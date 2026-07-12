import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";
import { decodeWrappedKeyEnvelope } from "../src/lib/wrappedKeyEnvelope.ts";

const wrappedEnvelope = decodeWrappedKeyEnvelope(Buffer.from([0x4c, 0x57, 0x4b, 1, 4, ...new Array(140).fill(0)]).toString("base64"))!;
const ciphertextEnvelope = Buffer.from([2, ...new Array(28).fill(0)]).toString("base64");
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

function fixture(path = ":memory:", activate = true) {
  const store = new Store(path);
  const org = store.createOrg({ name: "Archived relay denial", plan: "practice", packs: [], seat_limit: 8 });
  const admin = store.createUser({ org_id: org.org_id, email: "admin@archived.test", password_hash: "x", role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "member@archived.test", password_hash: "x", role: "member" });
  for (const [device_id, user_id] of [["member-device", member.user_id], ["active-publish-device", member.user_id], ["archived-publish-device", member.user_id]] as const) {
    store.upsertDevice({ device_id, user_id, org_id: org.org_id, machine_id: device_id, label: "", pubkey_jwk: '{"kty":"EC","crv":"P-256","x":"x","y":"y"}' });
  }
  const matter = store.createMatter({ org_id: org.org_id });
  if (activate) store.activateProvisioningMatter(matter.matter_handle);
  store.addMatterMember({ matter_handle: matter.matter_handle, user_id: member.user_id, org_id: org.org_id, role: "editor" });
  const seat = store.activateSeat({ org_id: org.org_id, user_id: member.user_id, machine_id: "member-machine", machine_label: null, seat_limit: 8 });
  if (!seat.ok) throw new Error("test seat activation failed");
  store.upsertWrappedMatterKey({ matter_handle: matter.matter_handle, epoch: matter.key_epoch, user_id: member.user_id, device_id: "member-device", wrapped_key: wrappedEnvelope, published_by: admin.user_id });

  return {
    store,
    org,
    admin,
    member,
    matter,
    adminToken: issueAuthTokens(store, admin).access_token,
    memberToken: issueAuthTokens(store, member).access_token,
    memberSeat: mintSeatToken(org, member, seat.seat).token,
    memberSeatId: seat.seat.seat_id,
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
  return request(f.memberToken, { blob_id: `bh2_${Buffer.from(blobId).toString("base64url").padEnd(43, "A").slice(0, 43)}`, ciphertext_b64: ciphertextEnvelope, seat_token: f.memberSeat, key_epoch: 1 });
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
        wrapped: [{ user_id: f.member.user_id, device_id: "active-publish-device", wrapped_key_b64: Buffer.from(wrappedEnvelope).toString("base64") }],
      }),
      f.store,
      f.matter.matter_handle,
    );
    expect(response.status).toBe(200);
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "active-publish-device")).toMatchObject({ wrapped_key_b64: Buffer.from(wrappedEnvelope).toString("base64") });
    f.store.close();
  });

  test("a publisher demoted after the route check cannot overwrite current-epoch wrapped keys", async () => {
    const f = fixture();
    f.store.addMatterMember({ matter_handle: f.matter.matter_handle, user_id: f.member.user_id, org_id: f.org.org_id, role: "owner" });
    const originalPublish = f.store.publishWrappedMatterKeys.bind(f.store);
    let changed = false;
    f.store.publishWrappedMatterKeys = (input) => {
      // The route has already accepted this member as an owner. Simulate the
      // concurrent role change in the gap immediately before the write method.
      if (!changed) {
        changed = true;
        f.store.addMatterMember({ matter_handle: f.matter.matter_handle, user_id: f.member.user_id, org_id: f.org.org_id, role: "viewer" });
      }
      return originalPublish(input);
    };

    const response = await handlePublishMatterKeys(
      request(f.memberToken, {
        epoch: 1,
        wrapped: [{ user_id: f.member.user_id, device_id: "active-publish-device", wrapped_key_b64: Buffer.from(wrappedEnvelope).toString("base64") }],
      }),
      f.store,
      f.matter.matter_handle,
    );
    expect(response.status).toBe(403);
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "active-publish-device")).toBeNull();
    f.store.close();
  });

  test("a publisher walled after the route check cannot overwrite current-epoch wrapped keys", async () => {
    const f = fixture();
    f.store.addMatterMember({ matter_handle: f.matter.matter_handle, user_id: f.member.user_id, org_id: f.org.org_id, role: "owner" });
    const originalPublish = f.store.publishWrappedMatterKeys.bind(f.store);
    let changed = false;
    f.store.publishWrappedMatterKeys = (input) => {
      // Again, place the access change after the route's early check but before
      // the storage transaction starts.
      if (!changed) {
        changed = true;
        f.store.setEthicalWall({ matter_handle: f.matter.matter_handle, user_id: f.member.user_id, org_id: f.org.org_id, created_by: f.admin.user_id });
      }
      return originalPublish(input);
    };

    const response = await handlePublishMatterKeys(
      request(f.memberToken, {
        epoch: 1,
        wrapped: [{ user_id: f.member.user_id, device_id: "active-publish-device", wrapped_key_b64: Buffer.from(wrappedEnvelope).toString("base64") }],
      }),
      f.store,
      f.matter.matter_handle,
    );
    expect(response.status).toBe(403);
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "active-publish-device")).toBeNull();
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
        wrapped: [{ user_id: f.member.user_id, device_id: "archived-publish-device", wrapped_key_b64: Buffer.from(wrappedEnvelope).toString("base64") }],
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
      wrapped: [{ user_id: f.member.user_id, device_id: "racing-publish-device", wrapped_key: wrappedEnvelope }],
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
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.member.user_id, "member-device")?.wrapped_key_b64).toBe(Buffer.from(wrappedEnvelope).toString("base64"));
    f.store.close();
  });

  test("provisioning matters are denied on every relay and key-data path", async () => {
    const f = fixture(":memory:", false);
    const tickets = new SyncTicketStore();
    await expectOpaqueArchivedDenial(await handlePushUpdate(pushRequest(f, "provisioning-push"), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "provisioning-push"));
    await expectOpaqueArchivedDenial(await handlePullUpdates(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "provisioning-pull"));
    await expectOpaqueArchivedDenial(await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "provisioning-ticket", tickets));
    await expectOpaqueArchivedDenial(await handleFetchMatterKey(request(f.memberToken, { device_id: "member-device" }, f.memberSeat), f.store, f.matter.matter_handle));
    await expectOpaqueArchivedDenial(await handlePublishMatterKeys(request(f.adminToken, { epoch: 1, wrapped: [] }), f.store, f.matter.matter_handle));
    const { ticket } = tickets.mint({ matterHandle: f.matter.matter_handle, streamHandle: f.matter.root_stream_handle, orgId: f.org.org_id, userId: f.member.user_id, seatId: f.memberSeatId, role: "member" });
    const connection = authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${ticket}`), f.store, tickets);
    expect(connection.ok).toBe(false);
    f.store.close();
  });

  test("malformed statuses fail closed on every relay and key-data path", async () => {
    const path = `/tmp/firm-relay-malformed-${crypto.randomUUID()}.sqlite`;
    const f = fixture(path);
    const attacker = new Database(path);
    // This simulates a separately-authorized SQLite/schema attacker. Store no
    // longer exposes its connection, but resolveAccess must still deny a corrupt
    // legacy/on-disk value if one somehow exists.
    attacker.exec("PRAGMA ignore_check_constraints = ON; DROP TRIGGER prevent_invalid_matter_status_transition;");
    attacker.query("UPDATE matters SET status = 'malformed' WHERE matter_handle = ?").run(f.matter.matter_handle);
    attacker.close();

    const tickets = new SyncTicketStore();
    await expectOpaqueArchivedDenial(await handlePushUpdate(pushRequest(f, "malformed-push"), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "malformed-push"));
    await expectOpaqueArchivedDenial(await handlePullUpdates(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "malformed-pull"));
    await expectOpaqueArchivedDenial(await handleSyncTicket(request(f.memberToken, {}, f.memberSeat), f.store, f.matter.matter_handle, f.matter.root_stream_handle, "malformed-ticket", tickets));
    await expectOpaqueArchivedDenial(await handleFetchMatterKey(request(f.memberToken, { device_id: "member-device" }, f.memberSeat), f.store, f.matter.matter_handle));
    await expectOpaqueArchivedDenial(await handlePublishMatterKeys(request(f.adminToken, { epoch: 1, wrapped: [] }), f.store, f.matter.matter_handle));
    const { ticket } = tickets.mint({ matterHandle: f.matter.matter_handle, streamHandle: f.matter.root_stream_handle, orgId: f.org.org_id, userId: f.member.user_id, seatId: f.memberSeatId, role: "member" });
    const connection = authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${ticket}`), f.store, tickets);
    expect(connection.ok).toBe(false);
    f.store.close();
    rmSync(path, { force: true });
  });

  test("SQLite accepts only legal status transitions and blocks archived delete-reinsert resurrection", () => {
    const path = `/tmp/firm-relay-transitions-${crypto.randomUUID()}.sqlite`;
    const f = fixture(path);
    const provisioningSelf = f.store.createMatter({ org_id: f.org.org_id });
    const provisioningToActive = f.store.createMatter({ org_id: f.org.org_id });
    const provisioningToArchived = f.store.createMatter({ org_id: f.org.org_id });
    const activeSelf = f.store.createMatter({ org_id: f.org.org_id });
    const activeToArchived = f.store.createMatter({ org_id: f.org.org_id });
    const archivedSelf = f.store.createMatter({ org_id: f.org.org_id });
    f.store.activateProvisioningMatter(activeSelf.matter_handle);
    f.store.activateProvisioningMatter(activeToArchived.matter_handle);
    f.store.archiveMatter(archivedSelf.matter_handle);
    f.store.archiveMatter(f.matter.matter_handle);
    f.store.close();

    const attacker = new Database(path);
    expect(() => attacker.query("INSERT INTO matters (matter_handle, org_id, root_stream_handle, status, key_epoch, created_at) VALUES (?, ?, ?, 'malformed', 1, 'now')").run("mh2_invalid_status", f.org.org_id, "sh2_invalid_status")).toThrow(/CHECK constraint failed/);
    const update = (matterHandle: string, status: string) => attacker.query("UPDATE matters SET status = ? WHERE matter_handle = ?").run(status, matterHandle);

    // Every explicitly legal edge, including no-op transitions.
    expect(update(provisioningSelf.matter_handle, "provisioning").changes).toBe(1);
    expect(update(provisioningToActive.matter_handle, "active").changes).toBe(1);
    expect(update(provisioningToArchived.matter_handle, "archived").changes).toBeGreaterThan(0);
    expect(update(activeSelf.matter_handle, "active").changes).toBe(1);
    expect(update(activeToArchived.matter_handle, "archived").changes).toBeGreaterThan(0);
    expect(update(archivedSelf.matter_handle, "archived").changes).toBeGreaterThan(0);

    // Every illegal edge is rejected: backwards, resurrection, and malformed.
    expect(() => update(activeSelf.matter_handle, "provisioning")).toThrow(/invalid_matter_status_transition/);
    expect(() => update(activeSelf.matter_handle, "malformed")).toThrow(/invalid_matter_status_transition/);
    expect(() => update(archivedSelf.matter_handle, "provisioning")).toThrow(/invalid_matter_status_transition/);
    expect(() => update(archivedSelf.matter_handle, "active")).toThrow(/invalid_matter_status_transition/);
    expect(() => update(archivedSelf.matter_handle, "malformed")).toThrow(/invalid_matter_status_transition/);
    expect(() => update(provisioningSelf.matter_handle, "malformed")).toThrow(/invalid_matter_status_transition/);

    // This is the hostile delete+reinsert sequence: foreign keys are disabled,
    // but retained streams/updates/wrapped keys still make the delete abort.
    attacker.exec("PRAGMA foreign_keys = OFF;");
    expect(() => attacker.query("DELETE FROM matters WHERE matter_handle = ?").run(f.matter.matter_handle)).toThrow(/archived_matter_deletion_forbidden/);
    expect(() => attacker.query("INSERT INTO matters (matter_handle, org_id, root_stream_handle, status, key_epoch, created_at) VALUES (?, ?, ?, 'active', 1, 'now')").run(f.matter.matter_handle, f.org.org_id, f.matter.root_stream_handle)).toThrow(/archived_matter_handle_tombstoned|UNIQUE constraint failed/);
    attacker.close();
    rmSync(path, { force: true });
  });

  test("an archived handle remains tombstoned after raw child cleanup and rejects INSERT OR REPLACE", () => {
    const path = `/tmp/firm-relay-tombstone-${crypto.randomUUID()}.sqlite`;
    const f = fixture(path);
    f.store.archiveMatter(f.matter.matter_handle);
    f.store.close();
    const attacker = new Database(path);
    attacker.exec("PRAGMA foreign_keys = OFF");
    attacker.query("DELETE FROM matter_updates WHERE matter_handle = ?").run(f.matter.matter_handle);
    attacker.query("DELETE FROM wrapped_matter_keys WHERE matter_handle = ?").run(f.matter.matter_handle);
    attacker.query("DELETE FROM matter_members WHERE matter_handle = ?").run(f.matter.matter_handle);
    attacker.query("DELETE FROM ethical_walls WHERE matter_handle = ?").run(f.matter.matter_handle);
    attacker.query("DELETE FROM matter_streams WHERE matter_handle = ?").run(f.matter.matter_handle);
    expect(() => attacker.query("INSERT OR REPLACE INTO matters (matter_handle, org_id, root_stream_handle, status, key_epoch, created_at) VALUES (?, ?, ?, 'active', 1, 'now')").run(f.matter.matter_handle, f.org.org_id, f.matter.root_stream_handle)).toThrow(/archived_matter_handle_tombstoned|archived_matter_deletion_forbidden/);
    attacker.close();
    rmSync(path, { force: true });
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
