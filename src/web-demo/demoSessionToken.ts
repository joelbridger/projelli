/**
 * Stream D-web Group III · Task 3.3
 *
 * Mints and persists the session token the demo browser sends to the
 * `lantern-demo-proxy`. Format (matches Group I's validator):
 *
 *   lantern-demo-<random-base64url>-<YYYY-MM-DD-utc>
 *
 * The middle segment is opaque session entropy minted in the browser. The
 * proxy only validates shape + that the date matches today's UTC date; the
 * abuse model is "tokens are session identifiers, rate limits do the real
 * work" (see proxy `rateLimit.ts`).
 *
 * Storage: localStorage. Tokens auto-rotate at midnight UTC because the date
 * suffix becomes stale; we re-mint on the first call after a date change.
 */

const STORAGE_KEY = '__lantern_demo_session_token';
const SECRET_BYTES = 16; // 128 bits → ~22 url-safe chars; well within proxy's 8..96 bound.

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for impossibly old environments. Should never hit in modern
    // browsers; we ship the demo to evergreen Chromium first.
    for (let i = 0; i < byteCount; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintToken(): string {
  return `lantern-demo-${randomBase64Url(SECRET_BYTES)}-${utcDate()}`;
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // private browsing / quota — tolerate; next call will re-mint and try again
  }
}

/**
 * Returns a valid token for today. Re-mints if the stored token's date
 * suffix is stale (rotated past midnight UTC) or if there is no stored token.
 */
export function getDemoSessionToken(): string {
  const today = utcDate();
  const stored = readStoredToken();
  if (stored && stored.endsWith(`-${today}`) && stored.startsWith('lantern-demo-')) {
    return stored;
  }
  const fresh = mintToken();
  writeStoredToken(fresh);
  return fresh;
}

/**
 * Force-mints a fresh token. The Group IV "Reset session" UX wires this up
 * so the user can request a new pool of demo messages without clearing
 * everything else in localStorage.
 */
export function resetDemoSessionToken(): string {
  const fresh = mintToken();
  writeStoredToken(fresh);
  return fresh;
}

/**
 * Test helper: clears the stored token so the next get* call re-mints. Not
 * used by production code paths.
 */
export function clearDemoSessionTokenForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // tolerate
  }
}
