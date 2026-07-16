import type { ContactRef } from '@/features/crm-contacts';
import {
  linkWorkspaceDocumentToContact,
  type ContactFileLink,
  type WorkspaceDocumentRef,
} from '@/features/crm-documents';

export function fileForContact(
  contactRef: ContactRef,
  documentRef: WorkspaceDocumentRef,
): ContactFileLink {
  return linkWorkspaceDocumentToContact(contactRef, documentRef);
}
