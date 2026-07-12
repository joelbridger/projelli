/** Wrapped-key routes keyed by client-generated opaque `ih2_` intake handles. */
import { authenticate, error, isNonEmptyString, json, rateLimit } from "../lib/http.ts";
import { config } from "../lib/config.ts";
import { verifyActiveSeat } from "../lib/matters.ts";
import { readStrictV2Payload } from "../lib/v2Payload.ts";
import { v2BodyKeys } from "../lib/v2RouteInventory.ts";
import { decodeWrappedKeyEnvelope, encodeWrappedKeyEnvelope, MAX_WRAPPED_KEYS_PER_PUBLISH } from "../lib/wrappedKeyEnvelope.ts";
import type { Store } from "../lib/db.ts";

const validIntakeHandle = (handle: string) => /^ih2_[A-Za-z0-9_-]{43}$/.test(handle);
const validMatterHandle = (handle: unknown): handle is string => typeof handle === "string" && /^mh2_[A-Za-z0-9_-]{43}$/.test(handle);

function authSeat(req: Request, store: Store) {
  const auth = authenticate(req);
  if (!auth.ok) return { ok: false as const, resp: error("unauthorized", 401, auth.reason) };
  const token = req.headers.get("x-seat-token");
  if (!token) return { ok: false as const, resp: error("seat_required", 401) };
  const seat = verifyActiveSeat(store, token, { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  return seat.ok ? { ok: true as const, claims: auth.claims } : { ok: false as const, resp: error("seat_invalid", 401, seat.reason) };
}

export async function handlePublishIntakeKeys(req: Request, store: Store, intakeHandle: string): Promise<Response> {
  const auth = authenticate(req);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);
  if (!validIntakeHandle(intakeHandle)) return error("intake_not_found", 404);
  const body = await readStrictV2Payload(req, v2BodyKeys("publishIntakeKeys"));
  if (!body || !validMatterHandle(body.matter_handle) || !Number.isInteger(body.epoch) || typeof body.epoch !== "number" || !Array.isArray(body.wrapped) || body.wrapped.length > MAX_WRAPPED_KEYS_PER_PUBLISH || body.wrapped.some((item) => !item || typeof item !== "object" || Array.isArray(item) || Object.keys(item as Record<string, unknown>).some((key) => !["user_id", "device_id", "wrapped_key_b64"].includes(key)))) return error("invalid_v2_payload", 400);
  if (body.wrapped.length === 0) return error("empty_wrapped_keys", 400);

  const wrapped: Array<{ user_id: string; device_id: string; wrapped_key: Uint8Array }> = [];
  for (const item of body.wrapped) {
    const entry = item as Record<string, unknown>;
    const envelope = decodeWrappedKeyEnvelope(entry.wrapped_key_b64);
    if (!isNonEmptyString(entry.user_id, 64) || !isNonEmptyString(entry.device_id, 128) || !envelope || !store.getDevice(entry.device_id, entry.user_id)) return error("invalid_v2_payload", 400);
    wrapped.push({ user_id: entry.user_id, device_id: entry.device_id, wrapped_key: envelope });
  }

  const matter = store.getMatter(body.matter_handle);
  if (!matter || matter.org_id !== auth.claims.org_id) return error("matter_not_found", 404);
  if (store.isWalled(body.matter_handle, auth.claims.sub)) return error("forbidden", 403, "walled");
  const owner = store.getMatterMember(body.matter_handle, auth.claims.sub)?.role === "owner";
  if (auth.claims.role !== "admin" && !owner) return error("forbidden", 403, "admin_or_owner_required");
  const publishRate = rateLimit(auth.claims.org_id, "firm_intake_key_publish", { max: config.firmMatterIntakePublishRateLimitMax, windowSeconds: config.firmMatterStreamWriteRateLimitWindowSeconds });
  if (!publishRate.ok) return error("rate_limited", 429);

  const published = store.publishWrappedIntakeKeys({ intake_handle: intakeHandle, matter_handle: body.matter_handle, org_id: auth.claims.org_id, epoch: body.epoch, published_by: auth.claims.sub, wrapped });
  if ("matterArchived" in published || "matterNotFound" in published) return error("matter_not_found", 404);
  if ("publisherWalled" in published) return error("forbidden", 403, "walled");
  if ("publisherUnauthorized" in published) return error("forbidden", 403, "admin_or_owner_required");
  if ("invalidRecipient" in published) return error("invalid_v2_payload", 400);
  if ("emptyBatch" in published) return error("empty_wrapped_keys", 400);
  if ("staleEpoch" in published) return error("stale_epoch", 409);
  if ("intakeMatterMismatch" in published) return error("intake_matter_mismatch", 409);
  if ("intakeLimitReached" in published) return error("intake_limit_reached", 409);
  store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "intake.keys.publish", target: intakeHandle, detail: { op: "key_publish", matter_handle: body.matter_handle, epoch: body.epoch, stored: published.stored, skipped: published.skipped } });
  return json({ ok: true, stored: published.stored });
}

export async function handleFetchIntakeKey(req: Request, store: Store, intakeHandle: string): Promise<Response> {
  if (!validIntakeHandle(intakeHandle)) return error("intake_not_found", 404);
  const body = await readStrictV2Payload(req, v2BodyKeys("fetchIntakeKeys"));
  const auth = authSeat(req, store);
  if (!auth.ok) return auth.resp;
  if (!body || !isNonEmptyString(body.device_id, 128) || !store.getDevice(body.device_id, auth.claims.sub)) return error("invalid_v2_payload", 400);
  const fetched = store.fetchWrappedIntakeKeyForAccess({ intake_handle: intakeHandle, org_id: auth.claims.org_id, user_id: auth.claims.sub, role: auth.claims.role, device_id: body.device_id });
  if (!fetched.ok) {
    store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "intake.access.denied", target: intakeHandle, detail: { action: "key_fetch", reason: fetched.reason } });
    return error(fetched.reason === "walled" || fetched.reason === "not_member" ? "forbidden" : "intake_not_found", fetched.reason === "walled" || fetched.reason === "not_member" ? 403 : 404, fetched.reason === "inactive" ? undefined : fetched.reason);
  }
  store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "intake.access.granted", target: intakeHandle, detail: { action: "key_fetch", via: fetched.access } });
  if (!fetched.key) return error("not_published", 404);
  store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "intake.keys.fetch", target: intakeHandle, detail: { op: "key_fetch", epoch: fetched.epoch } });
  return json({ epoch: fetched.epoch, wrapped_key_b64: encodeWrappedKeyEnvelope(fetched.key.wrapped_key) });
}
