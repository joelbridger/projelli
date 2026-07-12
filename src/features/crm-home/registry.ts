import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmHomeRoute } from './CrmHome';
import {
  intakeLinksSurface,
  propagationSurface,
  tasksSurface,
  todaySurface,
  workflowsSurface,
} from './surfaces';
import { pipelineSettingsSurface, pipelineSurface } from '@/features/crm-pipeline/surface';
import { reportsSurface } from '@/features/crm-reports/surface';
import { firmFieldsSurface, firmSurface } from '@/features/crm-firm/surface';
import { archiveExportSurface, attachmentAccountingSurface, fidelitySurface, migrationSurface, rollbackExportSurface, workflowRecreationSurface } from '@/features/crm-migration/surface';
import { crmAskSurface } from '@/features/crm-ask/surface';

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
 * a lane adds its descriptor here without editing CrmHome.
 */
export const crmHomeSurfaceRegistry: readonly CrmHomeSurfaceDescriptor[] = [
  todaySurface,
  tasksSurface,
  workflowsSurface,
  propagationSurface,
  pipelineSurface,
  pipelineSettingsSurface,
  reportsSurface,
  firmSurface,
  firmFieldsSurface,
  intakeLinksSurface,
  migrationSurface,
  fidelitySurface,
  workflowRecreationSurface,
  attachmentAccountingSurface,
  archiveExportSurface,
  rollbackExportSurface,
  crmAskSurface,
];
