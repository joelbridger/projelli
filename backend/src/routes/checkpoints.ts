import { authenticate, error, isNonEmptyString, json, readJson } from "../lib/http.ts";
import { resolveAccess, verifyActiveSeat } from "../lib/matters.ts";
import type { Store } from "../lib/db.ts";

export const MAX_CHECKPOINT_CHUNK_BYTES = 768 * 1024;

function opaque(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.length) return null;
  try { const bytes = new Uint8Array(Buffer.from(value, "base64")); return bytes.byteLength ? bytes : null; } catch { return null; }
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function checkpointGate(req: Request, store: Store, matterId: string, adminOnly = false) {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false as const, resp: error("unauthorized", 401) };
  const seat = verifyActiveSeat(store, req.headers.get("x-seat-token") ?? "", { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) return { ok: false as const, resp: error("seat_invalid", 401) };
  if (adminOnly && auth.claims.role !== "admin") return { ok: false as const, resp: error("forbidden", 403) };
  const access = resolveAccess(store, { orgId: auth.claims.org_id, userId: auth.claims.sub, role: auth.claims.role }, matterId);
  if (!access.allowed) return { ok: false as const, resp: error(access.reason === "cross_org" || access.reason === "matter_not_found" ? "matter_not_found" : "forbidden", access.reason === "cross_org" || access.reason === "matter_not_found" ? 404 : 403) };
  return { ok: true as const, orgId: auth.claims.org_id, userId: auth.claims.sub };
}

export async function handleCheckpointChunk(req: Request, store: Store, matterId: string): Promise<Response> {
  const body = await readJson<{ doc_id?: unknown; generation?: unknown; chunk_index?: unknown; ciphertext_b64?: unknown }>(req);
  if (!body || !isNonEmptyString(body.doc_id, 256) || !isInteger(body.generation) || !isInteger(body.chunk_index) || body.generation < 1 || body.chunk_index < 0) return error("missing_fields", 400);
  const gate = checkpointGate(req, store, matterId, true);
  if (!gate.ok) return gate.resp;
  const ciphertext = opaque(body.ciphertext_b64);
  if (!ciphertext) return error("invalid_ciphertext", 400);
  if (ciphertext.byteLength > MAX_CHECKPOINT_CHUNK_BYTES) return error("payload_too_large", 413);
  store.putCheckpointChunk({ matter_id: matterId, doc_id: body.doc_id.trim(), generation: body.generation, chunk_index: body.chunk_index, ciphertext });
  return json({ ok: true }, 201);
}

export async function handleCheckpointManifest(req: Request, store: Store, matterId: string): Promise<Response> {
  const body = await readJson<{ doc_id?: unknown; generation?: unknown; frontier?: unknown; retention_eligible?: unknown; manifest_ciphertext_b64?: unknown }>(req);
  if (!body || !isNonEmptyString(body.doc_id, 256) || !isInteger(body.generation) || !isInteger(body.frontier) || body.generation < 1 || body.frontier < 0 || typeof body.retention_eligible !== "boolean") return error("missing_fields", 400);
  const gate = checkpointGate(req, store, matterId, true);
  if (!gate.ok) return gate.resp;
  const manifest = opaque(body.manifest_ciphertext_b64);
  if (!manifest) return error("invalid_ciphertext", 400);
  if (manifest.byteLength > MAX_CHECKPOINT_CHUNK_BYTES) return error("payload_too_large", 413);
  const published = store.publishCheckpointManifest({ matter_id: matterId, org_id: gate.orgId, doc_id: body.doc_id.trim(), generation: body.generation, frontier: body.frontier, retention_eligible: body.retention_eligible, manifest_ciphertext: manifest });
  return json({ ok: true, duplicate: !published }, published ? 201 : 200);
}

export async function handleCheckpointReceipt(req: Request, store: Store, matterId: string): Promise<Response> {
  const body = await readJson<{ doc_id?: unknown; generation?: unknown; device_id?: unknown; signed_receipt_b64?: unknown }>(req);
  if (!body || !isNonEmptyString(body.doc_id, 256) || !isInteger(body.generation) || body.generation < 1 || !isNonEmptyString(body.device_id, 128)) return error("missing_fields", 400);
  const gate = checkpointGate(req, store, matterId);
  if (!gate.ok) return gate.resp;
  const device = store.getDevice(body.device_id, gate.userId);
  if (!device || device.org_id !== gate.orgId) return error("device_not_found", 404);
  const receipt = opaque(body.signed_receipt_b64);
  if (!receipt) return error("invalid_receipt", 400);
  // The signed receipt is opaque; the client independently reconstructs and signs before upload.
  const added = store.addCheckpointReceipt({ matter_id: matterId, org_id: gate.orgId, doc_id: body.doc_id.trim(), generation: body.generation, validator_user_id: gate.userId, validator_device_id: body.device_id.trim(), signed_receipt: receipt });
  return json({ ok: true, duplicate: !added }, added ? 201 : 200);
}

export async function handleCheckpointPrune(req: Request, store: Store, matterId: string): Promise<Response> {
  const body = await readJson<{ doc_id?: unknown; generation?: unknown }>(req);
  if (!body || !isNonEmptyString(body.doc_id, 256) || !isInteger(body.generation) || body.generation < 1) return error("missing_fields", 400);
  const gate = checkpointGate(req, store, matterId, true);
  if (!gate.ok) return gate.resp;
  const result = store.pruneCheckpointTail({ matter_id: matterId, org_id: gate.orgId, doc_id: body.doc_id.trim(), generation: body.generation });
  return result.ok ? json({ ok: true, pruned: result.pruned }) : error(result.reason!, 409);
}
