import type { RelatedContactSummaryProjection } from '@/features/crm-contacts';
import type { HouseholdSectionDescriptor } from '@/features/crm-clients';

export type HouseholdSectionPublicImports = {
  descriptor: HouseholdSectionDescriptor;
  related: RelatedContactSummaryProjection;
};
