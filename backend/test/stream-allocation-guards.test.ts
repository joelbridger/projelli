import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { handleAllocateStream } from "../src/routes/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import type { MatterRole } from "../src/lib/types.ts";

const originalCap = config.firmMatterStreamCap;
const originalRateMax = config.firmMatterStreamAllocationRateLimitMax;
const originalTtl = config.firmMatterProvisionalStreamTtlSeconds;

afterEach(() => {
  (config as { firmMatterStreamCap: number }).firmMatterStreamCap = originalCap;
  (config as { firmMatterStreamAllocationRateLimitMax: number }).firmMatterStreamAllocationRateLimitMax = originalRateMax;
  (config as { firmMatterProvisionalStreamTtlSeconds: number }).firmMatterProvisionalStreamTtlSeconds = originalTtl;
});

function setup(role: MatterRole) {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Allocation guard", plan: "practice", packs: [], seat_limit: 8 });
  const user = store.createUser({ org_id: org.org_id, email: `${role}@allocation.test`, password_hash: "x", role: "member" });
  const matter = store.createMatter({ org_id: org.org_id });
  store.setMatterStatus(matter.matter_handle, "active");
  store.addMatterMember({ matter_handle: matter.matter_handle, user_id: user.user_id, org_id: org.org_id, role });
  const activeSeat = store.activateSeat({ org_id: org.org_id, user_id: user.user_id, machine_id: `${role}-machine`, machine_label: null, seat_limit: 8 });
  if (!activeSeat.ok) throw new Error("test seat activation failed");
  return { store, matter, user, token: issueAuthTokens(store, user).access_token, seatToken: mintSeatToken(org, user, activeSeat.seat).token };
}

function allocationRequest(token: string, seatToken: string): Request {
  return new Request("http://relay.test/v2/firm/matters/opaque/streams", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-seat-token": seatToken },
    body: "{}",
  });
}

async function allocate(fixture: ReturnType<typeof setup>) {
  return handleAllocateStream(allocationRequest(fixture.token, fixture.seatToken), fixture.store, fixture.matter.matter_handle);
}

describe("stream allocation guards", () => {
  test("viewers cannot allocate streams", async () => {
    const fixture = setup("viewer");
    expect((await allocate(fixture)).status).toBe(403);
    fixture.store.close();
  });

  test("owners and editors can allocate streams", async () => {
    for (const role of ["owner", "editor"] as const) {
      const fixture = setup(role);
      expect((await allocate(fixture)).status).toBe(201);
      fixture.store.close();
    }
  });

  test("the per-matter stream cap rejects more streams", async () => {
    (config as { firmMatterStreamCap: number }).firmMatterStreamCap = 2;
    const fixture = setup("editor");
    expect((await allocate(fixture)).status).toBe(201);
    expect((await allocate(fixture)).status).toBe(409);
    fixture.store.close();
  });

  test("expired provisional allocations are reclaimed and do not consume the cap", () => {
    const fixture = setup("editor");
    const provisional = fixture.store.createMatterStream(fixture.matter.matter_handle, 1);
    expect(fixture.store.countMatterStreams(fixture.matter.matter_handle)).toBe(2);
    expect(fixture.store.purgeExpiredProvisionalStreams(new Date(Date.now() + 2_000).toISOString())).toBe(1);
    expect(fixture.store.countMatterStreams(fixture.matter.matter_handle)).toBe(1);
    expect(fixture.store.streamBelongsToMatter(provisional, fixture.matter.matter_handle)).toBe(false);
    fixture.store.close();
  });

  test("a root update commits an allocation while an uncommitted crash leaves no permanent slot", () => {
    const fixture = setup("editor");
    const committed = fixture.store.createMatterStream(fixture.matter.matter_handle, 1);
    const accepted = fixture.store.appendMatterUpdate({
      matter_handle: fixture.matter.matter_handle, org_id: fixture.user.org_id,
      stream_handle: fixture.matter.root_stream_handle, blob_id: "root-publishes-stream",
      ciphertext: new Uint8Array([2]), author_seat: "seat", key_epoch: 1,
      commit_stream_handle: committed,
    });
    expect("commitRejected" in accepted).toBe(false);
    expect(fixture.store.purgeExpiredProvisionalStreams(new Date(Date.now() + 2_000).toISOString())).toBe(0);
    expect(fixture.store.streamBelongsToMatter(committed, fixture.matter.matter_handle)).toBe(true);
    const crashed = fixture.store.createMatterStream(fixture.matter.matter_handle, 1);
    expect(fixture.store.purgeExpiredProvisionalStreams(new Date(Date.now() + 2_000).toISOString())).toBe(1);
    expect(fixture.store.streamBelongsToMatter(crashed, fixture.matter.matter_handle)).toBe(false);
    fixture.store.close();
  });

  test("a seat cannot allocate streams faster than its allocation limit", async () => {
    (config as { firmMatterStreamAllocationRateLimitMax: number }).firmMatterStreamAllocationRateLimitMax = 1;
    const fixture = setup("editor");
    expect((await allocate(fixture)).status).toBe(201);
    expect((await allocate(fixture)).status).toBe(429);
    fixture.store.close();
  });

  test("an ethically walled editor remains denied", async () => {
    const fixture = setup("editor");
    fixture.store.setEthicalWall({ matter_handle: fixture.matter.matter_handle, user_id: fixture.user.user_id, org_id: fixture.user.org_id, created_by: fixture.user.user_id });
    expect((await allocate(fixture)).status).toBe(403);
    fixture.store.close();
  });
});
