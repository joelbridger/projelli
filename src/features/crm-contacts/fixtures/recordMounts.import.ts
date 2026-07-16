import type { ContactRef, RecordScreenProjection, RelatedContactProjection } from '@/features/crm-contacts';
import type {
  HouseholdRecordExtensionDescriptor,
  HouseholdRecordShellContext,
} from '@/features/crm-clients';

export type RecordMountPublicImports = {
  ref: ContactRef;
  screen: RecordScreenProjection;
  related: RelatedContactProjection;
  extension: HouseholdRecordExtensionDescriptor;
  shell: HouseholdRecordShellContext;
};
