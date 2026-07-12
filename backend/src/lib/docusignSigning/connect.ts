/** Strict, document-free DocuSign Connect aggregate event verification. */

import { createHmac, timingSafeEqual } from "node:crypto";

export const CONNECT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface DocusignConnectPayload {
  event: "envelope-completed";
  apiVersion: string;
  uri: string;
  retryCount: number;
  configurationId: number;
  generatedDateTime: string;
  data: {
    accountId: string;
    envelopeId: string;
    envelopeSummary: {
      status: "completed";
      statusChangedDateTime: string;
    };
  };
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

const TOP_LEVEL_FIELDS = new Set(["event", "apiVersion", "uri", "retryCount", "configurationId", "generatedDateTime", "data"]);
const DATA_FIELDS = new Set(["accountId", "envelopeId", "envelopeSummary"]);
const SUMMARY_FIELDS = new Set(["status", "statusChangedDateTime"]);
const FORBIDDEN_FIELD = /^(document|documents|documentbytes|documentcontent|pdf|content|attachment|attachments|filename|filepath|path|recipientname|recipientemail|matterid|ceremonyurl)$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;
// DocuSign sends up to seven fractional digits, while JavaScript only retains milliseconds.
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;

function normalizedField(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function exactObject(value: unknown, allowedFields: Set<string>): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).every((key) => !FORBIDDEN_FIELD.test(normalizedField(key)) && allowedFields.has(key));
}

function nonEmptyOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_RE.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC_RE.test(value) && Number.isFinite(Date.parse(value));
}

/** Parse only after signature verification. Any document-shaped field is rejected, never stripped. */
export function validateDocusignConnectPayload(rawBody: string, nowMs = Date.now()): ConnectValidation {
  let candidate: unknown;
  try {
    candidate = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: "invalid_json", status: 400 };
  }
  if (!exactObject(candidate, TOP_LEVEL_FIELDS)) return { ok: false, code: "unknown_or_sensitive_field", status: 400 };
  const body = candidate;
  if (!exactObject(body["data"], DATA_FIELDS) || !exactObject(body["data"]["envelopeSummary"], SUMMARY_FIELDS)) {
    return { ok: false, code: "unknown_or_sensitive_field", status: 400 };
  }
  if (body["event"] !== "envelope-completed" || body["data"]["envelopeSummary"]["status"] !== "completed") {
    return { ok: false, code: "unknown_event_type", status: 400 };
  }
  const retryCount = body["retryCount"];
  const configurationId = body["configurationId"];
  if (typeof body["apiVersion"] !== "string" || typeof body["uri"] !== "string" || typeof retryCount !== "number" || !Number.isInteger(retryCount) || retryCount < 0 || typeof configurationId !== "number" || !Number.isInteger(configurationId) || configurationId < 0) {
    return { ok: false, code: "missing_event_fields", status: 400 };
  }
  if (!nonEmptyOpaqueId(body["data"]["accountId"]) || !nonEmptyOpaqueId(body["data"]["envelopeId"])) return { ok: false, code: "missing_event_fields", status: 400 };
  if (!validTimestamp(body["generatedDateTime"]) || !validTimestamp(body["data"]["envelopeSummary"]["statusChangedDateTime"])) return { ok: false, code: "invalid_timestamp", status: 400 };
  const timestamp = Date.parse(body["generatedDateTime"] as string);
  if (Math.abs(nowMs - timestamp) > CONNECT_CLOCK_SKEW_MS) return { ok: false, code: "expired_event", status: 400 };
  return {
    ok: true,
    payload: body as unknown as DocusignConnectPayload,
    at: new Date(timestamp).toISOString(),
  };
}
