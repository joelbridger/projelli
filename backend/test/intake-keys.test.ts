/** Opaque, seat-gated intake key exchange: no readable intake or matter IDs cross the relay. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { buildServeOptions } from "../src/server.ts";

const store = new Store(":memory:");
const server = Bun.serve(buildServeOptions(store, new FanoutHub()));
const base = `http://${server.hostname}:${server.port}`;
const intakeHandle = `ih2_${"I".repeat(43)}`;
const wrappedEnvelope = Buffer.from([0x4c, 0x57, 0x4b, 1, 4, ...new Array(140).fill(0)]).toString("base64");
let adminToken = "";
let memberToken = "";
let memberSeat = "";
let matterHandle = "";
let memberId = "";

async function post(path: string, body: unknown, token = adminToken, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

beforeAll(() => {
  const org = store.createOrg({ name: "Intake keys", plan: "practice", packs: ["advisor"], seat_limit: 4 });
  const admin = store.createUser({ org_id: org.org_id, email: "admin@intake.test", password_hash: "x", role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "member@intake.test", password_hash: "x", role: "member" });
  memberId = member.user_id;
  store.upsertDevice({ device_id: "member-device", user_id: member.user_id, org_id: org.org_id, machine_id: "member-machine", label: "", pubkey_jwk: "{}" });
  const seat = store.activateSeat({ org_id: org.org_id, user_id: member.user_id, machine_id: "member-machine", machine_label: null, seat_limit: 4 });
  if (!seat.ok) throw new Error("test seat activation failed");
  adminToken = issueAuthTokens(store, admin).access_token;
  memberToken = issueAuthTokens(store, member).access_token;
  memberSeat = mintSeatToken(store.getOrg(org.org_id)!, member, seat.seat).token;
  const matter = store.createMatter({ org_id: org.org_id });
  matterHandle = matter.matter_handle;
  store.addMatterMember({ matter_handle: matterHandle, user_id: admin.user_id, org_id: org.org_id, role: "owner" });
  store.addMatterMember({ matter_handle: matterHandle, user_id: member.user_id, org_id: org.org_id, role: "editor" });
  store.activateProvisioningMatter(matterHandle);
});

afterAll(() => {
  server.stop(true);
  store.close();
});

describe("opaque intake key routes", () => {
  test("publishes a wrapped key to an opaque intake handle and fetches it back for the active recipient seat", async () => {
    const published = await post(`/v2/firm/intake/${intakeHandle}/keys/publish`, {
      matter_handle: matterHandle,
      epoch: 1,
      wrapped: [{ user_id: memberId, device_id: "member-device", wrapped_key_b64: wrappedEnvelope }],
    });
    expect(published).toMatchObject({ status: 200, body: { ok: true, stored: 1 } });

    const fetched = await post(`/v2/firm/intake/${intakeHandle}/keys/fetch`, { device_id: "member-device" }, memberToken, { "x-seat-token": memberSeat });
    expect(fetched).toMatchObject({ status: 200, body: { epoch: 1, wrapped_key_b64: wrappedEnvelope } });
  });

  test("keeps the legacy readable intake key address unreachable", async () => {
    expect((await post("/intake/some-readable-id/keys", { matter_id: "Smith family matter" })).status).toBe(404);
  });

  test("rejects a readable matter value in the new opaque publish body", async () => {
    expect((await post(`/v2/firm/intake/${intakeHandle}/keys/publish`, {
      matter_handle: "Smith family matter",
      epoch: 1,
      wrapped: [],
    })).status).toBe(400);
  });

  test("returns 404 before dispatch for a malformed intake handle in the URL", async () => {
    expect((await post("/v2/firm/intake/Smith-family/keys/publish", {
      matter_handle: matterHandle,
      epoch: 1,
      wrapped: [],
    })).status).toBe(404);
  });

  test("rejects un-inventoried extra body fields", async () => {
    expect((await post(`/v2/firm/intake/${intakeHandle}/keys/publish`, {
      matter_handle: matterHandle,
      epoch: 1,
      wrapped: [],
      unexpected: "not-in-the-inventory",
    })).status).toBe(400);
  });
});
