/**
 * Temporary propagation-facing CRM contract.
 *
 * B1-PENDING: B1 owns src/platform/crm/types.  This narrow structural bridge is
 * deliberately local to the new propagation engine so this lane can be built in
 * isolation. Replace these exports with imports from B1 when the lanes merge;
 * do not let this become a second shared CRM type definition.
 */

export const UNTOUCHED = 'todo' as const;

export type WorkflowStepStatus = typeof UNTOUCHED | 'in_progress' | 'done' | 'skipped';
export type DerivedFieldName =
  | 'title'
  | 'description'
  | 'order'
  | 'required'
  | 'defaultAssigneeRole'
  | 'dueOffset';

export interface HlcStamp {
  wallMillis: number;
  logicalCounter: number;
  actorId: string;
  operationId: string;
}

export interface TemplateStepChange {
  stepId: string;
  field: DerivedFieldName | '__step_removal__';
  value: unknown;
  changeKind: 'add' | 'modify' | 'remove';
}

export interface TemplateRevision {
  revisionId: string;
  templateId: string;
  parentRevisionIds: string[];
  issuedHlc: HlcStamp;
  label: string;
  stepChanges: TemplateStepChange[];
}

export interface WorkflowTemplateSnapshot {
  id: string;
  revisions: Record<string, TemplateRevision>;
  headRevisionIds: string[];
}

export interface DerivedField {
  value: unknown;
  sourceRevisionId: string;
  sourceOperationId: string;
}

export interface CompletionOperation {
  completionId: string;
  completedBy: string;
  outcome?: string;
  sourceOperationId: string;
}

export interface AssignmentOperation {
  assignmentId: string;
  assignedUserId: string | null;
  sourceOperationId: string;
}

export interface WorkflowStepProgress {
  stepId: string;
  origin: 'template' | 'local';
  status: WorkflowStepStatus;
  assigneeUserId?: string;
  titleSnapshot: string;
  derived: Partial<Record<DerivedFieldName, DerivedField>>;
  removalRequestedBy: string[];
  detachedFromTemplate: boolean;
  hiddenByTemplateRemoval?: boolean;
  stepNotes: string;
  assignmentOperations: AssignmentOperation[];
  completionOperations: CompletionOperation[];
  outcome?: string;
}

export interface RevisionSet {
  revisionIds: string[];
}

export interface PropagationDecision {
  decisionKey: string;
  instanceId: string;
  revisionId: string;
  stepId: string;
  field: DerivedFieldName | '__step_removal__';
  decision: 'accepted' | 'rejected';
  sourceOperationId: string;
  supersedesDecisionKey?: string;
  reofferState: 'original' | 'reoffered';
}

export interface OfferDecision {
  id: string;
  revisionId: string;
  stepId: string;
  field: DerivedFieldName | '__step_removal__';
  value: unknown;
  changeKind: 'add' | 'modify' | 'remove';
  decision: 'accepted' | 'rejected' | 'review_required';
  supersedesDecisionKey?: string;
  reofferState: 'original' | 'reoffered';
}

export interface PropagationOffer {
  offerId: string;
  instanceId: string;
  fromRevisionSet: RevisionSet;
  targetRevisionSet: RevisionSet;
  decisions: OfferDecision[];
  state: 'pending' | 'applied' | 'partially_applied' | 'superseded';
  requiresConcurrentHeadReview: boolean;
}

export interface WorkflowInstanceSnapshot {
  id: string;
  acceptedRevisionIds: string[];
  displayedRevisionSet: RevisionSet;
  steps: Record<string, WorkflowStepProgress>;
  decisionLedger: PropagationDecision[];
  propagationEvents: PropagationApplyEvent[];
}

export interface DerivedBeforeImage {
  stepId: string;
  field: DerivedFieldName;
  previous?: DerivedField;
  sourceOperationId: string;
}

export interface PropagationApplyEvent {
  eventId: string;
  offerId: string;
  operationIds: string[];
  beforeImages: DerivedBeforeImage[];
  addedStepIds: string[];
}

export interface PropagationTransactionPayload {
  kind: 'apply' | 'undo';
  instance: WorkflowInstanceSnapshot;
  event: PropagationApplyEvent;
  immutableOperations: string[];
  activityOutbox: { eventId: string; idempotencyKey: string };
  notificationOutbox: { eventId: string; idempotencyKey: string; dependsOnOperationIds: string[] };
}

/** B1-PENDING: adapt this to B1's SQLCipher + encrypted CRDT/outbox transaction API. */
export interface PropagationTransactionPort {
  transact(payload: PropagationTransactionPayload): void;
}
