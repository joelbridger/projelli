/**
 * Matter / ethical-wall admin routes + the E2EE sync relay (DECISION.md §1+§4).
 *
 * ADMIN (role=admin, same-org): the source of truth for the ACL.
 *   POST /org/matters                         { client_name }                  -> create a matter
 *   POST /org/matters/list                                                     -> list this org's matters
 *   POST /matter/:id/members/add              { user_id, role? }               -> add a member
 *   POST /matter/:id/members/remove           { user_id }                      -> remove a member (+ key rotate)
 *   POST /matter/:id/members/list                                              -> members + walls + key_epoch
 *   POST /matter/:id/wall/set                 { user_id, reason? }             -> raise a screen (+ key rotate)
 *   POST /matter/:id/wall/clear               { user_id }                      -> lift a screen
 *
 * RELAY (any firm member, gated by access JWT + active seat + member∧¬walled):
 *   POST /matter/:id/updates                  { blob_id, ciphertext_b64, seat_token, key_epoch? }
 *       -> append one opaque encrypted CRDT update; fans out live to connected members.
 *   GET  /matter/:id/updates?since=<cursor>    (X-Seat-Token: <t> header)
 *       -> catch-up: updates strictly after the cursor, in order.
 *   POST /matter/:id/sync-ticket               (Bearer access + X-Seat-Token header)
 *       -> mint a short-lived, single-use ticket bound to {matter,user,seat,org}.
 *   (WS)  /matter/:id/sync?ticket=<t>          -> live fan-out (upgrade handled in server.ts)
 *
 * SECRETS NEVER RIDE IN A URL. The seat token is a header on every HTTP relay
 * call; the WS upgrade (which can't set headers) carries ONLY a single-use
 * ticket minted by the authed `sync-ticket` endpoint — never the access/seat
 * token. This keeps confidential credentials out of access logs / history.
 *
 * Every relay access runs through `gateMatterAccess`, which audits grant + deny.
 * The relay stores ciphertext bytes only; it never requires/accepts plaintext,
 * never decodes the blob, never logs it. A 1 MiB size cap is the only shape check.
 */

import { readCappedJson, type HttpRequest } from "../lib/requestBody.ts";
import { json, error, readJson, isNonEmptyString, authenticate, authorizeLiveSession, rateLimit } from "../lib/http.ts";
import { config } from "../lib/config.ts";
import {
  gateMatterAccess,
  resolveAccess,
  verifyActiveSeat,
  toUpdateFrame,
  fanout,
  MAX_UPDATE_BYTES,
  type FanoutHub,
} from "../lib/matters.ts";
import { syncTickets, type SyncTicketStore } from "../lib/syncTickets.ts";
import type { Store } from "../lib/db.ts";
import type { AccessTokenClaims, MatterRole } from "../lib/types.ts";

const VALID_MATTER_ROLES = new Set<MatterRole>(["owner", "editor", "viewer"]);

// ---------------------------------------------------------------------------
// Shared admin guard (mirrors routes/admin.ts requireAdmin).
// ---------------------------------------------------------------------------
function requireAdmin(req: HttpRequest, store: Store): { ok: true; claims: AccessTokenClaims } | { ok: false; resp: Response } {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  if (auth.claims.role !== "admin") return { ok: false, resp: error("forbidden", 403, "admin_required") };
  return { ok: true, claims: auth.claims };
}

/** Validate that the target user exists and is in the admin's org (no cross-org). */
function sameOrgUser(store: Store, orgId: string, userId: string): { ok: true } | { ok: false; resp: Response } {
  const u = store.getUser(userId);
  if (!u) return { ok: false, resp: error("user_not_found", 404) };
  if (u.org_id !== orgId) return { ok: false, resp: error("forbidden", 403, "cross_org") };
  return { ok: true };
}

/** Fetch a matter and assert it's in the caller's org; else a 404 (don't leak existence). */
function sameOrgMatter(store: Store, orgId: string, matterId: string): { ok: true; matter: NonNullable<ReturnType<Store["getMatter"]>> } | { ok: false; resp: Response } {
  const m = store.getMatter(matterId);
  if (!m || m.org_id !== orgId) return { ok: false, resp: error("matter_not_found", 404) };
  return { ok: true, matter: m };
}

// ===========================================================================
// Admin: matter CRUD
// ===========================================================================
export async function handleCreateMatter(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const body = await readJson<{ client_name?: unknown }>(req);
  if (!body || !isNonEmptyString(body.client_name, 256)) return error("missing_fields", 400);

  const matter = store.createMatter({ org_id: a.claims.org_id, client_name: body.client_name.trim() });
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.create", target: matter.matter_id, detail: { client_name: matter.client_name } });
  return json({ matter }, 201);
}

export function handleListMatters(req: HttpRequest, store: Store): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  return json({ matters: store.listMatters(a.claims.org_id) });
}

export function handleArchiveMatter(req: HttpRequest, store: Store, matterId: string): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const m = sameOrgMatter(store, a.claims.org_id, matterId);
  if (!m.ok) return m.resp;
  store.setMatterStatus(matterId, "archived");
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.archive", target: matterId });
  return json({ ok: true, matter_id: matterId, status: "archived" });
}

// ===========================================================================
// Admin: membership
// ===========================================================================
export async function handleAddMatterMember(req: HttpRequest, store: Store, matterId: string): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const m = sameOrgMatter(store, a.claims.org_id, matterId);
  if (!m.ok) return m.resp;

  const body = await readJson<{ user_id?: unknown; role?: unknown }>(req);
  if (!body || !isNonEmptyString(body.user_id, 64)) return error("missing_fields", 400);
  const ok = sameOrgUser(store, a.claims.org_id, body.user_id);
  if (!ok.ok) return ok.resp;

  const role: MatterRole = VALID_MATTER_ROLES.has(body.role as MatterRole) ? (body.role as MatterRole) : "editor";
  store.addMatterMember({ matter_id: matterId, user_id: body.user_id, org_id: a.claims.org_id, role });
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.member.add", target: matterId, detail: { user_id: body.user_id, role } });

  // NOTE (desktop key-release task, §4 L2): this is the hook to RELEASE the
  // per-matter content key to the newly-added member's keychain (only if they
  // are not walled). The relay never holds that key.
  const walled = store.isWalled(matterId, body.user_id);
  return json({ ok: true, matter_id: matterId, user_id: body.user_id, role, key_epoch: m.matter.key_epoch, key_release: walled ? "blocked_walled" : "release_to_member" });
}

export async function handleRemoveMatterMember(req: HttpRequest, store: Store, matterId: string): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const m = sameOrgMatter(store, a.claims.org_id, matterId);
  if (!m.ok) return m.resp;

  const body = await readJson<{ user_id?: unknown }>(req);
  if (!body || !isNonEmptyString(body.user_id, 64)) return error("missing_fields", 400);

  const oldEpoch = m.matter.key_epoch;
  const removed = store.removeMatterMember(matterId, body.user_id);
  // Removing a member rotates the matter key so updates pushed after this point
  // are sealed under an epoch the removed user never receives (§4 L2).
  const newEpoch = store.bumpMatterKeyEpoch(matterId);

  // Phase 1 (wrapped keys): delete all wrapped keys for the removed user on this
  // matter (all epochs) and delete the OLD epoch's full published set so publishers
  // must re-wrap for the new epoch.
  store.deleteWrappedKeysForUser(matterId, body.user_id);
  store.deleteWrappedKeysForEpoch(matterId, oldEpoch);

  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.member.remove", target: matterId, detail: { user_id: body.user_id, removed } });
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.key.rotate", target: matterId, detail: { reason: "member_remove", key_epoch: newEpoch } });

  // NOTE (desktop key-release task): stop releasing the matter key to this user
  // and re-release the NEW epoch key to remaining members.
  return json({ ok: true, matter_id: matterId, user_id: body.user_id, removed, key_epoch: newEpoch });
}

export function handleListMatterMembers(req: HttpRequest, store: Store, matterId: string): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const m = sameOrgMatter(store, a.claims.org_id, matterId);
  if (!m.ok) return m.resp;
  return json({
    matter_id: matterId,
    key_epoch: m.matter.key_epoch,
    members: store.listMatterMembersWithEmail(matterId),
    walls: store.listEthicalWalls(matterId),
  });
}

// ===========================================================================
// Admin: ethical walls (explicit DENY)
// ===========================================================================
export async function handleSetWall(req: HttpRequest, store: Store, matterId: string): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const m = sameOrgMatter(store, a.claims.org_id, matterId);
  if (!m.ok) return m.resp;

  const body = await readJson<{ user_id?: unknown; reason?: unknown }>(req);
  if (!body || !isNonEmptyString(body.user_id, 64)) return error("missing_fields", 400);
  const ok = sameOrgUser(store, a.claims.org_id, body.user_id);
  if (!ok.ok) return ok.resp;

  const reason = isNonEmptyString(body.reason, 512) ? body.reason.trim() : null;
  const wallOldEpoch = m.matter.key_epoch;
  store.setEthicalWall({ matter_id: matterId, user_id: body.user_id, org_id: a.claims.org_id, reason, created_by: a.claims.sub });
  // Raising a screen rotates the key so the screened user — even if they were a
  // member with the old key — cannot read updates pushed after the screen (§4 L2).
  const newEpoch = store.bumpMatterKeyEpoch(matterId);

  // Phase 1 (wrapped keys): delete all wrapped keys for the walled user and purge
  // the old epoch set so publishers must re-wrap at the new epoch.
  store.deleteWrappedKeysForUser(matterId, body.user_id);
  store.deleteWrappedKeysForEpoch(matterId, wallOldEpoch);

  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.wall.set", target: matterId, detail: { user_id: body.user_id, reason } });
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.key.rotate", target: matterId, detail: { reason: "wall_set", key_epoch: newEpoch } });

  // NOTE (desktop key-release task): immediately stop releasing the matter key
  // to the screened user and rotate for everyone else.
  return json({ ok: true, matter_id: matterId, user_id: body.user_id, walled: true, key_epoch: newEpoch });
}

export async function handleClearWall(req: HttpRequest, store: Store, matterId: string): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const m = sameOrgMatter(store, a.claims.org_id, matterId);
  if (!m.ok) return m.resp;

  const body = await readJson<{ user_id?: unknown }>(req);
  if (!body || !isNonEmptyString(body.user_id, 64)) return error("missing_fields", 400);

  const cleared = store.clearEthicalWall(matterId, body.user_id);
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.wall.clear", target: matterId, detail: { user_id: body.user_id, cleared } });
  // Lifting a screen does NOT auto-grant access; the user still needs membership.
  return json({ ok: true, matter_id: matterId, user_id: body.user_id, cleared });
}

// ===========================================================================
// The E2EE sync relay
// ===========================================================================

/**
 * Shared front gate for HTTP relay calls: access JWT (Authorization header) +
 * active seat + matter access. The seat token rides in a header / body, never a
 * query string (so it can't leak into access logs). The WS upgrade does NOT use
 * this gate — it presents a single-use ticket instead (see authorizeSyncConnect).
 */
function relayGate(
  req: HttpRequest,
  store: Store,
  matterId: string,
  seatToken: string | null,
  action: string,
):
  | { ok: true; claims: AccessTokenClaims; seatId: string; matter: NonNullable<ReturnType<Store["getMatter"]>> }
  | { ok: false; resp: Response } {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };

  if (!seatToken) return { ok: false, resp: error("seat_required", 401, "missing_seat_token") };
  const seat = verifyActiveSeat(store, seatToken, { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) return { ok: false, resp: error("seat_invalid", 401, seat.reason) };

  const gate = gateMatterAccess(store, { org_id: auth.claims.org_id, user_id: auth.claims.sub, role: auth.claims.role }, matterId, action);
  if (!gate.ok) return { ok: false, resp: error(gate.error, gate.http, gate.reason) };

  return { ok: true, claims: auth.claims, seatId: seat.claims.seat_id, matter: gate.matter };
}

/** POST /matter/:id/updates — append one opaque encrypted CRDT update. */
export async function handlePushUpdate(req: HttpRequest, store: Store, matterId: string, ip: string, hub: FanoutHub = fanout): Promise<Response> {
  // Per-IP relay write rate limit (generous; sync is chatty but still bounded).
  const rl = rateLimit(ip, "relay_push", { max: config.relayRateLimitMax, windowSeconds: config.relayRateLimitWindowSeconds });
  if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);

  // The access credential is always in a header, so reject a missing or bad
  // identity before waiting for the legacy body-carried seat token. This keeps
  // an unauthenticated caller from making the relay read/validate any body.
  const identity = authenticate(req, store);
  if (!identity.ok) return error("unauthorized", 401);

  // The legacy seat token still lives in this request body; after the access
  // front gate above, the complete seat + matter gate runs below.
  const read = await readUpdateBody(req);
  if (!read.ok) {
    return read.tooLarge
      ? error("payload_too_large", 413, `Encrypted update exceeds the relay limit (${MAX_UPDATE_BYTES} bytes).`)
      : error("invalid_json", 400);
  }
  const body = read.body;
  const seatToken = typeof body.seat_token === "string" ? body.seat_token : null;

  const gate = relayGate(req, store, matterId, seatToken, "push");
  if (!gate.ok) return gate.resp;

  if (!isNonEmptyString(body.blob_id, 128)) return error("missing_fields", 400, "blob_id");
  if (typeof body.ciphertext_b64 !== "string" || body.ciphertext_b64.length === 0) {
    return error("missing_fields", 400, "ciphertext_b64");
  }

  // Decode the opaque blob. We do NOT inspect it — only measure it against the cap.
  let ciphertext: Uint8Array;
  try {
    ciphertext = new Uint8Array(Buffer.from(body.ciphertext_b64, "base64"));
  } catch {
    return error("invalid_ciphertext", 400);
  }
  if (ciphertext.byteLength === 0) return error("invalid_ciphertext", 400, "empty");
  if (ciphertext.byteLength > MAX_UPDATE_BYTES) {
    return error("payload_too_large", 413, `Encrypted update exceeds ${MAX_UPDATE_BYTES} bytes.`);
  }

  // Clients seal under the current epoch; default to the matter's current epoch
  // if the client didn't pin one. We store what the client declares (it's the
  // client's key regime), but never let it diverge wildly — clamp to >= 1.
  const keyEpoch =
    typeof body.key_epoch === "number" && Number.isInteger(body.key_epoch) && body.key_epoch >= 1
      ? body.key_epoch
      : gate.matter.key_epoch;

  // doc_id partitions the relay: absent → '_notes' (backward-compatible notes path).
  const docId = typeof body.doc_id === "string" && body.doc_id.length > 0 ? body.doc_id : "_notes";

  const { update, duplicate } = store.appendMatterUpdate({
    matter_id: matterId,
    org_id: gate.claims.org_id,
    doc_id: docId,
    blob_id: body.blob_id.trim(),
    ciphertext,
    author_seat: gate.seatId,
    key_epoch: keyEpoch,
  });

  // Fan the new update out to connected members on the same (matter, doc) channel.
  // A duplicate (idempotent retry) is NOT re-broadcast. Never log the ciphertext.
  if (!duplicate) {
    hub.broadcast(matterId, toUpdateFrame(update), docId);
  }

  return json({ ok: true, cursor: update.id, blob_id: update.blob_id, key_epoch: update.key_epoch, doc_id: update.doc_id, duplicate }, duplicate ? 200 : 201);
}

/** GET /matter/:id/updates?since=<cursor> — cursor catch-up. Seat token rides in
 *  the `X-Seat-Token` header (never the query string, so it can't hit a log). */
export function handlePullUpdates(req: HttpRequest, store: Store, matterId: string, ip: string): Response {
  const rl = rateLimit(ip, "relay_pull", { max: config.relayRateLimitMax, windowSeconds: config.relayRateLimitWindowSeconds });
  if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);

  const url = new URL(req.url);
  const seatToken = req.headers.get("x-seat-token");
  const gate = relayGate(req, store, matterId, seatToken, "pull");
  if (!gate.ok) return gate.resp;

  const sinceRaw = url.searchParams.get("since") ?? "0";
  const since = Number(sinceRaw);
  if (!Number.isInteger(since) || since < 0) return error("invalid_cursor", 400);

  // doc_id stream filter: absent → '_notes' (backward-compatible notes path).
  const docId = url.searchParams.get("doc_id") ?? "_notes";

  const updates = store.getMatterUpdatesSince(matterId, since, 500, docId);
  const latest = store.latestMatterCursor(matterId, docId);
  // The opaque bytes ride back base64-encoded, untouched.
  return json({
    matter_id: matterId,
    doc_id: docId,
    key_epoch: gate.matter.key_epoch,
    since,
    cursor: updates.length ? updates[updates.length - 1]!.id : since,
    latest_cursor: latest,
    has_more: updates.length === 500 && (updates[updates.length - 1]!.id < latest),
    updates: updates.map((u) => ({
      cursor: u.id,
      blob_id: u.blob_id,
      doc_id: u.doc_id,
      key_epoch: u.key_epoch,
      author_seat: u.author_seat,
      created_at: u.created_at,
      ciphertext_b64: Buffer.from(u.ciphertext).toString("base64"),
    })),
  });
}

/**
 * POST /matter/:id/sync-ticket — mint a short-lived, single-use ticket the
 * client puts on the WS upgrade URL (`/matter/:id/sync?ticket=<t>`) instead of
 * the access/seat token. This is an ORDINARY authed HTTPS request: it runs the
 * EXACT same access gate as the relay (access JWT + active seat + member∧¬walled,
 * correct org), then records the grant against {matter,user,seat,org}. The ticket
 * is opaque (256-bit), expires in seconds, and is redeemed exactly once. No token
 * is ever written to a URL, so nothing sensitive can land in an access log.
 */
export function handleSyncTicket(
  req: HttpRequest,
  store: Store,
  matterId: string,
  ip: string,
  tickets: SyncTicketStore = syncTickets,
): Response {
  const rl = rateLimit(ip, "relay_ticket", { max: config.relayRateLimitMax, windowSeconds: config.relayRateLimitWindowSeconds });
  if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);

  // Seat token in the header (same convention as pull / assured) — never a query.
  const seatToken = req.headers.get("x-seat-token");
  const gate = relayGate(req, store, matterId, seatToken, "ticket");
  if (!gate.ok) return gate.resp;

  const { ticket, expiresInMs } = tickets.mint({
    matterId,
    orgId: gate.claims.org_id,
    userId: gate.claims.sub,
    seatId: gate.seatId,
    sid: gate.claims.sid,
    role: gate.claims.role,
  });
  return json({ ticket, expires_in_ms: expiresInMs });
}

/**
 * Authorize a WebSocket sync connection BEFORE upgrade. The browser WebSocket
 * API can't set headers, so it presents a SINGLE-USE TICKET (`?ticket=<t>`) that
 * was minted by the authed `sync-ticket` endpoint above — NOT the access or seat
 * token. We redeem the ticket (one-time; expired/replayed tickets fail), require
 * it to be bound to THIS matter, and run the socket as the ticket's identity.
 * The full access gate already ran at mint time, so a walled / non-member /
 * cross-org caller never holds a valid ticket for this matter.
 */
export function authorizeSyncConnect(
  req: HttpRequest,
  store: Store,
  matterId: string,
  tickets: SyncTicketStore = syncTickets,
):
  | { ok: true; data: { matterId: string; orgId: string; userId: string; seatId: string; role: AccessTokenClaims["role"]; sid: string } }
  | { ok: false; resp: Response } {
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket");
  if (!ticket) return { ok: false, resp: error("unauthorized", 401, "missing_ticket") };

  const binding = tickets.redeem(ticket);
  // Invalid / expired / already-used ticket, or one minted for a different matter.
  if (!binding || binding.matterId !== matterId) {
    return { ok: false, resp: error("unauthorized", 401, "invalid_ticket") };
  }
  const live = authorizeLiveSession({ sub: binding.userId, org_id: binding.orgId, sid: binding.sid }, store);
  if (!live.ok) return { ok: false, resp: error("forbidden", 403, live.reason) };
  // Defense in depth: re-confirm access at connect time too. A wall/removal that
  // landed in the <=30s window between mint and connect must still slam the door.
  // Use the role captured at mint time so an org admin's (non-membership) access
  // path is preserved, while a wall still denies regardless of role.
  const access = resolveAccess(store, { orgId: live.claims.org_id, userId: live.claims.sub, role: live.claims.role }, matterId);
  if (!access.allowed) {
    return { ok: false, resp: error("forbidden", 403, access.reason) };
  }
  return { ok: true, data: { matterId, orgId: live.claims.org_id, userId: live.claims.sub, seatId: binding.seatId, role: live.claims.role, sid: live.claims.sid } };
}

// ---------------------------------------------------------------------------
// Body reader for relay pushes: larger cap than the auth/licensing endpoints
// (encrypted CRDT updates are bigger than tiny JSON), still hard-bounded.
//
// The ciphertext rides as base64 (≈4/3 the raw size) plus a small JSON envelope.
// We size the request cap above the base64-inflated blob cap + envelope so a
// blob that's only slightly over MAX_UPDATE_BYTES still reaches the explicit
// 413 path (a precise "payload_too_large"), while a grossly oversized body is
// rejected here. `tooLarge` lets the route distinguish a size rejection (413)
// from a malformed-JSON rejection (400).
// ---------------------------------------------------------------------------
export const MAX_REQUEST_BYTES = Math.ceil(MAX_UPDATE_BYTES * 1.4) + 64 * 1024;

interface UpdateBody {
  blob_id?: unknown;
  ciphertext_b64?: unknown;
  seat_token?: unknown;
  key_epoch?: unknown;
  doc_id?: unknown;
}

type ReadResult = { ok: true; body: UpdateBody } | { ok: false; tooLarge: boolean };

async function readUpdateBody(req: HttpRequest): Promise<ReadResult> {
  // Streams and aborts at the cap (lib/requestBody.ts) — a chunked push with no
  // Content-Length no longer reaches RAM before the size check.
  const read = await readCappedJson<UpdateBody>(req, MAX_REQUEST_BYTES);
  return read.ok ? { ok: true, body: read.value } : { ok: false, tooLarge: read.tooLarge };
}

// Re-export for the access-decision tests.
export { resolveAccess };
