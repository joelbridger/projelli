import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { handlePushUpdate } from "../src/routes/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import type { MatterRole } from "../src/lib/types.ts";

const originalCap = config.firmMatterStreamCap;
const originalRateMax = config.firmMatterStreamWriteRateLimitMax;

afterEach(() => {
  (config as { firmMatterStreamCap: number }).firmMatterStreamCap = originalCap;
  (config as { firmMatterStreamWriteRateLimitMax: number }).firmMatterStreamWriteRateLimitMax = originalRateMax;
});

function stream(char: string) { return `sh2_${char.repeat(43)}`; }

function setup(role: MatterRole) {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "First write guard", plan: "practice", packs: [], seat_limit: 8 });
  const user = store.createUser({ org_id: org.org_id, email: `${role}@write.test`, password_hash: "x", role: "member" });
  const matter = store.createMatter({ org_id: org.org_id });
  store.activateProvisioningMatter(matter.matter_handle);
  store.addMatterMember({ matter_handle: matter.matter_handle, user_id: user.user_id, org_id: org.org_id, role });
  const activeSeat = store.activateSeat({ org_id: org.org_id, user_id: user.user_id, machine_id: `${role}-machine`, machine_label: null, seat_limit: 8 });
  if (!activeSeat.ok) throw new Error("test seat activation failed");
  return { store, matter, user, token: issueAuthTokens(store, user).access_token, seatToken: mintSeatToken(org, user, activeSeat.seat).token };
}

function request(fixture: ReturnType<typeof setup>, blobId: string): Request {
  return new Request("http://relay.test/v2/firm/matters/opaque/streams/opaque/updates", {
    method: "POST",
    headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
    body: JSON.stringify({ blob_id: blobId, ciphertext_b64: "AQ==", seat_token: fixture.seatToken, key_epoch: 1 }),
  });
}

async function push(fixture: ReturnType<typeof setup>, handle: string, blobId: string) {
  return handlePushUpdate(request(fixture, blobId), fixture.store, fixture.matter.matter_handle, handle, "127.0.0.1");
}

describe("client-generated stream first-write guards", () => {
  test("a client-generated handle is accepted and bound on its first write", async () => {
    const fixture = setup("editor");
    const handle = stream("A");
    expect((await push(fixture, handle, "first")).status).toBe(201);
    expect(fixture.store.streamBelongsToMatter(handle, fixture.matter.matter_handle)).toBe(true);
    fixture.store.close();
  });

  test("a handle already bound to another matter is rejected", async () => {
    const fixture = setup("editor");
    const other = fixture.store.createMatter({ org_id: fixture.user.org_id });
    fixture.store.activateProvisioningMatter(other.matter_handle);
    fixture.store.addMatterMember({ matter_handle: other.matter_handle, user_id: fixture.user.user_id, org_id: fixture.user.org_id, role: "editor" });
    const handle = stream("B");
    expect((await push(fixture, handle, "first")).status).toBe(201);
    expect((await handlePushUpdate(request(fixture, "hijack"), fixture.store, other.matter_handle, handle, "127.0.0.1")).status).toBe(403);
    fixture.store.close();
  });

  test("unused client handles cannot consume the live-stream cap", async () => {
    (config as { firmMatterStreamCap: number }).firmMatterStreamCap = 2; // root + one document
    const fixture = setup("editor");
    for (let i = 0; i < 100; i += 1) expect(fixture.store.streamBelongsToMatter(stream(String.fromCharCode(65 + (i % 26))), fixture.matter.matter_handle)).toBe(false);
    expect((await push(fixture, stream("C"), "first-live")).status).toBe(201);
    expect((await push(fixture, stream("D"), "over-cap")).status).toBe(409);
    fixture.store.close();
  });

  test("the per-seat write rate limit is enforced on push", async () => {
    (config as { firmMatterStreamWriteRateLimitMax: number }).firmMatterStreamWriteRateLimitMax = 1;
    const fixture = setup("editor");
    expect((await push(fixture, stream("E"), "first")).status).toBe(201);
    expect((await push(fixture, fixture.matter.root_stream_handle, "second")).status).toBe(429);
    fixture.store.close();
  });

  test("viewers and walled editors still cannot bind a stream", async () => {
    const viewer = setup("viewer");
    expect((await push(viewer, stream("F"), "viewer")).status).toBe(403);
    viewer.store.close();

    const editor = setup("editor");
    editor.store.setEthicalWall({ matter_handle: editor.matter.matter_handle, user_id: editor.user.user_id, org_id: editor.user.org_id, created_by: editor.user.user_id });
    expect((await push(editor, stream("G"), "walled")).status).toBe(403);
    editor.store.close();
  });
});
