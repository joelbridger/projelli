import { mintAskClientSnapshot } from '../foundation/clientSnapshotAuthority';
import type { AskClientSnapshot } from '../foundation/contracts';

/**
 * Test-only authority mint. It delegates to Ask's single production mint, so
 * fixtures receive the same private provenance seal and deep-freeze behavior.
 * This module is intentionally absent from the normal @/features/ask surface.
 */
export function mintAskClientSnapshotForTest<const ClientReference>(input: {
  readonly contactRef: ClientReference;
  readonly matterId: string;
  readonly revision: string;
}): AskClientSnapshot<ClientReference> {
  return mintAskClientSnapshot(input);
}
