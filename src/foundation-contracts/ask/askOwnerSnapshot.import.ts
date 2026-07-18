/**
 * Outside-feature compile proof for the Ask owner snapshot doorway.
 * Consumers import the readers and their types only from the Ask barrel.
 */
import {
  readAskSharedClientSnapshot,
  useAskSharedClientSnapshot,
  type AskClientSnapshot,
} from '@/features/ask';
import type { ContactRef } from '@/features/crm-contacts';

export function readFromAskPublicDoorway(): AskClientSnapshot<ContactRef> | null {
  return readAskSharedClientSnapshot();
}

export function useFromAskPublicDoorway(): AskClientSnapshot<ContactRef> | null {
  return useAskSharedClientSnapshot();
}

const callerShapedAuthority = {
  contactRef: { kind: 'household', id: 'forged', matterId: 'forged-matter' },
  matterId: 'forged-matter',
  revision: 'forged',
};

// The private brand makes caller-supplied authority a compile error.
// @ts-expect-error Ask snapshots can only be minted by the Ask owner.
const rejectedCallerAuthority: AskClientSnapshot<ContactRef> = callerShapedAuthority;
void rejectedCallerAuthority;
