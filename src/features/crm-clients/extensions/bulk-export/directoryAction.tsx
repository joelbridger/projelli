import type { DirectoryActionDescriptor } from '../../directoryRegistry';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { BulkExportDirectoryAction } from './BulkExportDirectoryAction';

declare module '../../directoryRegistry' {
  interface DirectoryActionIdMap {
    'bulk-export': true;
  }
}

/** The one feature-owned CRM directory action descriptor for selected CSV export. */
export const bulkExportDirectoryAction: DirectoryActionDescriptor = {
  id: 'bulk-export',
  order: 70,
  isEnabled: () => isFlagEnabled('crm-bulk-export'),
  mount: (context) => <BulkExportDirectoryAction context={context} />,
};
