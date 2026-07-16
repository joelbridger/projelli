import type {
  DirectoryContext,
  DirectoryContribution,
  DirectoryRepository,
} from '@/features/crm-clients';
import type { ContactRef } from '@/features/crm-contacts';

export type CrmClientsDirectoryPublicImports = {
  context: DirectoryContext;
  contribution: DirectoryContribution;
  repository: DirectoryRepository;
  ref: ContactRef;
};
