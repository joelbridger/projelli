import type { MeetingMeta } from '../../meetingStore';
import {
  updateMeetingJson,
  type MeetingJsonMutationGuard,
} from '../../meetingStore';
import type { NoticeState } from '../../noticeLedger';
import type { NoticePolicy } from '../../noticeSettings';
import {
  noticeEvidenceSatisfied,
  type NoticeCardEvidence,
  type NoticeEvidenceRule,
} from '../../noticeCard/noticeCardEvidence';
import type {
  MeetingInsightArtifact,
  MeetingInsightArtifactContext,
  MeetingInsightArtifactStore,
  MeetingInsightDescriptor,
} from '../../meetingWorkspaceTypes';

declare module '../../meetingWorkspaceTypes' {
  interface MeetingInsightIdMap {
    review_status: true;
  }
}

export const MEETING_REVIEW_ARTIFACT_ID = 'meeting-review-status';
export const MEETING_REVIEW_ARTIFACT_VERSION = 1;

export interface MeetingReviewArtifactPayload {
  reviewedAt: string | null;
}

export type ReviewItemKind =
  | 'unreviewed-note'
  | 'crm-waiting'
  | 'no-followup'
  | 'unreadable-meta'
  // Recording Notice Kit: no spoken recording notice was detected in the
  // meeting's first minutes. 'notice-unverified' is the Standard-policy flag;
  // 'notice-quarantined' is the stronger Strict-policy state (meeting stays
  // in-review until a human resolves it — never auto-deleted or auto-stopped).
  | 'notice-unverified'
  | 'notice-quarantined'
  // QA-40: transcribe_meeting failed (missing engine/model, wedged sidecar, or
  // other error) — surfaced honestly with a retry rather than an eternal queue.
  | 'transcript-failed'
  // QA-35 review round 2: capture_stop failed AND no audio.wav ever got
  // finalized (most commonly the disk was still full when finalize_session
  // tried to write it) — there's nothing to transcribe/generate notes from,
  // so this is a genuine dead end, not a transient "still generating" state.
  // No retry offered (there's no recourse short of re-recording the
  // meeting); surfaced so it's never mistaken for an eternal pending queue.
  | 'recording-incomplete';

export interface ReviewItem {
  kind: ReviewItemKind;
}

interface CrmQueueItemLike {
  matterId: string;
  sourceRef: string;
  status: string;
}

interface MeetingReviewSource {
  dir: string;
  meta: MeetingMeta | null;
  hasNotes: boolean;
  hasAudio: boolean;
}

/**
 * Task 12b — per-client (never practice-wide) "Needs review" flags for one
 * meeting. Pure so it's cheap to call per row in ClientMeetingsTab's list.
 */
export function needsReview(
  meeting: MeetingReviewSource,
  crmQueue: CrmQueueItemLike[],
  now: number = Date.now(),
  // Recording Notice Kit: the meeting's derived notice state + the firm policy.
  // Optional so existing callers (meeting, crmQueue) keep working unchanged.
  // Notice Card (additive): full-duration card presence + the firm evidence
  // rule. When absent, behavior is identical to before (verbal-only, 'either').
  notice?: {
    state: NoticeState;
    policy: NoticePolicy;
    cardEvidence?: NoticeCardEvidence;
    evidenceRule?: NoticeEvidenceRule;
  }
): ReviewItem[] {
  const items: ReviewItem[] = [];
  // A meeting folder with a missing/corrupt meeting.json is an orphaned or
  // incomplete recording — it must be surfaced honestly here, never silently
  // hidden or rendered as if it were a normal, fully-formed meeting.
  if (meeting.meta === null) items.push({ kind: 'unreadable-meta' });
  // QA-40: a failed transcription is a silent dead-end otherwise — surface
  // it in the same review queue the advisor already checks, not just on the
  // meeting's own detail page.
  if (meeting.meta?.transcriptError) items.push({ kind: 'transcript-failed' });
  // QA-35 review round 2: a recordingError with no salvaged audio at all
  // (see runPostStopPipeline's doc — a 'disk-full' failure DOES salvage
  // real audio and runs the normal pipeline on it instead) has nothing that
  // will ever transcribe/generate notes on its own — flag it rather than
  // let it read as an ordinary in-progress meeting forever.
  if (meeting.meta?.recordingError && !meeting.hasAudio) {
    items.push({ kind: 'recording-incomplete' });
  }
  if (meeting.hasNotes && !meeting.meta?.reviewedAt)
    items.push({ kind: 'unreviewed-note' });
  const waiting = crmQueue.some(
    (q) =>
      q.status === 'proposed' &&
      q.sourceRef.startsWith(`meeting:${meeting.dir}`)
  );
  if (waiting) items.push({ kind: 'crm-waiting' });
  // "No follow-up drafted" only nags once the meeting is a day old — flagging
  // a meeting recorded five minutes ago is noise, not a review queue.
  const ageMs = now - Date.parse(meeting.meta?.startedAt ?? '');
  if (
    !meeting.meta?.followupDraftedAt &&
    Number.isFinite(ageMs) &&
    ageMs > 24 * 3_600_000
  ) {
    items.push({ kind: 'no-followup' });
  }
  // Recording Notice Kit + Notice Card: a meeting needs attention when its
  // notice is NOT satisfied by the firm's evidence rule. By default ('either'),
  // a verified spoken notice OR the card present for the whole recording
  // satisfies it; a firm can require both. 'unchecked' (not yet transcribed)
  // never flags. Strict escalates the same condition to a quarantine state
  // instead of a plain review flag. With no card evidence + the default rule,
  // this is identical to the verbal-only behavior it replaces.
  if (notice && notice.state.status !== 'unchecked') {
    const cardEvidence: NoticeCardEvidence = notice.cardEvidence ?? {
      presentForEntireRecording: false,
    };
    const rule: NoticeEvidenceRule = notice.evidenceRule ?? 'either';
    if (!noticeEvidenceSatisfied(notice.state, cardEvidence, rule)) {
      items.push({
        kind:
          notice.policy === 'strict'
            ? 'notice-quarantined'
            : 'notice-unverified',
      });
    }
  }
  return items;
}

function assertReviewArtifact(
  artifact: MeetingInsightArtifact
): asserts artifact is MeetingInsightArtifact & {
  payload: MeetingReviewArtifactPayload;
} {
  const payload = artifact.payload;
  if (
    artifact.artifactId !== MEETING_REVIEW_ARTIFACT_ID ||
    artifact.version !== MEETING_REVIEW_ARTIFACT_VERSION ||
    typeof payload !== 'object' ||
    payload === null ||
    !('reviewedAt' in payload) ||
    (payload.reviewedAt !== null && typeof payload.reviewedAt !== 'string')
  ) {
    throw new Error('Invalid meeting review artifact');
  }
}

/**
 * Versioned review-state projection over the existing meeting.json bytes.
 * Keeping the same file and two-space JSON formatting makes this extraction a
 * storage refactor only; existing workspaces require no migration.
 */
export const meetingReviewArtifactStore: MeetingInsightArtifactStore = {
  artifactId: MEETING_REVIEW_ARTIFACT_ID,
  version: MEETING_REVIEW_ARTIFACT_VERSION,
  async read(context) {
    const ws = context.workspaceService;
    if (!ws) return null;
    try {
      const meta = JSON.parse(
        await ws.readFile(`${context.meetingDir}/meeting.json`)
      ) as MeetingMeta;
      return {
        artifactId: MEETING_REVIEW_ARTIFACT_ID,
        version: MEETING_REVIEW_ARTIFACT_VERSION,
        payload: { reviewedAt: meta.reviewedAt ?? null },
      };
    } catch {
      return null;
    }
  },
  async write(context, artifact) {
    assertReviewArtifact(artifact);
    const ws = context.workspaceService;
    if (!ws) return null;
    const path = `${context.meetingDir}/meeting.json`;
    const current = JSON.parse(await ws.readFile(path)) as MeetingMeta;
    const next = artifact.payload.reviewedAt
      ? { ...current, reviewedAt: artifact.payload.reviewedAt }
      : (() => {
          const { reviewedAt: _reviewedAt, ...rest } = current;
          return rest;
        })();
    await ws.writeFile(path, JSON.stringify(next, null, 2));
    return artifact;
  },
};

/** Task 12b — set `meeting.json.reviewedAt`, marking a meeting reviewed. */
export async function markMeetingReviewed(
  meetingDir: string,
  guard?: MeetingJsonMutationGuard
): Promise<MeetingMeta | null> {
  return updateMeetingJson(
    meetingDir,
    (current) => ({
      ...current,
      reviewedAt: new Date().toISOString(),
    }),
    guard
  );
}

export const meetingReviewInsightDescriptor: MeetingInsightDescriptor = {
  id: 'review_status',
  order: 10,
  version: MEETING_REVIEW_ARTIFACT_VERSION,
  mounts: { meetingSummary: false, clientSummary: false },
  prerequisites: [{ artifactId: 'meeting.json', minimumVersion: 1 }],
  artifactStore: meetingReviewArtifactStore,
  artifactProducer: {
    artifactId: MEETING_REVIEW_ARTIFACT_ID,
    produce: (context: MeetingInsightArtifactContext) =>
      meetingReviewArtifactStore.read(context),
  },
  selectors: { needsReview },
  settings: {
    id: 'meeting-review-status-settings',
    labelKey: 'meetings.entry.needs-review',
    mount: () => null,
  },
  renderMeetingSummary: () => null,
  renderClientSummary: () => null,
};
