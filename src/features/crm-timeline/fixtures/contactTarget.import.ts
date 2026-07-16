import type { ContactRef } from '@/features/crm-contacts';
import type { TimelineActivityRecord } from '@/features/crm-timeline';

export function activityForContact(contactRef: ContactRef): TimelineActivityRecord {
  return {
    id: 'activity:contact-follow-up',
    kind: 'activityEvent',
    matterId: contactRef.matterId,
    at: '2026-07-16T00:00:00.000Z',
    summary: 'Contact follow-up',
    targetRef: contactRef,
  };
}
