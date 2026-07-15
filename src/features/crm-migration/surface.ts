import { ClipboardList } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    migration: true;
    fidelity: true;
    'workflow-recreation': true;
    'attachment-accounting': true;
    'archive-export': true;
    'rollback-export': true;
  }
}
import { MigrationWizard } from './MigrationWizard';

export const migrationSurface: CrmHomeSurfaceDescriptor = {
  id: 'migration',
  labelKey: 'crm.home.destinations.migration',
  icon: ClipboardList,
  route: 'migration',
  parentRoute: 'firm-setup',
  shortcut: 'm',
  Component: MigrationWizard,
};
export const fidelitySurface: CrmHomeSurfaceDescriptor = {
  id: 'fidelity',
  labelKey: 'crm.home.destinations.fidelity',
  icon: ClipboardList,
  route: 'fidelity',
  parentRoute: 'firm-setup',
  Component: MigrationWizard,
};
export const workflowRecreationSurface: CrmHomeSurfaceDescriptor = {
  id: 'workflow-recreation',
  labelKey: 'crm.home.destinations.workflow-recreation',
  icon: ClipboardList,
  route: 'workflow-recreation',
  parentRoute: 'firm-setup',
  Component: MigrationWizard,
};
export const attachmentAccountingSurface: CrmHomeSurfaceDescriptor = {
  id: 'attachment-accounting',
  labelKey: 'crm.home.destinations.attachment-accounting',
  icon: ClipboardList,
  route: 'attachment-accounting',
  parentRoute: 'firm-setup',
  Component: MigrationWizard,
};
export const archiveExportSurface: CrmHomeSurfaceDescriptor = {
  id: 'archive-export',
  labelKey: 'crm.home.destinations.archive-export',
  icon: ClipboardList,
  route: 'archive-export',
  parentRoute: 'firm-setup',
  Component: MigrationWizard,
};
export const rollbackExportSurface: CrmHomeSurfaceDescriptor = {
  id: 'rollback-export',
  labelKey: 'crm.home.destinations.rollback-export',
  icon: ClipboardList,
  route: 'rollback-export',
  parentRoute: 'firm-setup',
  Component: MigrationWizard,
};
