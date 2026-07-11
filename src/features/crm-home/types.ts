/**
 * UI-facing CRM Home contracts.
 *
 * ENGINE-PENDING: unify these with `src/platform/crm/propagation/types.ts` at
 * wire-together. These deliberately mirror the engine's PropagationOffer and
 * OfferDecision contracts rather than creating a second persistence model.
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

/** The only fields propagation may change. Progress is intentionally absent. */
export type DerivedStepField =
  | 'title'
  | 'description'
  | 'order'
  | 'required'
  | 'default_assignee_role'
  | 'due_offset';

export interface OfferDecision {
  id: string;
  revisionId: string;
  stepId: string;
  field: DerivedStepField;
  label: string;
  before?: string;
  after: string;
  decision: 'accepted' | 'rejected' | 'review_required';
  reofferState: 'original' | 'reoffered';
}

export interface ProtectedStepProgress {
  status: 'todo' | 'in_progress' | 'completed' | 'blocked';
  hasNotes: boolean;
  hasCompletion: boolean;
  hasOutcome: boolean;
  hasAssignmentHistory: boolean;
}

export interface NewAssignmentOffer {
  id: string;
  stepId: string;
  assigneeLabel: string;
  decision: 'accepted' | 'rejected' | 'review_required';
}

export interface PropagationStep {
  id: string;
  label: string;
  changeKind: 'add' | 'modify' | 'remove';
  decisions: readonly OfferDecision[];
  /** Read-only proof of state that propagation never sends or changes. */
  protectedProgress: ProtectedStepProgress;
  /** A separate future-routing proposal, never a propagation field. */
  newAssignmentOffer?: NewAssignmentOffer;
}

export interface PropagationOffer {
  id: string;
  instanceId: string;
  householdLabel: string;
  revisionLabel: string;
  state: 'ready' | 'needs-decision' | 'already-decided';
  steps: readonly PropagationStep[];
}

/** The UI can only dispatch accepted derived cells. Protected progress cannot fit here. */
export interface PropagationApplyOffer {
  offerId: string;
  instanceId: string;
  acceptedDecisions: readonly Pick<OfferDecision, 'id' | 'revisionId' | 'stepId' | 'field' | 'reofferState'>[];
}

export interface MigrationWorkflowChecklist {
  id: string;
  clientLabel: string;
  sourceTemplateLabel: string;
  activityEvidence: readonly string[];
  availableSteps: readonly string[];
  selectedCurrentStep?: string;
  evidenceReviewed?: boolean;
  decision: 'pending' | 'recreate' | 'gap';
  resultingInstanceLabel?: string;
  gapReason?: string;
}

export interface AttachmentAccountingRecord {
  id: string;
  clientLabel: string;
  status: 'pending' | 'exported' | 'gap';
  exportSource?: string;
  exportedBy?: string;
  gapReason?: string;
  gapOwner?: string;
}

export interface ExportJobStatus {
  kind: 'archive' | 'rollback';
  status: 'ready' | 'preparing' | 'failed' | 'exported';
  failureReason?: string;
  exportedAt?: string;
  manifestId?: string;
  reconciliationReportId?: string;
}

export interface CrmMigrationData {
  workflowChecklists: readonly MigrationWorkflowChecklist[];
  attachmentAccounting: readonly AttachmentAccountingRecord[];
  exports: readonly ExportJobStatus[];
}

export interface CrmHomeActions {
  updateTask: (task: CrmTask) => void;
  applyPropagation: (offers: readonly PropagationApplyOffer[]) => void;
  undoPropagation: () => { restored: number; protectedCells: readonly string[] };
  markNotificationsRead: () => void;
  recordWorkflowChecklist: (record: MigrationWorkflowChecklist) => void;
  recordAttachmentAccounting: (record: AttachmentAccountingRecord) => void;
  createExport: (kind: ExportJobStatus['kind']) => void;
  retryExport: (kind: ExportJobStatus['kind']) => void;
}

/**
 * Real CRM data must be supplied through this adapter. The shell deliberately
 * does not fabricate records or freshness when the engine is not connected.
 */
export interface CrmHomeAdapter {
  freshness: CrmFreshnessState;
  tasks: readonly CrmTask[];
  offers: readonly PropagationOffer[];
  migration: CrmMigrationData;
  actions: CrmHomeActions;
}
