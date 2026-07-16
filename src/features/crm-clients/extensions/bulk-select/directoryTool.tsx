import type { DirectoryToolDescriptor } from '../../directoryRegistry';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { BulkSelectDirectoryTool } from './BulkSelectDirectoryTool';

declare module '../../directoryRegistry' {
  interface DirectoryToolIdMap {
    'bulk-select': true;
  }
}

/** The one feature-owned CRM directory toolbar descriptor for bulk selection. */
export const bulkSelectDirectoryTool: DirectoryToolDescriptor = {
  id: 'bulk-select',
  order: 55,
  isEnabled: () => isFlagEnabled('crm-bulk-select'),
  mount: (context) => <BulkSelectDirectoryTool context={context} />,
};
