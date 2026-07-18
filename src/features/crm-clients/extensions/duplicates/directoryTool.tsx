import type {
  DirectoryContext,
  DirectoryToolDescriptor,
} from '@/features/crm-clients';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { CrmDuplicatesDirectoryTool } from './CrmDuplicatesDirectoryTool';

declare module '@/features/crm-clients/directoryRegistry' {
  interface DirectoryToolIdMap {
    'crm-duplicates': true;
  }
}

/** The feature's one append-only directory-tool registry descriptor. */
export const crmDuplicatesDirectoryTool: DirectoryToolDescriptor = {
  id: 'crm-duplicates',
  order: 65,
  isEnabled: () => isFlagEnabled('crm-duplicates'),
  // This guard also protects callers that mount a descriptor directly.
  mount: (context: DirectoryContext) =>
    isFlagEnabled('crm-duplicates') ? (
      <CrmDuplicatesDirectoryTool context={context} />
    ) : null,
};
