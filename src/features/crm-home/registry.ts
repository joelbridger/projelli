import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmHomeRoute } from './CrmHome';
import { activitySurface, timelineSurface } from '@/features/crm-activity/surface';
import { calendarSurface, emailSurface } from '@/features/crm-connectors/surface';
import {
  intakeLinksSurface,
  propagationSurface,
  tasksSurface,
  todaySurface,
  workflowsSurface,
} from './surface';
import { firmFieldsSurface, firmSurface } from '@/features/crm-firm/surface';
import { archiveExportSurface, attachmentAccountingSurface, fidelitySurface, migrationSurface, rollbackExportSurface, workflowRecreationSurface } from '@/features/crm-migration/surface';
import { pipelineSettingsSurface, pipelineSurface } from '@/features/crm-pipeline/surface';
import { reportsSurface } from '@/features/crm-reports/surface';
import { viewsSurface } from '@/features/crm-views/surface';
import { searchSurface } from '@/features/crm-search/surface';

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
 * a lane adds its descriptor here without editing CrmHome. Keep entries sorted
 * by id; each entry is a feature-owned descriptor imported from `surface.tsx`.
 */
export const crmHomeSurfaceRegistry: readonly CrmHomeSurfaceDescriptor[] = [
  activitySurface,
  archiveExportSurface,
  calendarSurface,
  emailSurface,
  attachmentAccountingSurface,
  fidelitySurface,
  firmSurface,
  firmFieldsSurface,
  intakeLinksSurface,
  migrationSurface,
  pipelineSurface,
  pipelineSettingsSurface,
  propagationSurface,
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
