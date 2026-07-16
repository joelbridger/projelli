import type { ContactRef } from '@/features/crm-contacts';
import type { EntityRef } from '@/platform/crm/types';

/** Typed handoff to the existing mail surface, not an email send. */
export interface OpenMailSurfaceRequest {
  kind: 'open_mail_surface';
  contactRef: ContactRef;
  contextRefs: readonly EntityRef[];
  source: 'crm_contact';
}
