/**
 * Blind DocuSign signing broker.
 *
 * It only mints a fresh OAuth capability, carries sealed launch ciphertext, and
 * turns an authenticated Connect completion into a tiny wake-up record. It has
 * no document, recipient, envelope-creation, or document-retrieval endpoint.
 */

import { hmacEquals, hmacHash, verifySeatToken } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import { error, getBearer, json, rateLimit } from "../lib/http.ts";
import type { Store, IntakeRecord } from "../lib/db.ts";
import type { SeatTokenClaims } from "../lib/types.ts";
import {
  DocusignGrantError,
  type DocusignSigningGrantConfig,
  type HttpPostForm,
  requestDocusignSigningCapability,
} from "../lib/docusignSigning/jwtGrant.ts";
import { validateDocusignConnectPayload, verifyDocusignConnectSignature } from "../lib/docusignSigning/connect.ts";
import { BlindSigningBrokerStore, MAX_SIGNATURE_LAUNCH_BYTES } from "../lib/docusignSigning/store.ts";

const DECOY_INTAKE_TOKEN_HASH = hmacHash("lantern-docusign-signing-decoy-token-v1");
const MAX_JSON_BYTES = Math.ceil(MAX_SIGNATURE_LAUNCH_BYTES * 1.4) + 8 * 1024;
const MAX_CONNECT_BYTES = 64 * 1024;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/u;
const FORBIDDEN_FIELD = /^(document|documents|documentbytes|documentcontent|pdf|content|attachment|attachments|filename|filepath|path|recipientname|recipientemail|matterid|ceremonyurl)$/;

export interface DocusignSigningDependencies {
  brokerStore?: BlindSigningBrokerStore;
  postForm?: HttpPostForm;
  now?: () => number;
  signingConfig?: DocusignSigningGrantConfig & { connectKey?: string | null };
}

const liveBrokerStore = new BlindSigningBrokerStore();

function dependencies(input?: DocusignSigningDependencies): Required<Pick<DocusignSigningDependencies, "brokerStore" | "now">> & DocusignSigningDependencies {
  return {
    ...input,
    brokerStore: input?.brokerStore ?? liveBrokerStore,
    now: input?.now ?? Date.now,
  };
}

function fieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function safeIntakeId(intakeId: string): boolean {
  return intakeId.length > 0 && intakeId.length <= 128 && !intakeId.includes("/");
}

function authorizeAdvisorSigning(
  req: Request,
  store: Store,
  intakeId: string,
): { ok: true; intake: IntakeRecord; userId: string } | { ok: false; resp: Response } {
  if (!safeIntakeId(intakeId)) return { ok: false, resp: error("intake_not_found", 404) };
  const seatToken = req.headers.get("x-seat-token");
  if (!seatToken) return { ok: false, resp: error("seat_required", 401, "missing_seat_token") };
  const verified = verifySeatToken<SeatTokenClaims>(seatToken, config.seatPublicKey);
  if (!verified.valid) return { ok: false, resp: error("seat_invalid", 401, verified.reason) };
  const claims = verified.payload;
  const seat = store.getSeat(claims.seat_id);
  const org = store.getOrg(claims.org_id);
  const user = store.getUser(claims.user_id);
  if (!seat || seat.status !== "active" || seat.user_id !== claims.user_id || seat.org_id !== claims.org_id || !org || org.status !== "active" || !user || user.status !== "active") {
    return { ok: false, resp: error("seat_invalid", 401, "seat_not_active") };
  }
  const intake = store.getIntake(intakeId);
  if (!intake || intake.org_id !== claims.org_id || intake.user_id !== claims.user_id) {
    return { ok: false, resp: error("intake_not_found", 404) };
  }
  return { ok: true, intake, userId: claims.user_id };
}

/** Public launch read gate, intentionally independent from intake.ts internals. */
function authorizePublicSigningLaunch(
  req: Request,
  store: Store,
  intakeId: string,
  ip: string,
): { ok: true; intake: IntakeRecord } | { ok: false; resp: Response } {
  if (!safeIntakeId(intakeId)) return { ok: false, resp: error("intake_unavailable", 410) };
  const perIp = rateLimit(ip, "docusign_signing_public_ip", {
    max: config.intakePublicIpRateLimitMax,
    windowSeconds: config.intakePublicIpRateLimitWindowSeconds,
  });
  if (!perIp.ok) return { ok: false, resp: error("rate_limited", 429, `Try again in ${perIp.retryAfter}s`) };
  const perIntake = rateLimit(intakeId, "docusign_signing_public_intake", {
    max: config.intakePublicIntakeRateLimitMax,
    windowSeconds: config.intakePublicIntakeRateLimitWindowSeconds,
  });
  if (!perIntake.ok) return { ok: false, resp: error("rate_limited", 429, `Try again in ${perIntake.retryAfter}s`) };

  const intake = store.getIntake(intakeId);
  const tokenMatches = hmacEquals(getBearer(req) ?? "", intake?.token_hash ?? DECOY_INTAKE_TOKEN_HASH);
  const active = Boolean(intake && intake.status === "active" && Date.parse(intake.expires_at) > Date.now());
  if (!tokenMatches || !active || !intake) return { ok: false, resp: error("intake_unavailable", 410) };
  return { ok: true, intake };
}

async function readStrictJson(req: Request, allowedFields: readonly string[], maxBytes = MAX_JSON_BYTES): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; resp: Response }> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/")) return { ok: false, resp: error("multipart_not_allowed", 400) };
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxBytes) return { ok: false, resp: error("payload_too_large", 413) };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, resp: error("read_error", 400) };
  }
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, resp: error("payload_too_large", 413) };
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, resp: error("invalid_json", 400) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, resp: error("invalid_body", 400) };
  const object = body as Record<string, unknown>;
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(object)) {
    if (FORBIDDEN_FIELD.test(fieldName(key))) return { ok: false, resp: error("forbidden_field", 400) };
    if (!allowed.has(key)) return { ok: false, resp: error("unknown_field", 400) };
  }
  return { ok: true, body: object };
}

async function rejectUnexpectedBody(req: Request): Promise<Response | null> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/")) return error("multipart_not_allowed", 400);
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > 0 || req.body !== null) return error("body_not_allowed", 400);
  return null;
}

function validOpaqueLaunch(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(MAX_SIGNATURE_LAUNCH_BYTES * 4 / 3) + 4 || !B64_RE.test(value)) return false;
  try {
    return Buffer.from(value, "base64").byteLength <= MAX_SIGNATURE_LAUNCH_BYTES;
  } catch {
    return false;
  }
}

function capabilityError(err: unknown): Response {
  if (!(err instanceof DocusignGrantError)) return error("docusign_token_unavailable", 503);
  const details: Record<string, string> = {
    docusign_consent_required: "DocuSign consent is required for this signing integration.",
    docusign_signing_not_configured: "DocuSign signing is not configured for this environment.",
    docusign_production_not_released: "Production DocuSign signing has not been released.",
  };
  return error(err.code, err.status, details[err.code]);
}

/** POST /docusign-signing/:intakeId/capability */
export async function handleIssueSigningCapability(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const parsed = await readStrictJson(req, []);
  if (!parsed.ok) return parsed.resp;
  const deps = dependencies(input);
  const signingConfig = deps.signingConfig ?? config.docusignSigning;
  try {
    const issued = await requestDocusignSigningCapability(signingConfig, deps.postForm, Math.floor(deps.now() / 1000));
    return json({ capability: issued.capability, expires_in: issued.expiresIn });
  } catch (err) {
    return capabilityError(err);
  }
}

/** PUT /docusign-signing/:intakeId/launch */
export async function handlePutSignatureLaunch(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const parsed = await readStrictJson(req, ["launch_ciphertext_b64"]);
  if (!parsed.ok) return parsed.resp;
  if (!validOpaqueLaunch(parsed.body.launch_ciphertext_b64)) return error("invalid_launch_ciphertext", 400);
  // Store the opaque wire value verbatim. Do not decode, inspect, or log it.
  dependencies(input).brokerStore.putLaunch(intakeId, parsed.body.launch_ciphertext_b64);
  return json({ ok: true });
}

/** GET /docusign-signing/:intakeId/launch */
export async function handleGetSignatureLaunch(req: Request, store: Store, intakeId: string, ip: string, input?: DocusignSigningDependencies): Promise<Response> {
  const unexpected = await rejectUnexpectedBody(req);
  if (unexpected) return unexpected;
  const publicGate = authorizePublicSigningLaunch(req, store, intakeId, ip);
  if (!publicGate.ok) return publicGate.resp;
  return json({ launch_ciphertext_b64: dependencies(input).brokerStore.getLaunch(intakeId) });
}

/** DELETE /docusign-signing/:intakeId/launch */
export async function handleDeleteSignatureLaunch(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const unexpected = await rejectUnexpectedBody(req);
  if (unexpected) return unexpected;
  dependencies(input).brokerStore.deleteLaunch(intakeId);
  return json({ ok: true });
}

/** POST /webhooks/docusign-signing */
export async function handleDocusignConnectEvent(req: Request, input?: DocusignSigningDependencies): Promise<Response> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_CONNECT_BYTES) return error("payload_too_large", 413);
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return error("read_error", 400);
  }
  if (!rawBody) return error("empty_body", 400);
  if (Buffer.byteLength(rawBody) > MAX_CONNECT_BYTES) return error("payload_too_large", 413);
  const deps = dependencies(input);
  const signingConfig = deps.signingConfig ?? config.docusignSigning;
  // HMAC verification is deliberately before JSON parsing or schema inspection.
  if (!verifyDocusignConnectSignature(rawBody, req.headers.get("x-docusign-signature-1") ?? "", signingConfig.connectKey ?? null)) {
    return error("invalid_signature", 401, "X-DocuSign-Signature-1 verification failed");
  }
  const validated = validateDocusignConnectPayload(rawBody, signingConfig.environment, deps.now());
  if (!validated.ok) return error(validated.code, validated.status);
  if (deps.brokerStore.hasSeen(validated.payload.event_id, validated.payload.nonce)) return error("replayed_event", 409);
  const enqueued = deps.brokerStore.enqueueWakeup({
    event_id: validated.payload.event_id,
    envelope_id: validated.payload.envelope_id,
    event_type: validated.payload.event_type,
    at: validated.at,
  }, validated.payload.nonce);
  if (!enqueued) return error("replayed_event", 409);
  return json({ ok: true });
}

/** GET /docusign-signing/:intakeId/wakeups (advisor local record matches envelope IDs). */
export async function handleListSignatureWakeups(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const unexpected = await rejectUnexpectedBody(req);
  if (unexpected) return unexpected;
  // The broker deliberately holds no intake-to-envelope map. The authenticated
  // advisor's encrypted local record matches these opaque envelope wake-ups.
  return json({ wakeups: dependencies(input).brokerStore.listWakeups() });
}

/** POST /docusign-signing/:intakeId/wakeups/ack */
export async function handleAckSignatureWakeups(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const parsed = await readStrictJson(req, ["event_ids"]);
  if (!parsed.ok) return parsed.resp;
  const eventIds = parsed.body.event_ids;
  if (!Array.isArray(eventIds) || eventIds.length === 0 || eventIds.length > 100 || eventIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 256)) {
    return error("invalid_event_ids", 400);
  }
  return json({ ok: true, consumed: dependencies(input).brokerStore.consumeWakeups(eventIds) });
}

export { MAX_SIGNATURE_LAUNCH_BYTES } from "../lib/docusignSigning/store.ts";
