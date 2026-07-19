/* eslint-disable react-refresh/only-export-components -- this app composition module intentionally owns a private mount component plus its one-time registration function */
import { useMemo } from 'react';
import {
  BLESSED_MEETING_PANEL_IDS,
  registerMeetingPanel,
  useMeetingArtifactStore,
  useMeetingFoundationStore,
  type MeetingArtifact,
  type MeetingPanelContext,
} from '@/features/meetings';
import { useTaskRecordStore } from '@/features/crm-tasks';
import { MeetingNotesReview, productionMeetingNotesReviewCrmDelivery } from '@/platform/meetingNotesReview/MeetingNotesReview';
import {
  EXACT_MEETING_REVIEW_SCHEMA_VERSION,
  makeExactMeetingNotesReviewRepository,
  type ExactMeetingReviewArtifact,
} from '@/platform/meetingNotesReview/notesReviewDelivery';
import type { ExactMeetingReviewKind } from '@/ui/notesReview';

// These values come from F2's sealed manifest. The guards make a reordered or
// changed manifest fail loudly instead of letting F6 claim the wrong slot.
const TASKS_PANEL_ID = BLESSED_MEETING_PANEL_IDS[4];
const CRM_UPDATE_PANEL_ID = BLESSED_MEETING_PANEL_IDS[5];

function exactArtifact(artifact: MeetingArtifact): ExactMeetingReviewArtifact {
  if (artifact.kind !== 'action-update-proposal') {
    throw new Error('The meeting proposal reader returned the wrong artifact kind.');
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
  };
}

function ExactMeetingReviewPanel({
  context,
  reviewKind,
}: {
  readonly context: MeetingPanelContext;
  readonly reviewKind: ExactMeetingReviewKind;
}) {
  const meetings = useMeetingFoundationStore();
  const artifacts = useMeetingArtifactStore();
  const tasks = useTaskRecordStore();
  const meeting = context.canonicalMeeting ?? null;
  const client = context.clientBoundary ?? null;
  const identityMatches = Boolean(
    meeting &&
      client &&
      meeting.householdRef === client.householdRef &&
      meeting.matterId === client.matterId
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
      approveArtifact: async (artifactId, transition) =>
        exactArtifact(await artifacts.approve(artifactId, transition)),
      taskDelivery: {
        create: (input) => tasks.create(input),
      },
      crmDelivery: productionMeetingNotesReviewCrmDelivery,
    });
  }, [artifacts, client, identityMatches, meeting, meetings, tasks]);

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
