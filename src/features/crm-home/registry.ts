import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmHomeRoute } from './CrmHome';
import { activitySurface } from '@/features/crm-activity/surface';
import { crmAskSurface } from '@/features/crm-ask/surface';
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
 * by id and append only the feature-owned descriptor import above.
 */
export const crmHomeSurfaceRegistry: readonly CrmHomeSurfaceDescriptor[] = [
  activitySurface,
  archiveExportSurface,
  crmAskSurface,
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
  todaySurface,
  workflowRecreationSurface,
  workflowsSurface,
];
