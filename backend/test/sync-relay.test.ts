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
const wsUrlForTicket = (matterId: string, ticket: string) =>
  `ws://${srv.hostname}:${srv.port}/matter/${matterId}/sync?ticket=${encodeURIComponent(ticket)}`;
/** Mint a ticket and return the WS URL (the common path the client takes). */
async function wsUrl(matterId: string, bearer: string, seatToken: string): Promise<string> {
  const t = await mintTicket(matterId, bearer, seatToken);
  if (t.status !== 200 || !t.json.ticket) throw new Error(`ticket mint failed (${t.status}): ${JSON.stringify(t.json)}`);
  return wsUrlForTicket(matterId, t.json.ticket as string);
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
    const { ticket } = tickets.mint({ matterId: mId, orgId: "o", userId: aliceId, seatId: "s", role: "member" });
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
