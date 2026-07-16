import type { ContactPrintProjection, ContactRef } from '@/features/crm-contacts';

export function printProjectionForContact(ref: ContactRef): ContactPrintProjection {
  return {
    ref,
    title: ref.label ?? 'Contact',
    lifecycle: 'Active',
    channels: [],
  };
}
