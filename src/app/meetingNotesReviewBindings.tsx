/* eslint-disable react-refresh/only-export-components -- this app composition module intentionally owns a private mount component plus its one-time registration function */
import { useMemo } from 'react';
import {
  BLESSED_MEETING_PANEL_IDS,
  registerMeetingPanel,
  useMeetingArtifactStore,
  useMeetingFoundationPreferencesStore,
  useMeetingFoundationStore,
  type MeetingArtifact,
  type MeetingPanelContext,
} from '@/features/meetings';
import { useTaskRecordStore, type TaskRecordStore } from '@/features/crm-tasks';
import { MeetingNotesReview } from '@/platform/meetingNotesReview/MeetingNotesReview';
import {
  EXACT_MEETING_REVIEW_SCHEMA_VERSION,
  MeetingProposalEgressAuthorityError,
  hasCompleteExactMeetingReviewIdentity,
  makeExactMeetingNotesReviewRepository,
  type ExactMeetingReviewArtifact,
  type ExactMeetingTaskDelivery,
  type NotesReviewCrmDelivery,
} from '@/platform/meetingNotesReview/notesReviewDelivery';
import { saveApprovedMeetingCrmFieldRebased } from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { ExactMeetingReviewKind } from '@/ui/notesReview';
import {
  resolveMeetingVisibility,
  type MeetingVisibilityPolicy,
  type MeetingVisibilitySubject,
} from '@/platform/meeting-visibility';
import { useFirmStore } from '@/platform/firm/firmStore';

export function createExactMeetingTaskDelivery(
  tasks: Pick<TaskRecordStore, 'create'>
): ExactMeetingTaskDelivery {
  return {
    create: ({ deliveryKey, ...input }) =>
      tasks.create({ ...input, meetingDeliveryKey: deliveryKey }),
  };
}

export function createExactMeetingLocalCrmDelivery(input: {
  readonly workspaceRoot: string | null | undefined;
  readonly canPersist: () => boolean;
}): NotesReviewCrmDelivery {
  return {
    // Kept only for the older summary-review contract. Exact delivery never
    // reads this or calls any provider proposal method.
    isConnected: () => Promise.resolve(true),
    saveProposal: () =>
      Promise.reject(new Error('Provider CRM delivery is disabled.')),
    prepareProposal: () =>
      Promise.reject(new Error('Provider CRM delivery is disabled.')),
    approveProposal: () =>
      Promise.reject(new Error('Provider CRM delivery is disabled.')),
    saveApprovedLocalField: async (request) => {
      const saved = await saveApprovedMeetingCrmFieldRebased({
        workspaceRoot: input.workspaceRoot,
        householdRef: request.householdRef,
        matterId: request.matterId,
        deliveryKey: request.deliveryKey,
        field: request.field,
        value: request.value,
        canPersist: input.canPersist,
      });
      return { recordId: saved.record.id, deduped: saved.deduped };
    },
  };
}

// These values come from F2's sealed manifest. The guards make a reordered or
// changed manifest fail loudly instead of letting F6 claim the wrong slot.
const TASKS_PANEL_ID = BLESSED_MEETING_PANEL_IDS[4];
const CRM_UPDATE_PANEL_ID = BLESSED_MEETING_PANEL_IDS[5];

function exactArtifact(artifact: MeetingArtifact): ExactMeetingReviewArtifact {
  if (artifact.kind !== 'action-update-proposal') {
    throw new Error(
      'The meeting proposal reader returned the wrong artifact kind.'
    );
  }
  return {
    id: artifact.id,
    meetingId: artifact.meetingId,
    householdRef: artifact.householdRef,
    matterId: artifact.matterId,
    kind: artifact.kind,
    schemaVersion: artifact.schemaVersion,
    state: artifact.state,
    producedAt: artifact.producedAt,
    payload: artifact.payload,
    ...(artifact.decision ? { decision: artifact.decision } : {}),
    ...(artifact.delivery ? { delivery: artifact.delivery } : {}),
    ...(artifact.meetingVisibility
      ? { meetingVisibility: artifact.meetingVisibility }
      : {}),
  };
}

export function canReadExactMeetingReviewArtifact(input: {
  readonly artifact: ExactMeetingReviewArtifact;
  readonly meeting: {
    readonly id: string;
    readonly ownerRef: string | null;
    readonly visibilityPolicyId?: string;
  };
  readonly viewerId: string | null | undefined;
  readonly policies: readonly MeetingVisibilityPolicy[];
}): boolean {
  const subject = input.artifact.meetingVisibility;
  if (!subject || !input.meeting.ownerRef) return false;
  const root: MeetingVisibilitySubject = {
    kind: 'meeting-note',
    id: input.meeting.id,
    lineage: 'root',
    ownerRef: input.meeting.ownerRef,
    ...(input.meeting.visibilityPolicyId
      ? { visibilityPolicyId: input.meeting.visibilityPolicyId }
      : {}),
  };
  return resolveMeetingVisibility({
    subject,
    viewerId: input.viewerId,
    policies: input.policies,
    resolveParent: (ref) =>
      ref.kind === root.kind && ref.id === root.id ? root : null,
  }).visible;
}

export function hasMatchingCompleteMeetingReviewIdentity(
  meeting:
    | {
        readonly id?: unknown;
        readonly householdRef?: unknown;
        readonly matterId?: unknown;
      }
    | null
    | undefined,
  client:
    | {
        readonly householdRef?: unknown;
        readonly matterId?: unknown;
      }
    | null
    | undefined
): boolean {
  return Boolean(
    meeting &&
    client &&
    hasCompleteExactMeetingReviewIdentity(meeting.id, client) &&
    meeting.householdRef === client.householdRef &&
    meeting.matterId === client.matterId
  );
}

function ExactMeetingReviewPanel({
  context,
  reviewKind,
}: {
  readonly context: MeetingPanelContext;
  readonly reviewKind: ExactMeetingReviewKind;
}) {
  const meetings = useMeetingFoundationStore();
  const preferences = useMeetingFoundationPreferencesStore().preferences;
  const artifacts = useMeetingArtifactStore();
  const tasks = useTaskRecordStore();
  const liveCrm = useLiveCrmRecords();
  const viewerId = useFirmStore((state) => state.session?.userId ?? null);
  const meeting = context.canonicalMeeting ?? null;
  const client = context.clientBoundary ?? null;
  const identityMatches = hasMatchingCompleteMeetingReviewIdentity(
    meeting,
    client
  );
  const repository = useMemo(() => {
    if (!meeting || !client || !identityMatches) return null;
    const reader = artifacts.readerFor(meetings, client, [
      {
        kind: 'action-update-proposal',
        minimumSchemaVersion: EXACT_MEETING_REVIEW_SCHEMA_VERSION,
      },
    ]);
    return makeExactMeetingNotesReviewRepository({
      meetingId: meeting.id,
      client,
      artifacts: {
        listForMeeting: (meetingId) =>
          reader
            .listForMeeting(meetingId, ['action-update-proposal'])
            .map(exactArtifact),
      },
      decideArtifact: async (artifactId, transition) => {
        if (!artifacts.decide)
          throw new Error('The meeting decision ledger is unavailable.');
        return exactArtifact(await artifacts.decide(artifactId, transition));
      },
      recordDelivery: async (input) => {
        if (!artifacts.recordDelivery)
          throw new Error('The meeting delivery ledger is unavailable.');
        return exactArtifact(await artifacts.recordDelivery(input));
      },
      assertEgressAuthority: (expected) => {
        const current = reader.get(expected.artifactId);
        if (!current)
          throw new MeetingProposalEgressAuthorityError(
            'Client, workspace, membership, or private-note access changed. Nothing was sent.'
          );
        const exact = exactArtifact(current);
        if (
          exact.state !== 'approved' ||
          exact.decision?.proposalRevision !== expected.proposalRevision ||
          exact.delivery?.key !== expected.deliveryKey ||
          exact.delivery.status !== 'pending'
        )
          throw new MeetingProposalEgressAuthorityError(
            'The approved proposal changed before delivery. Nothing was sent.'
          );
      },
      taskDelivery: createExactMeetingTaskDelivery(tasks),
      crmDelivery: createExactMeetingLocalCrmDelivery({
        workspaceRoot: liveCrm.workspaceRoot,
        canPersist: () =>
          hasMatchingCompleteMeetingReviewIdentity(
            context.canonicalMeeting ?? null,
            context.clientBoundary ?? null
          ),
      }),
      canReadArtifact: (artifact) =>
        canReadExactMeetingReviewArtifact({
          artifact,
          meeting,
          viewerId,
          policies: preferences.visibilityPolicies,
        }),
    });
  }, [
    artifacts,
    client,
    identityMatches,
    meeting,
    meetings,
    preferences.visibilityPolicies,
    tasks,
    liveCrm.workspaceRoot,
    viewerId,
  ]);

  const identityBlock = identityMatches
    ? undefined
    : 'Open this meeting from its confirmed client before reviewing proposals.';
  const crmBlock =
    reviewKind === 'crm-update' && context.crmBlockedReason
      ? context.crmBlockedReason
      : undefined;
  const blockedReason = identityBlock ?? crmBlock;
  return (
    <MeetingNotesReview
      key={`${meeting?.id ?? 'blocked'}\u0000${client?.householdRef ?? ''}\u0000${client?.matterId ?? ''}\u0000${reviewKind}`}
      reviewKind={reviewKind}
      repository={repository}
      {...(blockedReason ? { blockedReason } : {})}
    />
  );
}

let registered = false;

/** Register rule (b) contributions only; the F2 base descriptors stay untouched. */
export function registerMeetingNotesReviewCompatibilityPanels(): void {
  if (registered) return;
  registerMeetingPanel({
    id: TASKS_PANEL_ID,
    order: 40,
    labelKey: 'meetings.entry.tab-tasks',
    mount: (context) => (
      <ExactMeetingReviewPanel context={context} reviewKind="task" />
    ),
  });
  registerMeetingPanel({
    id: CRM_UPDATE_PANEL_ID,
    order: 50,
    labelKey: 'meetings.entry.tab-crm-update',
    mount: (context) => (
      <ExactMeetingReviewPanel context={context} reviewKind="crm-update" />
    ),
  });
  registered = true;
}
