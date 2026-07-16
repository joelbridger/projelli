import type { ContactCreateInput, ContactRecordStore } from '@/features/crm-contacts';
import type {
  DirectoryRepository,
  HouseholdAddActionDescriptor,
} from '@/features/crm-clients';

export type HouseholdAddActionPublicImports = {
  descriptor: HouseholdAddActionDescriptor;
  input: ContactCreateInput;
  create: ContactRecordStore['create'];
  open: DirectoryRepository['openContact'];
};
