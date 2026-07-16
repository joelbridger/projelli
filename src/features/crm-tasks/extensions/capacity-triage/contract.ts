import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home';

export type CapacityTriageAssignee = 'all' | 'unassigned' | `user:${string}`;
export type CapacityTriageDuePressure =
  | 'all'
  | 'due_now'
  | 'scheduled'
  | 'unscheduled';
export type CapacityTriagePriority = 'all' | 'high' | 'normal' | 'low';

/**
 * The small, feature-owned view preference. It is not a task update and it
 * stores only stable tag IDs, so renamed and retired tags remain resolvable.
 */
export interface CapacityTriagePreference {
  readonly assignee: CapacityTriageAssignee;
  readonly duePressure: CapacityTriageDuePressure;
  readonly priority: CapacityTriagePriority;
  readonly tagIds: readonly string[];
}

/** The supplied work is canonical; this surface only ranks it for display. */
export interface CapacityTriageInput {
  readonly tasks: readonly CrmTask[];
  readonly workflowWorkItems: readonly CrmWorkflowWorkItem[];
  readonly preference: CapacityTriagePreference;
  /** ISO calendar day, supplied by callers/tests for deterministic ranking. */
  readonly today?: string;
}

/**
 * Counts describe only fields missing from the supplied records. This result
 * deliberately contains no hours, workload limit, or inferred team capacity.
 * Ranked entries are the exact foundation records supplied by the caller.
 */
export interface CapacityTriageResult {
  readonly openCount: number;
  readonly shownCount: number;
  readonly unscheduledCount: number;
  readonly unassignedCount: number;
  readonly ranked: readonly (CrmTask | CrmWorkflowWorkItem)[];
}

/** Saved-preference operations backed by the encrypted live-record route. */
export interface CapacityTriagePreferenceOperation {
  readonly preference: CapacityTriagePreference;
  readonly error: string | null;
  save(value: CapacityTriagePreference): Promise<void>;
  reload(): Promise<void>;
}
