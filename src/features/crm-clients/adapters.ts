/**
 * Temporary boundary for build-wave integration.
 * B1-PENDING: Replace these local screen input shapes with imports from
 * `@/platform/crm/types` once B1 lands. These are deliberately view-only;
 * this lane never owns persistence or connector writes.
 */
export type SyncState =
  | 'live'
  | 'syncing'
  | 'last_synced'
  | 'offline'
  | 'needs_attention';
export type NoteAudience = 'internal' | 'client_facing';
export type ProposalKind =
  | 'workflow_launch'
  | 'task_create'
  | 'fact_add'
  | 'communication_draft';
export type ProposalState = 'pending' | 'approved' | 'dismissed' | 'failed';

export interface CrmSource {
  id: string;
  label: string;
  asOf?: string;
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
  personType: 'person' | 'trust' | 'organization';
  roles: readonly string[];
  householdRole?: string;
  external?: boolean;
  relatedHouseholds: number;
  channel?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}
export interface CrmNote {
  id: string;
  body: string;
  audience: NoteAudience;
  pinned?: boolean;
  mentions?: readonly string[];
}
export interface CrmProposal {
  id: string;
  kind: ProposalKind;
  state: ProposalState;
  rationale: string;
  context: string;
  sources: readonly CrmSource[];
  changedSinceReview?: boolean;
  error?: string;
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
  lifecycle: string;
  primaryAdvisor: string;
  ownership: 'mine' | 'shared' | 'other';
  serviceTier: string;
  nextReview?: string;
  syncState: SyncState;
  facts: readonly CrmFact[];
  accounts: readonly CrmAccount[];
  members: readonly CrmPerson[];
  externalParties: readonly CrmPerson[];
  notes: readonly CrmNote[];
  customFields?: readonly CrmFieldValue[];
  tags?: readonly string[];
  schedulingLinkUrl?: string;
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
}

/** UI-only integration points. Implementations belong to the CRM engine lanes. */
export interface CrmClientsActions {
  onAdd?: (
    kind:
      | 'fact'
      | 'note'
      | 'task'
      | 'account'
      | 'person'
      | 'opportunity'
      | 'workflow'
  ) => void;
  onAskHousehold?: (householdId: string) => void;
  onDraftEmail?: (householdId: string) => void;
  onOpenSchedulingLink?: (url: string) => void;
  onSaveNote?: (
    note: Pick<CrmNote, 'body' | 'audience' | 'pinned' | 'mentions'>,
    notifyFirm: boolean
  ) => void;
  onSaveMetadata?: (
    values: readonly CrmFieldValue[],
    tags: readonly string[]
  ) => void;
  onApproveProposal?: (proposalId: string) => void;
  onDismissProposal?: (proposalId: string) => void;
  onRetryProposal?: (proposalId: string) => void;
  onReviewRecipient?: (personId: string) => void;
  onMatchIntake?: (submissionId: string, householdId: string) => void;
  onCreateHouseholdForIntake?: (submissionId: string) => void;
}
