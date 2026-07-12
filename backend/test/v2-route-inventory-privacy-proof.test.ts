/**
 * Hostile-client proof driven by the live v2 input inventory.
 *
 * Adding a relay route/field means adding it to V2_FIRM_ROUTE_SPECS first;
 * this test then automatically sends every sentinel through it. The checks
 * cover text and BLOB database columns, audit rows, caught server logs, HTTP
 * responses, and every observed WebSocket frame.
 */
import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";
import { V2_FIRM_REJECTED_INPUTS, V2_FIRM_ROUTE_SPECS, V2_FIRM_SHARED_INPUTS, type V2FirmRouteId, type V2FirmRouteSpec } from "../src/lib/v2RouteInventory.ts";

const SENTINELS = ["CLIENT_SECRET_NIMBUS", "matter-semantic-123", "doc-advisory-plan.docx"] as const;
const wrappedEnvelope = Buffer.from([0x4c, 0x57, 0x4b, 1, 4, ...new Array(140).fill(0)]).toString("base64");
const ciphertextEnvelope = Buffer.from([2, ...new Array(28).fill(0)]).toString("base64");
const blobId = `bh2_${"A".repeat(43)}`;

function fixture() {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Inventory proof", plan: "practice", packs: ["advisor"], seat_limit: 8 });
  const admin = store.createUser({ org_id: org.org_id, email: "admin@inventory.test", password_hash: "x", role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "member@inventory.test", password_hash: "x", role: "member" });
  store.upsertDevice({ device_id: "admin-device", user_id: admin.user_id, org_id: org.org_id, machine_id: "admin", label: "device", pubkey_jwk: "{}" });
  store.upsertDevice({ device_id: "member-device", user_id: member.user_id, org_id: org.org_id, machine_id: "member", label: "device", pubkey_jwk: "{}" });
  const adminSeat = store.activateSeat({ org_id: org.org_id, user_id: admin.user_id, machine_id: "admin", machine_label: null, seat_limit: 8 });
  if (!adminSeat.ok) throw new Error("test seat activation failed");
  const matter = store.createMatter({ org_id: org.org_id });
  store.addMatterMember({ matter_handle: matter.matter_handle, user_id: admin.user_id, org_id: org.org_id, role: "owner" });
  store.addMatterMember({ matter_handle: matter.matter_handle, user_id: member.user_id, org_id: org.org_id, role: "editor" });
  store.activateProvisioningMatter(matter.matter_handle);
  return {
    store, admin, member, matter,
    auth: `Bearer ${issueAuthTokens(store, admin).access_token}`,
    seat: mintSeatToken(store.getOrg(org.org_id)!, admin, adminSeat.seat).token,
  };
}

function assertNoSentinels(value: unknown, label: string): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const sentinel of SENTINELS) expect(text, `${label} contains ${sentinel}`).not.toContain(sentinel);
}

function assertStoreAndAuditAreClean(store: Store): void {
  const db = store.inspectReadOnly();
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") as Array<{ name: string }>;
  for (const { name } of tables) {
    const table = `"${name.replaceAll('"', '""')}"`;
    const columns = db.all(`PRAGMA table_info(${table})`) as Array<{ name: string }>;
    for (const { name: columnName } of columns) {
      const column = `"${columnName.replaceAll('"', '""')}"`;
      for (const sentinel of SENTINELS) {
        expect(db.all(`SELECT 1 FROM ${table} WHERE instr(CAST(${column} AS TEXT), ?) > 0`, sentinel), `${name}.${columnName}`).toHaveLength(0);
      }
    }
  }
  for (const { org_id } of db.all("SELECT org_id FROM orgs") as Array<{ org_id: string }>) assertNoSentinels(store.listAudit(org_id), `audit ${org_id}`);
}

function concretePath(spec: V2FirmRouteSpec, matterHandle: string, streamHandle: string): string {
  return spec.path.replace(":matter_handle", matterHandle).replace(":stream_handle", streamHandle);
}

function bodyFor(route: V2FirmRouteId, memberId: string, seat: string): Record<string, unknown> {
  switch (route) {
    case "releaseMatterStream": return { stream_handle: `sh2_${"R".repeat(43)}` };
    case "addMatterMember": return { user_id: memberId, role: "editor" };
    case "removeMatterMember": return { user_id: memberId };
    case "setWall": return { user_id: memberId };
    case "clearWall": return { user_id: memberId };
    case "publishMatterKeys": return { epoch: 1, wrapped: [{ user_id: memberId, device_id: "member-device", wrapped_key_b64: wrappedEnvelope }] };
    case "fetchMatterKey": return { device_id: "admin-device" };
    case "pushUpdate": return { blob_id: blobId, ciphertext_b64: ciphertextEnvelope, seat_token: seat, key_epoch: 1 };
    default: return {};
  }
}

function replaceBodyValue(body: Record<string, unknown>, name: string, sentinel: string): Record<string, unknown> {
  const copy = structuredClone(body);
  if (name === "all unlisted body keys and values") return { ...copy, [sentinel]: sentinel };
  if (name === "wrapped (array shape)") return { ...copy, wrapped: sentinel };
  if (name.startsWith("wrapped[].")) {
    const key = name.slice("wrapped[].".length);
    if (key === "all unlisted keys and values") return { ...copy, wrapped: [{ ...(copy.wrapped as Array<Record<string, unknown>>)[0], [sentinel]: sentinel }] };
    return { ...copy, wrapped: [{ ...(copy.wrapped as Array<Record<string, unknown>>)[0], [key]: sentinel }] };
  }
  return { ...copy, [name]: sentinel };
}

describe("v2 route inventory hostile-client privacy proof", () => {
  test("the executable inventory covers each route and every listed input rejects or ignores hostile text without reflection", async () => {
    const { store, admin, member, matter, auth, seat } = fixture();
    const logs: unknown[][] = [];
    const frames: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub(), { onWebSocketFrame: (frame) => frames.push(frame) }));
    const base = `http://${server.hostname}:${server.port}`;
    try {
      expect(new Set(V2_FIRM_ROUTE_SPECS.map((route) => route.id)).size).toBe(V2_FIRM_ROUTE_SPECS.length);
      expect(V2_FIRM_ROUTE_SPECS.map((route) => route.path)).toEqual(expect.arrayContaining([
        "/v2/firm/matters", "/v2/firm/matters/:matter_handle/keys/publish", "/v2/firm/streams/:stream_handle/updates", "/v2/firm/sync",
      ]));

      for (const spec of V2_FIRM_ROUTE_SPECS) {
        const path = concretePath(spec, matter.matter_handle, matter.root_stream_handle);
        const inputValues = spec.inputs.filter((input) => input.location !== "websocket-frame");
        const everyInput = [...V2_FIRM_SHARED_INPUTS, ...V2_FIRM_REJECTED_INPUTS.filter((input) => spec.method === "POST" || input.location !== "body"), ...inputValues];
        for (const sentinel of SENTINELS) {
          for (const input of everyInput) {
            let requestPath = path;
            let headers: Record<string, string> = { authorization: auth, "x-seat-token": seat, "content-type": "application/json" };
            let body = bodyFor(spec.id, member.user_id, seat);
            let query = spec.id === "pullUpdates" ? "since=0" : spec.id === "syncSocket" ? `ticket=${"0".repeat(64)}` : "";

            if (input.location === "path") requestPath = requestPath.replace(input.name === "matter_handle" ? matter.matter_handle : matter.root_stream_handle, sentinel);
            if (input.location === "query") {
              if (input.name === "all unlisted query keys and values" || input.name.endsWith("(key)")) query = `${encodeURIComponent(sentinel)}=${encodeURIComponent(sentinel)}`;
              else query = `${input.name.startsWith("since") ? "since" : "ticket"}=${encodeURIComponent(sentinel)}`;
            }
            if (input.location === "body") body = replaceBodyValue(body, input.name, sentinel);
            if (input.location === "header") {
              if (input.name.startsWith("authorization (Bearer")) headers.authorization = `Bearer ${sentinel}`;
              else if (input.name.startsWith("x-seat-token (value")) headers["x-seat-token"] = sentinel;
              else if (input.name.startsWith("content-type")) headers["content-type"] = sentinel;
              else if (input.name.startsWith("upgrade")) headers.upgrade = sentinel;
              else headers[`x-probe-${sentinel}`] = sentinel;
            }

            const response = await fetch(`${base}${requestPath}${query ? `?${query}` : ""}`, {
              method: spec.method,
              headers,
              ...(spec.method === "POST" ? { body: JSON.stringify(body) } : {}),
            });
            if (input.name.includes("all unlisted")) expect(response.status, `${spec.id} ${input.name}`).toBe(400);
            assertNoSentinels(await response.text(), `${spec.id} ${input.location}:${input.name} response`);
          }

        }
      }

      assertStoreAndAuditAreClean(store);
      assertNoSentinels(logs, "server logs");
      assertNoSentinels(frames, "WebSocket frames");
    } finally {
      console.error = originalError;
      server.stop(true);
      store.close();
    }
  });
});
