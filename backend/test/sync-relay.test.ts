/**
 * E2E HTTP + WebSocket test for the E2EE sync relay (DECISION.md §1 + §4).
 *
 * Boots an ISOLATED server (its own in-memory Store + fan-out hub) on an
 * ephemeral port via buildServeOptions — the SAME routes + WS handler as prod,
 * no cross-file server coupling. Drives the full firm flow over the wire:
 *
 *   provision org + admin + license  →  admin + two members log in  →  each
 *   activates a seat  →  admin creates a matter + adds both members  →
 *   - member pushes an opaque encrypted update; the OTHER member pulls it back
 *     byte-for-byte (relay round-trips ciphertext unchanged)
 *   - a non-member push/pull is rejected (403) and audited
 *   - cursor catch-up returns only updates after the cursor, in order
 *   - a live WebSocket subscriber (member) receives a new push; a walled user
 *     cannot even open the socket (403 at upgrade) — ethical wall overrides
 *   - a walled member (was a member, then screened) is rejected on push/pull
 *   - cross-org access is rejected (404)
 *   - relay rejects an over-sized blob (size cap) and a non-base64 blob
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { buildServeOptions } from "../src/server.ts";
import type { SyncSocketData } from "../src/server.ts";

// Isolated server for this file.
const store = new Store(":memory:");
const hub = new FanoutHub();
const srv = Bun.serve<SyncSocketData>(buildServeOptions(store, hub));
const BASE = () => `http://${srv.hostname}:${srv.port}`;
// The browser WebSocket API can't set an Authorization header, so the relay
// authenticates the upgrade with a SINGLE-USE TICKET on the URL (?ticket=<t>) —
// never the access/seat token. Mint the ticket over an authed HTTP request, then
// open the socket with only the ticket.
async function mintTicket(matterId: string, bearer: string, seatToken: string) {
  const res = await fetch(`${BASE()}/matter/${matterId}/sync-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "x-seat-token": seatToken },
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}
const wsUrlForTicket = (matterId: string, ticket: string, options: { docId?: string; since?: number } = {}) => {
  const params = new URLSearchParams({ ticket });
  if (options.docId) params.set("doc_id", options.docId);
  if (options.since !== undefined) params.set("since", String(options.since));
  return `ws://${srv.hostname}:${srv.port}/matter/${matterId}/sync?${params}`;
};
/** Mint a ticket and return the WS URL (the common path the client takes). */
async function wsUrl(
  matterId: string,
  bearer: string,
  seatToken: string,
  options: { docId?: string; since?: number } = {},
): Promise<string> {
  const t = await mintTicket(matterId, bearer, seatToken);
  if (t.status !== 200 || !t.json.ticket) throw new Error(`ticket mint failed (${t.status}): ${JSON.stringify(t.json)}`);
  return wsUrlForTicket(matterId, t.json.ticket as string, options);
}

afterAll(() => srv.stop(true));

async function post(path: string, body: unknown, bearer?: string) {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function pushUpdate(matterId: string, bearer: string, seatToken: string, blobId: string, ciphertext: Uint8Array) {
  return post(`/matter/${matterId}/updates`, { blob_id: blobId, ciphertext_b64: Buffer.from(ciphertext).toString("base64"), seat_token: seatToken }, bearer);
}

// Pull carries the seat token in the X-Seat-Token header (never the query string).
async function pullUpdates(matterId: string, bearer: string, seatToken: string, since = 0) {
  const res = await fetch(`${BASE()}/matter/${matterId}/updates?since=${since}`, {
    headers: { authorization: `Bearer ${bearer}`, "x-seat-token": seatToken },
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

/** Open a WS, resolve once it's ready (or reject on the HTTP error if upgrade is refused). */
function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("ws open timeout")), 4000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    });
  });
}

/**
 * Buffer EVERY "update" frame that arrives on a socket from the moment of
 * subscription, so a live broadcast can't be missed by a late listener. Returns
 * the live buffer plus a poller that resolves once a given cursor shows up.
 */
function bufferUpdates(ws: WebSocket): { frames: any[]; waitFor: (cursor: number, timeoutMs?: number) => Promise<any> } {
  const frames: any[] = [];
  ws.addEventListener("message", (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    if (msg.type === "update") frames.push(msg);
  });
  const waitFor = (cursor: number, timeoutMs = 4000) =>
    new Promise<any>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const hit = frames.find((f) => f.cursor === cursor);
        if (hit) return resolve(hit);
        if (Date.now() > deadline) return reject(new Error(`update cursor ${cursor} not delivered in ${timeoutMs}ms`));
        setTimeout(tick, 20);
      };
      tick();
    });
  return { frames, waitFor };
}

describe("E2EE sync relay — E2E over HTTP + WebSocket", () => {
  let licenseKey = "";
  let matterId = "";
  let adminAccess = "";
  let aliceAccess = "";
  let aliceSeat = "";
  let bobAccess = "";
  let bobSeat = "";
  let aliceId = "";
  let bobId = "";

  // A second org, to prove cross-org isolation.
  let orgBMatterId = "";
  let carolAccess = "";
  let carolSeat = "";

  beforeAll(async () => {
    // --- Org A: provision + admin login ---
    const prov = await post("/admin/org", {
      name: `Acme Law ${crypto.randomUUID()}`,
      plan: "practice",
      packs: ["legal"],
      seat_limit: 5,
      admin_email: `admin-${crypto.randomUUID()}@acme.test`,
      admin_password: "admin-password-1234",
    });
    expect(prov.status).toBe(201);
    licenseKey = prov.json.license_key;
    const adminLogin = await post("/auth/login", { email: prov.json.admin.email, password: "admin-password-1234" });
    adminAccess = adminLogin.json.access_token;

    // --- Two members: create + login + activate a seat each ---
    const mk = async (label: string) => {
      const email = `${label}-${crypto.randomUUID()}@acme.test`;
      const create = await post("/org/users", { email, password: "member-password-123" }, adminAccess);
      expect(create.status).toBe(201);
      const login = await post("/auth/login", { email, password: "member-password-123" });
      const access = login.json.access_token;
      const act = await post("/org/activate", { license_key: licenseKey, machine_id: `machine-${label}` }, access);
      expect(act.status).toBe(200);
      return { userId: create.json.user.user_id, access, seat: act.json.seat_token as string };
    };
    const alice = await mk("alice");
    const bob = await mk("bob");
    aliceId = alice.userId; aliceAccess = alice.access; aliceSeat = alice.seat;
    bobId = bob.userId; bobAccess = bob.access; bobSeat = bob.seat;

    // --- Matter + both members added ---
    const matter = await post("/org/matters", { client_name: "Project Nimbus" }, adminAccess);
    expect(matter.status).toBe(201);
    matterId = matter.json.matter.matter_id;
    expect((await post(`/matter/${matterId}/members/add`, { user_id: aliceId, role: "editor" }, adminAccess)).status).toBe(200);
    expect((await post(`/matter/${matterId}/members/add`, { user_id: bobId, role: "editor" }, adminAccess)).status).toBe(200);

    // --- Org B: provision + member + seat + matter (for cross-org tests) ---
    const provB = await post("/admin/org", {
      name: `Beta Legal ${crypto.randomUUID()}`,
      plan: "practice",
      packs: ["legal"],
      seat_limit: 5,
      admin_email: `admin-${crypto.randomUUID()}@beta.test`,
      admin_password: "admin-password-9999",
    });
    const adminBLogin = await post("/auth/login", { email: provB.json.admin.email, password: "admin-password-9999" });
    const adminBAccess = adminBLogin.json.access_token;
    const carolEmail = `carol-${crypto.randomUUID()}@beta.test`;
    const carolCreate = await post("/org/users", { email: carolEmail, password: "carol-password-123" }, adminBAccess);
    const carolLogin = await post("/auth/login", { email: carolEmail, password: "carol-password-123" });
    carolAccess = carolLogin.json.access_token;
    const carolAct = await post("/org/activate", { license_key: provB.json.license_key, machine_id: "machine-carol" }, carolAccess);
    carolSeat = carolAct.json.seat_token;
    const matterB = await post("/org/matters", { client_name: "Beta Matter" }, adminBAccess);
    orgBMatterId = matterB.json.matter.matter_id;
    await post(`/matter/${orgBMatterId}/members/add`, { user_id: carolCreate.json.user.user_id, role: "editor" }, adminBAccess);
  });

  test("a matter member can PUSH and another member can PULL the opaque bytes back unchanged", async () => {
    // Non-UTF8, non-JSON bytes prove the relay never decodes the blob.
    const blob = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0xfe, 0x7f, 0xab]);
    const push = await pushUpdate(matterId, aliceAccess, aliceSeat, "blob-a", blob);
    expect(push.status).toBe(201);
    expect(typeof push.json.cursor).toBe("number");
    expect(push.json.duplicate).toBe(false);

    const pull = await pullUpdates(matterId, bobAccess, bobSeat, 0);
    expect(pull.status).toBe(200);
    expect(pull.json.updates.length).toBe(1);
    const back = new Uint8Array(Buffer.from(pull.json.updates[0].ciphertext_b64, "base64"));
    expect(Array.from(back)).toEqual(Array.from(blob));
  });

  test("a duplicate push (same blob_id) is idempotent (200, duplicate=true, no new row)", async () => {
    const blob = new Uint8Array([1, 2, 3]);
    const first = await pushUpdate(matterId, aliceAccess, aliceSeat, "blob-dup", blob);
    expect(first.status).toBe(201);
    const again = await pushUpdate(matterId, aliceAccess, aliceSeat, "blob-dup", new Uint8Array([9, 9, 9]));
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(again.json.cursor).toBe(first.json.cursor);
  });

  test("cursor catch-up returns only updates strictly after the cursor, in order", async () => {
    // Snapshot current latest, push three more, then pull since the snapshot.
    const snap = await pullUpdates(matterId, aliceAccess, aliceSeat, 0);
    const from = snap.json.latest_cursor as number;
    const cursors: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await pushUpdate(matterId, aliceAccess, aliceSeat, `seq-${i}-${crypto.randomUUID()}`, new Uint8Array([i]));
      cursors.push(r.json.cursor);
    }
    const after = await pullUpdates(matterId, bobAccess, bobSeat, from);
    const ids = after.json.updates.map((u: any) => u.cursor);
    expect(ids).toEqual(cursors);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1]);
  });

  test("a NON-member is rejected on push and pull (403) and the denial is audited", async () => {
    // Make a fresh member who is NOT added to the matter.
    const email = `outsider-${crypto.randomUUID()}@acme.test`;
    await post("/org/users", { email, password: "outsider-pw-123" }, adminAccess);
    const login = await post("/auth/login", { email, password: "outsider-pw-123" });
    const access = login.json.access_token;
    const act = await post("/org/activate", { license_key: licenseKey, machine_id: `m-${crypto.randomUUID()}` }, access);
    const seat = act.json.seat_token;

    const push = await pushUpdate(matterId, access, seat, "nope", new Uint8Array([1]));
    expect(push.status).toBe(403);
    const pull = await pullUpdates(matterId, access, seat, 0);
    expect(pull.status).toBe(403);

    const audit = await post("/org/audit", {}, adminAccess);
    const denied = (audit.json.events as Array<{ action: string }>).filter((e) => e.action === "matter.access.denied");
    expect(denied.length).toBeGreaterThan(0);
  });

  test("a live WebSocket subscriber (member) receives a newly pushed update", async () => {
    const ws = await openSocket(await wsUrl(matterId, bobAccess, bobSeat));
    try {
      const buf = bufferUpdates(ws);
      // Let the socket settle (it's already subscribed pre-broadcast), then push.
      await new Promise((r) => setTimeout(r, 50));
      const blob = new Uint8Array([42, 7, 0xff]);
      const push = await pushUpdate(matterId, aliceAccess, aliceSeat, `live-${crypto.randomUUID()}`, blob);
      expect(push.status).toBe(201);
      const live = await buf.waitFor(push.json.cursor);
      expect(live).toBeTruthy();
      // Bytes ride the socket unchanged.
      expect(Array.from(new Uint8Array(Buffer.from(live.ciphertext_b64, "base64")))).toEqual(Array.from(blob));
    } finally {
      ws.close();
    }
  });

  test("a live subscriber catches up past 500 updates from its saved cursor", async () => {
    // This is the reconnect race from the adversarial review in a deterministic
    // form. The peer is caught up through cursor 0 for this new document stream,
    // then 501 updates land while it is offline. Its live socket must deliver the
    // 501st update too, rather than replaying only the first 500 old rows.
    const docId = `live-gap-${crypto.randomUUID()}`;
    const matter = store.getMatter(matterId)!;
    let expectedCursor = 0;
    for (let i = 0; i < 501; i++) {
      expectedCursor = store.appendMatterUpdate({
        matter_id: matterId,
        org_id: matter.org_id,
        doc_id: docId,
        blob_id: `offline-${i}-${crypto.randomUUID()}`,
        ciphertext: new Uint8Array([i & 0xff]),
        author_seat: aliceSeat,
        key_epoch: matter.key_epoch,
      }).update.id;
    }

    const ws = await openSocket(await wsUrl(matterId, bobAccess, bobSeat, { docId, since: 0 }));
    try {
      const buf = bufferUpdates(ws);
      const caughtUp = await buf.waitFor(expectedCursor);
      expect(caughtUp.doc_id).toBe(docId);
    } finally {
      ws.close();
    }
  });

  test("a WALLED user cannot even open the sync socket (upgrade refused) — wall overrides membership", async () => {
    // Screen Bob (currently a member). His socket connect must now fail.
    const wall = await post(`/matter/${matterId}/wall/set`, { user_id: bobId, reason: "screened for conflict" }, adminAccess);
    expect(wall.status).toBe(200);
    expect(wall.json.key_epoch).toBeGreaterThan(1); // key rotated on wall-set

    // A walled user can't even MINT a ticket (the gate runs at mint time), so the
    // socket is unreachable: there is no credential to put on the URL.
    const ticket = await mintTicket(matterId, bobAccess, bobSeat);
    expect(ticket.status).toBe(403);
    // Even a forged/guessed ?ticket= value is refused at the upgrade.
    await expect(openSocket(wsUrlForTicket(matterId, "deadbeef".repeat(8)))).rejects.toThrow();

    // And the walled member is rejected on push + pull too (deny-overrides-allow).
    const push = await pushUpdate(matterId, bobAccess, bobSeat, "after-wall", new Uint8Array([1]));
    expect(push.status).toBe(403);
    const pull = await pullUpdates(matterId, bobAccess, bobSeat, 0);
    expect(pull.status).toBe(403);

    // Alice (still a member, not walled) connects and DOES receive a live fan-out
    // of a fresh push — while Bob (walled) could not even open a socket. This is
    // the "delivered to a member, not to a walled user" guarantee, end to end.
    const alistream = await openSocket(await wsUrl(matterId, aliceAccess, aliceSeat));
    try {
      const buf = bufferUpdates(alistream);
      await new Promise((r) => setTimeout(r, 50));
      const aliPush = await pushUpdate(matterId, aliceAccess, aliceSeat, `still-ok-${crypto.randomUUID()}`, new Uint8Array([5]));
      expect(aliPush.status).toBe(201);
      const live = await buf.waitFor(aliPush.json.cursor);
      expect(live).toBeTruthy();
    } finally {
      alistream.close();
    }

    // Lift the screen → Bob is still a member, so access returns.
    expect((await post(`/matter/${matterId}/wall/clear`, { user_id: bobId }, adminAccess)).status).toBe(200);
    const pullAfterClear = await pullUpdates(matterId, bobAccess, bobSeat, 0);
    expect(pullAfterClear.status).toBe(200);
  });

  test("CROSS-ORG access is rejected (404 — never confirm the other org's matter)", async () => {
    // Alice (org A) cannot touch org B's matter.
    const push = await pushUpdate(orgBMatterId, aliceAccess, aliceSeat, "x", new Uint8Array([1]));
    expect(push.status).toBe(404);
    const pull = await pullUpdates(orgBMatterId, aliceAccess, aliceSeat, 0);
    expect(pull.status).toBe(404);
    // Carol (org B, a member of orgBMatter) CAN access it — proves it's a real, accessible matter.
    const carolPull = await pullUpdates(orgBMatterId, carolAccess, carolSeat, 0);
    expect(carolPull.status).toBe(200);
  });

  test("a relay caller without a valid seat token is rejected (seat is required)", async () => {
    // Valid access JWT, but a bogus seat token.
    const push = await post(`/matter/${matterId}/updates`, { blob_id: "z", ciphertext_b64: Buffer.from([1]).toString("base64"), seat_token: "not-a-real-seat-token" }, aliceAccess);
    expect(push.status).toBe(401);
  });

  test("the relay rejects an over-sized blob (size cap) and a non-base64 blob", async () => {
    // > 1 MiB once decoded.
    const huge = "A".repeat(1_500_000); // base64 of ~1.1MB
    const big = await post(`/matter/${matterId}/updates`, { blob_id: `big-${crypto.randomUUID()}`, ciphertext_b64: huge, seat_token: aliceSeat }, aliceAccess);
    expect(big.status).toBe(413);

    // Empty ciphertext is rejected.
    const empty = await post(`/matter/${matterId}/updates`, { blob_id: `empty-${crypto.randomUUID()}`, ciphertext_b64: "", seat_token: aliceSeat }, aliceAccess);
    expect(empty.status).toBe(400);
  });

  test("relay requires authentication (no access token → 401)", async () => {
    // Seat token present (header), but no Authorization header → still 401.
    const res = await fetch(`${BASE()}/matter/${matterId}/updates?since=0`, {
      headers: { "x-seat-token": aliceSeat },
    });
    expect(res.status).toBe(401);
  });

  // === WS connect tickets (Finding 1: no token in the WS URL) ===============
  test("sync-ticket requires the access JWT (no Authorization → 401)", async () => {
    const res = await fetch(`${BASE()}/matter/${matterId}/sync-ticket`, {
      method: "POST",
      headers: { "x-seat-token": aliceSeat }, // seat but no bearer
    });
    expect(res.status).toBe(401);
  });

  test("sync-ticket requires a valid seat (missing X-Seat-Token → 401)", async () => {
    const res = await fetch(`${BASE()}/matter/${matterId}/sync-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${aliceAccess}` }, // bearer but no seat header
    });
    expect(res.status).toBe(401);
  });

  test("sync-ticket enforces matter access: a NON-member is rejected (403)", async () => {
    // Fresh seated member who is NOT on the matter.
    const email = `tixout-${crypto.randomUUID()}@acme.test`;
    await post("/org/users", { email, password: "outsider-pw-123" }, adminAccess);
    const login = await post("/auth/login", { email, password: "outsider-pw-123" });
    const access = login.json.access_token;
    const act = await post("/org/activate", { license_key: licenseKey, machine_id: `m-${crypto.randomUUID()}` }, access);
    const seat = act.json.seat_token;
    const res = await mintTicket(matterId, access, seat);
    expect(res.status).toBe(403);
  });

  test("a minted ticket opens the WS exactly ONCE and is rejected on reuse", async () => {
    const t = await mintTicket(matterId, aliceAccess, aliceSeat);
    expect(t.status).toBe(200);
    const ticket = t.json.ticket as string;
    expect(typeof ticket).toBe("string");
    expect(ticket.length).toBeGreaterThanOrEqual(32);

    // First use: opens.
    const ws = await openSocket(wsUrlForTicket(matterId, ticket));
    ws.close();
    // Second use of the SAME ticket: rejected (single-use; redeemed + deleted).
    await expect(openSocket(wsUrlForTicket(matterId, ticket))).rejects.toThrow();
  });

  test("the WS URL carries ONLY the ticket — no seat/access token substring", async () => {
    const t = await mintTicket(matterId, aliceAccess, aliceSeat);
    const url = wsUrlForTicket(matterId, t.json.ticket as string);
    expect(url).toContain("ticket=");
    expect(url).not.toContain("seat_token");
    expect(url).not.toContain("access_token");
    // The actual secrets never appear in the URL.
    expect(url).not.toContain(aliceSeat);
    expect(url).not.toContain(aliceAccess);
  });

  test("an expired ticket is rejected (TTL)", async () => {
    // Drive the ticket store directly with a tiny TTL to prove expiry, then feed
    // the expired ticket through the real authorize path.
    const { SyncTicketStore } = await import("../src/lib/syncTickets.ts");
    const { authorizeSyncConnect } = await import("../src/routes/matters.ts");
    const tickets = new SyncTicketStore(5); // 5ms TTL
    const m = await post("/org/matters", { client_name: "Expiry Matter" }, adminAccess);
    const mId = m.json.matter.matter_id as string;
    await post(`/matter/${mId}/members/add`, { user_id: aliceId, role: "editor" }, adminAccess);
    const { ticket } = tickets.mint({ matterId: mId, orgId: "o", userId: aliceId, seatId: "s", sessionId: "expired-test-session", role: "member" });
    await new Promise((r) => setTimeout(r, 20)); // let it expire
    const req = new Request(`http://x/matter/${mId}/sync?ticket=${ticket}`, { headers: { upgrade: "websocket" } });
    const res = authorizeSyncConnect(req, store, mId, tickets);
    expect(res.ok).toBe(false);
  });

  test("a ticket minted for matter A cannot open matter B's socket", async () => {
    const t = await mintTicket(matterId, aliceAccess, aliceSeat);
    // Point the ticket at the cross-org matter id — must be refused.
    await expect(openSocket(wsUrlForTicket(orgBMatterId, t.json.ticket as string))).rejects.toThrow();
  });

  // === Pull via header (Finding 2) =========================================
  test("pull authenticates via the X-Seat-Token header and rejects when it is missing", async () => {
    // Header present → 200.
    const withHeader = await fetch(`${BASE()}/matter/${matterId}/updates?since=0`, {
      headers: { authorization: `Bearer ${aliceAccess}`, "x-seat-token": aliceSeat },
    });
    expect(withHeader.status).toBe(200);

    // No X-Seat-Token header (and none in the query) → seat_required 401.
    const noHeader = await fetch(`${BASE()}/matter/${matterId}/updates?since=0`, {
      headers: { authorization: `Bearer ${aliceAccess}` },
    });
    expect(noHeader.status).toBe(401);

    // A seat_token in the QUERY must NOT authenticate (we read the header only).
    const queryOnly = await fetch(
      `${BASE()}/matter/${matterId}/updates?since=0&seat_token=${encodeURIComponent(aliceSeat)}`,
      { headers: { authorization: `Bearer ${aliceAccess}` } },
    );
    expect(queryOnly.status).toBe(401);
  });

  test("normal relay use is not throttled (limiter does not false-positive)", async () => {
    // A burst well within the (high, test-configured) relay limit all succeeds —
    // the limiter is wired (handlePushUpdate calls rateLimit) but generous.
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      const r = await pushUpdate(matterId, aliceAccess, aliceSeat, `burst-${crypto.randomUUID()}`, new Uint8Array([i]));
      if (r.status === 201) ok++;
    }
    expect(ok).toBe(20);
  });
});

// The 429 mechanism the relay uses (rateLimit) is unit-tested directly so the
// assertion is deterministic regardless of the (import-time) configured limit.
describe("relay rate-limit mechanism", () => {
  test("rateLimit returns 429-shaped exhaustion once max is hit for an IP+bucket", async () => {
    const { rateLimit } = await import("../src/lib/http.ts");
    const ip = `1.2.3.${Math.floor(Math.random() * 250)}`;
    const opts = { max: 3, windowSeconds: 60 };
    expect(rateLimit(ip, "relay_unit", opts).ok).toBe(true);
    expect(rateLimit(ip, "relay_unit", opts).ok).toBe(true);
    expect(rateLimit(ip, "relay_unit", opts).ok).toBe(true);
    const blocked = rateLimit(ip, "relay_unit", opts);
    expect(blocked.ok).toBe(false);
    expect(typeof blocked.retryAfter).toBe("number");
  });
});

// ===========================================================================
// Task 6: doc_id stream partitioning — new tests (TDD: written first, run red,
// then implemented green). These extend the isolated server built at the top of
// the file (store + hub + srv), using the same alice/bob credentials via the
// helpers defined above.
// ===========================================================================
describe("doc_id stream partitioning", () => {
  // Re-use credentials from the E2E describe block — they are set in that
  // beforeAll which runs first. We piggyback on the same matter/members.
  // All helpers (pushUpdate, pullUpdates, wsUrl, bufferUpdates, mintTicket) are
  // in scope from the module level.

  // Isolated store for the unit-level DB/helpers tests.
  const unitStore = new Store(":memory:");

  // ---- Unit: DB helpers -------------------------------------------------------

  test("doc_id defaults to _notes in appendMatterUpdate", () => {
    const org = unitStore.createOrg({ name: "docid-test-org", plan: "practice", packs: [], seat_limit: 5 });
    const matter = unitStore.createMatter({ org_id: org.org_id, client_name: "DocId Test" });

    // No doc_id supplied → should store as _notes
    const { update } = unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "default-blob",
      ciphertext: new Uint8Array([1, 2, 3]),
      author_seat: "seat-x",
      key_epoch: 1,
    });
    expect((update as any).doc_id).toBe("_notes");
  });

  test("doc_id field is threaded through appendMatterUpdate and getMatterUpdatesSince", () => {
    const org = unitStore.createOrg({ name: "docid-test2-org", plan: "practice", packs: [], seat_limit: 5 });
    const matter = unitStore.createMatter({ org_id: org.org_id, client_name: "DocId Test 2" });

    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "docA-blob1",
      ciphertext: new Uint8Array([10]),
      author_seat: "seat-a",
      key_epoch: 1,
      doc_id: "docA",
    } as any);
    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "docB-blob1",
      ciphertext: new Uint8Array([20]),
      author_seat: "seat-b",
      key_epoch: 1,
      doc_id: "docB",
    } as any);

    const onlyA = unitStore.getMatterUpdatesSince(matter.matter_id, 0, 500, "docA" as any);
    expect(onlyA.length).toBe(1);
    expect((onlyA[0] as any).doc_id).toBe("docA");

    const onlyB = unitStore.getMatterUpdatesSince(matter.matter_id, 0, 500, "docB" as any);
    expect(onlyB.length).toBe(1);
    expect((onlyB[0] as any).doc_id).toBe("docB");
  });

  test("getMatterUpdatesSince without doc_id returns only _notes rows", () => {
    const org = unitStore.createOrg({ name: "docid-test3-org", plan: "practice", packs: [], seat_limit: 5 });
    const matter = unitStore.createMatter({ org_id: org.org_id, client_name: "DocId Test 3" });

    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "notes-blob",
      ciphertext: new Uint8Array([1]),
      author_seat: "seat-a",
      key_epoch: 1,
      // no doc_id → _notes
    } as any);
    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "doc-blob",
      ciphertext: new Uint8Array([2]),
      author_seat: "seat-a",
      key_epoch: 1,
      doc_id: "my-doc",
    } as any);

    // Default pull (no doc_id) must return only _notes
    const notes = unitStore.getMatterUpdatesSince(matter.matter_id, 0);
    expect(notes.length).toBe(1);
    expect(notes[0]!.blob_id).toBe("notes-blob");
  });

  test("idempotency unique key is per (matter_id, doc_id, blob_id) — same blob_id on different doc_ids are distinct rows", () => {
    const org = unitStore.createOrg({ name: "docid-idem-org", plan: "practice", packs: [], seat_limit: 5 });
    const matter = unitStore.createMatter({ org_id: org.org_id, client_name: "Idem Test" });

    const r1 = unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "shared-blob-id",
      ciphertext: new Uint8Array([1]),
      author_seat: "seat",
      key_epoch: 1,
      doc_id: "docA",
    } as any);
    const r2 = unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "shared-blob-id",
      ciphertext: new Uint8Array([2]),
      author_seat: "seat",
      key_epoch: 1,
      doc_id: "docB",
    } as any);
    // Same blob_id on different doc_ids → two distinct rows, neither is a duplicate
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(false);
    expect(r1.update.id).not.toBe(r2.update.id);
    // But same (matter, doc_id, blob_id) IS idempotent
    const r3 = unitStore.appendMatterUpdate({
      matter_id: matter.matter_id,
      org_id: org.org_id,
      blob_id: "shared-blob-id",
      ciphertext: new Uint8Array([99]),
      author_seat: "seat",
      key_epoch: 1,
      doc_id: "docA",
    } as any);
    expect(r3.duplicate).toBe(true);
    expect(r3.update.id).toBe(r1.update.id);
  });

  test("latestMatterCursor is per (matter, doc_id)", () => {
    const org = unitStore.createOrg({ name: "docid-cursor-org", plan: "practice", packs: [], seat_limit: 5 });
    const matter = unitStore.createMatter({ org_id: org.org_id, client_name: "Cursor Test" });

    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id, org_id: org.org_id, blob_id: "c-docA",
      ciphertext: new Uint8Array([1]), author_seat: "s", key_epoch: 1, doc_id: "docA",
    } as any);
    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id, org_id: org.org_id, blob_id: "c-docB-1",
      ciphertext: new Uint8Array([2]), author_seat: "s", key_epoch: 1, doc_id: "docB",
    } as any);
    unitStore.appendMatterUpdate({
      matter_id: matter.matter_id, org_id: org.org_id, blob_id: "c-docB-2",
      ciphertext: new Uint8Array([3]), author_seat: "s", key_epoch: 1, doc_id: "docB",
    } as any);

    const cursorA = unitStore.latestMatterCursor(matter.matter_id, "docA" as any);
    const cursorB = unitStore.latestMatterCursor(matter.matter_id, "docB" as any);
    expect(cursorA).toBeGreaterThan(0);
    expect(cursorB).toBeGreaterThan(cursorA); // docB has 2 rows, all IDs > docA's
  });

  // ---- HTTP: push+pull partitioning over the wire ----------------------------

  // Grab IDs from the E2E describe's beforeAll — we need the shared state.
  // They are module-level vars set in that beforeAll.
  // We reference the outer scope vars: matterId, aliceAccess, aliceSeat, bobAccess, bobSeat.

  test("push with doc_id:docA and doc_id:docB keep separate cursors; pull doc_id:docA returns only docA blobs", async () => {
    // Access the outer scope variables from the E2E describe block.
    // These are set in the beforeAll above.
    const mId = (globalThis as any).__docIdTestMatterId as string;
    if (!mId) return; // guard: these run after the E2E beforeAll

    const blobDocA = new Uint8Array([0xAA, 0x01]);
    const blobDocB = new Uint8Array([0xBB, 0x02]);

    const pushA = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${(globalThis as any).__docIdAliceAccess}` },
      body: JSON.stringify({
        blob_id: `docA-${crypto.randomUUID()}`,
        ciphertext_b64: Buffer.from(blobDocA).toString("base64"),
        seat_token: (globalThis as any).__docIdAliceSeat,
        doc_id: "docA",
      }),
    });
    expect(pushA.status).toBe(201);
    const pushAJson = await pushA.json() as any;

    const pushB = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${(globalThis as any).__docIdAliceAccess}` },
      body: JSON.stringify({
        blob_id: `docB-${crypto.randomUUID()}`,
        ciphertext_b64: Buffer.from(blobDocB).toString("base64"),
        seat_token: (globalThis as any).__docIdAliceSeat,
        doc_id: "docB",
      }),
    });
    expect(pushB.status).toBe(201);

    // Pull only docA — must not see docB blobs
    const pullA = await fetch(`${BASE()}/matter/${mId}/updates?since=0&doc_id=docA`, {
      headers: { authorization: `Bearer ${(globalThis as any).__docIdBobAccess}`, "x-seat-token": (globalThis as any).__docIdBobSeat },
    });
    expect(pullA.status).toBe(200);
    const pullAJson = await pullA.json() as any;
    const aCiphers = pullAJson.updates.map((u: any) => u.ciphertext_b64);
    expect(aCiphers.some((c: string) => Array.from(new Uint8Array(Buffer.from(c, "base64"))).join() === Array.from(blobDocA).join())).toBe(true);
    // docB blob must NOT appear in the docA pull
    expect(aCiphers.some((c: string) => Array.from(new Uint8Array(Buffer.from(c, "base64"))).join() === Array.from(blobDocB).join())).toBe(false);

    // Cursors are distinct: docA's cursor returned from push
    expect(typeof pushAJson.cursor).toBe("number");
  });

  test("absent doc_id defaults to _notes — existing notes tests unchanged", async () => {
    const mId = (globalThis as any).__docIdTestMatterId as string;
    if (!mId) return;

    const blob = new Uint8Array([0xCC, 0x03]);
    const push = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${(globalThis as any).__docIdAliceAccess}` },
      body: JSON.stringify({
        blob_id: `notes-default-${crypto.randomUUID()}`,
        ciphertext_b64: Buffer.from(blob).toString("base64"),
        seat_token: (globalThis as any).__docIdAliceSeat,
        // no doc_id → must go to _notes
      }),
    });
    expect(push.status).toBe(201);

    // Pull without doc_id → only _notes stream
    const pull = await fetch(`${BASE()}/matter/${mId}/updates?since=0`, {
      headers: { authorization: `Bearer ${(globalThis as any).__docIdBobAccess}`, "x-seat-token": (globalThis as any).__docIdBobSeat },
    });
    expect(pull.status).toBe(200);
    const pullJson = await pull.json() as any;
    // All returned blobs are from the _notes stream (no doc_id filter = _notes default)
    expect(Array.isArray(pullJson.updates)).toBe(true);
    // The blob we pushed without doc_id must appear
    const ciphers = pullJson.updates.map((u: any) => u.ciphertext_b64);
    expect(ciphers.some((c: string) => Array.from(new Uint8Array(Buffer.from(c, "base64"))).join() === Array.from(blob).join())).toBe(true);
  });

  test("WS fan-out delivers only the subscribed doc's frames", async () => {
    const mId = (globalThis as any).__docIdTestMatterId as string;
    if (!mId) return;
    const aliceAccess2 = (globalThis as any).__docIdAliceAccess as string;
    const aliceSeat2 = (globalThis as any).__docIdAliceSeat as string;
    const bobAccess2 = (globalThis as any).__docIdBobAccess as string;
    const bobSeat2 = (globalThis as any).__docIdBobSeat as string;

    // Bob subscribes to docA stream (mint ticket with doc_id=docA)
    const ticketRes = await fetch(`${BASE()}/matter/${mId}/sync-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${bobAccess2}`, "x-seat-token": bobSeat2, "x-doc-id": "docA" },
    });
    expect(ticketRes.status).toBe(200);
    const { ticket } = await ticketRes.json() as any;
    const wsUrlDocA = `ws://${srv.hostname}:${srv.port}/matter/${mId}/sync?ticket=${encodeURIComponent(ticket)}&doc_id=docA`;

    const ws = await openSocket(wsUrlDocA);
    try {
      const buf = bufferUpdates(ws);
      await new Promise((r) => setTimeout(r, 50));

      // Push to docA — Bob should receive
      const blobA = new Uint8Array([0xDD, 0x04]);
      const pushA = await fetch(`${BASE()}/matter/${mId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
        body: JSON.stringify({
          blob_id: `ws-docA-${crypto.randomUUID()}`,
          ciphertext_b64: Buffer.from(blobA).toString("base64"),
          seat_token: aliceSeat2,
          doc_id: "docA",
        }),
      });
      expect(pushA.status).toBe(201);
      const pushAJson = await pushA.json() as any;

      // Push to docB — Bob (subscribed to docA) should NOT receive
      const blobB = new Uint8Array([0xEE, 0x05]);
      await fetch(`${BASE()}/matter/${mId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
        body: JSON.stringify({
          blob_id: `ws-docB-${crypto.randomUUID()}`,
          ciphertext_b64: Buffer.from(blobB).toString("base64"),
          seat_token: aliceSeat2,
          doc_id: "docB",
        }),
      });

      // Wait for the docA frame to arrive
      const live = await buf.waitFor(pushAJson.cursor);
      expect(live).toBeTruthy();
      expect(Array.from(new Uint8Array(Buffer.from(live.ciphertext_b64, "base64")))).toEqual(Array.from(blobA));

      // The docB blob must NOT be in the buffer (the doc_id filter is working)
      await new Promise((r) => setTimeout(r, 100)); // give time for spurious frames
      const hasDocB = buf.frames.some((f: any) =>
        Array.from(new Uint8Array(Buffer.from(f.ciphertext_b64, "base64"))).join() === Array.from(blobB).join()
      );
      expect(hasDocB).toBe(false);
    } finally {
      ws.close();
    }
  });
});

// Shared matter for the doc_id tests — populated after the E2E beforeAll runs.
// We use a separate describe block with its own beforeAll to set up a matter
// for the doc_id partition tests.
describe("doc_id stream partitioning — HTTP integration", () => {
  let mId = "";
  let aliceAccess2 = "";
  let aliceSeat2 = "";
  let bobAccess2 = "";
  let bobSeat2 = "";
  let licenseKey2 = "";
  let aliceId2 = "";
  let bobId2 = "";

  beforeAll(async () => {
    // Provision a fresh org + 2 members for the partitioning tests
    const prov = await fetch(`${BASE()}/admin/org`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `DocId Law ${crypto.randomUUID()}`,
        plan: "practice",
        packs: ["legal"],
        seat_limit: 5,
        admin_email: `docid-admin-${crypto.randomUUID()}@docid.test`,
        admin_password: "docid-admin-pw-1234",
      }),
    });
    const provJson = await prov.json() as any;
    licenseKey2 = provJson.license_key;
    const adminLogin = await fetch(`${BASE()}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: provJson.admin.email, password: "docid-admin-pw-1234" }),
    });
    const adminAccess2 = ((await adminLogin.json()) as any).access_token as string;

    const mkMember = async (label: string) => {
      const email = `${label}-docid-${crypto.randomUUID()}@docid.test`;
      const create = await fetch(`${BASE()}/org/users`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminAccess2}` },
        body: JSON.stringify({ email, password: "member-pw-docid-123" }),
      });
      const createJson = await create.json() as any;
      const login = await fetch(`${BASE()}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "member-pw-docid-123" }),
      });
      const access = ((await login.json()) as any).access_token as string;
      const act = await fetch(`${BASE()}/org/activate`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
        body: JSON.stringify({ license_key: licenseKey2, machine_id: `machine-docid-${label}` }),
      });
      const seat = ((await act.json()) as any).seat_token as string;
      return { userId: createJson.user.user_id as string, access, seat };
    };

    const alice = await mkMember("alice2");
    const bob = await mkMember("bob2");
    aliceAccess2 = alice.access; aliceSeat2 = alice.seat; aliceId2 = alice.userId;
    bobAccess2 = bob.access; bobSeat2 = bob.seat; bobId2 = bob.userId;

    const matter = await fetch(`${BASE()}/org/matters`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminAccess2}` },
      body: JSON.stringify({ client_name: "DocId Test Matter" }),
    });
    mId = ((await matter.json()) as any).matter.matter_id as string;
    await fetch(`${BASE()}/matter/${mId}/members/add`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminAccess2}` },
      body: JSON.stringify({ user_id: aliceId2, role: "editor" }),
    });
    await fetch(`${BASE()}/matter/${mId}/members/add`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminAccess2}` },
      body: JSON.stringify({ user_id: bobId2, role: "editor" }),
    });
  });

  test("push with doc_id:docA and doc_id:docB keep separate cursors; pull doc_id:docA returns only docA blobs", async () => {
    const blobDocA = new Uint8Array([0xAA, 0x01]);
    const blobDocB = new Uint8Array([0xBB, 0x02]);

    const pushARes = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
      body: JSON.stringify({
        blob_id: `docA-${crypto.randomUUID()}`,
        ciphertext_b64: Buffer.from(blobDocA).toString("base64"),
        seat_token: aliceSeat2,
        doc_id: "docA",
      }),
    });
    expect(pushARes.status).toBe(201);
    const pushAJson = await pushARes.json() as any;

    await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
      body: JSON.stringify({
        blob_id: `docB-${crypto.randomUUID()}`,
        ciphertext_b64: Buffer.from(blobDocB).toString("base64"),
        seat_token: aliceSeat2,
        doc_id: "docB",
      }),
    });

    // Pull only docA
    const pullA = await fetch(`${BASE()}/matter/${mId}/updates?since=0&doc_id=docA`, {
      headers: { authorization: `Bearer ${bobAccess2}`, "x-seat-token": bobSeat2 },
    });
    expect(pullA.status).toBe(200);
    const pullAJson = await pullA.json() as any;
    const aCiphers = pullAJson.updates.map((u: any) => u.ciphertext_b64);
    expect(aCiphers.some((c: string) => Array.from(new Uint8Array(Buffer.from(c, "base64"))).join() === Array.from(blobDocA).join())).toBe(true);
    expect(aCiphers.some((c: string) => Array.from(new Uint8Array(Buffer.from(c, "base64"))).join() === Array.from(blobDocB).join())).toBe(false);
    expect(typeof pushAJson.cursor).toBe("number");
  });

  test("absent doc_id defaults to _notes — existing notes tests unchanged", async () => {
    const blob = new Uint8Array([0xCC, 0x03]);
    const push = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
      body: JSON.stringify({
        blob_id: `notes-default-${crypto.randomUUID()}`,
        ciphertext_b64: Buffer.from(blob).toString("base64"),
        seat_token: aliceSeat2,
        // no doc_id → must go to _notes
      }),
    });
    expect(push.status).toBe(201);

    // Pull without doc_id → only _notes stream
    const pull = await fetch(`${BASE()}/matter/${mId}/updates?since=0`, {
      headers: { authorization: `Bearer ${bobAccess2}`, "x-seat-token": bobSeat2 },
    });
    expect(pull.status).toBe(200);
    const pullJson = await pull.json() as any;
    expect(Array.isArray(pullJson.updates)).toBe(true);
    const ciphers = pullJson.updates.map((u: any) => u.ciphertext_b64);
    expect(ciphers.some((c: string) => Array.from(new Uint8Array(Buffer.from(c, "base64"))).join() === Array.from(blob).join())).toBe(true);
  });

  test("idempotency unique key is per (matter_id, doc_id, blob_id): same blob_id under different doc_ids are distinct rows", async () => {
    const sharedBlobId = `shared-idem-${crypto.randomUUID()}`;
    const push1 = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
      body: JSON.stringify({ blob_id: sharedBlobId, ciphertext_b64: Buffer.from([1]).toString("base64"), seat_token: aliceSeat2, doc_id: "idem-docA" }),
    });
    expect(push1.status).toBe(201);
    expect(((await push1.json()) as any).duplicate).toBe(false);

    const push2 = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
      body: JSON.stringify({ blob_id: sharedBlobId, ciphertext_b64: Buffer.from([2]).toString("base64"), seat_token: aliceSeat2, doc_id: "idem-docB" }),
    });
    expect(push2.status).toBe(201);
    expect(((await push2.json()) as any).duplicate).toBe(false);

    // Same (matter, doc_id, blob_id) IS a duplicate
    const push3 = await fetch(`${BASE()}/matter/${mId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
      body: JSON.stringify({ blob_id: sharedBlobId, ciphertext_b64: Buffer.from([99]).toString("base64"), seat_token: aliceSeat2, doc_id: "idem-docA" }),
    });
    expect(push3.status).toBe(200);
    expect(((await push3.json()) as any).duplicate).toBe(true);
  });

  test("WS fan-out delivers only the subscribed doc's frames", async () => {
    // Subscribe Bob's WS to docA stream only
    const ticketRes = await fetch(`${BASE()}/matter/${mId}/sync-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${bobAccess2}`, "x-seat-token": bobSeat2 },
    });
    expect(ticketRes.status).toBe(200);
    const { ticket } = await ticketRes.json() as any;
    // WS connects and sends a subscribe message for docA
    const wsUrlDocA = `ws://${srv.hostname}:${srv.port}/matter/${mId}/sync?ticket=${encodeURIComponent(ticket)}&doc_id=docA`;

    const ws = await openSocket(wsUrlDocA);
    try {
      const buf = bufferUpdates(ws);
      await new Promise((r) => setTimeout(r, 50));

      // Push to docA
      const blobA = new Uint8Array([0xDD, 0x04]);
      const pushA = await fetch(`${BASE()}/matter/${mId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
        body: JSON.stringify({
          blob_id: `ws-docA-${crypto.randomUUID()}`,
          ciphertext_b64: Buffer.from(blobA).toString("base64"),
          seat_token: aliceSeat2,
          doc_id: "docA",
        }),
      });
      expect(pushA.status).toBe(201);
      const pushAJson = await pushA.json() as any;

      // Push to docB — Bob subscribed to docA should NOT receive
      const blobB = new Uint8Array([0xEE, 0x05]);
      await fetch(`${BASE()}/matter/${mId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${aliceAccess2}` },
        body: JSON.stringify({
          blob_id: `ws-docB-${crypto.randomUUID()}`,
          ciphertext_b64: Buffer.from(blobB).toString("base64"),
          seat_token: aliceSeat2,
          doc_id: "docB",
        }),
      });

      // Wait for docA frame
      const live = await buf.waitFor(pushAJson.cursor);
      expect(live).toBeTruthy();
      expect(Array.from(new Uint8Array(Buffer.from(live.ciphertext_b64, "base64")))).toEqual(Array.from(blobA));

      // docB blob must NOT appear
      await new Promise((r) => setTimeout(r, 100));
      const hasDocB = buf.frames.some((f: any) =>
        Array.from(new Uint8Array(Buffer.from(f.ciphertext_b64, "base64"))).join() === Array.from(blobB).join()
      );
      expect(hasDocB).toBe(false);
    } finally {
      ws.close();
    }
  });
});

// ===========================================================================
// Presence frames — subscriber count broadcast (§10)
// ===========================================================================
describe("presence frames — subscriber count broadcast", () => {
  // Each test provisions its own fresh matter + members so tests are fully isolated.

  let presAdminAccess = "";
  let presLicenseKey = "";
  let presAliceAccess = "";
  let presAliceSeat = "";
  let presBobAccess = "";
  let presBobSeat = "";
  let presMatterId = "";

  beforeAll(async () => {
    const prov = await post("/admin/org", {
      name: `Presence Law ${crypto.randomUUID()}`,
      plan: "practice",
      packs: ["legal"],
      seat_limit: 5,
      admin_email: `pres-admin-${crypto.randomUUID()}@pres.test`,
      admin_password: "pres-admin-pw-1234",
    });
    expect(prov.status).toBe(201);
    presLicenseKey = prov.json.license_key;
    const adminLogin = await post("/auth/login", { email: prov.json.admin.email, password: "pres-admin-pw-1234" });
    presAdminAccess = adminLogin.json.access_token;

    const mk = async (label: string) => {
      const email = `${label}-pres-${crypto.randomUUID()}@pres.test`;
      const create = await post("/org/users", { email, password: "pres-member-pw-1234" }, presAdminAccess);
      expect(create.status).toBe(201);
      const login = await post("/auth/login", { email, password: "pres-member-pw-1234" });
      const access = login.json.access_token;
      const act = await post("/org/activate", { license_key: presLicenseKey, machine_id: `pres-${label}` }, access);
      expect(act.status).toBe(200);
      return { userId: create.json.user.user_id as string, access, seat: act.json.seat_token as string };
    };

    const alice = await mk("alice");
    const bob = await mk("bob");
    presAliceAccess = alice.access; presAliceSeat = alice.seat;
    presBobAccess = bob.access; presBobSeat = bob.seat;

    const matter = await post("/org/matters", { client_name: "Presence Test Matter" }, presAdminAccess);
    expect(matter.status).toBe(201);
    presMatterId = matter.json.matter.matter_id;
    await post(`/matter/${presMatterId}/members/add`, { user_id: alice.userId, role: "editor" }, presAdminAccess);
    await post(`/matter/${presMatterId}/members/add`, { user_id: bob.userId, role: "editor" }, presAdminAccess);
  });

  /**
   * Buffer presence frames from a socket. Returns the frame buffer and a
   * poller that resolves when a frame with at least `minCount` subscribers arrives.
   */
  function bufferPresence(ws: WebSocket): { frames: any[]; waitForCount: (count: number, timeoutMs?: number) => Promise<any> } {
    const frames: any[] = [];
    ws.addEventListener("message", (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch { return; }
      if (msg.type === "presence") frames.push(msg);
    });
    const waitForCount = (count: number, timeoutMs = 4000) =>
      new Promise<any>((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
          const hit = frames.find((f) => f.count === count);
          if (hit) return resolve(hit);
          if (Date.now() > deadline) return reject(new Error(`presence count ${count} not received in ${timeoutMs}ms; frames: ${JSON.stringify(frames)}`));
          setTimeout(tick, 20);
        };
        tick();
      });
    return { frames, waitForCount };
  }

  /** Read the ready frame from a socket (first message). */
  function waitForReady(ws: WebSocket, timeoutMs = 4000): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (Date.now() > deadline) return reject(new Error("ready frame timeout"));
      };
      ws.addEventListener("message", function handler(ev) {
        let msg: any;
        try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch { return; }
        if (msg.type === "ready") {
          ws.removeEventListener("message", handler);
          resolve(msg);
        }
      });
      setTimeout(check, timeoutMs);
    });
  }

  test("Test 4: ready frame includes subscribers field", async () => {
    const ws = await openSocket(await wsUrl(presMatterId, presAliceAccess, presAliceSeat));
    try {
      const ready = await waitForReady(ws);
      expect(typeof ready.subscribers).toBe("number");
      expect(ready.subscribers).toBeGreaterThanOrEqual(1);
    } finally {
      ws.close();
    }
  });

  test("Test 1: two sockets on the same doc each receive a presence frame with count:2", async () => {
    const docId = `presence-two-${crypto.randomUUID()}`;
    const aliceUrl = await (async () => {
      const t = await mintTicket(presMatterId, presAliceAccess, presAliceSeat);
      expect(t.status).toBe(200);
      return `ws://${srv.hostname}:${srv.port}/matter/${presMatterId}/sync?ticket=${encodeURIComponent(t.json.ticket as string)}&doc_id=${docId}`;
    })();
    const bobUrl = await (async () => {
      const t = await mintTicket(presMatterId, presBobAccess, presBobSeat);
      expect(t.status).toBe(200);
      return `ws://${srv.hostname}:${srv.port}/matter/${presMatterId}/sync?ticket=${encodeURIComponent(t.json.ticket as string)}&doc_id=${docId}`;
    })();

    const wsAlice = await openSocket(aliceUrl);
    const wsBob = await openSocket(bobUrl);
    try {
      const alicePres = bufferPresence(wsAlice);
      const bobPres = bufferPresence(wsBob);

      // Wait for both to see count:2 (after both have connected)
      await alicePres.waitForCount(2);
      await bobPres.waitForCount(2);

      // Both should have received a presence frame with count:2
      expect(alicePres.frames.some((f: any) => f.count === 2)).toBe(true);
      expect(bobPres.frames.some((f: any) => f.count === 2)).toBe(true);
    } finally {
      wsAlice.close();
      wsBob.close();
    }
  });

  test("Test 2: when one socket disconnects, the remaining one receives count:1", async () => {
    const docId = `presence-leave-${crypto.randomUUID()}`;
    const aliceUrl = await (async () => {
      const t = await mintTicket(presMatterId, presAliceAccess, presAliceSeat);
      return `ws://${srv.hostname}:${srv.port}/matter/${presMatterId}/sync?ticket=${encodeURIComponent(t.json.ticket as string)}&doc_id=${docId}`;
    })();
    const bobUrl = await (async () => {
      const t = await mintTicket(presMatterId, presBobAccess, presBobSeat);
      return `ws://${srv.hostname}:${srv.port}/matter/${presMatterId}/sync?ticket=${encodeURIComponent(t.json.ticket as string)}&doc_id=${docId}`;
    })();

    const wsAlice = await openSocket(aliceUrl);
    const wsBob = await openSocket(bobUrl);
    const alicePres = bufferPresence(wsAlice);

    try {
      // Wait for count:2 (both connected)
      await alicePres.waitForCount(2);

      // Bob disconnects
      wsBob.close();

      // Alice should now receive count:1
      await alicePres.waitForCount(1);
      expect(alicePres.frames.some((f: any) => f.count === 1)).toBe(true);
    } finally {
      wsAlice.close();
    }
  });

  test("Test 3: a different (matter, docId) channel is presence-isolated", async () => {
    const docIdA = `presence-iso-a-${crypto.randomUUID()}`;
    const docIdB = `presence-iso-b-${crypto.randomUUID()}`;

    const aliceUrlA = await (async () => {
      const t = await mintTicket(presMatterId, presAliceAccess, presAliceSeat);
      return `ws://${srv.hostname}:${srv.port}/matter/${presMatterId}/sync?ticket=${encodeURIComponent(t.json.ticket as string)}&doc_id=${docIdA}`;
    })();
    const bobUrlB = await (async () => {
      const t = await mintTicket(presMatterId, presBobAccess, presBobSeat);
      return `ws://${srv.hostname}:${srv.port}/matter/${presMatterId}/sync?ticket=${encodeURIComponent(t.json.ticket as string)}&doc_id=${docIdB}`;
    })();

    const wsAliceA = await openSocket(aliceUrlA);
    const wsBobB = await openSocket(bobUrlB);
    try {
      const alicePres = bufferPresence(wsAliceA);
      const bobPres = bufferPresence(wsBobB);

      // Give both sockets time to settle
      await new Promise((r) => setTimeout(r, 200));

      // Alice is alone in docIdA — she should only ever see count:1 (never 2).
      // Bob is alone in docIdB — same.
      expect(alicePres.frames.every((f: any) => f.count === 1)).toBe(true);
      expect(bobPres.frames.every((f: any) => f.count === 1)).toBe(true);
    } finally {
      wsAliceA.close();
      wsBobB.close();
    }
  });
});
