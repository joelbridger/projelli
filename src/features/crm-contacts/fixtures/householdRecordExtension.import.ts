import type { ContactCore, ContactRef } from '@/features/crm-contacts';
import type { HouseholdRecordExtensionDescriptor } from '@/features/crm-clients';

export type HouseholdRecordExtensionPublicImports = {
  descriptor: HouseholdRecordExtensionDescriptor;
  ref: ContactRef;
  extensionData: ContactCore['extensionData'];
};
