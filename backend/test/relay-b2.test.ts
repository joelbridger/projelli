import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";

const store = new Store(":memory:");
const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
const base = `http://${server.hostname}:${server.port}`;
afterAll(() => server.stop(true));

async function call(path: string, body?: unknown, token?: string, seat?: string) {
  const res = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(seat ? { "x-seat-token": seat } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, any> };
}

describe("B2 relay envelopes, checkpoints, and multiplexing", () => {
  let license = "", admin = "", adminSeat = "", bob = "", bobSeat = "", bobId = "", matter = "";

  beforeAll(async () => {
    const org = await call("/admin/org", { name: `Relay ${crypto.randomUUID()}`, plan: "practice", packs: ["advisor"], seat_limit: 5, admin_email: `admin-${crypto.randomUUID()}@test.dev`, admin_password: "administrator-password" });
    license = org.json.license_key;
    const adminLogin = await call("/auth/login", { email: org.json.admin.email, password: "administrator-password" });
    admin = adminLogin.json.access_token;
    adminSeat = (await call("/org/activate", { license_key: license, machine_id: "admin-machine" }, admin)).json.seat_token;
    const created = await call("/org/users", { email: `bob-${crypto.randomUUID()}@test.dev`, password: "member-password-123" }, admin);
    bobId = created.json.user.user_id;
    bob = (await call("/auth/login", { email: created.json.user.email, password: "member-password-123" })).json.access_token;
    bobSeat = (await call("/org/activate", { license_key: license, machine_id: "bob-machine" }, bob)).json.seat_token;
    matter = (await call("/org/matters", { client_name: "Northcrest" }, admin)).json.matter.matter_id;
    expect((await call(`/matter/${matter}/members/add`, { user_id: bobId, role: "editor" }, admin)).status).toBe(200);
    const adminId = store.getUserByEmailWithHash(org.json.admin.email)!.user_id;
    store.upsertDevice({ device_id: "admin-device", user_id: adminId, org_id: store.getMatter(matter)!.org_id, machine_id: "admin-device", label: "Admin", pubkey_jwk: "{}" });
    store.upsertDevice({ device_id: "bob-device", user_id: bobId, org_id: store.getMatter(matter)!.org_id, machine_id: "bob-device", label: "Bob", pubkey_jwk: "{}" });
    store.upsertWrappedMatterKey({ matter_id: matter, epoch: 1, user_id: bobId, device_id: "bob-device", wrapped_key_b64: "opaque", published_by: adminId });
  });

  test("sealed envelopes are idempotent, org-scoped, TTL-exempt for approval, and wake a ticketed recipient", async () => {
    const body = { org_id: store.getMatter(matter)!.org_id, recipient_user_id: bobId, envelope_id: crypto.randomUUID(), ciphertext_b64: Buffer.from([1, 2, 3]).toString("base64"), transient_scope: { matter_id: matter }, key_hint: "recipient-only-hint", idempotency_key: crypto.randomUUID(), retention_until_terminal: true };
    const first = await call("/notify/send", body, admin, adminSeat);
    expect(first.status).toBe(201);
    const retry = await call("/notify/send", body, admin, adminSeat);
    expect(retry.status).toBe(200); expect(retry.json.duplicate).toBe(true); expect(retry.json.seq).toBe(first.json.seq);
    const inbox = await call(`/notify/inbox?org_id=${body.org_id}&since=0`, undefined, bob, bobSeat);
    expect(inbox.status).toBe(200); expect(inbox.json.envelopes).toHaveLength(1); expect(inbox.json.envelopes[0].key_hint).toBe("recipient-only-hint"); expect(inbox.json.envelopes[0].expires_at).toBeNull();
    const ticket = await call("/notify/sync-ticket", { org_id: body.org_id }, bob, bobSeat);
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}/notify/sync?org_id=${body.org_id}&ticket=${ticket.json.ticket}`);
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));
    const wake = new Promise<any>((resolve) => ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }));
    const next = await call("/notify/send", { ...body, envelope_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), retention_until_terminal: false }, admin, adminSeat);
    expect((await wake).seq).toBe(next.json.seq); ws.close();
    expect((await call("/notify/ack", { org_id: body.org_id, device_id: "bob-device", up_to_cursor: first.json.seq }, bob, bobSeat)).status).toBe(200);
    // A device can never advance an inbox outside its own organization.
    expect((await call("/notify/ack", { org_id: crypto.randomUUID(), device_id: "bob-device", up_to_cursor: first.json.seq }, bob, bobSeat)).status).toBe(404);
    expect((await call("/notify/terminal", { org_id: body.org_id, recipient_user_id: bobId, envelope_id: body.envelope_id, signed_terminal_notice_b64: "AQ==" }, admin, adminSeat)).status).toBe(200);
  });

  test("one document socket adds a second subscription and checkpoint prune waits for two receipts", async () => {
    const pushed = await call(`/matter/${matter}/updates`, { blob_id: crypto.randomUUID(), doc_id: "crm:record", ciphertext_b64: "AQ==", seat_token: adminSeat }, admin);
    const ticket = await call(`/matter/${matter}/sync-ticket`, {}, bob, bobSeat);
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}/matter/${matter}/sync?ticket=${ticket.json.ticket}&doc_id=crm:record&since=0`);
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));
    const ready = new Promise<any>((resolve) => ws.addEventListener("message", (event) => { const frame = JSON.parse(String(event.data)); if (frame.type === "ready" && frame.doc_id === "crm:tasks") resolve(frame); }));
    ws.send(JSON.stringify({ type: "subscribe", matter_id: matter, doc_id: "crm:tasks", since: 0 }));
    expect((await ready).watermark).toBe(0); ws.close();
    expect((await call(`/matter/${matter}/checkpoints/chunks`, { doc_id: "crm:record", generation: 1, chunk_index: 0, ciphertext_b64: "AQ==" }, admin, adminSeat)).status).toBe(201);
    expect((await call(`/matter/${matter}/checkpoints/manifest`, { doc_id: "crm:record", generation: 1, frontier: pushed.json.cursor, retention_eligible: true, manifest_ciphertext_b64: "AQ==" }, admin, adminSeat)).status).toBe(201);
    expect((await call(`/matter/${matter}/checkpoints/prune`, { doc_id: "crm:record", generation: 1 }, admin, adminSeat)).status).toBe(409);
    expect((await call(`/matter/${matter}/checkpoints/receipt`, { doc_id: "crm:record", generation: 1, device_id: "bob-device", signed_receipt_b64: "AQ==" }, bob, bobSeat)).status).toBe(201);
    expect((await call(`/matter/${matter}/checkpoints/receipt`, { doc_id: "crm:record", generation: 1, device_id: "admin-device", signed_receipt_b64: "AQ==" }, admin, adminSeat)).status).toBe(201);
    expect((await call(`/matter/${matter}/checkpoints/prune`, { doc_id: "crm:record", generation: 1 }, admin, adminSeat)).json.pruned).toBe(1);
  });
});
