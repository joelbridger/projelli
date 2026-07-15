import type { CrmHomeAdapter } from './types';
import type { CrmHomeRoute } from './registryTypes';

export type { CrmHomeRoute } from './registryTypes';

export interface CrmHouseholdAddRequest {
  kind: 'task' | 'opportunity' | 'workflow';
  householdId: string;
  householdLabel: string;
}

export interface CrmHomeProps {
  adapter?: CrmHomeAdapter;
  initialRoute?: CrmHomeRoute;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
  /** Sample records are visual-test-only and always visibly labelled. */
  preview?: boolean;
}
