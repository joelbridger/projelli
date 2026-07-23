import { sha256Hex } from '@/lib/hash';
import {
  meetingArtifactsForClient,
  type MeetingArtifact,
  type MeetingArtifactStore,
  type MeetingProjection,
  type MeetingRef,
  type MeetingStore,
  type SealedMeetingClientBoundary,
} from '../foundation/contract';

export const MEETING_FOLLOW_UP_SCHEMA_VERSION = 1 as const;

const MAX_RECIPIENTS_LENGTH = 8_000;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 100_000;
const encoder = new TextEncoder();

/** The required read/write boundary: exact meeting plus the complete sealed pair. */
export interface MeetingFollowUpTarget {
  readonly meetingId: MeetingRef;
  readonly client: SealedMeetingClientBoundary;
}

export interface MeetingFollowUpDraft {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface MeetingFollowUpRecap extends MeetingFollowUpDraft {
  readonly artifactId: string;
  readonly recapKey: string;
  readonly meetingId: MeetingRef;
  readonly householdRef: string;
  readonly matterId: string;
  readonly producedAt: string;
  readonly state: 'edited' | 'saved-to-drafts';
  readonly outlookDraftId?: string;
  /** Provider retained so a saved Gmail draft is never presented as Outlook. */
  readonly draftProvider?: 'm365' | 'gmail';
}

export type MeetingFollowUpReadResult =
  | { readonly kind: 'not-produced' }
  | { readonly kind: 'ready'; readonly recap: MeetingFollowUpRecap }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error' };

export type MeetingFollowUpWriteResult =
  | { readonly kind: 'ready'; readonly recap: MeetingFollowUpRecap }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error' };

export interface MeetingFollowUpStore {
  read(target: MeetingFollowUpTarget): Promise<MeetingFollowUpReadResult>;
  start(target: MeetingFollowUpTarget): Promise<MeetingFollowUpWriteResult>;
  save(
    target: MeetingFollowUpTarget,
    input: MeetingFollowUpDraft &
      (
        | { readonly state: 'edited' }
        | {
            readonly state: 'saved-to-drafts';
            readonly outlookDraftId: string;
            readonly draftProvider: 'm365' | 'gmail';
          }
      )
  ): Promise<MeetingFollowUpWriteResult>;
}

function cleanIdentity(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasCompleteTarget(target: MeetingFollowUpTarget): boolean {
  const runtimeTarget = target as Partial<MeetingFollowUpTarget> | null;
  const runtimeClient = runtimeTarget?.client as
    | Partial<SealedMeetingClientBoundary>
    | null
    | undefined;
  return Boolean(
    cleanIdentity(runtimeTarget?.meetingId) &&
    cleanIdentity(runtimeClient?.householdRef) &&
    cleanIdentity(runtimeClient?.matterId)
  );
}

function samePair(
  left: Pick<SealedMeetingClientBoundary, 'householdRef' | 'matterId'>,
  right: Pick<SealedMeetingClientBoundary, 'householdRef' | 'matterId'>
): boolean {
  return (
    cleanIdentity(left.householdRef) !== null &&
    cleanIdentity(left.matterId) !== null &&
    left.householdRef === right.householdRef &&
    left.matterId === right.matterId
  );
}

/** Build a target only when the canonical meeting proves the same full pair. */
export function meetingFollowUpTarget(
  meeting: MeetingProjection | null | undefined,
  client: SealedMeetingClientBoundary | null | undefined
): MeetingFollowUpTarget | null {
  if (
    !meeting ||
    !client ||
    !cleanIdentity(meeting.id) ||
    !samePair(meeting, client)
  ) {
    return null;
  }
  return Object.freeze({ meetingId: meeting.id, client });
}

/**
 * Opaque logical key for one exact household + matter + meeting triple. Length
 * framing prevents ambiguous concatenation and keeps raw client ids out of the
 * durable artifact payload.
 */
export async function deriveMeetingFollowUpRecapKey(
  target: MeetingFollowUpTarget
): Promise<string> {
  if (!hasCompleteTarget(target)) {
    throw new Error('A complete meeting and client identity is required.');
  }
  const parts = [
    target.client.householdRef,
    target.client.matterId,
    target.meetingId,
  ];
  const framed = parts
    .map((part) => `${String(encoder.encode(part).byteLength)}:${part}`)
    .join('|');
  return `meeting-follow-up-${await sha256Hex(encoder.encode(framed))}`;
}

function ownsExactCanonicalMeeting(
  meetings: MeetingStore,
  target: MeetingFollowUpTarget
): boolean {
  return (
    meetings.list.filter(
      (meeting) =>
        meeting.id === target.meetingId &&
        meeting.householdRef === target.client.householdRef &&
        meeting.matterId === target.client.matterId
    ).length === 1
  );
}

function newestFirst(left: MeetingArtifact, right: MeetingArtifact): number {
  return (
    right.producedAt.localeCompare(left.producedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

function validEditedDraft(input: {
  readonly to: unknown;
  readonly subject: unknown;
  readonly body: unknown;
}): input is MeetingFollowUpDraft {
  return (
    typeof input.to === 'string' &&
    input.to.length <= MAX_RECIPIENTS_LENGTH &&
    typeof input.subject === 'string' &&
    input.subject.length <= MAX_SUBJECT_LENGTH &&
    typeof input.body === 'string' &&
    input.body.length <= MAX_BODY_LENGTH
  );
}

function validOutlookDraft(input: {
  readonly to: unknown;
  readonly subject: unknown;
  readonly body: unknown;
}): boolean {
  return (
    validEditedDraft(input) &&
    typeof input.body === 'string' &&
    input.body.trim().length > 0
  );
}

function projectRecap(
  artifact: MeetingArtifact,
  target: MeetingFollowUpTarget,
  recapKey: string
): MeetingFollowUpRecap | null {
  if (
    artifact.kind !== 'follow-up-draft' ||
    artifact.schemaVersion < MEETING_FOLLOW_UP_SCHEMA_VERSION ||
    artifact.meetingId !== target.meetingId ||
    artifact.householdRef !== target.client.householdRef ||
    artifact.matterId !== target.client.matterId ||
    artifact.payload['recapKey'] !== recapKey
  ) {
    return null;
  }
  const draft = {
    to: artifact.payload['to'],
    subject: artifact.payload['subject'],
    body: artifact.payload['body'],
  };
  if (!validEditedDraft(draft)) {
    return null;
  }
  const validatedDraft: MeetingFollowUpDraft = {
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
  };
  const state = artifact.payload['deliveryState'];
  if (state !== 'edited' && state !== 'saved-to-drafts') return null;
  if (state === 'saved-to-drafts' && !validOutlookDraft(validatedDraft))
    return null;
  const outlookDraftId = cleanIdentity(artifact.payload['outlookDraftId']);
  const rawProvider = artifact.payload['draftProvider'];
  const draftProvider =
    rawProvider === 'gmail' || rawProvider === 'm365' ? rawProvider : 'm365';
  if (state === 'saved-to-drafts' && !outlookDraftId) return null;
  if (state === 'edited' && outlookDraftId) return null;
  return Object.freeze({
    artifactId: artifact.id,
    recapKey,
    meetingId: target.meetingId,
    householdRef: target.client.householdRef,
    matterId: target.client.matterId,
    producedAt: artifact.producedAt,
    to: validatedDraft.to,
    subject: validatedDraft.subject,
    body: validatedDraft.body,
    state,
    ...(outlookDraftId ? { outlookDraftId } : {}),
    ...(state === 'saved-to-drafts' ? { draftProvider } : {}),
  });
}

/**
 * Typed adapter over the foundation artifact store. Reads and writes require
 * the exact meeting and full sealed pair; old matter-only artifacts do not have
 * this lane's derived recap key and are rejected as invalid current records.
 */
export function createMeetingFollowUpStore(
  meetings: MeetingStore,
  artifacts: MeetingArtifactStore
): MeetingFollowUpStore {
  const read = async (
    target: MeetingFollowUpTarget
  ): Promise<MeetingFollowUpReadResult> => {
    if (
      !hasCompleteTarget(target) ||
      !ownsExactCanonicalMeeting(meetings, target)
    ) {
      return { kind: 'refused' };
    }
    try {
      const recapKey = await deriveMeetingFollowUpRecapKey(target);
      const reader = meetingArtifactsForClient(
        meetings,
        artifacts,
        target.client,
        [
          {
            kind: 'follow-up-draft',
            minimumSchemaVersion: MEETING_FOLLOW_UP_SCHEMA_VERSION,
          },
        ]
      );
      const candidates = reader
        .listForMeeting(target.meetingId, ['follow-up-draft'])
        .filter(
          (artifact) =>
            artifact.meetingId === target.meetingId &&
            artifact.householdRef === target.client.householdRef &&
            artifact.matterId === target.client.matterId
        )
        .sort(newestFirst);
      const newest = candidates[0];
      if (!newest) return { kind: 'not-produced' };
      const recap = projectRecap(newest, target, recapKey);
      return recap ? { kind: 'ready', recap } : { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  };

  const save: MeetingFollowUpStore['save'] = async (target, input) => {
    if (
      !hasCompleteTarget(target) ||
      !ownsExactCanonicalMeeting(meetings, target) ||
      !validEditedDraft(input) ||
      (input.state === 'saved-to-drafts' &&
        (!validOutlookDraft(input) ||
          !cleanIdentity(input.outlookDraftId) ||
          (input.draftProvider !== 'm365' && input.draftProvider !== 'gmail')))
    ) {
      return { kind: 'refused' };
    }
    try {
      const recapKey = await deriveMeetingFollowUpRecapKey(target);
      const artifact = await artifacts.append({
        meetingId: target.meetingId,
        kind: 'follow-up-draft',
        schemaVersion: MEETING_FOLLOW_UP_SCHEMA_VERSION,
        producedAt: new Date().toISOString(),
        sourceRefs: [],
        provenance: 'local-entry',
        payload: {
          recapKey,
          to: input.to,
          subject: input.subject,
          body: input.body,
          deliveryState: input.state,
          ...(input.state === 'saved-to-drafts'
            ? { outlookDraftId: input.outlookDraftId }
            : {}),
          ...(input.state === 'saved-to-drafts'
            ? { draftProvider: input.draftProvider }
            : {}),
        },
      });
      const recap = projectRecap(artifact, target, recapKey);
      return recap ? { kind: 'ready', recap } : { kind: 'refused' };
    } catch {
      return { kind: 'error' };
    }
  };

  return {
    read,
    start: async (target) => {
      const current = await read(target);
      if (current.kind === 'ready') return current;
      if (current.kind !== 'not-produced') return current;
      return save(target, {
        to: '',
        subject: '',
        body: '',
        state: 'edited',
      });
    },
    save,
  };
}
