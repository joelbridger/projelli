import {
  verifyDirectClientMeetingTarget,
  verifyLiveMeetingClientBoundary,
  verifyMeetingOpenTarget,
  type DirectClientMeetingTarget,
  type MeetingOpenTarget,
  type MeetingProjection,
  type SealedMeetingClientBoundary,
} from './foundation/contract';

/** The two F8-minted targets that are allowed to reach the detail host. */
export type MeetingEntryTarget =
  | MeetingOpenTarget
  | DirectClientMeetingTarget;

/**
 * The complete construction input for the one meeting-detail mount doorway.
 * Neither field is optional: a folder, matter id, or target by itself is not
 * enough to construct host identity.
 */
export interface MeetingEntryHostIdentityInput {
  readonly activeClientBoundary: SealedMeetingClientBoundary;
  readonly target: MeetingEntryTarget;
}

/** Identity the detail host may use after the F8 seal and exact pair agree. */
export interface MeetingEntryHostIdentity {
  readonly matterId: string;
  readonly meetingDir: string;
  readonly folderName: string;
  readonly canonicalMeeting: MeetingProjection | null;
  readonly clientBoundary: SealedMeetingClientBoundary;
  readonly target: MeetingEntryTarget;
}

function sameClientBoundary(
  left: SealedMeetingClientBoundary,
  right: SealedMeetingClientBoundary
): boolean {
  return (
    left.householdRef === right.householdRef &&
    left.matterId === right.matterId
  );
}

function folderNameFor(meetingDir: string): string {
  const normalized = meetingDir.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop() ?? normalized;
}

/**
 * The SINGLE meeting-detail mount identity chokepoint.
 *
 * A caller must supply the live sealed household + matter pair and one target
 * minted by an F8 resolver/adapter for that exact pair. Missing, forged, or
 * pair-mismatched runtime inputs return `null`; there is deliberately no
 * matter/folder fallback for a header, panel, read, write, drawer, or utility
 * to inherit.
 */
export function meetingEntryHostIdentity(
  input: MeetingEntryHostIdentityInput
): MeetingEntryHostIdentity | null {
  // Treat the erased runtime boundary as unknown first: tests and external JS
  // can still pass absent/forged values even though TypeScript callers cannot.
  const unknownInput = input as unknown;
  if (!unknownInput || typeof unknownInput !== 'object') return null;
  const runtimeInput = unknownInput as {
    readonly activeClientBoundary?: unknown;
    readonly target?: unknown;
  };
  const active = runtimeInput.activeClientBoundary;
  const runtimeTarget = runtimeInput.target;

  if (
    !verifyLiveMeetingClientBoundary(
      active as SealedMeetingClientBoundary | null | undefined
    ) ||
    !runtimeTarget ||
    typeof runtimeTarget !== 'object' ||
    !('kind' in runtimeTarget)
  ) {
    return null;
  }
  const activeClientBoundary = active as SealedMeetingClientBoundary;

  if (runtimeTarget.kind === 'direct-client-meeting') {
    const target = runtimeTarget as DirectClientMeetingTarget;
    if (!verifyDirectClientMeetingTarget(target, activeClientBoundary)) {
      return null;
    }
    return Object.freeze({
      matterId: activeClientBoundary.matterId,
      meetingDir: target.meetingDir,
      folderName: target.folderName,
      canonicalMeeting: null,
      clientBoundary: activeClientBoundary,
      target,
    });
  }

  if (runtimeTarget.kind !== 'linked-legacy-meeting') return null;
  const target = runtimeTarget as MeetingOpenTarget;
  if (!verifyMeetingOpenTarget(target)) return null;
  if (!sameClientBoundary(target.client, activeClientBoundary)) return null;
  if (
    target.meeting.householdRef !== activeClientBoundary.householdRef ||
    target.meeting.matterId !== activeClientBoundary.matterId
  ) {
    return null;
  }

  return Object.freeze({
    matterId: activeClientBoundary.matterId,
    meetingDir: target.meetingDir,
    folderName: folderNameFor(target.meetingDir),
    canonicalMeeting: target.meeting,
    clientBoundary: activeClientBoundary,
    target,
  });
}
