import {
  sealAskOpenPath,
  type AskClientSnapshot,
  type AskSealedOpenPath,
  type AskSourceDescriptor,
} from '@/features/ask';
import type { ContactRecord, ContactRef } from '@/features/crm-contacts';
import { toRecordRef, validateContactRef } from '@/features/crm-contacts';
import {
  listWorkspaceDocumentRefs,
  type WorkspaceDocumentRef,
} from './documentLinks';

/** A fresh, exact client contact is required before document pointers are read. */
export interface AskDocumentSourcesBoundary {
  readonly workspaceId: string;
  readonly client: AskClientSnapshot<ContactRef> | null;
  readonly contact: ContactRecord | null;
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
  boundary: AskDocumentSourcesBoundary | null | undefined
): boundary is AskDocumentSourcesBoundary & {
  readonly client: AskClientSnapshot<ContactRef>;
  readonly contact: ContactRecord;
} {
  if (
    !boundary?.workspaceId.trim() ||
    !boundary.client?.revision.trim() ||
    !boundary.contact
  ) {
    return false;
  }
  try {
    const reference = validateContactRef(boundary.client.contactRef);
    return (
      reference.matterId === boundary.client.matterId &&
      sameContact(toRecordRef(boundary.contact), reference)
    );
  } catch {
    return false;
  }
}

/** Produces an opaque Ask opener; the workspace-relative document path is sealed. */
export function openDocumentCitation(
  reference: WorkspaceDocumentRef
): AskSealedOpenPath {
  const document = listWorkspaceDocumentRefs([reference])[0];
  if (!document) throw new Error('Ask document opener requires a valid document reference.');
  return sealAskOpenPath({ kind: 'document', token: document.id });
}

/**
 * Returns only document pointers attached to the exact client contact and
 * explicitly owned by that client's matter. No workspace-wide fallback exists.
 */
export function readAskDocumentSources(
  boundary: AskDocumentSourcesBoundary | null | undefined
): readonly AskSourceDescriptor<ContactRef>[] {
  if (!usableBoundary(boundary)) return [];

  return listWorkspaceDocumentRefs(boundary.contact.contextRefs).flatMap(
    (document) =>
      document.matterId === boundary.client.matterId
        ? [
            {
              sourceId: opaqueSourceId('document', document.id),
              workspaceId: boundary.workspaceId,
              client: boundary.client,
              label: document.label,
              availability: 'available' as const,
              kind: 'document' as const,
              citationOpenPath: openDocumentCitation(document),
            },
          ]
        : []
  );
}
