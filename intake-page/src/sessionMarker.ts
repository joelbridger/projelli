const SESSION_MARKER_KEY_PREFIX = 'lantern.intake.session.';
const inMemoryMarkers = new Map<string, string>();

function mintSessionMarker(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * This marker identifies one browser's visits to one intake. It never leaves
 * the browser except as encrypted manifest content for the advisor to read.
 *
 * Single-flight by construction: the in-memory map is checked and populated
 * FIRST, before this function ever touches localStorage. The whole function
 * body is synchronous with no internal await, so once the first caller for a
 * given intakeId reaches the map-populate line, every other caller for that
 * same intakeId - however it was triggered, including React StrictMode's
 * dev-only double-invoked effects racing two `boot()` calls against real
 * async work (WebCrypto key generation) between the await and this call -
 * short-circuits on the map and never re-reads or re-writes localStorage.
 * The old read-localStorage-first order left a window where two callers
 * could each see localStorage empty and mint two different markers for one
 * browser, which the advisor's desktop then saw as two devices.
 */
export function getOrCreateSessionMarker(intakeId: string): string {
  const cached = inMemoryMarkers.get(intakeId);
  if (cached) return cached;

  const key = `${SESSION_MARKER_KEY_PREFIX}${intakeId}`;
  let existing: string | null = null;
  try {
    existing = window.localStorage.getItem(key);
  } catch {
    // Reading storage can throw (disabled, private-mode quota, security
    // policy). Fall through to minting; persistence below is best-effort
    // and independent, since a read failure doesn't imply a write failure.
  }
  const marker = existing ?? mintSessionMarker();
  inMemoryMarkers.set(intakeId, marker);
  try {
    window.localStorage.setItem(key, marker);
  } catch {
    // Storage disabled; the map still keeps this page load consistent.
  }
  return marker;
}
