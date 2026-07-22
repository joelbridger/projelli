import type { CrmHomeAdapter } from './types';
import type { CrmHomeRoute } from './registryTypes';

export type { CrmHomeRoute } from './registryTypes';

/**
 * A client/contact relation that may safely cross the shared CRM add-flow
 * handoff. The shell normalizes looser screen references into this shape
 * before Tasks or Workflows can receive them.
 */
export interface CrmOriginatingContextRef {
  kind: 'household' | 'person' | 'organization' | 'trust';
  id: string;
  matterId: string;
  label?: string;
}

export interface CrmHouseholdAddRequest {
  kind: 'task' | 'opportunity' | 'workflow';
  householdId: string;
  householdLabel: string;
  /** Optional so existing household-only callers remain source-compatible. */
  contextRefs?: readonly CrmOriginatingContextRef[];
}

export interface CrmHomeProps {
  adapter?: CrmHomeAdapter;
  initialRoute?: CrmHomeRoute;
  /** Lets a top-level surface mount one CRM destination without the CRM rail. */
  showRail?: boolean;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
  /** Sample records are visual-test-only and always visibly labelled. */
  preview?: boolean;
}
