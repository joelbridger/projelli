/**
 * Ephemeral SSO server-side state. Two single-use, TTL'd in-memory maps:
 *  - `state` (issued in /auth/sso/start, consumed in the callback): binds the
 *    flow to one org + PKCE verifier + nonce + the desktop's loopback port.
 *  - `code` (issued by the callback, consumed by /auth/sso/exchange): a one-time
 *    handle the desktop swaps for real tokens, keyed by hmacHash(code).
 * Single-instance only (same posture as the rate limiter + syncTickets); a
 * sweeper drops expired entries so the maps can't grow unbounded.
 */
export interface SsoStateEntry {
  orgId: string; issuer: string; clientId: string;
  codeVerifier: string; nonce: string; loopbackPort: number;
}
export interface SsoCodeEntry { userId: string; }

interface Wrapped<T> { value: T; expiresAt: number; }
const states = new Map<string, Wrapped<SsoStateEntry>>();
const codes = new Map<string, Wrapped<SsoCodeEntry>>();

export function putState(state: string, e: SsoStateEntry, ttlSeconds: number): void {
  states.set(state, { value: e, expiresAt: Date.now() + ttlSeconds * 1000 });
}
export function takeState(state: string): SsoStateEntry | null {
  const w = states.get(state);
  states.delete(state);
  if (!w || w.expiresAt <= Date.now()) return null;
  return w.value;
}
export function putCode(codeHash: string, e: SsoCodeEntry, ttlSeconds: number): void {
  codes.set(codeHash, { value: e, expiresAt: Date.now() + ttlSeconds * 1000 });
}
export function takeCode(codeHash: string): SsoCodeEntry | null {
  const w = codes.get(codeHash);
  codes.delete(codeHash);
  if (!w || w.expiresAt <= Date.now()) return null;
  return w.value;
}
export function startSsoStateGc(): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of states) if (v.expiresAt <= now) states.delete(k);
    for (const [k, v] of codes) if (v.expiresAt <= now) codes.delete(k);
  }, 60_000);
  if (typeof t.unref === "function") t.unref();
  return t;
}
