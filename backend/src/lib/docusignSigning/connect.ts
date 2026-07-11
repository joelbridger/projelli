/** Strict, document-free DocuSign Connect event verification. */

import { createHmac, timingSafeEqual } from "node:crypto";

export const CONNECT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface DocusignConnectPayload {
  event_id: string;
  envelope_id: string;
  event_type: "completed";
  occurred_at: string;
  environment: "demo" | "production";
  nonce: string;
}

export type ConnectValidation =
  | { ok: true; payload: DocusignConnectPayload; at: string }
  | { ok: false; code: string; status: number };

/** Same timing-safe HMAC shape as the existing LemonSqueezy webhook verifier. */
export function verifyDocusignConnectSignature(rawBody: string, signature: string, connectKey: string | null): boolean {
  if (!connectKey) return false;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", connectKey).update(rawBody).digest();
  } catch {
    return false;
  }
  let provided: Buffer;
  try {
    provided = /^[0-9a-f]{64}$/i.test(signature.trim())
      ? Buffer.from(signature.trim(), "hex")
      : Buffer.from(signature.trim(), "base64");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const ALLOWED_FIELDS = new Set(["event_id", "envelope_id", "event_type", "occurred_at", "environment", "nonce"]);
const FORBIDDEN_FIELD = /^(document|documents|documentbytes|documentcontent|pdf|content|attachment|attachments|filename|filepath|path|recipientname|recipientemail|matterid|ceremonyurl)$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function normalizedField(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function nonEmptyString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length <= max && OPAQUE_ID_RE.test(value);
}

/** Parse only after signature verification. Any document-shaped field is rejected, never stripped. */
export function validateDocusignConnectPayload(
  rawBody: string,
  expectedEnvironment: "demo" | "production",
  nowMs = Date.now(),
): ConnectValidation {
  let candidate: unknown;
  try {
    candidate = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: "invalid_json", status: 400 };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { ok: false, code: "invalid_payload", status: 400 };
  const body = candidate as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELD.test(normalizedField(key))) return { ok: false, code: "document_or_sensitive_field_forbidden", status: 400 };
    if (!ALLOWED_FIELDS.has(key)) return { ok: false, code: "unknown_field", status: 400 };
  }
  if (!nonEmptyString(body.event_id) || !nonEmptyString(body.envelope_id) || !nonEmptyString(body.nonce)) {
    return { ok: false, code: "missing_event_fields", status: 400 };
  }
  if (body.event_type !== "completed") return { ok: false, code: "unknown_event_type", status: 400 };
  if (body.environment !== expectedEnvironment) return { ok: false, code: "wrong_environment", status: 400 };
  if (typeof body.occurred_at !== "string" || !ISO_UTC_RE.test(body.occurred_at)) return { ok: false, code: "invalid_timestamp", status: 400 };
  const timestamp = Date.parse(body.occurred_at);
  if (!Number.isFinite(timestamp) || Math.abs(nowMs - timestamp) > CONNECT_CLOCK_SKEW_MS) {
    return { ok: false, code: "expired_event", status: 400 };
  }
  return {
    ok: true,
    payload: {
      event_id: body.event_id,
      envelope_id: body.envelope_id,
      event_type: "completed",
      occurred_at: body.occurred_at,
      environment: body.environment,
      nonce: body.nonce,
    } as DocusignConnectPayload,
    at: new Date(timestamp).toISOString(),
  };
}
