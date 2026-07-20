import { readCappedJson, type HttpRequest } from "../lib/requestBody.ts";
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
import {
  recordIntakePayloadRejected,
  recordIntakeRateLimited,
  recordIntakeUnauthorized,
  recordPublicIntakeRequest,
  type PublicIntakeEndpoint,
} from "../lib/intakeTelemetry.ts";

/** A neutral response for firm key/inbox access, avoiding an intake-id oracle. */
function intakeNotFound(): Response {
  return error("intake_not_found", 404);
}

function isFirmPlan(plan: string): boolean {
  return plan === 'practice';
}

/**
 * Firm team read access: active seat + JWT, current matter membership or org
 * admin, and no ethical wall. The key-routing row carries only the matter id.
 */
function authorizeSharedIntakeRead(
  req: HttpRequest,
  store: Store,
  intakeId: string,
): { ok: true; userId: string; orgId: string; intake: ReturnType<Store['getIntake']>; matterId: string } | { ok: false; resp: Response } {
  const advisor = verifyAdvisorSeat(req, store);
  if (!advisor.ok || !advisor.identity.access) return { ok: false, resp: intakeNotFound() };
  const org = store.getOrg(advisor.identity.org_id);
  if (!org || !isFirmPlan(org.plan)) return { ok: false, resp: intakeNotFound() };
  const intake = store.getIntake(intakeId);
  const matterId = store.getIntakeKeyMatterId(intakeId);
  if (!intake || !matterId || intake.org_id !== advisor.identity.org_id) return { ok: false, resp: intakeNotFound() };
  const matter = store.getMatter(matterId);
  if (!matter || matter.org_id !== advisor.identity.org_id || store.isWalled(matterId, advisor.identity.user_id)) {
    return { ok: false, resp: intakeNotFound() };
  }
  const allowed = advisor.identity.access.role === 'admin' || Boolean(store.getMatterMember(matterId, advisor.identity.user_id));
  if (!allowed) return { ok: false, resp: intakeNotFound() };
  return { ok: true, userId: advisor.identity.user_id, orgId: advisor.identity.org_id, intake, matterId };
}

/** Creator-only legacy/solo access, otherwise the Firm team read gate. */
function authorizeIntakeRead(req: HttpRequest, store: Store, intakeId: string): { ok: true; intake: NonNullable<ReturnType<Store['getIntake']>> } | { ok: false; resp: Response } {
  const creator = authorizeAdvisorIntake(req, store, intakeId);
  if (creator.ok) return { ok: true, intake: creator.intake };
  const shared = authorizeSharedIntakeRead(req, store, intakeId);
  if (!shared.ok || !shared.intake) return { ok: false, resp: intakeNotFound() };
  return { ok: true, intake: shared.intake };
}

const MAX_CREATE_REQUEST_BYTES = Math.ceil(MAX_INTAKE_CHECKLIST_BYTES * 1.4) + Math.ceil(MAX_INTAKE_STATE_BYTES * 1.4) + 64 * 1024;
const MAX_STATE_REQUEST_BYTES = Math.ceil(MAX_INTAKE_STATE_BYTES * 1.4) + 8 * 1024;
/** The largest body any intake route accepts (a base64 upload chunk + envelope). */
export const MAX_CHUNK_REQUEST_BYTES = Math.ceil(MAX_INTAKE_CHUNK_BYTES * 1.4) + 64 * 1024;
const MAX_SUBMIT_REQUEST_BYTES = 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/u;

type ReadResult<T> = { ok: true; body: T } | { ok: false; tooLarge: boolean };

/**
 * This is where the streaming-cap technique originated. It now lives in
 * `lib/requestBody.ts` so every route in the backend gets it, not just intake;
 * this stays as the intake-shaped adapter (`body` instead of `value`).
 */
async function readJsonWithCap<T>(req: HttpRequest, maxBytes: number): Promise<ReadResult<T>> {
  const read = await readCappedJson<T>(req, maxBytes);
  return read.ok ? { ok: true, body: read.value } : { ok: false, tooLarge: read.tooLarge };
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

function parseCursor(req: HttpRequest): { ok: true; cursor: number } | { ok: false; resp: Response } {
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

/**
 * The order here is security-sensitive: rate-limit without consulting storage,
 * then perform the constant-time capability check, and only then let a handler
 * touch its request body. The same limiter is applied to known and unknown ids
 * so its 429 response cannot reveal whether a link exists.
 */
function gatePublicIntake(
  req: HttpRequest,
  store: Store,
  intakeId: string,
  ip: string,
  endpoint: PublicIntakeEndpoint,
): { ok: true; intake: NonNullable<ReturnType<Store["getIntake"]>>; token: string } | { ok: false; resp: Response } {
  recordPublicIntakeRequest(endpoint);
  const limited = publicIntakeRateLimit(ip, intakeId);
  if (limited) {
    recordIntakeRateLimited();
    return { ok: false, resp: limited };
  }
  const auth = authorizePublicIntake(req, store, intakeId);
  if (!auth.ok) {
    recordIntakeUnauthorized();
    return auth;
  }
  return auth;
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

export async function handleCreateIntake(req: HttpRequest, store: Store): Promise<Response> {
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

// ---------------------------------------------------------------------------
// Firm-only intake private-key grants. The relay never receives a plaintext
// JWK; it validates routing only and persists opaque per-device ciphertext.
// ---------------------------------------------------------------------------

export async function handlePublishIntakeKeys(req: HttpRequest, store: Store, intakeId: string): Promise<Response> {
  const advisor = verifyAdvisorSeat(req, store);
  if (!advisor.ok || !advisor.identity.access) return intakeNotFound();
  const org = store.getOrg(advisor.identity.org_id);
  const intake = store.getIntake(intakeId);
  if (!org || !isFirmPlan(org.plan) || !intake || intake.org_id !== advisor.identity.org_id) return intakeNotFound();
  const canPublish = intake.user_id === advisor.identity.user_id || advisor.identity.access.role === 'admin';
  if (!canPublish) return intakeNotFound();

  const read = await readJsonWithCap<{ matter_id?: unknown; epoch?: unknown; wrapped?: unknown }>(req, 2 * 1024 * 1024);
  if (!read.ok) return read.tooLarge ? error('payload_too_large', 413) : error('invalid_json', 400);
  const { matter_id: matterId, epoch, wrapped } = read.body;
  if (!isNonEmptyString(matterId, 128) || !Number.isInteger(epoch) || (epoch as number) < 1 || !Array.isArray(wrapped)) {
    return error('missing_fields', 400);
  }
  const matter = store.getMatter(matterId);
  if (!matter || matter.org_id !== advisor.identity.org_id || store.isWalled(matterId, advisor.identity.user_id)) return intakeNotFound();

  const allowedUsers = new Set<string>();
  for (const member of store.listMatterMembers(matterId)) {
    if (!store.isWalled(matterId, member.user_id)) allowedUsers.add(member.user_id);
  }
  for (const admin of store.listOrgAdmins(advisor.identity.org_id)) {
    if (!store.isWalled(matterId, admin.user_id)) allowedUsers.add(admin.user_id);
  }
  const validated: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }> = [];
  for (const entry of wrapped) {
    if (!entry || typeof entry !== 'object') return error('invalid_wrapped_entry', 400);
    const row = entry as Record<string, unknown>;
    if (!isNonEmptyString(row.user_id, 128) || !isNonEmptyString(row.device_id, 128) || !isNonEmptyString(row.wrapped_key_b64, 32768)) {
      return error('invalid_wrapped_entry', 400);
    }
    if (!allowedUsers.has(row.user_id)) return error('invalid_wrapped_recipient', 400);
    const device = store.getDevice(row.device_id, row.user_id);
    if (!device || device.org_id !== advisor.identity.org_id) return error('invalid_wrapped_recipient', 400);
    validated.push({ user_id: row.user_id, device_id: row.device_id, wrapped_key_b64: row.wrapped_key_b64 });
  }
  store.replaceIntakeWrappedKeys({
    intake_id: intakeId,
    matter_id: matterId,
    epoch: epoch as number,
    published_by: advisor.identity.user_id,
    wrapped: validated,
  });
  store.audit({ org_id: advisor.identity.org_id, actor_user_id: advisor.identity.user_id, action: 'intake.keys.publish', target: intakeId, detail: { epoch, stored: validated.length } });
  return json({ ok: true, stored: validated.length });
}

export function handleFetchIntakeKey(req: HttpRequest, store: Store, intakeId: string): Response {
  const shared = authorizeSharedIntakeRead(req, store, intakeId);
  if (!shared.ok) return shared.resp;
  const deviceId = req.headers.get('x-device-id');
  if (!isNonEmptyString(deviceId, 128)) return error('missing_device_id', 400);
  const row = store.getIntakeWrappedKeyForDevice(intakeId, shared.userId, deviceId);
  if (!row || row.matter_id !== shared.matterId) return intakeNotFound();
  store.audit({ org_id: shared.orgId, actor_user_id: shared.userId, action: 'intake.keys.fetch', target: intakeId, detail: { epoch: row.epoch, device_id: deviceId } });
  return json({ epoch: row.epoch, wrapped_key_b64: row.wrapped_key_b64 });
}

/**
 * Return only routing metadata for private-key grants addressed to this exact
 * device. Each row is re-checked through the normal org, matter-membership,
 * and ethical-wall gate before it is exposed.
 */
export function handleListGrantedIntakes(req: HttpRequest, store: Store): Response {
  const advisor = verifyAdvisorSeat(req, store);
  if (!advisor.ok || !advisor.identity.access) return intakeNotFound();
  const deviceId = req.headers.get('x-device-id');
  if (!isNonEmptyString(deviceId, 128)) return error('missing_device_id', 400);

  const grants = store.listIntakeWrappedKeysForDevice(advisor.identity.user_id, deviceId);
  const intakes: Array<{ intake_id: string; matter_id: string; epoch: number }> = [];
  for (const grant of grants) {
    const shared = authorizeSharedIntakeRead(req, store, grant.intake_id);
    if (!shared.ok || shared.userId !== advisor.identity.user_id || shared.matterId !== grant.matter_id) continue;
    intakes.push({ intake_id: grant.intake_id, matter_id: grant.matter_id, epoch: grant.epoch });
  }
  return json({ intakes });
}

export async function handleReplaceIntakeChecklist(req: HttpRequest, store: Store, intakeId: string): Promise<Response> {
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

export async function handleRegenerateIntake(req: HttpRequest, store: Store, intakeId: string): Promise<Response> {
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

export function handleIntakeInbox(req: HttpRequest, store: Store, intakeId: string): Response {
  const advisor = authorizeIntakeRead(req, store, intakeId);
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

export function handleGetIntakeBlob(req: HttpRequest, store: Store, intakeId: string, blobId: string): Response {
  const advisor = authorizeIntakeRead(req, store, intakeId);
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

export async function handleAckIntake(req: HttpRequest, store: Store, intakeId: string): Promise<Response> {
  // Acknowledging deletes ciphertext. Read access is shareable, deletion is
  // deliberately creator-only so a teammate cannot erase an offline owner's
  // mailbox before every authorized device has fetched it.
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

export function handleRevokeIntake(req: HttpRequest, store: Store, intakeId: string): Response {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  store.revokeIntake(intakeId);
  return json({ ok: true, intake_id: intakeId, status: "revoked" });
}

export async function handleExtendIntake(req: HttpRequest, store: Store, intakeId: string): Promise<Response> {
  const advisor = authorizeAdvisorIntake(req, store, intakeId);
  if (!advisor.ok) return advisor.resp;
  const read = await readJsonWithCap<{ expires_at?: unknown }>(req, 64 * 1024);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  if (typeof read.body.expires_at !== "string" || !Number.isFinite(Date.parse(read.body.expires_at))) {
    return error("invalid_expires_at", 400);
  }
  const expiresAt = new Date(read.body.expires_at).toISOString();
  store.extendIntake(intakeId, expiresAt);
  return json({ ok: true, intake_id: intakeId, expires_at: expiresAt });
}

// ---------------------------------------------------------------------------
// Public endpoints (Authorization: Bearer t_auth). Body is read only after auth.
// ---------------------------------------------------------------------------

export function handleIntakeBundle(req: HttpRequest, store: Store, intakeId: string, ip: string): Response {
  const auth = gatePublicIntake(req, store, intakeId, ip, "bundle");
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

export async function handleSaveIntakeState(req: HttpRequest, store: Store, intakeId: string, ip: string): Promise<Response> {
  const auth = gatePublicIntake(req, store, intakeId, ip, "state");
  if (!auth.ok) return auth.resp;

  const read = await readJsonWithCap<StateBlob>(req, MAX_STATE_REQUEST_BYTES);
  if (!read.ok) {
    if (read.tooLarge) recordIntakePayloadRejected();
    return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  }
  const state = decodeB64(read.body.ciphertext_b64, MAX_INTAKE_STATE_BYTES);
  if (!state.ok) {
    if (state.status === 413) recordIntakePayloadRejected();
    return error(state.code, state.status);
  }
  if (!store.setIntakeState(intakeId, state.bytes, auth.intake.generation)) {
    return error("stale_state", 409);
  }
  return json({ ok: true, intake_id: intakeId });
}

export async function handleUploadIntakeChunk(
  req: HttpRequest,
  store: Store,
  intakeId: string,
  itemId: string,
  ip: string,
): Promise<Response> {
  const auth = gatePublicIntake(req, store, intakeId, ip, "chunk");
  if (!auth.ok) return auth.resp;

  const read = await readJsonWithCap<ChunkUpload>(req, MAX_CHUNK_REQUEST_BYTES);
  if (!read.ok) {
    if (read.tooLarge) recordIntakePayloadRejected();
    return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  }
  const mismatch = ensureBodyMatchesEndpoint(read.body, intakeId, itemId);
  if (mismatch) return mismatch;
  if (!isNonEmptyString(itemId, 256) || !isNonEmptyString(read.body.submission_id, 256)) return error("missing_fields", 400);
  if (!Number.isInteger(read.body.index) || read.body.index < 0) return error("invalid_index", 400);

  const ciphertext = decodeB64(read.body.ciphertext_b64, MAX_INTAKE_CHUNK_BYTES);
  if (!ciphertext.ok) {
    if (ciphertext.status === 413) recordIntakePayloadRejected();
    return error(ciphertext.code, ciphertext.status);
  }

  const currentFileBytes = store.sumIntakeSubmissionBytes(intakeId, itemId, read.body.submission_id);
  if (currentFileBytes + ciphertext.bytes.byteLength > MAX_INTAKE_FILE_BYTES) {
    recordIntakePayloadRejected();
    return error("file_too_large", 413);
  }
  const currentTotalBytes = store.sumIntakeBytes(intakeId) + store.sumIntakeSubmissionStoredBytes(intakeId);
  if (currentTotalBytes + ciphertext.bytes.byteLength > MAX_INTAKE_TOTAL_BYTES) {
    recordIntakePayloadRejected();
    return error("intake_too_large", 413);
  }

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
  req: HttpRequest,
  store: Store,
  intakeId: string,
  itemId: string,
  ip: string,
): Response {
  const auth = gatePublicIntake(req, store, intakeId, ip, "chunks");
  if (!auth.ok) return auth.resp;

  const submissionId = new URL(req.url).searchParams.get("submission_id");
  if (!isNonEmptyString(itemId, 256) || !isNonEmptyString(submissionId, 256)) return error("missing_fields", 400);
  return json({
    uploaded_indexes: store.listIntakeChunkIndexesForSubmission(intakeId, itemId, submissionId),
  });
}

export async function handleSubmitIntakeItem(
  req: HttpRequest,
  store: Store,
  intakeId: string,
  itemId: string,
  ip: string,
): Promise<Response> {
  const auth = gatePublicIntake(req, store, intakeId, ip, "submit");
  if (!auth.ok) return auth.resp;

  const read = await readJsonWithCap<SubmitManifest>(req, MAX_SUBMIT_REQUEST_BYTES);
  if (!read.ok) {
    if (read.tooLarge) recordIntakePayloadRejected();
    return read.tooLarge ? error("payload_too_large", 413) : error("invalid_json", 400);
  }
  const mismatch = ensureBodyMatchesEndpoint(read.body, intakeId, itemId);
  if (mismatch) return mismatch;
  if (!isNonEmptyString(itemId, 256) || !isNonEmptyString(read.body.submission_id, 256)) return error("missing_fields", 400);

  const manifest = decodeB64(read.body.manifest_ciphertext_b64, MAX_SUBMIT_REQUEST_BYTES);
  if (!manifest.ok) {
    if (manifest.status === 413) recordIntakePayloadRejected();
    return error(manifest.code, manifest.status);
  }
  const wrappedKey = decodeB64(read.body.wrapped_content_key_b64, MAX_SUBMIT_REQUEST_BYTES);
  if (!wrappedKey.ok) {
    if (wrappedKey.status === 413) recordIntakePayloadRejected();
    return error(wrappedKey.code, wrappedKey.status);
  }

  // Finalization rows persist manifest + wrapped-key bytes independently of
  // chunks, so a link holder could otherwise grow the DB without bound by
  // posting endless fresh submission_ids. Count these bytes toward the intake
  // quota and cap the finalization row count.
  if (store.countIntakeSubmissions(intakeId) >= MAX_INTAKE_SUBMISSIONS) {
    recordIntakePayloadRejected();
    return error("intake_too_large", 413);
  }
  const storedBytes = store.sumIntakeBytes(intakeId) + store.sumIntakeSubmissionStoredBytes(intakeId);
  if (storedBytes + manifest.bytes.byteLength + wrappedKey.bytes.byteLength > MAX_INTAKE_TOTAL_BYTES) {
    recordIntakePayloadRejected();
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
