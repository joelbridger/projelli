import {
  sealAskOpenPath,
  type AskClientSnapshot,
  type AskSealedOpenPath,
  type AskSourceDescriptor,
} from '@/features/ask';
import { toRecordRef, validateContactRef } from './model';
import type { ContactRecord, ContactRef } from './types';

/**
 * The caller supplies a fresh local contact snapshot for one client. This
 * producer deliberately keeps neither the boundary nor any client identity.
 */
export interface AskContactSourcesBoundary {
  readonly workspaceId: string;
  readonly client: AskClientSnapshot<ContactRef> | null;
  readonly contacts: readonly ContactRecord[];
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
  boundary: AskContactSourcesBoundary | null | undefined
): boundary is AskContactSourcesBoundary & {
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

/** Produces an opaque Ask opener; a raw contact reference never crosses it. */
export function openContactRef(reference: ContactRef): AskSealedOpenPath {
  const contact = validateContactRef(reference);
  return sealAskOpenPath({
    kind: 'contact',
    token: JSON.stringify({
      kind: contact.kind,
      id: contact.id,
      matterId: contact.matterId,
    }),
  });
}

/**
 * Reads only the exact contact represented by the supplied client boundary.
 * Missing, malformed, or mismatched boundaries fail closed with no sources.
 */
export function readAskContactSources(
  boundary: AskContactSourcesBoundary | null | undefined
): readonly AskSourceDescriptor<ContactRef>[] {
  if (!usableBoundary(boundary)) return [];

  const client = validateContactRef(boundary.client.contactRef);
  const contact = boundary.contacts.find((candidate) =>
    sameContact(toRecordRef(candidate), client)
  );
  if (!contact) return [];

  const reference = toRecordRef(contact);
  return [
    {
      sourceId: opaqueSourceId(
        'crm-contact',
        `${reference.kind}:${reference.id}:${reference.matterId}`
      ),
      workspaceId: boundary.workspaceId,
      client: boundary.client,
      label: contact.displayName,
      availability: 'available',
      kind: 'crm-contact',
      citationOpenPath: openContactRef(reference),
    },
  ];
}
