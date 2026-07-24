/**
 * Matter key distribution (Phase 1 firm desktop wiring).
 *
 *   POST /matter/:id/keys/publish    Bearer + (admin | matter-owner)
 *       { epoch, wrapped: [{user_id, device_id, wrapped_key_b64}] }
 *       -> { ok, stored }  (walled members skipped; epoch mismatch -> 409)
 *
 *   POST /matter/:id/keys/fetch      Bearer + X-Seat-Token
 *       { device_id }
 *       -> { epoch, wrapped_key_b64 }  |  403 walled/non-member  |  404 not published
 *
 *   POST /matter/mine                Bearer + X-Seat-Token
 *       {}
 *       -> { matters: [{matter_id, client_name, status, key_epoch, role}] }
 *          member ∧ ¬walled only
 *
 * The access contract is fail-closed: a walled user returns 403 even if also
 * listed as a member. The adversarial test (member AND walled → 403) is
 * explicit in the test suite.
 */

import { json, error, readJson, isNonEmptyString, authenticate } from "../lib/http.ts";
import { verifyActiveSeat } from "../lib/matters.ts";
import type { Store } from "../lib/db.ts";

// ---------------------------------------------------------------------------
// POST /matter/:id/keys/publish
// ---------------------------------------------------------------------------

export async function handlePublishMatterKeys(req: Request, store: Store, matterId: string): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  // Access: admin OR matter owner (has a member row with role=owner).
  const matter = store.getMatter(matterId);
  if (!matter || matter.org_id !== auth.claims.org_id) return error("matter_not_found", 404);

  const isAdmin = auth.claims.role === "admin";
  const memberRow = store.getMatterMember(matterId, auth.claims.sub);
  const isOwner = memberRow?.role === "owner";
  if (!isAdmin && !isOwner) return error("forbidden", 403, "admin_or_owner_required");

  // Also reject if the caller themselves is walled (deny-overrides-allow).
  if (store.isWalled(matterId, auth.claims.sub)) return error("forbidden", 403, "walled");

  const body = await readJson<{ epoch?: unknown; wrapped?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  if (typeof body.epoch !== "number" || !Number.isInteger(body.epoch) || body.epoch < 1) {
    return error("missing_fields", 400, "epoch must be a positive integer");
  }
  if (!Array.isArray(body.wrapped)) return error("missing_fields", 400, "wrapped must be an array");

  // Reject stale epoch: the epoch in the request must match the matter's current epoch.
  if (body.epoch !== matter.key_epoch) {
    return error("stale_epoch", 409, `expected epoch ${matter.key_epoch}, got ${body.epoch}`);
  }

  let stored = 0;
  let skipped = 0;

  for (const entry of body.wrapped) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).user_id !== "string" ||
      typeof (entry as Record<string, unknown>).device_id !== "string" ||
      typeof (entry as Record<string, unknown>).wrapped_key_b64 !== "string"
    ) {
      return error("invalid_wrapped_entry", 400, "each entry must have user_id, device_id, wrapped_key_b64");
    }
    const e = entry as { user_id: string; device_id: string; wrapped_key_b64: string };

    // Verify the target user is in this org.
    const targetUser = store.getUser(e.user_id);
    if (!targetUser || targetUser.org_id !== auth.claims.org_id) {
      skipped++;
      continue;
    }

    // Walled users are silently skipped (do NOT store their key).
    if (store.isWalled(matterId, e.user_id)) {
      skipped++;
      continue;
    }

    store.upsertWrappedMatterKey({
      matter_id: matterId,
      epoch: body.epoch,
      user_id: e.user_id,
      device_id: e.device_id,
      wrapped_key_b64: e.wrapped_key_b64,
      published_by: auth.claims.sub,
    });
    stored++;
  }

  store.audit({
    org_id: auth.claims.org_id,
    actor_user_id: auth.claims.sub,
    action: "matter.keys.publish",
    target: matterId,
    detail: { epoch: body.epoch, stored, skipped },
  });

  return json({ ok: true, stored });
}

// ---------------------------------------------------------------------------
// POST /matter/:id/keys/fetch
// ---------------------------------------------------------------------------

export async function handleFetchMatterKey(req: Request, store: Store, matterId: string): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  // Also require an active seat token (X-Seat-Token header).
  const seatToken = req.headers.get("x-seat-token");
  if (!seatToken) return error("seat_required", 401, "missing_seat_token");
  const seat = verifyActiveSeat(store, seatToken, { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) return error("seat_invalid", 401, seat.reason);

  const matter = store.getMatter(matterId);
  if (!matter || matter.org_id !== auth.claims.org_id) return error("matter_not_found", 404);

  // Fail-closed: walled beats membership — deny if walled (even if also a member).
  if (store.isWalled(matterId, auth.claims.sub)) return error("forbidden", 403, "walled");

  // Non-member (and not an admin) → 403.
  const memberRow = store.getMatterMember(matterId, auth.claims.sub);
  const isAdmin = auth.claims.role === "admin";
  if (!memberRow && !isAdmin) return error("forbidden", 403, "not_member");

  const body = await readJson<{ device_id?: unknown }>(req);
  if (!body || !isNonEmptyString(body.device_id, 128)) return error("missing_fields", 400, "device_id");

  const row = store.getWrappedMatterKey(matterId, matter.key_epoch, auth.claims.sub, body.device_id.trim());
  if (!row) return error("not_published", 404, `no key published for device ${body.device_id} at epoch ${matter.key_epoch}`);

  store.audit({
    org_id: auth.claims.org_id,
    actor_user_id: auth.claims.sub,
    action: "matter.keys.fetch",
    target: matterId,
    detail: { epoch: matter.key_epoch, device_id: body.device_id.trim() },
  });

  return json({ epoch: matter.key_epoch, wrapped_key_b64: row.wrapped_key_b64 });
}

// ---------------------------------------------------------------------------
// POST /matter/mine
// ---------------------------------------------------------------------------

export async function handleMatterMine(req: Request, store: Store): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  // Also require a seat token (X-Seat-Token header).
  const seatToken = req.headers.get("x-seat-token");
  if (!seatToken) return error("seat_required", 401, "missing_seat_token");
  const seat = verifyActiveSeat(store, seatToken, { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) return error("seat_invalid", 401, seat.reason);

  // Fetch all matters where this user is a member AND NOT walled.
  const allMatters = store.listMatterMembershipsForUser(auth.claims.sub, auth.claims.org_id);

  return json({ matters: allMatters });
}
