import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { handleAllocateStream } from "../src/routes/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import type { MatterRole } from "../src/lib/types.ts";

const originalCap = config.firmMatterStreamCap;
const originalRateMax = config.firmMatterStreamAllocationRateLimitMax;
const originalLeaseIdle = config.firmMatterStreamLeaseIdleSeconds;
const originalSeatCap = config.firmMatterSeatLiveStreamCap;

afterEach(() => {
  (config as { firmMatterStreamCap: number }).firmMatterStreamCap = originalCap;
  (config as { firmMatterStreamAllocationRateLimitMax: number }).firmMatterStreamAllocationRateLimitMax = originalRateMax;
  (config as { firmMatterStreamLeaseIdleSeconds: number }).firmMatterStreamLeaseIdleSeconds = originalLeaseIdle;
  (config as { firmMatterSeatLiveStreamCap: number }).firmMatterSeatLiveStreamCap = originalSeatCap;
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
  return { store, matter, user, token: issueAuthTokens(store, user).access_token, seatToken: mintSeatToken(org, user, activeSeat.seat).token, seatId: activeSeat.seat.seat_id };
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

function append(fixture: ReturnType<typeof setup>, stream: string, blobId: string, seatId = fixture.seatId) {
  return fixture.store.appendMatterUpdate({
    matter_handle: fixture.matter.matter_handle,
    org_id: fixture.user.org_id,
    stream_handle: stream,
    blob_id: blobId,
    ciphertext: new Uint8Array([1]),
    author_seat: seatId,
    key_epoch: 1,
  });
}

describe("stream lease guards", () => {
  test("viewers cannot allocate streams", async () => {
    const fixture = setup("viewer");
    expect((await allocate(fixture)).status).toBe(403);
    fixture.store.close();
  });

  test("owners and editors can allocate streams", async () => {
    for (const role of ["owner", "editor"] as const) {
      const fixture = setup(role);
      const response = await allocate(fixture);
      expect(response.status).toBe(201);
      const body = await response.json() as { lease_commit_deadline_at: string };
      expect(Date.parse(body.lease_commit_deadline_at)).toBeGreaterThan(Date.now());
      fixture.store.close();
    }
  });

  test("an unused lease expires and frees its non-durable slot", () => {
    (config as { firmMatterStreamLeaseIdleSeconds: number }).firmMatterStreamLeaseIdleSeconds = 1;
    const fixture = setup("editor");
    const lease = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(fixture.store.countLiveMatterStreams(fixture.matter.matter_handle)).toBe(1); // root only
    expect(fixture.store.reclaimInactiveStreamLeases(new Date(Date.now() + 2_000).toISOString())).toBe(1);
    expect(fixture.store.streamBelongsToMatter(lease, fixture.matter.matter_handle)).toBe(false);
    expect(fixture.store.countLiveMatterStreams(fixture.matter.matter_handle)).toBe(1);
    fixture.store.close();
  });

  test("a stream with one accepted update is never reclaimed", () => {
    (config as { firmMatterStreamLeaseIdleSeconds: number }).firmMatterStreamLeaseIdleSeconds = 1;
    const fixture = setup("editor");
    const stream = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(append(fixture, stream, "first-write")).toMatchObject({ duplicate: false });
    expect(fixture.store.reclaimInactiveStreamLeases(new Date(Date.now() + 86_400_000).toISOString())).toBe(0);
    expect(fixture.store.streamBelongsToMatter(stream, fixture.matter.matter_handle)).toBe(true);
    expect(fixture.store.countLiveMatterStreams(fixture.matter.matter_handle)).toBe(2);
    fixture.store.close();
  });

  test("a crashed client leaks no permanent stream slot", () => {
    (config as { firmMatterStreamLeaseIdleSeconds: number }).firmMatterStreamLeaseIdleSeconds = 1;
    const fixture = setup("editor");
    const crashed = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(fixture.store.reclaimInactiveStreamLeases(new Date(Date.now() + 2_000).toISOString())).toBe(1);
    expect(fixture.store.streamBelongsToMatter(crashed, fixture.matter.matter_handle)).toBe(false);
    expect(fixture.store.countLiveMatterStreams(fixture.matter.matter_handle)).toBe(1);
    fixture.store.close();
  });

  test("allocation spam cannot exceed a seat's durable quota or block another editor", () => {
    (config as { firmMatterSeatLiveStreamCap: number }).firmMatterSeatLiveStreamCap = 1;
    const fixture = setup("editor");
    const aliceFirst = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(append(fixture, aliceFirst, "alice-first")).toMatchObject({ duplicate: false });
    const aliceExtra = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(append(fixture, aliceExtra, "alice-extra")).toEqual({ seatStreamLimitReached: true });
    const bobSeat = "seat-bob";
    const bobStream = fixture.store.createMatterStream(fixture.matter.matter_handle, bobSeat);
    expect(append(fixture, bobStream, "bob-first", bobSeat)).toMatchObject({ duplicate: false });
    expect(fixture.store.countSeatLiveMatterStreams(fixture.matter.matter_handle, fixture.seatId)).toBe(1);
    expect(fixture.store.countSeatLiveMatterStreams(fixture.matter.matter_handle, bobSeat)).toBe(1);
    fixture.store.close();
  });

  test("the matter cap counts only streams with accepted updates", () => {
    (config as { firmMatterStreamCap: number }).firmMatterStreamCap = 2; // root + one document
    const fixture = setup("editor");
    const first = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(append(fixture, first, "first-live")).toMatchObject({ duplicate: false });
    const pending = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    expect(append(fixture, pending, "cap-rejected")).toEqual({ streamLimitReached: true });
    expect(fixture.store.countLiveMatterStreams(fixture.matter.matter_handle)).toBe(2);
    fixture.store.close();
  });

  test("an encrypted but empty root update cannot make another lease durable", () => {
    const fixture = setup("editor");
    const lease = fixture.store.createMatterStream(fixture.matter.matter_handle, fixture.seatId);
    // The relay cannot inspect this ciphertext. It accepts the root update,
    // but no client-controlled field can change the lease's lifecycle.
    expect(append(fixture, fixture.matter.root_stream_handle, "empty-root")).toMatchObject({ duplicate: false });
    expect(fixture.store.countLiveMatterStreams(fixture.matter.matter_handle)).toBe(1);
    expect(fixture.store.reclaimInactiveStreamLeases(new Date(Date.now() + 86_400_000).toISOString())).toBe(1);
    expect(fixture.store.streamBelongsToMatter(lease, fixture.matter.matter_handle)).toBe(false);
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
