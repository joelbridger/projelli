/**
 * Matter access-control + E2EE sync-relay service layer (DECISION.md §1 + §4).
 *
 * This is the load-bearing ethical-wall enforcement. The server is the source of
 * truth for `MatterMember` and `EthicalWall`; the single predicate
 *
 *     allowed = (member ∨ org-admin) ∧ ¬walled        // deny-overrides-allow
 *
 * is computed in ONE place (`resolveAccess`) and fail-closed by construction —
 * anything that isn't a clear allow is a deny. Every access decision is funneled
 * through `gateMatterAccess`, which audits both grants and denials so the audit
 * trail itself is the compliance artifact §4 calls for.
 *
 * The relay (DECISION.md §1) is a DUMB PIPE: it stores opaque, client-encrypted
 * CRDT update blobs and fans them out to `allowed` seats. It never holds the
 * per-matter key, never parses/decodes/logs ciphertext, and rejects anything
 * that smells like plaintext via a size cap.
 *
 * Pure-ish functions over a Store (+ an in-memory fan-out hub), so tests can drive
 * them without booting the server.
 */

import type { Store } from "./db.ts";
import type { AccessTokenClaims, Matter, MatterAccess, MatterUpdate, SeatTokenClaims } from "./types.ts";
import { verifySeatToken } from "./crypto.ts";
import { config } from "./config.ts";

// ---------------------------------------------------------------------------
// Relay payload limits. A single CRDT update is small; a generous cap both
// protects the store and acts as a sanity check that a client isn't shipping
// something other than an incremental encrypted delta. Ciphertext only — the
// relay can't and won't look inside, so the cap is the only shape check we make.
// ---------------------------------------------------------------------------
export const MAX_UPDATE_BYTES = 1024 * 1024; // 1 MiB per encrypted update blob.

// ---------------------------------------------------------------------------
// The §4 access predicate — the ONE place membership ∧ ¬wall is decided.
// ---------------------------------------------------------------------------
/**
 * Resolve whether `userId` (with org `orgId`, role `role`) may access `matterId`.
 *
 * Order matters and is intentional:
 *   1. Matter must exist AND be in the caller's org (no cross-org access).
 *   2. An ethical wall is checked FIRST and wins outright — deny-overrides-allow.
 *      A screened user is blocked even if mistakenly added as a member or admin.
 *   3. Otherwise allow iff the user is a matter member, OR an org admin (admins
 *      get an access policy over their own org's matters; still subject to the
 *      wall above, so a screened admin is still blocked).
 *
 * Fail-closed: every path that isn't an explicit allow returns `allowed: false`.
 */
export function resolveAccess(
  store: Store,
  input: { orgId: string; userId: string; role: AccessTokenClaims["role"] },
  matterHandle: string,
): MatterAccess {
  const matter = store.getMatter(matterHandle);
  if (!matter) return { allowed: false, matter: null, reason: "matter_not_found" };
  if (matter.org_id !== input.orgId) return { allowed: false, matter: null, reason: "cross_org" };

  // Deny wins. Check the wall before any allow path.
  if (store.isWalled(matterHandle, input.userId)) {
    return { allowed: false, matter, reason: "walled" };
  }

  const member = store.getMatterMember(matterHandle, input.userId);
  if (member) return { allowed: true, matter, reason: "member" };
  if (input.role === "admin") return { allowed: true, matter, reason: "admin" };

  return { allowed: false, matter, reason: "not_member" };
}

export type GateResult =
  | { ok: true; matter: Matter; reason: "member" | "admin" }
  | { ok: false; http: number; error: string; reason: string };

/**
 * The audited access gate every relay/membership endpoint calls. Resolves the
 * predicate and writes an append-only audit event for BOTH outcomes:
 *   - granted  -> matter.access.granted
 *   - denied   -> matter.access.denied (with the reason: walled / not_member / cross_org / matter_not_found)
 *
 * `action` tags what the caller was trying to do (e.g. "push", "pull", "connect")
 * so the audit trail shows intent. Returns a typed allow/deny the route maps to HTTP.
 */
export function gateMatterAccess(
  store: Store,
  caller: { org_id: string; user_id: string; role: AccessTokenClaims["role"] },
  matterHandle: string,
  action: string,
): GateResult {
  const access = resolveAccess(store, { orgId: caller.org_id, userId: caller.user_id, role: caller.role }, matterHandle);

  if (access.allowed) {
    store.audit({
      org_id: caller.org_id,
      actor_user_id: caller.user_id,
      action: "matter.access.granted",
      target: matterHandle,
      detail: { action, via: access.reason },
    });
    return { ok: true, matter: access.matter, reason: access.reason };
  }

  // Audit the denial against the matter's org when known; else the caller's org
  // (a cross-org / not-found probe is recorded under the caller so it's visible
  // to their admin without leaking the existence of another org's matter).
  const auditOrg = access.matter ? access.matter.org_id : caller.org_id;
  store.audit({
    org_id: auditOrg,
    actor_user_id: caller.user_id,
    action: "matter.access.denied",
    target: matterHandle,
    detail: { action, reason: access.reason },
  });

  // cross_org / matter_not_found both surface as 404 so we never confirm the
  // existence of another org's matter to an outsider. walled / not_member are
  // 403 (the caller's own org, matter exists, they're just not allowed).
  if (access.reason === "walled" || access.reason === "not_member") {
    return { ok: false, http: 403, error: "forbidden", reason: access.reason };
  }
  return { ok: false, http: 404, error: "matter_not_found", reason: access.reason };
}

// ---------------------------------------------------------------------------
// Seat verification for the relay. Beyond the access JWT, a relay caller must
// present a valid, active seat token (chunk-1 licensing) — proving a paid,
// non-revoked seat bound to this user. Mirrors services.validateSeatToken but
// returns the claims for attribution.
// ---------------------------------------------------------------------------
export type SeatCheck =
  | { ok: true; claims: SeatTokenClaims }
  | { ok: false; reason: string };

/**
 * Verify a presented seat token (signature+expiry, then the online liveness
 * checks the client can't do: revoked seat? suspended org? deprovisioned user?)
 * AND that it belongs to the authenticated user + their org. This ties the seat
 * to the access identity so a leaked seat token alone can't be used cross-user.
 */
export function verifyActiveSeat(
  store: Store,
  seatToken: string,
  expect: { user_id: string; org_id: string },
): SeatCheck {
  const res = verifySeatToken<SeatTokenClaims>(seatToken, config.seatPublicKey);
  if (!res.valid) return { ok: false, reason: res.reason };
  const claims = res.payload;

  if (claims.user_id !== expect.user_id) return { ok: false, reason: "seat_user_mismatch" };
  if (claims.org_id !== expect.org_id) return { ok: false, reason: "seat_org_mismatch" };

  const seat = store.getSeat(claims.seat_id);
  if (!seat) return { ok: false, reason: "seat_not_found" };
  if (seat.status === "revoked") return { ok: false, reason: "seat_revoked" };
  if (seat.user_id !== expect.user_id || seat.org_id !== expect.org_id) return { ok: false, reason: "seat_mismatch" };

  const org = store.getOrg(claims.org_id);
  if (!org || org.status !== "active") return { ok: false, reason: "org_suspended" };

  const user = store.getUser(claims.user_id);
  if (!user || user.status !== "active") return { ok: false, reason: "user_deprovisioned" };

  return { ok: true, claims };
}

// ---------------------------------------------------------------------------
// Real-time fan-out hub (DECISION.md §1: the relay fans new updates to connected
// `allowed` seats). Transport-agnostic: a subscriber is just a sink that takes a
// wire frame. The WebSocket route registers a sink that ships the frame down the
// socket. Awareness/presence is explicitly NOT handled here (ephemeral, separate).
// ---------------------------------------------------------------------------
export interface UpdateFrame {
  type: "update";
  cursor: number; // the assigned monotonic id; clients advance their `since` to this
  blob_id: string;
  key_epoch: number;
  author_seat: string;
  created_at: string;
  /** base64 of the opaque ciphertext (so it rides a JSON/text WS frame untouched). */
  ciphertext_b64: string;
}

/** Live subscriber count broadcasted to all connected editors on join/leave. */
export interface PresenceFrame {
  type: "presence";
  /** Total number of connected subscribers, including the recipient. */
  count: number;
}

export interface Subscriber {
  /** Unique per connection (so we can remove on close). */
  id: string;
  user_id: string;
  seat_id: string;
  /** Deliver a frame. Implementations must never throw; they swallow send errors. */
  send: (frame: UpdateFrame | PresenceFrame) => void;
}

/**
 * In-memory per-(matter, doc) subscriber registry + broadcast. Single-instance
 * only (documented): a multi-instance deployment fans out via a Redis/NATS pub-sub
 * behind this same interface — the hub is the seam. No payload is ever logged.
 *
 * Channels are keyed by `${matterId}::${docId}` so each document stream has its
 * own isolated subscriber set. A WS subscribed to docA will not receive docB frames.
 */
export class FanoutHub {
  private byChannel = new Map<string, Map<string, Subscriber>>();

  private channelKey(matterHandle: string, streamHandle: string): string {
    return `${matterHandle}::${streamHandle}`;
  }

  subscribe(matterHandle: string, sub: Subscriber, streamHandle: string): void {
    const key = this.channelKey(matterHandle, streamHandle);
    let set = this.byChannel.get(key);
    if (!set) {
      set = new Map();
      this.byChannel.set(key, set);
    }
    set.set(sub.id, sub);
  }

  unsubscribe(matterHandle: string, subId: string, streamHandle: string): void {
    const key = this.channelKey(matterHandle, streamHandle);
    const set = this.byChannel.get(key);
    if (!set) return;
    set.delete(subId);
    if (set.size === 0) this.byChannel.delete(key);
  }

  subscriberCount(matterHandle: string, streamHandle: string): number {
    return this.byChannel.get(this.channelKey(matterHandle, streamHandle))?.size ?? 0;
  }

  /** Broadcast a frame to every current subscriber of a (matter, doc_id) channel. */
  broadcast(matterHandle: string, frame: UpdateFrame, streamHandle: string): void {
    const key = this.channelKey(matterHandle, streamHandle);
    const set = this.byChannel.get(key);
    if (!set) return;
    for (const sub of set.values()) {
      try {
        sub.send(frame);
      } catch {
        // A dead socket shouldn't break the loop; the close handler prunes it.
      }
    }
  }

  /** Broadcast a presence frame to every subscriber of a (matter, doc_id) channel. */
  broadcastPresence(matterHandle: string, streamHandle: string): void {
    const key = this.channelKey(matterHandle, streamHandle);
    const set = this.byChannel.get(key);
    if (!set) return;
    const count = set.size;
    const frame: PresenceFrame = { type: "presence", count };
    for (const sub of set.values()) {
      try {
        sub.send(frame);
      } catch {
        // dead socket; close handler prunes it
      }
    }
  }
}

/** Build a wire frame from a stored update (base64 the opaque bytes, untouched). */
export function toUpdateFrame(u: MatterUpdate): UpdateFrame {
  return {
    type: "update",
    cursor: u.id,
    blob_id: u.blob_id,
    key_epoch: u.key_epoch,
    author_seat: u.author_seat,
    created_at: u.created_at,
    ciphertext_b64: Buffer.from(u.ciphertext).toString("base64"),
  };
}

/** Process-wide fan-out hub (the server shares one; tests make their own). */
export const fanout = new FanoutHub();
