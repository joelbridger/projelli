/**
 * Small HTTP helpers: JSON responses, body parsing with size cap, input
 * validation primitives, a simple in-memory IP rate limiter, and bearer-token
 * extraction. No framework — Bun.serve gives us Request/Response and that's
 * enough for a service this size.
 */

import { config } from "./config.ts";
import { verifyAccessJwt } from "./crypto.ts";
import type { AccessTokenClaims } from "./types.ts";
import type { Store } from "./db.ts";

const MAX_BODY_BYTES = 64 * 1024; // 64 KB — generous for our small JSON bodies.

// CORS: the desktop webview calls from `tauri://localhost`. Origin:* is safe
// because real deployment puts this behind a loopback-only reverse proxy and
// the auth/seat tokens are the actual security gate (same posture as the
// legacy validator). Tighten to specific origins if ever exposed directly.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Seat-Token",
  "Access-Control-Max-Age": "600",
};

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

export function error(code: string, status: number, detail?: string): Response {
  // `detail`/`error` keys match what the client's useLicense.ts reads.
  return json(detail ? { error: code, detail } : { error: code }, status);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Parse a JSON body with a hard size cap. Returns null on any failure. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Input validation primitives
// ---------------------------------------------------------------------------
export function isNonEmptyString(v: unknown, max = 512): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 320 && EMAIL_RE.test(v.trim());
}

/** Password policy: at least 12 chars, at most 200 (bcrypt truncates at 72
 *  bytes; we cap input so an over-long string can't be used to DoS hashing). */
export function isValidPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= 12 && v.length <= 200;
}

export const VALID_PLANS = new Set(["personal", "professional", "practice"]);
export const VALID_PACKS = new Set(["advisor", "legal", "tax", "consulting"]);

export function sanitizePacks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is string => typeof p === "string" && VALID_PACKS.has(p));
}

// ---------------------------------------------------------------------------
// Rate limiter — fixed-window per IP+bucket, in-memory.
// (Production would use Redis or the reverse proxy; in-memory is fine for a
// single-instance service and keeps the zero-dep promise. Documented in README.)
// ---------------------------------------------------------------------------
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  ip: string,
  bucket: string,
  opts?: { max?: number; windowSeconds?: number },
): { ok: boolean; retryAfter?: number } {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const max = opts?.max ?? config.authRateLimitMax;
  const windowMs = (opts?.windowSeconds ?? config.authRateLimitWindowSeconds) * 1000;
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (entry.count >= max) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { ok: true };
}

/** Periodically drop expired buckets so the map doesn't grow without bound. */
export function startRateLimitGc(): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }, 60_000);
  // Don't keep the process alive just for GC.
  if (typeof t.unref === "function") t.unref();
  return t;
}

// ---------------------------------------------------------------------------
// Auth: extract + verify a bearer access token
// ---------------------------------------------------------------------------
export function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export type AuthResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: string };

/** Verify a token string as an access JWT. */
function verifyAccess(token: string): AuthResult {
  const res = verifyAccessJwt<AccessTokenClaims>(token);
  if (!res.valid) return { ok: false, reason: res.reason };
  if (res.payload.typ !== "access") return { ok: false, reason: "wrong_token_type" };
  return { ok: true, claims: res.payload };
}

/** Verify the request carries a valid access JWT (Authorization: Bearer). Does NOT check role. */
export function authenticate(req: Request, store: Store): AuthResult {
  const token = getBearer(req);
  if (!token) return { ok: false, reason: "missing_token" };
  const auth = verifyAccess(token);
  if (!auth.ok || !auth.claims.sid) return auth.ok ? { ok: false, reason: "missing_session" } : auth;
  try {
    const session = store.getRefreshTokenById(auth.claims.sid);
    if (!session || session.user_id !== auth.claims.sub || session.revoked_at || session.rotated_to || Date.parse(session.expires_at) <= Date.now()) return { ok: false, reason: "session_invalid" };
    const user = store.getUser(auth.claims.sub);
    if (!user || user.status !== "active" || user.org_id !== auth.claims.org_id) return { ok: false, reason: "user_inactive" };
    const org = store.getOrg(user.org_id);
    if (!org || org.status !== "active") return { ok: false, reason: "org_inactive" };
    // The role comes from the live row, never the signed-but-stale token.
    return { ok: true, claims: { ...auth.claims, role: user.role, org_id: user.org_id, email: user.email } };
  } catch {
    return { ok: false, reason: "identity_unavailable" };
  }
}

// NOTE: relay endpoints used to accept the access token via an `?access_token=`
// query param so the browser WebSocket upgrade (which can't set headers) could
// authenticate. That leaked a credential into URLs (access logs / history), so
// it was removed: HTTP relay calls use the Authorization header + an X-Seat-Token
// header, and the WS upgrade carries only a single-use ticket (see syncTickets).
