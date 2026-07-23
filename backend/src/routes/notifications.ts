import { type HttpRequest } from "../lib/requestBody.ts";
import { authenticate, authorizeLiveSession, error, isNonEmptyString, json, rateLimit, readJson } from "../lib/http.ts";
import { resolveAccess, verifyActiveSeat } from "../lib/matters.ts";
import { notificationHub, type NotificationHub } from "../lib/notifications.ts";
import { notifyTickets, type NotifyTicketStore } from "../lib/notifyTickets.ts";
import type { Store } from "../lib/db.ts";

const MAX_ENVELOPE_BYTES = 768 * 1024;

function decodeOpaque(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(value, "base64"));
    return bytes.byteLength ? bytes : null;
  } catch { return null; }
}

function notifyAuth(req: HttpRequest, store: Store, orgId: string) {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false as const, resp: error("unauthorized", 401) };
  if (auth.claims.org_id !== orgId) return { ok: false as const, resp: error("not_found", 404) };
  const seat = verifyActiveSeat(store, req.headers.get("x-seat-token") ?? "", { user_id: auth.claims.sub, org_id: orgId });
  if (!seat.ok) return { ok: false as const, resp: error("seat_invalid", 401) };
  return { ok: true as const, claims: auth.claims };
}

/** Authenticate identity + active seat without needing any body-derived org id. */
function notifyHeaderAuth(req: HttpRequest, store: Store) {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false as const, resp: error("unauthorized", 401) };
  const seat = verifyActiveSeat(store, req.headers.get("x-seat-token") ?? "", { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) return { ok: false as const, resp: error("seat_invalid", 401) };
  return { ok: true as const, claims: auth.claims };
}

function scopeMatterId(scope: unknown): string | null {
  if (!scope || typeof scope !== "object") return null;
  const matterId = (scope as Record<string, unknown>).matter_id;
  return isNonEmptyString(matterId, 128) ? matterId.trim() : null;
}

/** POST /notify/send — sender-blind sealed-envelope routing. */
export async function handleNotifySend(req: HttpRequest, store: Store, ip: string, hub: NotificationHub = notificationHub): Promise<Response> {
  const limited = rateLimit(ip, "notify_send", { max: 240, windowSeconds: 60 });
  if (!limited.ok) return error("rate_limited", 429);
  const headerAuth = notifyHeaderAuth(req, store);
  if (!headerAuth.ok) return headerAuth.resp;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body || !isNonEmptyString(body.org_id, 128) || !isNonEmptyString(body.recipient_user_id, 128) || !isNonEmptyString(body.envelope_id, 128) || !isNonEmptyString(body.key_hint, 1024) || !isNonEmptyString(body.idempotency_key, 256)) return error("missing_fields", 400);
  if (body.org_id !== headerAuth.claims.org_id) return error("not_found", 404);
  const recipient = store.getUser(body.recipient_user_id);
  if (!recipient || recipient.org_id !== body.org_id) return error("recipient_not_found", 404);
  if (recipient.status !== "active") return error("recipient_inactive", 403);
  const matterId = scopeMatterId(body.transient_scope);
  if (!matterId) return error("invalid_transient_scope", 400);
  const senderAccess = resolveAccess(store, { orgId: body.org_id, userId: headerAuth.claims.sub, role: headerAuth.claims.role }, matterId);
  const recipientAccess = resolveAccess(store, { orgId: body.org_id, userId: recipient.user_id, role: recipient.role }, matterId);
  if (!senderAccess.allowed || !recipientAccess.allowed || !store.hasCurrentMatterKeyGrant(matterId, recipient.user_id)) return error("recipient_not_eligible", 403);
  const ciphertext = decodeOpaque(body.ciphertext_b64);
  if (!ciphertext) return error("invalid_ciphertext", 400);
  if (ciphertext.byteLength > MAX_ENVELOPE_BYTES) return error("payload_too_large", 413);
  // This lifetime bit is the only class-derived relay metadata the frozen design permits.
  const approval = body.retention_until_terminal === true;
  const result = store.appendNotifyEnvelope({ org_id: body.org_id, recipient_user_id: recipient.user_id, envelope_id: body.envelope_id.trim(), ciphertext, key_hint: body.key_hint.trim(), idempotency_key: body.idempotency_key.trim(), retention_until_terminal: approval });
  if (result.conflict) return error("idempotency_conflict", 409);
  if (!result.duplicate) hub.broadcast({ type: "notify", org_id: body.org_id, recipient_user_id: recipient.user_id, seq: result.envelope.seq });
  return json({ ok: true, seq: result.envelope.seq, envelope_id: result.envelope.envelope_id, created_at: result.envelope.created_at, expires_at: result.envelope.expires_at, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
}

/** GET /notify/inbox?org_id=&since= — the source of truth; live WS is only a wake-up. */
export function handleNotifyInbox(req: HttpRequest, store: Store): Response {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org_id");
  const since = Number(url.searchParams.get("since") ?? "0");
  if (!orgId || !Number.isInteger(since) || since < 0) return error("invalid_cursor", 400);
  const auth = notifyAuth(req, store, orgId);
  if (!auth.ok) return auth.resp;
  const rows = store.getNotifyInbox(orgId, auth.claims.sub, since);
  return json({ org_id: orgId, since, cursor: rows.length ? rows[rows.length - 1]!.seq : since, latest_cursor: store.latestNotifyCursor(orgId, auth.claims.sub), has_more: rows.length === 500, envelopes: rows.map((row) => ({ seq: row.seq, envelope_id: row.envelope_id, created_at: row.created_at, expires_at: row.expires_at, key_hint: row.key_hint, ciphertext_b64: Buffer.from(row.ciphertext).toString("base64") })) });
}

export async function handleNotifyAck(req: HttpRequest, store: Store): Promise<Response> {
  const headerAuth = notifyHeaderAuth(req, store);
  if (!headerAuth.ok) return headerAuth.resp;
  const body = await readJson<{ org_id?: unknown; device_id?: unknown; up_to_cursor?: unknown }>(req);
  if (!body || !isNonEmptyString(body.org_id, 128) || !isNonEmptyString(body.device_id, 128) || typeof body.up_to_cursor !== "number" || !Number.isInteger(body.up_to_cursor) || body.up_to_cursor < 0) return error("missing_fields", 400);
  if (body.org_id !== headerAuth.claims.org_id) return error("not_found", 404);
  const device = store.getDevice(body.device_id, headerAuth.claims.sub);
  if (!device || device.org_id !== body.org_id || device.user_id !== headerAuth.claims.sub) return error("device_not_found", 404);
  return json({ ok: true, acked_through: store.acknowledgeNotify(body.org_id, headerAuth.claims.sub, body.device_id, body.up_to_cursor) });
}

export async function handleNotifySyncTicket(req: HttpRequest, store: Store, tickets: NotifyTicketStore = notifyTickets): Promise<Response> {
  const headerAuth = notifyHeaderAuth(req, store);
  if (!headerAuth.ok) return headerAuth.resp;
  const body = await readJson<{ org_id?: unknown }>(req);
  if (!body || !isNonEmptyString(body.org_id, 128)) return error("missing_fields", 400);
  if (body.org_id !== headerAuth.claims.org_id) return error("not_found", 404);
  return json(tickets.mint({ orgId: body.org_id, userId: headerAuth.claims.sub, sid: headerAuth.claims.sid }));
}

export function authorizeNotifySync(req: HttpRequest, store: Store, tickets: NotifyTicketStore = notifyTickets): { ok: true; orgId: string; userId: string; sid: string } | { ok: false; resp: Response } {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org_id");
  const ticket = url.searchParams.get("ticket");
  if (!orgId || !ticket) return { ok: false, resp: error("unauthorized", 401) };
  const binding = tickets.redeem(ticket);
  if (!binding || binding.orgId !== orgId) return { ok: false, resp: error("unauthorized", 401) };
  const live = authorizeLiveSession({ sub: binding.userId, org_id: binding.orgId, sid: binding.sid }, store);
  if (!live.ok || binding.orgId !== orgId) return { ok: false, resp: error("forbidden", 403) };
  return { ok: true, orgId, userId: live.claims.sub, sid: live.claims.sid };
}

/** Signed terminal notice handler; envelope content and sender identity remain opaque. */
export async function handleNotifyTerminal(req: HttpRequest, store: Store): Promise<Response> {
  const headerAuth = notifyHeaderAuth(req, store);
  if (!headerAuth.ok) return headerAuth.resp;
  const body = await readJson<{ org_id?: unknown; recipient_user_id?: unknown; envelope_id?: unknown; signed_terminal_notice_b64?: unknown }>(req);
  if (!body || !isNonEmptyString(body.org_id, 128) || !isNonEmptyString(body.recipient_user_id, 128) || !isNonEmptyString(body.envelope_id, 128) || !decodeOpaque(body.signed_terminal_notice_b64)) return error("missing_fields", 400);
  if (body.org_id !== headerAuth.claims.org_id) return error("not_found", 404);
  // The notice signature is opaque to the relay; client-side verification is the cryptographic authority.
  return store.markNotifyTerminal(body.org_id, body.recipient_user_id, body.envelope_id) ? json({ ok: true }) : error("envelope_not_found", 404);
}
