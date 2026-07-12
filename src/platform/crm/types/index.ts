/**
 * Frozen CRM-core record contract (design/02-data-model.md).
 *
 * These are deliberately data-only types.  Collection documents are the shared
 * source of truth; Rust SQLCipher tables are a disposable local read index.
 */
import type { CoreSectionKey, SourceRef } from '@/platform/clientMap/types';

export type EntityKind =
  | 'household' | 'person' | 'account' | 'fact' | 'note' | 'task'
  /** A file owned by the existing Documents workspace, never a CRM record. */
  | 'document'
  | 'workflowTemplate' | 'workflowInstance' | 'servicePolicy'
  | 'activityEvent' | 'activityComment' | 'activityReaction' | 'firmDoc' | 'tag' | 'customFieldDef'
  | 'opportunity' | 'pipelineDef' | 'stageDef' | 'proposalRecord' | 'project' | 'legacyProject'
  | 'firmDirectoryEntry' | 'firmWorkspaceSummary' | 'firmSeatSummary'
  | 'householdDirectoryShell' | 'intakeLink' | 'intakeSubmission'
  | 'importArchiveManifest' | 'savedView' | 'savedReport' | 'reportRun';

export interface ActorRef { userId: string; seat?: string; display: string; kind: 'user' | 'ai' | 'system' | 'import'; }
export interface Provenance { origin: 'user' | 'ai' | 'import' | 'connector' | 'meeting' | 'system'; sources: SourceRef[]; importBatchId?: string; note?: string; }
/** Known import providers remain suggested while permitting connector-defined providers. */
export type ExternalProvider =
  | 'wealthbox'
  | 'salesforce'
  | 'redtail'
  | (string & {});
export interface ExternalRef { provider: ExternalProvider; sourceType: string; sourceId: string; scope: string; crmKey?: string; lastSyncedAt?: string; }
export interface RawRecordRef { importBatchId: string; manifestId: string; rawRecordId: string; sha256: string; capturedAt: string; }
/**
 * A small pointer to another thing. `document` pointers use the existing
 * workspace file path as their id; the CRM never makes a second file record.
 */
export interface EntityRef { kind: EntityKind; id: string; matterId?: string; label?: string; }
export type Keyed<T> = Record<string, T>;
export interface HlcStamp { wallMillis: number; logicalCounter: number; actorId: string; operationId: string; }

export interface CrmBase {
  id: string; kind: EntityKind; matterId: string; createdAt: string; createdBy: ActorRef;
  updatedAt: string; updatedBy: ActorRef; source: Provenance; deleted: boolean;
  externalRefs: ExternalRef[]; rawRecordRef?: RawRecordRef; schemaVersion: number;
}

export interface CrmStreetAddress { address: string; city: string; state: string; zip: string; kind: string; principal: boolean; }
export interface CrmEmailAddress { address: string; kind: string; principal: boolean; }
export interface CrmPhoneNumber { address: string; kind: string; principal: boolean; }
export interface HouseholdMember { personId: string; role?: string; addedAt: string; }
export interface Household extends CrmBase { kind: 'household'; name: string; greeting?: string; status: 'prospect' | 'active' | 'inactive' | 'former'; clientSince?: string; members: Keyed<HouseholdMember>; primaryContactId?: string; servicePolicyId?: string; tagIds: string[]; customFields: CustomFieldValueMap; addresses: Keyed<CrmStreetAddress>; primaryAdvisorId?: string; ownership: 'mine' | 'shared' | 'other'; pinnedFactIds: string[]; archived: boolean; }
export interface PersonRole { id: string; label: string; organizationRef?: EntityRef; active: boolean; }
export interface VerifiedRecipientLink { verified: boolean; verifiedAt?: string; verifiedBy?: ActorRef; channel: 'email' | 'esign' | 'portal'; address: string; }
export interface Person extends CrmBase { kind: 'person'; personType: 'person' | 'trust' | 'organization'; householdIds: string[]; roles: PersonRole[]; firstName: string; middleName?: string; lastName: string; nickname?: string; prefix?: string; suffix?: string; companyName?: string; jobTitle?: string; birthDate?: string; anniversary?: string; retirementDate?: string; dateOfDeath?: string; maritalStatus?: string; investmentObjective?: string; timeHorizon?: string; riskTolerance?: string; addresses: Keyed<CrmStreetAddress>; emails: Keyed<CrmEmailAddress>; phones: Keyed<CrmPhoneNumber>; background?: string; importantInfo?: string; personalInterests?: string; tagIds: string[]; customFields: CustomFieldValueMap; isExternal: boolean; externalRole?: 'accountant' | 'attorney' | 'cpa' | 'doctor' | 'insurance' | 'business_manager' | 'family_officer' | 'trusted_contact' | 'other'; servesHouseholdIds: string[]; verifiedRecipient?: VerifiedRecipientLink; }
export interface Account extends CrmBase { kind: 'account'; householdId: string; ownerPersonIds: string[]; custodian: string; accountType: string; registration?: string; last4?: string; purpose?: string; ownership: 'individual' | 'joint' | 'trust' | 'entity'; status: 'open' | 'closed' | 'pending' | 'transferring'; openedAt?: string; closedAt?: string; tagIds: string[]; customFields: CustomFieldValueMap; }
export type FactType = 'income' | 'asset' | 'liability' | 'net_worth' | 'tax_bracket' | 'account_balance' | 'goal' | 'risk_tolerance' | 'time_horizon' | 'beneficiary' | 'professional_relationship' | 'preference' | 'life_event' | 'note_fact' | 'custom';
export type FactValue = { t: 'money'; amount: number; currency: string } | { t: 'text'; v: string } | { t: 'date'; v: string } | { t: 'number'; v: number } | { t: 'enum'; v: string } | { t: 'entity'; ref: EntityRef } | { t: 'none' };
/** Frozen Client Map keys remain suggested while admitting future sections. */
export type FactSectionKey = CoreSectionKey | (string & {});
export interface Fact extends CrmBase { kind: 'fact'; householdId: string; subjectRef?: EntityRef; factType: FactType; label: string; value: FactValue; text: string; status: 'current' | 'superseded' | 'stale' | 'disputed'; isAssumption: boolean; pinned: boolean; sectionKey?: FactSectionKey; asOf: string; observedAt: string; supersededBy?: string; }
export interface HouseholdLink { householdId: string; matterId: string; externalRef?: ExternalRef; }
export interface NoteMention { id: string; ref: EntityRef; notifyState: 'none' | 'pending' | 'sent' | 'read'; }
export interface Note extends CrmBase { kind: 'note'; householdLinks: HouseholdLink[]; links: EntityRef[]; mentions: NoteMention[]; audience: 'internal' | 'client-facing'; body: string; pinned: boolean; title?: string; format?: 'plain' | 'meeting-note' | 'template'; templateId?: string; authoredVia?: 'manual' | 'jump-push' | 'meeting-capture' | 'ai'; tagIds: string[]; }
export interface RecurrenceRule { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; byWeekday?: number[]; byMonthDay?: number[]; count?: number; until?: string; regenerateOnComplete: boolean; }
export interface Task extends CrmBase { kind: 'task'; householdRef: EntityRef | null; title: string; body: string; assigneeUserId: string | null; status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled'; due?: string; recurrence?: RecurrenceRule; priority: 'high' | 'normal' | 'low'; contextRefs: EntityRef[]; customFields: CustomFieldValueMap; }
/** A new, editable project. Imported Wealthbox projects remain LegacyProject records. */
export interface Project extends CrmBase { kind: 'project'; householdRef: EntityRef; name: string; description: string; status: 'open' | 'completed'; completedAt?: string; taskIds: string[]; }
export interface WorkflowSchedule { frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'; timezone: string; startsAt: string; householdSelector: ViewQuery; enabled: boolean; }
export interface StepOutcome { id: string; label: string; nextStepId?: string; restartAtStepId?: string; condition?: string; }
export interface StepDef { id: string; title: string; description: string; ownerRole?: string; defaultAssigneeId?: string; offsetDays?: number; required: boolean; outcomes: StepOutcome[]; addedInRevisionId: string; removedInRevisionId?: string; }
/** The only template-owned cells propagation can change. Progress is never in this set. */
export type DerivedFieldName = 'title' | 'description' | 'order' | 'required' | 'defaultAssigneeRole' | 'dueOffset';
export interface TemplateStepChange {
  stepId: string;
  field: DerivedFieldName | '__step_removal__';
  value: unknown;
  changeKind: 'add' | 'modify' | 'remove';
}
/**
 * The revision graph is the propagation engine's canonical shape. `author` is
 * optional only because imported historical revisions do not always expose it.
 */
export interface TemplateRevision {
  revisionId: string;
  templateId: string;
  parentRevisionIds: string[];
  author?: ActorRef;
  issuedHlc: HlcStamp;
  label: string;
  stepChanges: TemplateStepChange[];
}
export interface WorkflowTemplate extends CrmBase { kind: 'workflowTemplate'; matterId: 'firm_home'; name: string; description: string; category?: string; revisions: Keyed<TemplateRevision>; headRevisionIds: string[]; status: 'draft' | 'published' | 'archived'; steps: Keyed<StepDef>; stepOrder: string[]; triggerHints: string[]; tagIds: string[]; schedule?: WorkflowSchedule; }
export const UNTOUCHED = 'todo' as const;
export type WorkflowStepStatus = typeof UNTOUCHED | 'in_progress' | 'done' | 'skipped';
export interface RevisionSet { revisionIds: string[]; }
export interface DerivedField { value: unknown; sourceRevisionId: string; sourceOperationId: string; }
export interface CompletionOperation {
  completionId: string;
  completedBy: string;
  /** Optional for historical imports; new operations populate it. */
  completedAt?: string;
  outcome?: string;
  sourceOperationId: string;
}
export interface AssignmentOperation {
  assignmentId: string;
  assignedUserId: string | null;
  /** Optional for historical imports; new operations populate it. */
  assignedAt?: string;
  assignedBy?: ActorRef;
  sourceOperationId: string;
}
export interface DisplayedStepCompletion { completionId: string; completedAt: string; completedBy: ActorRef; outcome?: string; }
export interface WorkflowStepProgress {
  stepId: string;
  origin: 'template' | 'local';
  status: WorkflowStepStatus;
  assigneeUserId?: string;
  taskId?: string;
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
export interface PropagationStepChange { stepId: string; changeKind: 'add' | 'modify' | 'remove'; fields: Record<string, unknown>; decision: 'pending' | 'accepted' | 'rejected' | 'review_required'; decidedBy?: ActorRef; decidedAt?: string; }
export interface PropagationOffer { offerId: string; fromRevisionSet: RevisionSet; targetRevisionSet: RevisionSet; stepChanges: Keyed<PropagationStepChange>; state: 'pending' | 'applied' | 'partially_applied' | 'superseded'; appliedAt?: string; appliedBy?: ActorRef; }
export interface PropagationDecision {
  decisionKey: string;
  instanceId: string;
  revisionId: string;
  stepId: string;
  field: DerivedFieldName | '__step_removal__';
  decision: 'accepted' | 'rejected';
  sourceOperationId: string;
  supersedesDecisionKey?: string | undefined;
  reofferState: 'original' | 'reoffered';
  decidedAt?: string;
  decidedBy?: ActorRef;
}
export interface WorkflowInstance extends CrmBase { kind: 'workflowInstance'; householdId: string; templateId: string; acceptedRevisionIds: string[]; displayedRevisionSet: RevisionSet; name: string; status: 'open' | 'completed' | 'cancelled'; startedAt: string; steps: Keyed<WorkflowStepProgress>; pendingOffers: Keyed<PropagationOffer>; decisionLedger: Keyed<PropagationDecision>; }

/** Engine snapshots are the encrypted CRDT document payloads, not SQL read rows. */
export interface WorkflowTemplateSnapshot { id: string; revisions: Record<string, TemplateRevision>; headRevisionIds: string[]; }
export interface DerivedBeforeImage { stepId: string; field: DerivedFieldName; previous?: DerivedField | undefined; sourceOperationId: string; }
export interface PropagationApplyEvent { eventId: string; offerId: string; operationIds: string[]; beforeImages: DerivedBeforeImage[]; addedStepIds: string[]; }
export interface WorkflowInstanceSnapshot {
  id: string;
  acceptedRevisionIds: string[];
  displayedRevisionSet: RevisionSet;
  steps: Record<string, WorkflowStepProgress>;
  decisionLedger: PropagationDecision[];
  propagationEvents: PropagationApplyEvent[];
}
export interface OfferDecision {
  id: string;
  revisionId: string;
  stepId: string;
  field: DerivedFieldName | '__step_removal__';
  value: unknown;
  changeKind: 'add' | 'modify' | 'remove';
  decision: 'accepted' | 'rejected' | 'review_required';
  supersedesDecisionKey?: string | undefined;
  reofferState: 'original' | 'reoffered';
}
export interface PropagationEngineOffer {
  offerId: string;
  instanceId: string;
  fromRevisionSet: RevisionSet;
  targetRevisionSet: RevisionSet;
  decisions: OfferDecision[];
  state: 'pending' | 'applied' | 'partially_applied' | 'superseded';
  requiresConcurrentHeadReview: boolean;
}
export interface PropagationTransactionPayload {
  kind: 'apply' | 'undo';
  instance: WorkflowInstanceSnapshot;
  event: PropagationApplyEvent;
  immutableOperations: string[];
  activityOutbox: { eventId: string; idempotencyKey: string };
  notificationOutbox: { eventId: string; idempotencyKey: string; dependsOnOperationIds: string[] };
}
export interface PropagationTransactionPort { transact(payload: PropagationTransactionPayload): void; }
export interface ServicePolicy extends CrmBase { kind: 'servicePolicy'; matterId: 'firm_home' | (string & {}); scope: 'firm-tier' | 'household-override'; tierName: string; meetingCadence?: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom'; cadenceDays?: number; nextReviewDue?: string; reviewChecklistTemplateId?: string; schedulingLinkUrl?: string; appliesToHouseholdIds: string[]; description: string; }
export type ActivityVerb = string;
export interface ActivityEvent extends CrmBase { kind: 'activityEvent'; at: string; actor: ActorRef; verb: ActivityVerb; targetRef: EntityRef; householdId?: string; summary: string; payload: Record<string, unknown>; important: boolean; }
/** Firm-wide discussion attached to one timeline activity. Replies always point to the root activity and optionally to their parent comment. */
export interface ActivityComment extends CrmBase { kind: 'activityComment'; activityId: string; parentCommentId?: string; householdId?: string; body: string; author: ActorRef; visibility: 'firm-wide'; }
/** One member's reaction state. Removing a reaction leaves an auditable tombstone instead of deleting history. */
export interface ActivityReaction extends CrmBase { kind: 'activityReaction'; activityId: string; householdId?: string; emoji: string; userId: string; removedAt?: string; }
export interface FirmDoc extends CrmBase { kind: 'firmDoc'; matterId: 'firm_home'; docType: 'process' | 'note-template' | 'report-layout' | 'ways-of-working' | 'other'; title: string; body: string; bodyRef?: string; tagIds: string[]; pinned: boolean; }
export interface Tag extends CrmBase { kind: 'tag'; matterId: 'firm_home'; name: string; color?: string; category?: string; }
export interface CustomFieldDef extends CrmBase { kind: 'customFieldDef'; matterId: 'firm_home'; appliesTo: EntityKind[]; key: string; label: string; fieldType: 'text' | 'number' | 'money' | 'date' | 'bool' | 'enum' | 'multi-enum'; options?: string[]; required: boolean; order: number; archived: boolean; }
export type CustomFieldValueMap = Record<string, { value: string | number | boolean | string[] | null; updatedAt: string; source: Provenance }>;
export interface Opportunity extends CrmBase { kind: 'opportunity'; householdId: string; name: string; pipelineId: string; stageId: string; amount?: { value: number; currency: string }; probability?: number; status: 'open' | 'won' | 'lost' | 'abandoned'; expectedCloseDate?: string; closedAt?: string; closeReason?: string; ownerId?: string; contextRefs: EntityRef[]; tagIds: string[]; customFields: CustomFieldValueMap; }
export interface PipelineDef extends CrmBase { kind: 'pipelineDef'; matterId: 'firm_home'; name: string; description?: string; stageIds: string[]; stageOrder: string[]; archived: boolean; }
export interface StageTriggerRule { id: string; event: 'entered' | 'exited'; workflowTemplateId?: string; proposalRequired: boolean; enabled: boolean; }
export interface StageDef extends CrmBase { kind: 'stageDef'; matterId: 'firm_home'; pipelineId: string; name: string; statusEffect: 'open' | 'won' | 'lost' | 'none'; triggerRules: StageTriggerRule[]; archived: boolean; }
export type ProposalMutation = { kind: 'workflow_launch'; workflowTemplateId: string } | { kind: 'task_create'; task: Pick<Task, 'householdRef' | 'title' | 'assigneeUserId' | 'due' | 'priority' | 'contextRefs'> } | { kind: 'fact_add'; fact: Pick<Fact, 'householdId' | 'subjectRef' | 'factType' | 'label' | 'value' | 'text' | 'asOf' | 'observedAt'> } | { kind: 'communication_draft'; draftRef: EntityRef };
export interface ProposalRecord extends CrmBase { kind: 'proposalRecord'; householdRef: EntityRef | null; proposalKind: ProposalMutation['kind']; proposedMutation: ProposalMutation; proposedBy: ActorRef; rationale: string; contextRefs: EntityRef[]; state: 'pending' | 'approved' | 'rejected' | 'expired'; decidedAt?: string; decidedBy?: ActorRef; appliedEntityRef?: EntityRef; }
export interface LegacyProjectWorkflowLaunch { launchId: string; workflowInstanceId: string; workflowTemplateId: string; launchedAt: string; launchedBy: ActorRef; }
export interface LegacyProject extends CrmBase { kind: 'legacyProject'; householdLinks: HouseholdLink[]; anchorHouseholdId?: string; unlinked: boolean; title: string; status?: string; description?: string; sourcePayload: Record<string, unknown>; manualWorkflowLaunches: LegacyProjectWorkflowLaunch[]; }
export interface FirmDirectoryEntry extends CrmBase { kind: 'firmDirectoryEntry'; matterId: 'firm_home'; userId: string; displayName: string; email?: string; title?: string; active: boolean; teamLabels: string[]; /** Read-only workspace access copied from firm administration. */ workspaceIds?: string[]; restrictedWorkspaceIds?: string[]; }
/** Read-only projection of the existing firm-admin workspace list. */
export interface FirmWorkspaceSummary extends CrmBase { kind: 'firmWorkspaceSummary'; matterId: 'firm_home'; name: string; status: 'active' | 'archived'; memberIds: string[]; restrictedMemberIds?: string[]; }
/** Read-only projection of a firm-admin seat. Never an entitlement source. */
export interface FirmSeatSummary extends CrmBase { kind: 'firmSeatSummary'; matterId: 'firm_home'; memberId: string; deviceName: string; status: 'active' | 'revoked'; lastSeenAt?: string; }
export interface RawArchiveEntry { rawRecordId: string; requestPath: string; captureLayerVersion: string; fixtureCorpusIdentity: string; capturedAt: string; responseSha256: string; byteLength: number; typedOutcome: 'landed' | 'skipped' | 'rejected'; targetEntityRef?: EntityRef; skipReason?: string; resultingExternalRefs: ExternalRef[]; }
export interface ImportArchiveManifest extends CrmBase { kind: 'importArchiveManifest'; matterId: 'firm_home'; importBatchId: string; provider: string; capturedAt: string; sourceWorkspaceLabel: string; records: RawArchiveEntry[]; finalizedAt?: string; manifestSha256?: string; }
export interface HouseholdDirectoryShell extends CrmBase { kind: 'householdDirectoryShell'; matterId: 'firm_home'; householdRef: EntityRef; operationalStatus: Household['status']; }
export interface IntakeField { id: string; label: string; kind: 'text' | 'email' | 'phone' | 'date' | 'select' | 'textarea'; required: boolean; choices?: string[]; }
export interface IntakeLink extends CrmBase { kind: 'intakeLink'; matterId: 'firm_home'; name: string; householdRef: EntityRef | null; audience: 'internal' | 'client-facing'; fields: Keyed<IntakeField>; confirmationCopy: string; status: 'draft' | 'active' | 'closed'; }
export type IntakeAudiencePayload = { audience: 'internal' | 'client-facing'; values: Record<string, string | string[] | null> };
export interface IntakeMatchingDecision { decisionId: string; decision: 'match' | 'create' | 'reject'; householdRef?: EntityRef; reason?: string; decidedAt: string; decidedBy: ActorRef; sourceOperationId: string; }
export interface DisplayedIntakeMatch { state: 'unmatched' | 'matched' | 'created' | 'rejected'; householdRef?: EntityRef; }
export interface IntakeSubmission extends CrmBase { kind: 'intakeSubmission'; matterId: 'firm_home'; intakeLinkId: string; audience: 'internal' | 'client-facing'; payload: IntakeAudiencePayload; submittedAt: string; matchingDecisions: Keyed<IntakeMatchingDecision>; }
export interface MigrationChecklistItem { id: string; importBatchId: string; legacyProjectRef: EntityRef; householdRef: EntityRef | null; sourceTemplateLabel?: string; activityEvidenceRefs: EntityRef[]; decision: 'pending' | 'recreate' | 'gap' | 'not_needed'; resultingWorkflowInstanceRef?: EntityRef; gapReason?: string; decidedAt?: string; decidedBy?: ActorRef; }
export interface AttachmentAccountingRecord { id: string; importBatchId: string; householdRef: EntityRef; status: 'exported' | 'gap'; exportSource?: string; exportedAt?: string; exportedBy?: ActorRef; gapReason?: string; gapOwnerUserId?: string; }
export interface ExportJob { id: string; importBatchId: string; kind: 'archive' | 'rollback'; status: 'preparing' | 'ready' | 'failed' | 'exported'; manifestRef?: EntityRef; fidelityReportSha256?: string; destinationLabel?: string; failureReason?: string; startedAt: string; startedBy: ActorRef; finishedAt?: string; }
/** A bounded local SavedView predicate. It deliberately cannot express SQL or code. */
export type FilterOperator = 'eq' | 'neq' | 'contains' | 'in' | 'before' | 'after' | 'is_empty' | 'is_not_empty';
export type FilterValue = string | number | boolean | null | readonly (string | number | boolean)[];
export interface FilterClause { field: string; op: FilterOperator; value?: FilterValue; }
export type ReportKind = 'no_contact_6mo' | 'attention_vs_fee' | 'birthdays' | 'age_65' | 'rmd_due' | 'review_due' | 'custom';
/** `fields` controls the columns or details shown by a saved view. */
export interface ViewQuery { entity: EntityKind; filters: FilterClause[]; fields?: string[]; sort?: { field: string; dir: 'asc' | 'desc' }[]; groupBy?: string; }
export interface SavedView extends CrmBase { kind: 'savedView'; matterId: 'firm_home' | (string & {}); name: string; surface: 'tasks' | 'households' | 'opportunities' | 'accounts' | 'report'; visibility: 'personal' | 'firm'; query: ViewQuery; layout: 'table' | 'kanban' | 'list'; reportKind?: ReportKind; }
/** A saved report is a reusable recipe, never a frozen copy of client data. */
export interface SavedReport extends CrmBase { kind: 'savedReport'; matterId: 'firm_home' | (string & {}); name: string; visibility: 'personal' | 'firm'; reportKind: ReportKind; query: ViewQuery; layout: 'table'; }
/** An audit-friendly record that a report was calculated. Result rows remain live. */
export interface ReportRun extends CrmBase { kind: 'reportRun'; matterId: 'firm_home' | (string & {}); reportKind: ReportKind; query: ViewQuery; calculatedAt: string; sourcesConsidered: number; resultCount: number; }

export type CrmEntity = Household | Person | Account | Fact | Note | Task | Project | WorkflowTemplate | WorkflowInstance | ServicePolicy | ActivityEvent | ActivityComment | ActivityReaction | FirmDoc | Tag | CustomFieldDef | Opportunity | PipelineDef | StageDef | ProposalRecord | LegacyProject | FirmDirectoryEntry | FirmWorkspaceSummary | FirmSeatSummary | HouseholdDirectoryShell | IntakeLink | IntakeSubmission | ImportArchiveManifest | SavedView | SavedReport | ReportRun;
