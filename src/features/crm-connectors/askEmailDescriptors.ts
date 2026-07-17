import {
  sealAskOpenPath,
  type AskClientSnapshot,
  type AskSourceDescriptor,
} from '@/features/ask';
import { validateContactRef, type ContactRef } from '@/features/crm-contacts';

/** Metadata already scoped by the connector owner. This is never a mailbox read. */
export interface AskEmailDescriptorInput {
  readonly id: string;
  readonly clientRef: ContactRef;
  readonly matterId: string;
  readonly label: string;
  readonly date: string;
}

/** The caller supplies the current boundary and already-local descriptor metadata. */
export interface AskEmailDescriptorsBoundary {
  readonly workspaceId: string;
  readonly client: AskClientSnapshot<ContactRef> | null;
  readonly emails: readonly AskEmailDescriptorInput[];
}

function sameContact(left: ContactRef, right: ContactRef): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.matterId === right.matterId
  );
}

function opaqueSourceId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function usableBoundary(
  boundary: AskEmailDescriptorsBoundary | null | undefined
): boundary is AskEmailDescriptorsBoundary & {
  readonly client: AskClientSnapshot<ContactRef>;
} {
  if (!boundary?.workspaceId.trim() || !boundary.client?.revision.trim()) {
    return false;
  }
  try {
    const reference = validateContactRef(boundary.client.contactRef);
    return reference.matterId === boundary.client.matterId;
  } catch {
    return false;
  }
}

/**
 * Projects only caller-supplied, client-matched metadata into Ask descriptors.
 * It never connects to, retrieves from, composes for, or sends through a mailbox.
 */
export function readAskEmailDescriptors(
  boundary: AskEmailDescriptorsBoundary | null | undefined
): readonly AskSourceDescriptor<ContactRef>[] {
  if (!usableBoundary(boundary)) return [];

  const client = validateContactRef(boundary.client.contactRef);
  const sourceIds = new Set<string>();
  return boundary.emails.flatMap((email) => {
    if (
      !email.id.trim() ||
      !email.label.trim() ||
      !email.date.trim() ||
      email.matterId !== boundary.client.matterId
    ) {
      return [];
    }
    try {
      if (!sameContact(validateContactRef(email.clientRef), client)) return [];
    } catch {
      return [];
    }
    const sourceId = opaqueSourceId('email-descriptor', email.id);
    if (sourceIds.has(sourceId)) return [];
    sourceIds.add(sourceId);
    return [
      {
        sourceId,
        workspaceId: boundary.workspaceId,
        client: boundary.client,
        label: email.label,
        availability: 'available' as const,
        kind: 'email-descriptor' as const,
        date: email.date,
        citationOpenPath: sealAskOpenPath({
          kind: 'email-descriptor',
          token: email.id,
        }),
      },
    ];
  });
}
