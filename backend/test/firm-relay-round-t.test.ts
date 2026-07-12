import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { config } from "../src/lib/config.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { buildServeOptions } from "../src/server.ts";

const opaque = (prefix: "sh2_" | "bh2_", fill: string) => `${prefix}${fill.repeat(43)}`;
const envelope = Buffer.from(new Uint8Array([2, ...new Array(28).fill(0)])).toString("base64");
const store = new Store(":memory:");
const server = Bun.serve(buildServeOptions(store, new FanoutHub()));
const base = `http://${server.hostname}:${server.port}`;
let admin = "", owner = "", editor = "", ownerSeat = "", editorSeat = "", matter = "", fake = "";
let ownerId = "", editorId = "", editorSeatId = "";
const originalStreamsPerSeat = config.firmMatterStreamsPerSeat;

async function request(path: string, method: "GET" | "POST", token?: string, seat?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(seat ? { "x-seat-token": seat } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, text: await response.text() };
}

beforeAll(() => {
  (config as { firmMatterStreamsPerSeat: number }).firmMatterStreamsPerSeat = 1;
  const org = store.createOrg({ name: "Round T", plan: "practice", packs: ["advisor"], seat_limit: 8 });
  const adminUser = store.createUser({ org_id: org.org_id, email: "admin@round-t.test", password_hash: "x", role: "admin" });
  const ownerUser = store.createUser({ org_id: org.org_id, email: "owner@round-t.test", password_hash: "x", role: "member" });
  const editorUser = store.createUser({ org_id: org.org_id, email: "editor@round-t.test", password_hash: "x", role: "member" });
  ownerId = ownerUser.user_id; editorId = editorUser.user_id;
  const ownerBinding = store.activateSeat({ org_id: org.org_id, user_id: ownerId, machine_id: "owner-machine", machine_label: null, seat_limit: 8 });
  const editorBinding = store.activateSeat({ org_id: org.org_id, user_id: editorId, machine_id: "editor-machine", machine_label: null, seat_limit: 8 });
  if (!ownerBinding.ok || !editorBinding.ok) throw new Error("fixture seat activation failed");
  editorSeatId = editorBinding.seat.seat_id;
  admin = issueAuthTokens(store, adminUser).access_token;
  owner = issueAuthTokens(store, ownerUser).access_token;
  editor = issueAuthTokens(store, editorUser).access_token;
  ownerSeat = mintSeatToken(org, ownerUser, ownerBinding.seat).token;
  editorSeat = mintSeatToken(org, editorUser, editorBinding.seat).token;
  const created = store.createMatter({ org_id: org.org_id }); matter = created.matter_handle;
  store.activateProvisioningMatter(matter);
  store.addMatterMember({ matter_handle: matter, org_id: org.org_id, user_id: ownerId, role: "owner" });
  store.addMatterMember({ matter_handle: matter, org_id: org.org_id, user_id: editorId, role: "editor" });
  fake = opaque("sh2_", "Z");
});
afterAll(() => { (config as { firmMatterStreamsPerSeat: number }).firmMatterStreamsPerSeat = originalStreamsPerSeat; server.stop(true); store.close(); });

describe("round T firm-relay controls", () => {
  test("an editor cannot exhaust the matter cap with fabricated handles", async () => {
    const first = opaque("sh2_", "A"), second = opaque("sh2_", "B");
    expect((await request(`/v2/firm/matters/${matter}/streams/${first}/updates`, "POST", editor, undefined, { blob_id: opaque("bh2_", "C"), ciphertext_b64: envelope, seat_token: editorSeat, key_epoch: 1 })).status).toBe(201);
    expect((await request(`/v2/firm/matters/${matter}/streams/${second}/updates`, "POST", editor, undefined, { blob_id: opaque("bh2_", "D"), ciphertext_b64: envelope, seat_token: editorSeat, key_epoch: 1 })).status).toBe(409);
  });

  test("a matter owner can discover and release an unreferenced opaque handle", async () => {
    const listed = await request(`/v2/firm/matters/${matter}/streams/list`, "POST", owner, undefined, {});
    expect(listed.status).toBe(200);
    expect(listed.text).toContain(opaque("sh2_", "A"));
    expect((await request(`/v2/firm/matters/${matter}/streams/release`, "POST", owner, undefined, { stream_handle: opaque("sh2_", "A") })).status).toBe(200);
  });

  test("a legitimate stream is never releasable by a non-owner", async () => {
    expect((await request(`/v2/firm/matters/${matter}/streams/release`, "POST", editor, undefined, { stream_handle: store.getMatter(matter)!.root_stream_handle })).status).toBe(403);
  });

  test("a walled user gets the identical opaque response for a real and fabricated stream", async () => {
    store.setEthicalWall({ matter_handle: matter, org_id: store.getMatter(matter)!.org_id, user_id: editorId, created_by: ownerId });
    const real = await request(`/v2/firm/streams/${store.getMatter(matter)!.root_stream_handle}/updates?since=0`, "GET", editor, editorSeat);
    const unknown = await request(`/v2/firm/streams/${fake}/updates?since=0`, "GET", editor, editorSeat);
    expect(real).toEqual(unknown);
    expect(real).toEqual({ status: 404, text: '{"error":"stream_access_denied"}' });
    store.clearEthicalWall(matter, editorId);
  });

  test("a free-text seat reason is rejected before any durable record or audit row", async () => {
    const sentinel = "CLIENT_SECRET_ROUND_T";
    const response = await request("/org/seat/revoke", "POST", admin, undefined, { seat_id: editorSeatId, reason: sentinel });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain(sentinel);
    expect(JSON.stringify(store.getSeat(editorSeatId))).not.toContain(sentinel);
    expect(JSON.stringify(store.listAudit(store.getMatter(matter)!.org_id))).not.toContain(sentinel);
  });

  test("a route absent from the firm route table is unreachable", async () => {
    expect((await request("/org/future-persist", "POST", admin, undefined, {})).status).toBe(404);
  });
});
