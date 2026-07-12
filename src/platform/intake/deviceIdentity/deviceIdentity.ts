/**
 * Classifies a client-page session marker against the markers already trusted
 * for one intake. The first verified marker establishes the expected device;
 * later, different markers remain visible as a new-device warning.
 */
export type DeviceIdentityStatus =
  | 'no_session_marker'
  | 'first_trusted_device'
  | 'known_device'
  | 'new_device';

export function classifyDeviceIdentity(
  sessionId: string | undefined,
  knownSessionIds: readonly string[],
): DeviceIdentityStatus {
  if (!sessionId) return 'no_session_marker';
  if (knownSessionIds.length === 0) return 'first_trusted_device';
  return knownSessionIds.includes(sessionId) ? 'known_device' : 'new_device';
}
