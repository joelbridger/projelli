/**
 * Firm backend configuration — the ONE place the client decides which URL the
 * firm backend lives at and how to reach its WebSocket.
 *
 * Resolution order (first hit wins):
 *   1. `VITE_FIRM_API_BASE` build/env override (used by tests + custom deploys).
 *   2. Dev (`import.meta.env.DEV`): the Vite proxy mount `/api/firm` (so the
 *      browser dev server can reach a locally-running backend without CORS).
 *   3. Production: `https://firm.keepance.com`.
 *
 * Solo/local mode never imports or calls any of this — it stays accountless.
 */

const PROD_FIRM_API_BASE = 'https://firm.keepance.com';
const DEV_FIRM_API_PROXY = '/api/firm';

function envBase(): string | undefined {
  try {
    const v = import.meta.env['VITE_FIRM_API_BASE'] as string | undefined;
    if (v && v.trim()) return v.trim().replace(/\/+$/, '');
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Absolute (or proxy-relative) base URL for the firm backend HTTP API. */
export function getFirmApiBase(): string {
  const override = envBase();
  if (override) return override;
  let isDev = false;
  try {
    isDev = import.meta.env.DEV;
  } catch {
    /* not a Vite/import.meta context */
  }
  return isDev ? DEV_FIRM_API_PROXY : PROD_FIRM_API_BASE;
}

/**
 * Build the WebSocket URL for the live matter-sync fan-out. The browser
 * `WebSocket` API cannot set an Authorization header, so the access token +
 * seat token ride as query params (the relay accepts them only on this
 * endpoint — see backend `authenticateRelay`).
 */
export function getMatterSyncSocketUrl(
  matterId: string,
  accessToken: string,
  seatToken: string,
): string {
  const base = getFirmApiBase();
  // Resolve to an absolute URL first (handles the dev proxy-relative base).
  let httpUrl: string;
  if (/^https?:\/\//i.test(base)) {
    httpUrl = base;
  } else if (typeof window !== 'undefined') {
    httpUrl = new URL(base, window.location.origin).toString();
  } else {
    httpUrl = `http://localhost${base}`;
  }
  const wsBase = httpUrl.replace(/^http/i, 'ws').replace(/\/+$/, '');
  const path = `/matter/${encodeURIComponent(matterId)}/sync`;
  const qs = `?seat_token=${encodeURIComponent(seatToken)}&access_token=${encodeURIComponent(accessToken)}`;
  return `${wsBase}${path}${qs}`;
}

/** App version sent on activation (kept in sync with the licensing hook). */
export const FIRM_APP_VERSION = '3.0.0';
