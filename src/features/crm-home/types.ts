/**
 * Thin UI-facing contracts for the CRM home. The durable CRM entities belong
 * to B1; these shapes deliberately describe only what this screen needs.
 *
 * B1-PENDING: replace these aliases with imports from
 * `@/platform/crm/types` when lane B1 is merged. They are not a second store
 * or persistence model.
 */
export type CrmFreshness = 'live' | 'syncing' | 'last-synced' | 'offline' | 'error';

export interface CrmFreshnessState {
  kind: CrmFreshness;
  lastSyncedAt?: string;
  lastFullCheckAt?: string;
  error?: string;
}

export interface CrmTask {
  id: string;
  title: string;
  householdLabel?: string;
  assigneeUserId: string;
  assigneeLabel: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  dueLabel?: string;
  priority: 'high' | 'normal' | 'low';
  recurrenceLabel?: string;
  contextRefs?: readonly string[];
}

export interface PropagationFieldDecision {
  id: string;
  label: string;
  before?: string;
  after: string;
  accepted: boolean;
  protected?: boolean;
}

export interface PropagationOffer {
  id: string;
  householdLabel: string;
  revisionLabel: string;
  state: 'ready' | 'needs-decision' | 'already-decided';
  concurrentHeads?: boolean;
  fields: readonly PropagationFieldDecision[];
}

export interface CrmHomeActions {
  updateTask?: (task: CrmTask) => void;
  applyPropagation?: (offers: readonly PropagationOffer[]) => void;
  undoPropagation?: () => { restored: number; protectedCells: readonly string[] };
  markNotificationsRead?: () => void;
}

export interface CrmHomeAdapter {
  freshness: CrmFreshnessState;
  tasks: readonly CrmTask[];
  offers: readonly PropagationOffer[];
  actions?: CrmHomeActions;
}
