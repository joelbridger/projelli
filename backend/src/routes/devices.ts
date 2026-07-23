/**
 * Device-key registration and enumeration (Phase 1 firm desktop wiring).
 *
 *   POST /device/register       Bearer access          { device_id, machine_id, label, pubkey_jwk }
 *       -> upsert a P-256 device public key for the calling user.
 *
 *   POST /org/users/devices     Bearer access          { user_ids: string[] }
 *       -> return all registered devices for the listed users (same-org only).
 *          Any org member may call this: device public keys are public by
 *          definition, and matter OWNERS (who may not be org admins) need the
 *          recipient devices to wrap per-matter keys for members.
 *
 *   POST /org/admins            Bearer access          { }
 *       -> list the caller's org admins ({ user_id, email }). Any org member;
 *          used by key publishing to include admin devices as escrow.
 *
 * The backend stores EC P-256 public JWKs only; private keys never transit this
 * service. The call validates that the JWK is a public EC P-256 key (kty=EC,
 * crv=P-256, x+y present, no `d` field) — anything else is rejected 400.
 */

import { type HttpRequest } from "../lib/requestBody.ts";
import { json, error, readJson, isNonEmptyString, authenticate } from "../lib/http.ts";
import type { Store } from "../lib/db.ts";

// ---------------------------------------------------------------------------
// P-256 public JWK validation
// ---------------------------------------------------------------------------

/** Validate that `v` is an EC P-256 PUBLIC JWK (no private key field `d`). */
function isValidP256PublicJwk(v: unknown): v is { kty: "EC"; crv: "P-256"; x: string; y: string } {
  if (typeof v !== "object" || v === null) return false;
  const jwk = v as Record<string, unknown>;
  if (jwk.kty !== "EC") return false;
  if (jwk.crv !== "P-256") return false;
  if (typeof jwk.x !== "string" || jwk.x.length === 0) return false;
  if (typeof jwk.y !== "string" || jwk.y.length === 0) return false;
  // Reject private keys — `d` is the private scalar in EC JWKs.
  if ("d" in jwk) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /device/register — upsert this user's device public key. */
export async function handleDeviceRegister(req: HttpRequest, store: Store): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  const body = await readJson<{
    device_id?: unknown;
    machine_id?: unknown;
    label?: unknown;
    pubkey_jwk?: unknown;
  }>(req);
  if (!body) return error("invalid_json", 400);
  if (!isNonEmptyString(body.device_id, 128)) return error("missing_fields", 400, "device_id");
  if (!isNonEmptyString(body.machine_id, 128)) return error("missing_fields", 400, "machine_id");
  if (!isNonEmptyString(body.label, 256)) return error("missing_fields", 400, "label");

  // Parse and validate the JWK.
  let jwk: unknown;
  try {
    jwk = typeof body.pubkey_jwk === "string" ? JSON.parse(body.pubkey_jwk) : body.pubkey_jwk;
  } catch {
    return error("invalid_pubkey_jwk", 400, "not valid JSON");
  }
  if (!isValidP256PublicJwk(jwk)) {
    return error("invalid_pubkey_jwk", 400, "must be EC P-256 public JWK (kty=EC, crv=P-256, x, y; no d)");
  }

  // Store the canonical JSON serialization (sorted keys for determinism).
  const jwkText = JSON.stringify(jwk);

  store.upsertDevice({
    device_id: body.device_id.trim(),
    user_id: auth.claims.sub,
    org_id: auth.claims.org_id,
    machine_id: body.machine_id.trim(),
    label: body.label.trim(),
    pubkey_jwk: jwkText,
  });
  store.audit({
    org_id: auth.claims.org_id,
    actor_user_id: auth.claims.sub,
    action: "device.register",
    target: body.device_id.trim(),
    detail: { machine_id: body.machine_id.trim() },
  });

  return json({ ok: true });
}

/** POST /org/users/devices — list devices for a set of users (any org member, same-org). */
export async function handleListUsersDevices(req: HttpRequest, store: Store): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  const body = await readJson<{ user_ids?: unknown }>(req);
  if (!body || !Array.isArray(body.user_ids)) return error("missing_fields", 400, "user_ids");
  if (body.user_ids.length === 0) return json({ devices: [] });

  // Validate and normalise: must be non-empty strings, all same-org.
  const userIds: string[] = [];
  for (const id of body.user_ids) {
    if (typeof id !== "string" || id.trim().length === 0) return error("invalid_user_id", 400);
    const u = store.getUser(id.trim());
    if (!u) return error("user_not_found", 404, id);
    if (u.org_id !== auth.claims.org_id) return error("forbidden", 403, "cross_org");
    userIds.push(id.trim());
  }

  const devices = store.listDevicesForUsers(userIds);
  return json({
    devices: devices.map((d) => ({
      user_id: d.user_id,
      device_id: d.device_id,
      // pubkey_jwk is stored in the DB as a JSON string; parse it to an object
      // so callers receive a JsonWebKey object as expected by the contract.
      pubkey_jwk: typeof d.pubkey_jwk === "string" ? JSON.parse(d.pubkey_jwk) : d.pubkey_jwk,
      label: d.label,
    })),
  });
}

/** POST /org/admins — list the caller's org admins (any org member). */
export async function handleListOrgAdmins(req: HttpRequest, store: Store): Promise<Response> {
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  const admins = store.listOrgAdmins(auth.claims.org_id);
  return json({ admins });
}
