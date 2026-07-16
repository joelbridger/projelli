/**
 * Temporary B1-compatible boundary for this screen lane. These names and fields
 * intentionally mirror the frozen B1 CRM contracts, so the eventual engine
 * import is a type move, not a data-shape migration. This lane owns no storage.
 */
export type SyncState =
  | 'live'
  | 'syncing'
  | 'last_synced'
  | 'offline'
  | 'needs_attention';
export type NoteAudience = 'internal' | 'client-facing';
export type ProposalKind =
  | 'workflow_launch'
  | 'task_create'
  | 'fact_add'
  | 'communication_draft';
export type ProposalState = 'pending' | 'approved' | 'rejected' | 'expired';

export interface EntityRef {
  kind: string;
  id: string;
  label?: string;
}
export interface ActorRef {
  id: string;
  label?: string;
}

export interface CrmSource {
  id: string;
  label: string;
  asOf?: string;
  /** A resolvable workspace, mail, CRM, or web location. */
  ref?: string;
}
export interface CrmFact {
  id: string;
  label: string;
  value: string;
  status: string;
  asOf: string;
  learned?: string;
  sources: CrmSource[];
  history?: readonly CrmFact[];
}
export interface CrmAccount {
  id: string;
  custodian: string;
  type: string;
  lastFour?: string;
  status: string;
  owner?: string;
  purpose?: string;
}
export interface CrmPerson {
  id: string;
  name: string;
  /** Optional canonical CRM timestamps; directory projections preserve them when present. */
  createdAt?: string;
  updatedAt?: string;
  /** Tags are preserved when the canonical person payload supplies them. */
  tags?: readonly string[];
  /** Most recent canonical activity directly targeting this person, when available. */
  lastActivityAt?: string;
  personType: 'person' | 'trust' | 'organization';
  roles: readonly string[];
  householdRole?: string;
  external?: boolean;
  relatedHouseholds: number;
  channel?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  companyName?: string;
  jobTitle?: string;
  addresses?: readonly CrmContactAddress[];
  emails?: readonly CrmContactChannel[];
  phones?: readonly CrmContactChannel[];
  /** Links to existing workspace documents; the document remains Documents-owned. */
  contextRefs?: readonly EntityRef[];
}
export interface CrmContactAddress {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  kind: string;
  primary: boolean;
}
export interface CrmContactChannel {
  id: string;
  address: string;
  kind: string;
  primary: boolean;
}
export interface CrmNote {
  id: string;
  body: string;
  audience: NoteAudience;
  pinned?: boolean;
  mentions?: readonly string[];
  createdAt?: string;
  updatedAt?: string;
  author?: string;
  /** Links to existing CRM records or workspace documents. */
  links?: readonly EntityRef[];
}
/** Frozen 02 §1.15 / B1 durable approval record. Never replace this with card state. */
export interface ProposalRecord {
  id: string;
  kind: 'proposalRecord';
  householdRef: EntityRef | null;
  proposalKind: ProposalKind;
  proposedMutation:
    | { kind: 'workflow_launch'; workflowTemplateId: string }
    | {
        kind: 'task_create';
        task: {
          householdRef: EntityRef | null;
          title: string;
          assigneeUserId: string | null;
          due?: string;
          priority?: 'high' | 'normal' | 'low';
          contextRefs: readonly EntityRef[];
        };
      }
    | { kind: 'fact_add'; fact: Record<string, unknown> }
    | { kind: 'communication_draft'; draftRef: EntityRef };
  proposedBy: ActorRef;
  contextRefs: readonly EntityRef[];
  state: ProposalState;
  rationale: string;
  decidedAt?: string;
  decidedBy?: ActorRef;
  appliedEntityRef?: EntityRef;
}

/**
 * Lossless render adapter around one durable ProposalRecord. The optional
 * review material is derived at render time; it never substitutes for the
 * proposed mutation or decision ledger held by `record`.
 */
export interface CrmProposal {
  record: ProposalRecord;
  contextLabel?: string;
  sources: readonly CrmSource[];
  review?: {
    changedSinceReview?: boolean;
    before?: string;
    after?: string;
    selectionCleared?: boolean;
  };
  deliveryError?: string;
}
export interface CrmFieldValue {
  id: string;
  label: string;
  value: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: readonly string[];
}
export interface HouseholdRecord {
  id: string;
  name: string;
  /** Optional canonical CRM timestamps; directory projections preserve them when present. */
  createdAt?: string;
  updatedAt?: string;
  lifecycle: string;
  primaryAdvisor: string;
  ownership: 'mine' | 'shared' | 'other';
  serviceTier: string;
  nextReview?: string;
  lastSyncedAt?: string;
  syncState: SyncState;
  facts: readonly CrmFact[];
  accounts: readonly CrmAccount[];
  members: readonly CrmPerson[];
  externalParties: readonly CrmPerson[];
  notes: readonly CrmNote[];
  customFields?: readonly CrmFieldValue[];
  tags?: readonly string[];
  schedulingLinkUrl?: string;
  /** Feature-owned record extensions live under namespaced descriptor keys. */
  extensionData?: Readonly<Record<string, unknown>>;
  /** Links to existing CRM records or workspace documents. */
  contextRefs?: readonly EntityRef[];
}

export interface HouseholdDirectoryEntry {
  id: string;
  name: string;
  /** Optional canonical CRM timestamps; directory projections preserve them when present. */
  createdAt?: string;
  updatedAt?: string;
  /** Tags are preserved from the canonical household record when present. */
  tags?: readonly string[];
  /** Most recent canonical household activity, derived only from activity events. */
  lastActivityAt?: string;
  lifecycle: string;
  primaryAdvisor: string;
  serviceTier: string;
  peopleCount: number;
}

export interface IntakeFactProposal {
  id: string;
  label: string;
  value: string;
  asOf: string;
  sourceLabel: string;
  state: 'pending' | 'approved' | 'rejected';
}
export interface IntakeSubmission {
  id: string;
  submittedAt: string;
  submitterLabel: string;
  fields: readonly { label: string; value: string }[];
  candidates: readonly {
    householdId: string;
    name: string;
    confidence: 'high' | 'possible';
  }[];
  matchedHouseholdId?: string;
  extractedFacts?: readonly IntakeFactProposal[];
}

export interface AddToHouseholdRequest {
  kind:
    | 'fact'
    | 'note'
    | 'task'
    | 'account'
    | 'person'
    | 'opportunity'
    | 'workflow';
  householdRef: EntityRef;
  contextRefs: readonly EntityRef[];
}

/** Typed handoff to the existing mail surface, not an email send. */
export interface OpenMailSurfaceRequest {
  kind: 'open_mail_surface';
  householdRef: EntityRef;
  contextRefs: readonly EntityRef[];
  source: 'crm_household';
}

/** Integration points. Implementations belong to the CRM engine and mail lanes. */
export interface CrmClientsActions {
  onAdd?: (request: AddToHouseholdRequest) => void;
  onAskHousehold?: (householdId: string) => void;
  /** Client-scoped Documents actions. The shell resolves the matter's safe folder. */
  onCreateClientDocument?: (matterId: string) => void | Promise<void>;
  onCreateClientFolder?: (matterId: string) => void | Promise<void>;
  onImportClientFiles?: (matterId: string) => void | Promise<void>;
  onDraftEmail?: (request: OpenMailSurfaceRequest) => void;
  onOpenSchedulingLink?: (url: string) => void;
  onSaveNote?: (
    note: Pick<CrmNote, 'body' | 'audience' | 'pinned' | 'mentions'>,
    notifyFirm: boolean
  ) => void | Promise<void>;
  onSaveMetadata?: (
    values: readonly CrmFieldValue[],
    tags: readonly string[]
  ) => void | Promise<void>;
  onApproveProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  onRestoreProposal?: (proposalId: string) => void;
  onRetryProposal?: (proposalId: string) => void;
  onReviewRecipient?: (personId: string) => void;
  onMatchIntake?: (submissionId: string, householdId: string) => void;
  onCreateHouseholdForIntake?: (submissionId: string) => void;
  onOpenHousehold?: (householdId: string) => void;
  onApproveIntakeFact?: (submissionId: string, proposalId: string) => void;
  onRejectIntakeFact?: (submissionId: string, proposalId: string) => void;
}
