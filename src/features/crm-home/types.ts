/**
 * UI-facing CRM Home contracts.
 *
 * These are render adapters over the canonical engine contracts. They carry
 * display labels only and never become a second persistence model.
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
  dueAt?: string;
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
  report?: MigrationFidelityReport;
}

export interface MigrationFidelityRow {
  sourceType: string;
  fetched: number;
  imported: number;
  skipped: number;
  rejected: number;
  plainReason?: string | null;
}

export interface MigrationFidelityReport {
  batchId: string;
  generatedAt: string;
  matrix: readonly MigrationFidelityRow[];
  attachments: { viaApi: string; affected: number; exported: number; gaps: number; unaccounted: number };
  workflows: { checklists: number; pending: number };
  message: string;
}

export interface CrmHomeActions {
  updateTask?: (task: CrmTask) => void;
  applyPropagation?: (offers: readonly PropagationApplyOffer[]) => void;
  undoPropagation?: () => { restored: number; protectedCells: readonly string[] };
  markNotificationsRead?: () => void;
  recordWorkflowChecklist?: (record: MigrationWorkflowChecklist) => void;
  recordAttachmentAccounting?: (record: AttachmentAccountingRecord) => void;
  createExport?: (kind: ExportJobStatus['kind']) => void;
  retryExport?: (kind: ExportJobStatus['kind']) => void;
  runMigrationImport?: (baseUrl: string) => Promise<void>;
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
