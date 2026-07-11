import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { SyncTicketStore } from "../src/lib/syncTickets.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import {
  authorizeSyncConnect,
  handleAddMatterMember,
  handleActivateMatter,
  handleArchiveMatter,
  handleClearWall,
  handlePullUpdates,
  handlePushUpdate,
  handleSetWall,
  handleSyncTicket,
} from "../src/routes/matters.ts";
import { handleFetchMatterKey, handlePublishMatterKeys } from "../src/routes/matterKeys.ts";

function stream(char: string) {
  return `sh2_${char.repeat(43)}`;
}

function fixture() {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Archived relay denial", plan: "practice", packs: [], seat_limit: 8 });
  const admin = store.createUser({ org_id: org.org_id, email: "admin@archived.test", password_hash: "x", role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "member@archived.test", password_hash: "x", role: "member" });
  const matter = store.createMatter({ org_id: org.org_id });
  store.activateProvisioningMatter(matter.matter_handle);
  store.addMatterMember({ matter_handle: matter.matter_handle, user_id: member.user_id, org_id: org.org_id, role: "editor" });
  const seat = store.activateSeat({ org_id: org.org_id, user_id: member.user_id, machine_id: "member-machine", machine_label: null, seat_limit: 8 });
  if (!seat.ok) throw new Error("test seat activation failed");
  store.upsertWrappedMatterKey({ matter_handle: matter.matter_handle, epoch: matter.key_epoch, user_id: member.user_id, device_id: "member-device", wrapped_key_b64: "wrapped-key", published_by: admin.user_id });

  return {
    store,
    org,
    admin,
    member,
    matter,
    adminToken: issueAuthTokens(store, admin).access_token,
    memberToken: issueAuthTokens(store, member).access_token,
    memberSeat: mintSeatToken(org, member, seat.seat).token,
  };
}

function request(token: string, body: unknown, seat?: string) {
  return new Request("http://relay.test/v2/firm/route", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(seat ? { "x-seat-token": seat } : {}) },
    body: JSON.stringify(body),
  });
}

/** Hold body delivery until the test deliberately lets the handler continue. */
function delayedRequest(token: string, body: unknown, seat?: string) {
  let bodyRead!: () => void;
  let releaseBody!: () => void;
  const reading = new Promise<void>((resolve) => { bodyRead = resolve; });
  const release = new Promise<void>((resolve) => { releaseBody = resolve; });
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      bodyRead();
      await release;
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return {
    request: new Request("http://relay.test/v2/firm/route", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(seat ? { "x-seat-token": seat } : {}) },
      body: stream,
    }),
    reading,
    release: releaseBody,
  };
}

function pushRequest(f: ReturnType<typeof fixture>, blobId: string) {
  return request(f.memberToken, { blob_id: blobId, ciphertext_b64: "AQ==", seat_token: f.memberSeat, key_epoch: 1 });
}

async function expectOpaqueArchivedDenial(response: Response) {
  expect(response.status).toBe(404);
  expect((await response.text()).toLowerCase()).not.toContain("archived");
}

describe("archived matter relay denial", () => {
  test("a normal active matter still permits relay and key fetch", async () => {
    const f = fixture();
    expect((await handlePushUpdate(pushRequest(f, "active-push"), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "active-push")).status).toBe(201);
    expect((await handlePullUpdates(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "active-pull")).status).toBe(200);
    expect((await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "active-ticket", new SyncTicketStore())).status).toBe(200);
    expect((await handleFetchMatterKey(request(f.memberToken, { device_id: "member-device" }, f.memberSeat), f.store, f.matter.matter_handle)).status).toBe(200);
    f.store.close();
  });

  test("a normal active matter still accepts wrapped-key publishing", async () => {
    const f = fixture();
    const response = await handlePublishMatterKeys(
      request(f.adminToken, {
        epoch: 1,
        wrapped: [{ user_id: f.member.user_id, device_id: "active-publish-device", wrapped_key_b64: "active-wrapped-key" }],
      }),
      f.store,
      f.matter.matter_handle,
    );
    expect(response.status).toBe(200);
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "active-publish-device")).toMatchObject({ wrapped_key_b64: "active-wrapped-key" });
    f.store.close();
  });

  test("archive cannot be reversed, and relay access remains denied", async () => {
    const f = fixture();
    const tickets = new SyncTicketStore();
    const minted = await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "terminal-ticket", tickets);
    expect(minted.status).toBe(200);
    const { ticket } = await minted.json() as { ticket: string };

    expect((await handleArchiveMatter(request(f.adminToken, {}), f.store, f.matter.matter_handle)).status).toBe(200);
    await expectOpaqueArchivedDenial(await handleActivateMatter(request(f.adminToken, {}), f.store, f.matter.matter_handle));
    expect(f.store.getMatter(f.matter.matter_handle)?.status).toBe("archived");
    await expectOpaqueArchivedDenial(await handlePushUpdate(pushRequest(f, "terminal-push"), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "terminal-push"));
    await expectOpaqueArchivedDenial(await handlePullUpdates(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "terminal-pull"));
    await expectOpaqueArchivedDenial(await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "terminal-ticket-after-archive", tickets));
    await expectOpaqueArchivedDenial(await handleFetchMatterKey(request(f.memberToken, { device_id: "member-device" }, f.memberSeat), f.store, f.matter.matter_handle));
    const connection = authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${encodeURIComponent(ticket)}`), f.store, tickets);
    expect(connection.ok).toBe(false);
    f.store.close();
  });

  test("push to an archived matter is denied and cannot bind a new stream", async () => {
    const f = fixture();
    const newStream = stream("A");
    f.store.archiveMatter(f.matter.matter_handle);
    await expectOpaqueArchivedDenial(await handlePushUpdate(pushRequest(f, "archived-push"), f.store, f.matter.matter_handle, newStream, "archived-push"));
    expect(f.store.streamBelongsToMatter(newStream, f.matter.matter_handle)).toBe(false);
    f.store.close();
  });

  test("pull from an archived matter is denied", async () => {
    const f = fixture();
    f.store.archiveMatter(f.matter.matter_handle);
    await expectOpaqueArchivedDenial(await handlePullUpdates(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "archived-pull"));
    f.store.close();
  });

  test("sync-ticket minting for an archived matter is denied", async () => {
    const f = fixture();
    f.store.archiveMatter(f.matter.matter_handle);
    await expectOpaqueArchivedDenial(await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "archived-ticket", new SyncTicketStore()));
    f.store.close();
  });

  test("a ticket minted before archive cannot open a WebSocket afterwards", async () => {
    const f = fixture();
    const tickets = new SyncTicketStore();
    const minted = await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "prearchive-ticket", tickets);
    expect(minted.status).toBe(200);
    const { ticket } = await minted.json() as { ticket: string };
    f.store.archiveMatter(f.matter.matter_handle);
    const connection = authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${encodeURIComponent(ticket)}`), f.store, tickets);
    expect(connection.ok).toBe(false);
    if (!connection.ok) {
      expect(connection.resp.status).toBe(403);
      expect((await connection.resp.text()).toLowerCase()).not.toContain("archived");
    }
    f.store.close();
  });

  test("key fetch from an archived matter is denied", async () => {
    const f = fixture();
    f.store.archiveMatter(f.matter.matter_handle);
    await expectOpaqueArchivedDenial(await handleFetchMatterKey(request(f.memberToken, { device_id: "member-device" }, f.memberSeat), f.store, f.matter.matter_handle));
    f.store.close();
  });

  test("wrapped-key publishing to an archived matter is denied without writing material", async () => {
    const f = fixture();
    f.store.archiveMatter(f.matter.matter_handle);
    const response = await handlePublishMatterKeys(
      request(f.adminToken, {
        epoch: 1,
        wrapped: [{ user_id: f.member.user_id, device_id: "archived-publish-device", wrapped_key_b64: "archived-wrapped-key" }],
      }),
      f.store,
      f.matter.matter_handle,
    );
    await expectOpaqueArchivedDenial(response);
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "archived-publish-device")).toBeNull();
    f.store.close();
  });

  test("an archive that wins a wrapped-key publish race leaves no new key material", () => {
    const f = fixture();
    f.store.archiveMatter(f.matter.matter_handle);
    const result = f.store.publishWrappedMatterKeys({
      matter_handle: f.matter.matter_handle,
      org_id: f.org.org_id,
      epoch: 1,
      published_by: f.admin.user_id,
      wrapped: [{ user_id: f.member.user_id, device_id: "racing-publish-device", wrapped_key_b64: "racing-wrapped-key" }],
    });
    expect(result).toEqual({ matterArchived: true });
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "racing-publish-device")).toBeNull();
    f.store.close();
  });

  test("a key fetch waiting for its body returns no key material after archive wins", async () => {
    const f = fixture();
    const pending = delayedRequest(f.memberToken, { device_id: "member-device" }, f.memberSeat);
    const fetch = handleFetchMatterKey(pending.request, f.store, f.matter.matter_handle);
    await pending.reading;

    // This is the old TOCTOU: access used to be approved before the awaited
    // body read, so this archive could commit before the wrapped-key lookup.
    f.store.archiveMatter(f.matter.matter_handle);
    pending.release();

    const response = await fetch;
    expect(response.status).toBe(404);
    const responseBody = await response.text();
    expect(responseBody).not.toContain("wrapped-key");
    expect(responseBody.toLowerCase()).not.toContain("archived");
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "member-device")?.wrapped_key_b64).toBe("wrapped-key");
    f.store.close();
  });

  test("the store only permits forward terminal transitions and SQLite rejects a raw resurrection", () => {
    const f = fixture();
    const provisioning = f.store.createMatter({ org_id: f.org.org_id });
    expect(f.store.activateProvisioningMatter(provisioning.matter_handle)).toBe(true);
    expect(f.store.getMatter(provisioning.matter_handle)?.status).toBe("active");
    expect(f.store.archiveMatter(f.matter.matter_handle)).toBe(true);
    expect(f.store.activateProvisioningMatter(f.matter.matter_handle)).toBe(false);
    expect(f.store.getMatter(f.matter.matter_handle)?.status).toBe("archived");

    // This deliberately bypasses Store methods. The SQLite trigger must still
    // reject the write, so a future direct caller cannot resurrect this matter.
    expect(() => f.store.db.query("UPDATE matters SET status = 'active' WHERE matter_handle = ?").run(f.matter.matter_handle)).toThrow(/archived_matter_terminal/);
    f.store.close();
  });

  test("archive racing a first write cannot bind the stream after archive commits", () => {
    const f = fixture();
    const newStream = stream("B");
    // The append method takes its own IMMEDIATE transaction, so this models a
    // push which cleared the earlier access gate before this archive committed.
    f.store.archiveMatter(f.matter.matter_handle);
    expect(f.store.appendMatterUpdate({ matter_handle: f.matter.matter_handle, org_id: f.org.org_id, stream_handle: newStream, blob_id: "racing-first-write", ciphertext: new Uint8Array([1]), author_seat: "seat", key_epoch: 1 })).toEqual({ matterArchived: true });
    expect(f.store.streamBelongsToMatter(newStream, f.matter.matter_handle)).toBe(false);
    f.store.close();
  });

  test("archiving keeps administrator membership and wall controls available", async () => {
    const f = fixture();
    const target = f.store.createUser({ org_id: f.org.org_id, email: "target@archived.test", password_hash: "x", role: "member" });
    f.store.archiveMatter(f.matter.matter_handle);
    expect((await handleAddMatterMember(request(f.adminToken, { user_id: target.user_id, role: "viewer" }), f.store, f.matter.matter_handle)).status).toBe(200);
    expect((await handleSetWall(request(f.adminToken, { user_id: target.user_id }), f.store, f.matter.matter_handle)).status).toBe(200);
    expect((await handleClearWall(request(f.adminToken, { user_id: target.user_id }), f.store, f.matter.matter_handle)).status).toBe(200);
    f.store.close();
  });
});
