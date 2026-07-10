import { randomUUID } from "node:crypto";
import { hmacHash } from "../lib/crypto.ts";
import { CORS_HEADERS, error, isNonEmptyString, json } from "../lib/http.ts";
import type { Store, IntakeSubmissionRecord } from "../lib/db.ts";
import type { BundleResponse, ChunkUpload, StateBlob, SubmitManifest, SubmissionEnvelope } from "../intakeContract.ts";
import {
  authorizeAdvisorIntake,
  authorizePublicIntake,
  isSafeIntakePathId,
  MAX_INTAKE_CHECKLIST_BYTES,
  MAX_INTAKE_CHUNK_BYTES,
  MAX_INTAKE_FILE_BYTES,
  MAX_INTAKE_STATE_BYTES,
  MAX_INTAKE_SUBMISSIONS,
  MAX_INTAKE_TOTAL_BYTES,
  neutralIntakeGone,
  publicIntakeRateLimit,
  verifyAdvisorSeat,
} from "../lib/intake.ts";

const MAX_CREATE_REQUEST_BYTES = Math.ceil(MAX_INTAKE_CHECKLIST_BYTES * 1.4) + Math.ceil(MAX_INTAKE_STATE_BYTES * 1.4) + 64 * 1024;
const MAX_STATE_REQUEST_BYTES = Math.ceil(MAX_INTAKE_STATE_BYTES * 1.4) + 8 * 1024;
const MAX_CHUNK_REQUEST_BYTES = Math.ceil(MAX_INTAKE_CHUNK_BYTES * 1.4) + 64 * 1024;
const MAX_SUBMIT_REQUEST_BYTES = 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/u;

type ReadResult<T> = { ok: true; body: T } | { ok: false; tooLarge: boolean };

async function readJsonWithCap<T>(req: Request, maxBytes: number): Promise<ReadResult<T>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > maxBytes) return { ok: false, tooLarge: true };
  try {
    const text = await req.text();
    if (text.length > maxBytes) return { ok: false, tooLarge: true };
    return { ok: true, body: JSON.parse(text) as T };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function decodeB64(value: unknown, maxBytes: number): { ok: true; bytes: Uint8Array } | { ok: false; status: number; code: string } {
  if (typeof value !== "string" || value.length === 0) return { ok: false, status: 400, code: "missing_fields" };
  if (!BASE64_RE.test(value) || value.length % 4 === 1) return { ok: false, status: 400, code: "invalid_ciphertext" };
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = new Uint8Array(Buffer.from(padded, "base64"));
  if (bytes.byteLength === 0) return { ok: false, status: 400, code: "invalid_ciphertext" };
  if (bytes.byteLength > maxBytes) return { ok: false, status: 413, code: "payload_too_large" };
  return { ok: true, bytes };
}

function parseCursor(req: Request): { ok: true; cursor: number } | { ok: false; resp: Response } {
  const raw = new URL(req.url).searchParams.get("cursor") ?? "0";
  const cursor = Number(raw);
  if (!Number.isInteger(cursor) || cursor < 0) return { ok: false, resp: error("invalid_cursor", 400) };
  return { ok: true, cursor };
}

function ensureBodyMatchesEndpoint(
  body: { intake_id?: unknown; item_id?: unknown },
  intakeId: string,
  itemId?: string,
): Response | null {
  if (body.intake_id !== undefined && body.intake_id !== intakeId) return error("intake_mismatch", 400);
  if (itemId !== undefined && body.item_id !== undefined && body.item_id !== itemId) return error("item_mismatch", 400);
  return null;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function submissionEnvelope(store: Store, row: IntakeSubmissionRecord): SubmissionEnvelope & {
  cursor: number;
  blobs: Array<{ blob_id: number; index: number; size: number }>;
} | null {
  if (!row.manifest_ciphertext || !row.wrapped_content_key) return null;
  const chunks = store.listIntakeChunksForSubmission(row.intake_id, row.item_id, row.submission_id);
  return {
    intake_id: row.intake_id,
    item_id: row.item_id,
    submission_id: row.submission_id,
    manifest_ciphertext_b64: b64(row.manifest_ciphertext),
    wrapped_content_key_b64: b64(row.wrapped_content_key),
    chunk_count: row.chunk_count,
    submitted_at: row.created_at,
    cursor: row.id,
    blobs: chunks.map((c) => ({ blob_id: c.id, index: c.index, size: c.size })),
  };
}

// ---------------------------------------------------------------------------
// Advisor-authenticated endpoints (X-Seat-Token).
// ---------------------------------------------------------------------------

export async function handleCreateIntake(req: Request, store: Store): Promise<Response> {
  const advisor = verifyAdvisorSeat(req, store);
  if (!advisor.ok) return advisor.resp;

  const read = await readJsonWithCap<{
    intake_id?: unknown;
    auth_token?: unknown;
    t_auth?: unknown;
    expires_at?: unknown;
    checklist_ciphertext_b64?: unknown;
    state_ciphertext_b64?: unknown;
  }>(req, MAX_CREATE_REQUEST_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  const body = read.body;

  const intakeId = typeof body.intake_id === "string" && body.intake_id.length > 0 ? body.intake_id : randomUUID();
  if (!isSafeIntakePathId(intakeId)) return error("invalid_intake_id", 400);
  if (store.getIntake(intakeId)) return error("intake_exists", 409);

  const rawToken = typeof body.auth_token === "string" ? body.auth_token : typeof body.t_auth === "string" ? body.t_auth : null;
  if (!isNonEmptyString(rawToken, 2048) || typeof body.expires_at !== "string") return error("missing_fields", 400);
  if (!Number.isFinite(Date.parse(body.expires_at))) return error("invalid_expires_at", 400);

  const checklist = decodeB64(body.checklist_ciphertext_b64, MAX_INTAKE_CHECKLIST_BYTES);
  if (!checklist.ok) return error(checklist.code, checklist.status);
  const state = decodeB64(body.state_ciphertext_b64, MAX_INTAKE_STATE_BYTES);
  if (!state.ok) return error(state.code, state.status);

  const intake = store.createIntake({
    intake_id: intakeId,
    org_id: advisor.identity.org_id,
    user_id: advisor.identity.user_id,
    seat_id: advisor.identity.seat_id,
    token_hash: hmacHash(rawToken),
    expires_at: body.expires_at,
    checklist_ciphertext: checklist.bytes,
    state_ciphertext: state.bytes,
  });

  return json(
    {
      intake_id: intake.intake_id,
      expires_at: intake.expires_at,
      status: intake.status,
      checklist_version: intake.checklist_version,
      created_at: intake.created_at,
    },
    201,
  );
}

export async function handleReplaceIntakeChecklist(req: Request, store: Store, intakeId: string): Promise<Response> {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;

  const read = await readJsonWithCap<{ checklist_ciphertext_b64?: unknown }>(req, MAX_CREATE_REQUEST_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  const checklist = decodeB64(read.body.checklist_ciphertext_b64, MAX_INTAKE_CHECKLIST_BYTES);
  if (!checklist.ok) return error(checklist.code, checklist.status);

  const intake = store.replaceIntakeChecklist(intakeId, checklist.bytes);
  if (!intake) return error("intake_not_found", 404);
  return json({ ok: true, intake_id: intakeId, checklist_version: intake.checklist_version });
}

export async function handleRegenerateIntake(req: Request, store: Store, intakeId: string): Promise<Response> {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;

  const read = await readJsonWithCap<{
    token_b64?: unknown;
    auth_token?: unknown;
    checklist_ciphertext_b64?: unknown;
    state_ciphertext_b64?: unknown;
  }>(req, MAX_CREATE_REQUEST_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);

  const rawToken = typeof read.body.token_b64 === "string"
    ? read.body.token_b64
    : typeof read.body.auth_token === "string"
      ? read.body.auth_token
      : null;
  if (!isNonEmptyString(rawToken, 2048)) return error("missing_fields", 400);
  const checklist = decodeB64(read.body.checklist_ciphertext_b64, MAX_INTAKE_CHECKLIST_BYTES);
  if (!checklist.ok) return error(checklist.code, checklist.status);
  const state = decodeB64(read.body.state_ciphertext_b64, MAX_INTAKE_STATE_BYTES);
  if (!state.ok) return error(state.code, state.status);

  // Keep submitted ciphertext intact. Only the new link's authentication and
  // page-key-sealed display bundle are replaced.
  const intake = store.regenerateIntake({
    intake_id: intakeId,
    token_hash: hmacHash(rawToken),
    checklist_ciphertext: checklist.bytes,
    state_ciphertext: state.bytes,
  });
  if (!intake) return error("intake_not_found", 404);
  return json({ ok: true, intake_id: intakeId, checklist_version: intake.checklist_version });
}

export function handleIntakeInbox(req: Request, store: Store, intakeId: string): Response {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const cursor = parseCursor(req);
  if (!cursor.ok) return cursor.resp;

  const rows = store.listIntakeSubmissionsSince(intakeId, cursor.cursor, 500);
  const submissions = rows.map((row) => submissionEnvelope(store, row)).filter((v): v is NonNullable<typeof v> => v !== null);
  const latest = store.latestIntakeSubmissionCursor(intakeId);
  const lastCursor = submissions.length > 0 ? submissions[submissions.length - 1]!.cursor : cursor.cursor;
  return json({
    intake_id: intakeId,
    cursor: lastCursor,
    latest_cursor: latest,
    has_more: submissions.length === 500 && lastCursor < latest,
    submissions,
  });
}

export function handleGetIntakeBlob(req: Request, store: Store, intakeId: string, blobId: string): Response {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const id = Number(blobId);
  if (!Number.isInteger(id) || id <= 0) return error("invalid_blob_id", 400);

  const chunk = store.getIntakeChunkById(intakeId, id);
  if (!chunk) return error("blob_not_found", 404);
  return new Response(chunk.ciphertext, {
    status: 200,
    headers: { "content-type": "application/octet-stream", ...CORS_HEADERS },
  });
}

export async function handleAckIntake(req: Request, store: Store, intakeId: string): Promise<Response> {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const read = await readJsonWithCap<{ submission_ids?: unknown; blob_ids?: unknown }>(req, 64 * 1024);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);

  const submissionIds = Array.isArray(read.body.submission_ids)
    ? read.body.submission_ids.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 256)
    : [];
  const blobIds = Array.isArray(read.body.blob_ids)
    ? read.body.blob_ids
        .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN))
        .filter((v): v is number => Number.isInteger(v) && v > 0)
    : [];
  if (submissionIds.length === 0 && blobIds.length === 0) return error("missing_fields", 400);

  return json({ ok: true, ...store.ackIntakeCiphertext({ intake_id: intakeId, submission_ids: submissionIds, blob_ids: blobIds }) });
}

export function handleRevokeIntake(req: Request, store: Store, intakeId: string): Response {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  store.revokeIntake(intakeId);
  return json({ ok: true, intake_id: intakeId, status: "revoked" });
}

export async function handleExtendIntake(req: Request, store: Store, intakeId: string): Promise<Response> {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const read = await readJsonWithCap<{ expires_at?: unknown }>(req, 64 * 1024);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  if (typeof read.body.expires_at !== "string" || !Number.isFinite(Date.parse(read.body.expires_at))) {
    return error("invalid_expires_at", 400);
  }
  store.extendIntake(intakeId, read.body.expires_at);
  return json({ ok: true, intake_id: intakeId, expires_at: read.body.expires_at });
}

// ---------------------------------------------------------------------------
// Public endpoints (Authorization: Bearer t_auth). Body is read only after auth.
// ---------------------------------------------------------------------------

export function handleIntakeBundle(req: Request, store: Store, intakeId: string, ip: string): Response {
  const limited = publicIntakeRateLimit(ip, intakeId);
  if (limited) return limited;
  const auth = authorizePublicIntake(req, store, intakeId);
  if (!auth.ok) return auth.resp;

  const bundle = store.getIntakeBundle(intakeId);
  if (!bundle) return neutralIntakeGone();
  const body: BundleResponse = {
    checklist_ciphertext_b64: b64(bundle.checklist_ciphertext),
    state_ciphertext_b64: b64(bundle.state_ciphertext),
    checklist_version: bundle.checklist_version,
    finalized_item_ids: bundle.finalized_item_ids,
  };
  return json(body);
}

export async function handleSaveIntakeState(req: Request, store: Store, intakeId: string, ip: string): Promise<Response> {
  const limited = publicIntakeRateLimit(ip, intakeId);
  if (limited) return limited;
  const auth = authorizePublicIntake(req, store, intakeId);
  if (!auth.ok) return auth.resp;

  const read = await readJsonWithCap<StateBlob>(req, MAX_STATE_REQUEST_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  const state = decodeB64(read.body.ciphertext_b64, MAX_INTAKE_STATE_BYTES);
  if (!state.ok) return error(state.code, state.status);
  store.setIntakeState(intakeId, state.bytes);
  return json({ ok: true, intake_id: intakeId });
}

export async function handleUploadIntakeChunk(
  req: Request,
  store: Store,
  intakeId: string,
  itemId: string,
  ip: string,
): Promise<Response> {
  const limited = publicIntakeRateLimit(ip, intakeId);
  if (limited) return limited;
  const auth = authorizePublicIntake(req, store, intakeId);
  if (!auth.ok) return auth.resp;

  const read = await readJsonWithCap<ChunkUpload>(req, MAX_CHUNK_REQUEST_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  const mismatch = ensureBodyMatchesEndpoint(read.body, intakeId, itemId);
  if (mismatch) return mismatch;
  if (!isNonEmptyString(itemId, 256) || !isNonEmptyString(read.body.submission_id, 256)) return error("missing_fields", 400);
  if (!Number.isInteger(read.body.index) || read.body.index < 0) return error("invalid_index", 400);

  const ciphertext = decodeB64(read.body.ciphertext_b64, MAX_INTAKE_CHUNK_BYTES);
  if (!ciphertext.ok) return error(ciphertext.code, ciphertext.status);

  const currentFileBytes = store.sumIntakeSubmissionBytes(intakeId, itemId, read.body.submission_id);
  if (currentFileBytes + ciphertext.bytes.byteLength > MAX_INTAKE_FILE_BYTES) return error("file_too_large", 413);
  const currentTotalBytes = store.sumIntakeBytes(intakeId) + store.sumIntakeSubmissionStoredBytes(intakeId);
  if (currentTotalBytes + ciphertext.bytes.byteLength > MAX_INTAKE_TOTAL_BYTES) return error("intake_too_large", 413);

  const saved = store.appendIntakeChunk({
    intake_id: intakeId,
    item_id: itemId,
    submission_id: read.body.submission_id,
    index: read.body.index,
    ciphertext: ciphertext.bytes,
  });
  if (!saved.ok) return error(saved.reason, 409);
  return json(
    {
      ok: true,
      blob_id: saved.chunk.id,
      intake_id: intakeId,
      item_id: itemId,
      submission_id: read.body.submission_id,
      index: saved.chunk.index,
      size: saved.chunk.size,
    },
    201,
  );
}

export function handleListUploadedIntakeChunks(
  req: Request,
  store: Store,
  intakeId: string,
  itemId: string,
  ip: string,
): Response {
  const limited = publicIntakeRateLimit(ip, intakeId);
  if (limited) return limited;
  const auth = authorizePublicIntake(req, store, intakeId);
  if (!auth.ok) return auth.resp;

  const submissionId = new URL(req.url).searchParams.get("submission_id");
  if (!isNonEmptyString(itemId, 256) || !isNonEmptyString(submissionId, 256)) return error("missing_fields", 400);
  return json({
    uploaded_indexes: store.listIntakeChunkIndexesForSubmission(intakeId, itemId, submissionId),
  });
}

export async function handleSubmitIntakeItem(
  req: Request,
  store: Store,
  intakeId: string,
  itemId: string,
  ip: string,
): Promise<Response> {
  const limited = publicIntakeRateLimit(ip, intakeId);
  if (limited) return limited;
  const auth = authorizePublicIntake(req, store, intakeId);
  if (!auth.ok) return auth.resp;

  const read = await readJsonWithCap<SubmitManifest>(req, MAX_SUBMIT_REQUEST_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  const mismatch = ensureBodyMatchesEndpoint(read.body, intakeId, itemId);
  if (mismatch) return mismatch;
  if (!isNonEmptyString(itemId, 256) || !isNonEmptyString(read.body.submission_id, 256)) return error("missing_fields", 400);

  const manifest = decodeB64(read.body.manifest_ciphertext_b64, MAX_SUBMIT_REQUEST_BYTES);
  if (!manifest.ok) return error(manifest.code, manifest.status);
  const wrappedKey = decodeB64(read.body.wrapped_content_key_b64, MAX_SUBMIT_REQUEST_BYTES);
  if (!wrappedKey.ok) return error(wrappedKey.code, wrappedKey.status);

  // Finalization rows persist manifest + wrapped-key bytes independently of
  // chunks, so a link holder could otherwise grow the DB without bound by
  // posting endless fresh submission_ids. Count these bytes toward the intake
  // quota and cap the finalization row count.
  if (store.countIntakeSubmissions(intakeId) >= MAX_INTAKE_SUBMISSIONS) return error("intake_too_large", 413);
  const storedBytes = store.sumIntakeBytes(intakeId) + store.sumIntakeSubmissionStoredBytes(intakeId);
  if (storedBytes + manifest.bytes.byteLength + wrappedKey.bytes.byteLength > MAX_INTAKE_TOTAL_BYTES) {
    return error("intake_too_large", 413);
  }

  const finalized = store.finalizeIntakeSubmission({
    intake_id: intakeId,
    item_id: itemId,
    submission_id: read.body.submission_id,
    manifest_ciphertext: manifest.bytes,
    wrapped_content_key: wrappedKey.bytes,
  });
  if (!finalized.ok) return error(finalized.reason, 409);
  return json({ ok: true, intake_id: intakeId, item_id: itemId, submission_id: read.body.submission_id }, 201);
}
