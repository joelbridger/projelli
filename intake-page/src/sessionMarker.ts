const SESSION_MARKER_KEY_PREFIX = 'lantern.intake.session.';

function mintSessionMarker(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * This marker identifies one browser's visits to one intake. It never leaves
 * the browser except as encrypted manifest content for the advisor to read.
 */
export function getOrCreateSessionMarker(intakeId: string): string {
  const key = `${SESSION_MARKER_KEY_PREFIX}${intakeId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const marker = mintSessionMarker();
  window.localStorage.setItem(key, marker);
  return marker;
}
