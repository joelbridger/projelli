import type { ContactRef, RelatedContactProjection } from '@/features/crm-contacts';
import type { HouseholdTabDescriptor } from '@/features/crm-clients';

export type HouseholdTabPublicImports = {
  descriptor: HouseholdTabDescriptor;
  ref: ContactRef;
  related: RelatedContactProjection;
};
