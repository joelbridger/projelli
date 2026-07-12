import { FileText } from 'lucide-react';
import type { HouseholdTabDescriptor } from '@/features/crm-clients/tabRegistry';
import { HouseholdDocumentsTab } from './HouseholdDocumentsTab';

/** The household Documents tab is owned by the CRM-document linking feature. */
export const documentsTab: HouseholdTabDescriptor = {
  id: 'documents',
  label: 'Documents',
  icon: FileText,
  route: 'documents',
  Component: HouseholdDocumentsTab,
};
