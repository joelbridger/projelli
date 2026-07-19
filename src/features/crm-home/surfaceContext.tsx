import { createContext, useContext } from 'react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { CrmHomeRoute, CrmHouseholdAddRequest } from './routes';
import type { CrmHomeAdapter } from './types';
import type { CrmWorkflowWorkItem } from './types';
import type {
  HouseholdChoice,
  LiveWorkflowData,
} from '@/features/crm-workflows/Workflows';

export interface CrmHomeSurfaceContextValue {
  adapter: CrmHomeAdapter;
  route: CrmHomeRoute;
  navigate: (route: string) => void;
  workflowOpenItem?: CrmWorkflowWorkItem | null;
  openWorkflowWorkItem?: (item: CrmWorkflowWorkItem) => void;
  workflowData?: LiveWorkflowData;
  workflowHouseholds?: readonly HouseholdChoice[];
  saveLiveRecord?: (record: LiveCrmRecord) => Promise<unknown>;
  undoReport: string | null;
  reportUndo: () => void;
  adapterProvided: boolean;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
}

export const CrmHomeSurfaceContext =
  createContext<CrmHomeSurfaceContextValue | null>(null);

export function useCrmHomeSurfaceContext(): CrmHomeSurfaceContextValue {
  const value = useContext(CrmHomeSurfaceContext);
  if (!value) throw new Error('CRM home surfaces must render inside CrmHome.');
  return value;
}
