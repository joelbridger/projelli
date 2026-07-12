import { ClipboardList } from 'lucide-react';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

function MigrationSurface() {
  return <>{useCrmHomeSurfaceContext().renderLegacySurface('migration')}</>;
}

export const migrationSurface: CrmHomeSurfaceDescriptor = { id: 'migration', label: 'Migration', icon: ClipboardList, route: 'migration', Component: MigrationSurface };
export const fidelitySurface: CrmHomeSurfaceDescriptor = { id: 'fidelity', label: 'Fidelity report', icon: ClipboardList, route: 'fidelity', Component: MigrationSurface };
export const workflowRecreationSurface: CrmHomeSurfaceDescriptor = { id: 'workflow-recreation', label: 'Workflow recreation', icon: ClipboardList, route: 'workflow-recreation', Component: MigrationSurface };
export const attachmentAccountingSurface: CrmHomeSurfaceDescriptor = { id: 'attachment-accounting', label: 'Attachment accounting', icon: ClipboardList, route: 'attachment-accounting', Component: MigrationSurface };
export const archiveExportSurface: CrmHomeSurfaceDescriptor = { id: 'archive-export', label: 'Archive export', icon: ClipboardList, route: 'archive-export', Component: MigrationSurface };
export const rollbackExportSurface: CrmHomeSurfaceDescriptor = { id: 'rollback-export', label: 'Rollback export', icon: ClipboardList, route: 'rollback-export', Component: MigrationSurface };
