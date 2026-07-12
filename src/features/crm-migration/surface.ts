import { ClipboardList } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { MigrationWizard } from './MigrationWizard';

export const migrationSurface: CrmHomeSurfaceDescriptor = { id: 'migration', label: 'Migration', icon: ClipboardList, route: 'migration', Component: MigrationWizard };
export const fidelitySurface: CrmHomeSurfaceDescriptor = { id: 'fidelity', label: 'Fidelity report', icon: ClipboardList, route: 'fidelity', Component: MigrationWizard };
export const workflowRecreationSurface: CrmHomeSurfaceDescriptor = { id: 'workflow-recreation', label: 'Workflow recreation', icon: ClipboardList, route: 'workflow-recreation', Component: MigrationWizard };
export const attachmentAccountingSurface: CrmHomeSurfaceDescriptor = { id: 'attachment-accounting', label: 'Attachment accounting', icon: ClipboardList, route: 'attachment-accounting', Component: MigrationWizard };
export const archiveExportSurface: CrmHomeSurfaceDescriptor = { id: 'archive-export', label: 'Archive export', icon: ClipboardList, route: 'archive-export', Component: MigrationWizard };
export const rollbackExportSurface: CrmHomeSurfaceDescriptor = { id: 'rollback-export', label: 'Rollback export', icon: ClipboardList, route: 'rollback-export', Component: MigrationWizard };
