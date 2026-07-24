/**
 * Per-org licensing / seat routes — the core of chunk 1.
 *
 *   POST /org/activate   (Bearer access token) { license_key, machine_id, machine_label? }
 *       -> binds a seat under seat_limit; returns a signed seat token.
 *       -> 409 with the current seat list when the limit is hit (the N+1 machine).
 *
 *   POST /seat/validate  { seat_token }   -> { valid, tier, packs, seats, seats_used, ... }
 *   POST /seat/heartbeat  { seat_token }  -> same as validate + bumps last_seen.
 *
 * /seat/validate and /seat/heartbeat are UNAUTHENTICATED by access token on
 * purpose: the seat token *is* the credential, it's asymmetrically signed, and
 * the desktop app calls these on a timer without necessarily holding a fresh
 * access JWT. They reveal only entitlement metadata, never secrets.
 */

import { json, error, readJson, isNonEmptyString, authenticate } from "../lib/http.ts";
import { activateSeatForUser, validateSeatToken, heartbeatSeat } from "../lib/services.ts";
import type { Store } from "../lib/db.ts";

export async function handleActivate(req: Request, store: Store): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  const body = await readJson<{ license_key?: unknown; machine_id?: unknown; machine_label?: unknown; app_version?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  if (!isNonEmptyString(body.license_key, 128) || !isNonEmptyString(body.machine_id, 128)) {
    return error("missing_fields", 400);
  }
  const machineLabel = isNonEmptyString(body.machine_label, 128) ? body.machine_label.trim() : null;

  const user = store.getUser(auth.claims.sub);
  if (!user) return error("unauthorized", 401, "user_not_found");

  const result = activateSeatForUser(store, {
    user,
    licenseKey: body.license_key.trim(),
    machineId: body.machine_id.trim(),
    machineLabel,
  });
  return json(result.body, result.http);
}

export async function handleSeatValidate(req: Request, store: Store): Promise<Response> {
  const body = await readJson<{ seat_token?: unknown; token?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  // Accept both `seat_token` (new contract) and `token` (legacy /validate field).
  const tok = typeof body.seat_token === "string" ? body.seat_token : typeof body.token === "string" ? body.token : null;
  if (!tok) return json({ valid: false, reason: "missing_token" }, 400);

  const res = validateSeatToken(store, tok);
  if (!res.valid) return json({ valid: false, reason: res.reason });
  return json(res.body);
}

export async function handleSeatHeartbeat(req: Request, store: Store): Promise<Response> {
  const body = await readJson<{ seat_token?: unknown; token?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  const tok = typeof body.seat_token === "string" ? body.seat_token : typeof body.token === "string" ? body.token : null;
  if (!tok) return json({ valid: false, reason: "missing_token" }, 400);

  const res = heartbeatSeat(store, tok);
  if (!res.valid) return json({ valid: false, reason: res.reason });
  return json(res.body);
}
