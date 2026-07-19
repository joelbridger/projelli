import {
  meetingArtifactsForClient,
  type MeetingArtifact,
  type MeetingArtifactStore,
  type MeetingProjection,
  type MeetingStore,
  type SealedMeetingClientBoundary,
} from './foundation/contract';

export const STRUCTURED_MEETING_SUMMARY_SCHEMA_VERSION = 1;

export interface StructuredMeetingSummaryPayload {
  readonly summary?: string;
  readonly decisions?: readonly string[];
  readonly personalNotes?: readonly string[];
}

export interface StructuredMeetingSummary {
  readonly artifactId: string;
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly producedAt: string;
  readonly reviewState: 'needs-review' | 'reviewed';
  readonly summary?: string;
  readonly decisions: readonly string[];
  readonly personalNotes: readonly string[];
}

export type StructuredMeetingSummaryReadResult =
  | { readonly kind: 'ready'; readonly summary: StructuredMeetingSummary }
  | { readonly kind: 'empty' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error' };

export interface StructuredMeetingSummaryReader {
  read(meeting: MeetingProjection): Promise<StructuredMeetingSummaryReadResult>;
}

function sameBoundary(
  meeting: MeetingProjection,
  boundary: SealedMeetingClientBoundary
): boolean {
  return (
    meeting.householdRef === boundary.householdRef &&
    meeting.matterId === boundary.matterId
  );
}

function cleanedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

function cleanedList(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const clean: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    if (text && !clean.includes(text)) clean.push(text);
  }
  return clean;
}

function projectStructuredSummary(
  artifact: MeetingArtifact
): StructuredMeetingSummary | null {
  if (
    artifact.kind !== 'summary' ||
    artifact.schemaVersion < STRUCTURED_MEETING_SUMMARY_SCHEMA_VERSION
  ) {
    return null;
  }

  const summary = cleanedText(artifact.payload['summary']);
  const decisions = cleanedList(artifact.payload['decisions']);
  const personalNotes = cleanedList(artifact.payload['personalNotes']);
  if (decisions === null || personalNotes === null) return null;
  if (!summary && decisions.length === 0 && personalNotes.length === 0) {
    return null;
  }

  return {
    artifactId: artifact.id,
    meetingId: artifact.meetingId,
    householdRef: artifact.householdRef,
    matterId: artifact.matterId,
    producedAt: artifact.producedAt,
    reviewState: artifact.state === 'approved' ? 'reviewed' : 'needs-review',
    ...(summary ? { summary } : {}),
    decisions,
    personalNotes,
  };
}

function newestFirst(left: MeetingArtifact, right: MeetingArtifact): number {
  return (
    right.producedAt.localeCompare(left.producedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

/**
 * Builds the Summary panel's only canonical artifact reader. The foundation
 * reader proves the live household + matter pair and exact meeting first; this
 * projection then chooses one deterministic latest summary. A malformed newest
 * artifact is an error, never permission to show an older summary as current.
 */
export function createStructuredMeetingSummaryReader(
  meetings: MeetingStore,
  artifacts: MeetingArtifactStore,
  boundary: SealedMeetingClientBoundary
): StructuredMeetingSummaryReader {
  const scoped = meetingArtifactsForClient(meetings, artifacts, boundary, [
    {
      kind: 'summary',
      minimumSchemaVersion: STRUCTURED_MEETING_SUMMARY_SCHEMA_VERSION,
    },
  ]);

  return {
    read: (meeting) => {
      if (!sameBoundary(meeting, boundary)) {
        return Promise.resolve({ kind: 'refused' });
      }

      const candidates = scoped
        .listForMeeting(meeting.id, ['summary'])
        .filter(
          (artifact) =>
            artifact.meetingId === meeting.id &&
            artifact.householdRef === boundary.householdRef &&
            artifact.matterId === boundary.matterId
        )
        .sort(newestFirst);
      const newest = candidates[0];
      if (!newest) return Promise.resolve({ kind: 'empty' });

      const summary = projectStructuredSummary(newest);
      return Promise.resolve(
        summary ? { kind: 'ready', summary } : { kind: 'error' }
      );
    },
  };
}
