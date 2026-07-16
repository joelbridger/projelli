import type { ContactRef, RecordScreenProjection } from '@/features/crm-contacts';
import type { HouseholdHeaderActionDescriptor } from '@/features/crm-clients';

export type HouseholdHeaderActionPublicImports = {
  descriptor: HouseholdHeaderActionDescriptor;
  ref: ContactRef;
  screen: RecordScreenProjection;
};
