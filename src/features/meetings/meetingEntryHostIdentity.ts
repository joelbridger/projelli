import {
  verifyMeetingOpenTarget,
  type MeetingOpenTarget,
} from './foundation/contract';

/** The identity the MeetingEntry host binds to, after weighing an open target. */
export interface MeetingEntryHostIdentity {
  readonly matterId: string;
  readonly meetingDir: string;
  readonly canonicalMeeting: MeetingOpenTarget['meeting'] | null;
  readonly clientBoundary: MeetingOpenTarget['client'] | null;
}

/**
 * Resolve the identity MeetingEntry renders through — panel/header/insight
 * composition, canonical projection, client boundary. A canonical opener owns
 * identity ONLY when its target is one the trusted resolver actually minted:
 * `verifyMeetingOpenTarget` is the sole proof. A hand-constructed structural
 * object (even cast to MeetingOpenTarget) is not in the seal, so it confers NO
 * identity and the host falls back to its legacy folder props — a forged target
 * can never redirect this host to another client's matter or folder.
 */
export function resolveMeetingEntryHostIdentity(
  openTarget: MeetingOpenTarget | undefined,
  legacyMatterId: string,
  legacyMeetingDir: string
): MeetingEntryHostIdentity {
  const canonical = verifyMeetingOpenTarget(openTarget)
    ? (openTarget as MeetingOpenTarget)
    : null;
  return {
    matterId: canonical?.client.matterId ?? legacyMatterId,
    meetingDir: canonical?.meetingDir ?? legacyMeetingDir,
    canonicalMeeting: canonical?.meeting ?? null,
    clientBoundary: canonical?.client ?? null,
  };
}
