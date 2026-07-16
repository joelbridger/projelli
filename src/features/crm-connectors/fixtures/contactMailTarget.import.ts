import type { ContactRef } from '@/features/crm-contacts';
import type { OpenMailSurfaceRequest } from '@/features/crm-connectors';

export function mailForContact(contactRef: ContactRef): OpenMailSurfaceRequest {
  return {
    kind: 'open_mail_surface',
    contactRef,
    contextRefs: [contactRef],
    source: 'crm_contact',
  };
}
