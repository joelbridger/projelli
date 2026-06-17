/**
 * installId — anonymous, persistent identifier used by opt-in telemetry.
 *
 * This is a random UUID generated once on first launch and persisted in
 * localStorage. It contains no PII and is not tied to email, license, or
 * any account. Wiping localStorage rotates the id (treated as a fresh
 * install for funnel purposes).
 *
 * The id is sent only when the user has opted into anonymous telemetry
 * (see useTelemetryConsent). Without consent, no events go out and the
 * id is generated lazily at first use.
 */

const KEY = 'keepance_install_id';

function uuidv4(): string {
  // Prefer the platform's secure UUID generator. Fall back only for very
  // old runtimes — modern browsers + Tauri webviews always have it.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Tiny fallback: 36-char hex string with dashes in v4 layout
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4 bits
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getInstallId(): string {
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const id = uuidv4();
  localStorage.setItem(KEY, id);
  return id;
}
