import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmHomeRoute } from './routes';
import { activitySurface } from '@/features/crm-activity/surface';
import { calendarSurface, emailSurface } from '@/features/crm-connectors/surface';
import { emailBroadcastSurface } from '@/features/crm-connectors/broadcastSurface';
import { emailDropboxSurface } from '@/features/crm-connectors/dropboxSurface';
import { todaySurface } from '@/features/crm-today/surface';
import { tasksSurface } from '@/features/crm-tasks/surface';
import { projectsSurface, propagationSurface, workflowsSurface } from '@/features/crm-workflows/surface';
import { firmFieldsSurface, firmSurface, intakeLinksSurface, workspacesSurface } from '@/features/crm-firm/surface';
import { archiveExportSurface, attachmentAccountingSurface, fidelitySurface, migrationSurface, rollbackExportSurface, workflowRecreationSurface } from '@/features/crm-migration/surface';
import { pipelineSettingsSurface, pipelineSurface } from '@/features/crm-pipeline/surface';
import { reportsSurface } from '@/features/crm-reports/surface';
import { viewsSurface } from '@/features/crm-views/surface';
import { searchSurface } from '@/features/crm-search/surface';
import { timelineSurface } from '@/features/crm-timeline/surface';

export interface CrmHomeSurfaceDescriptor {
  id: string;
  label: string;
  icon: LucideIcon;
  route: CrmHomeRoute;
  Component: ComponentType;
  rail?: boolean;
}

/**
 * The only shared list for home surfaces. Feature folders own their descriptor;
 * a lane adds its descriptor here without editing CrmHome. New entries append
 * at the end so existing route order stays stable; never reorder old entries.
 */
export const crmHomeSurfaceRegistry: readonly CrmHomeSurfaceDescriptor[] = [
  activitySurface,
  archiveExportSurface,
  calendarSurface,
  emailBroadcastSurface,
  emailSurface,
  emailDropboxSurface,
  attachmentAccountingSurface,
  fidelitySurface,
  firmSurface,
  firmFieldsSurface,
  intakeLinksSurface,
  workspacesSurface,
  migrationSurface,
  pipelineSurface,
  pipelineSettingsSurface,
  propagationSurface,
  projectsSurface,
  reportsSurface,
  rollbackExportSurface,
  searchSurface,
  tasksSurface,
  timelineSurface,
  todaySurface,
  viewsSurface,
  workflowRecreationSurface,
  workflowsSurface,
];
