/**
 * Blind DocuSign signing broker.
 *
 * It only mints a fresh OAuth capability, carries sealed launch ciphertext, and
 * turns an authenticated Connect completion into a tiny wake-up record. It has
 * no document, recipient, envelope-creation, or document-retrieval endpoint.
 */

import { createHash } from "node:crypto";
import { hmacEquals, hmacHash } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import { authenticate, error, getBearer, json, rateLimit } from "../lib/http.ts";
import { verifyActiveSeat } from "../lib/matters.ts";
import type { Store, IntakeRecord } from "../lib/db.ts";
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
const OPAQUE_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;
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
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401) };
  const seatToken = req.headers.get("x-seat-token");
  if (!seatToken) return { ok: false, resp: error("seat_required", 401, "missing_seat_token") };
  const seat = verifyActiveSeat(store, seatToken, { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) return { ok: false, resp: error("seat_invalid", 401, seat.reason) };
  const intake = store.getIntake(intakeId);
  if (!intake || intake.org_id !== auth.claims.org_id || intake.user_id !== auth.claims.sub) {
    return { ok: false, resp: error("intake_not_found", 404) };
  }
  return { ok: true, intake, userId: auth.claims.sub };
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

function validOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_RE.test(value);
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
  const parsed = await readStrictJson(req, ["template_id"]);
  if (!parsed.ok) return parsed.resp;
  const deps = dependencies(input);
  const signingConfig = deps.signingConfig ?? config.docusignSigning;
  const templateId = parsed.body.template_id;
  if (templateId !== undefined && !validOpaqueId(templateId)) return error("invalid_template_id", 400);
  if (signingConfig.environment === "production" && (!validOpaqueId(templateId) || !signingConfig.approvedTemplateIds.has(templateId))) {
    return error("docusign_template_not_approved", 403, "This DocuSign template is not approved for production signing.");
  }
  // Do this before the OAuth request so a partial demo setup cannot yield a
  // bearer with an unusable account target.
  if (!signingConfig.accountId || !signingConfig.apiBaseUri) return error("docusign_signing_not_configured", 503, "DocuSign signing is not configured for this environment.");
  const nowMs = deps.now();
  try {
    const issued = await requestDocusignSigningCapability(signingConfig, deps.postForm, Math.floor(nowMs / 1000));
    return json({
      // Legacy fields remain while desktop callers move to the explicit names.
      capability: issued.capability,
      expires_in: issued.expiresIn,
      access_token: issued.capability,
      account_id: signingConfig.accountId,
      base_uri: signingConfig.apiBaseUri,
      expires_at: new Date(nowMs + issued.expiresIn * 1000).toISOString(),
      return_url: signingConfig.allowedReturnUrl,
    });
  } catch (err) {
    return capabilityError(err);
  }
}

/** POST /docusign-signing/:intakeId/envelope */
export async function handleRegisterEnvelope(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const parsed = await readStrictJson(req, ["envelope_id"]);
  if (!parsed.ok) return parsed.resp;
  if (!validOpaqueId(parsed.body.envelope_id)) return error("invalid_envelope_id", 400);
  try {
    dependencies(input).brokerStore.registerEnvelope(intakeId, parsed.body.envelope_id);
  } catch {
    return error("envelope_registration_conflict", 409);
  }
  return json({ ok: true });
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
  const validated = validateDocusignConnectPayload(rawBody, deps.now());
  if (!validated.ok) return error(validated.code, validated.status);
  // Connect has no event ID or nonce in this notification. Its documented
  // idempotency identity is the completed envelope plus generated timestamp.
  const replayKey = `${validated.payload.data.envelopeId}\u0000${validated.payload.generatedDateTime}`;
  const eventId = createHash("sha256").update(replayKey).digest("hex");
  if (deps.brokerStore.hasSeen(replayKey)) return error("replayed_event", 409);
  const enqueued = deps.brokerStore.enqueueWakeup({
    event_id: eventId,
    envelope_id: validated.payload.data.envelopeId,
    event_type: "completed",
    at: validated.at,
  }, replayKey);
  if (!enqueued) return error("replayed_event", 409);
  return json({ ok: true });
}

/** GET /docusign-signing/:intakeId/wakeups */
export async function handleListSignatureWakeups(req: Request, store: Store, intakeId: string, input?: DocusignSigningDependencies): Promise<Response> {
  const advisor = authorizeAdvisorSigning(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const unexpected = await rejectUnexpectedBody(req);
  if (unexpected) return unexpected;
  return json({ wakeups: dependencies(input).brokerStore.listWakeups(intakeId) });
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
  return json({ ok: true, consumed: dependencies(input).brokerStore.consumeWakeups(intakeId, eventIds) });
}

export { MAX_SIGNATURE_LAUNCH_BYTES } from "../lib/docusignSigning/store.ts";
