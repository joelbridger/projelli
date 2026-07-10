const SESSION_MARKER_KEY_PREFIX = 'lantern.intake.session.';
const inMemoryMarkers = new Map<string, string>();

function mintSessionMarker(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getInMemoryMarker(intakeId: string): string {
  const existing = inMemoryMarkers.get(intakeId);
  if (existing) return existing;

  const marker = mintSessionMarker();
  inMemoryMarkers.set(intakeId, marker);
  return marker;
}

/**
 * This marker identifies one browser's visits to one intake. It never leaves
 * the browser except as encrypted manifest content for the advisor to read.
 */
export function getOrCreateSessionMarker(intakeId: string): string {
  const key = `${SESSION_MARKER_KEY_PREFIX}${intakeId}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;

    const marker = getInMemoryMarker(intakeId);
    window.localStorage.setItem(key, marker);
    return marker;
  } catch {
    // Browser storage can be disabled. The marker is advisory only, so keep
    // the form working with a marker that lasts for this page load.
    return getInMemoryMarker(intakeId);
  }
}
