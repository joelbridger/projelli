/**
 * Outside-module public-index proof for the tiny legacy-row link-status
 * doorway. It imports only the Meetings public index and executes a real read;
 * callers supply a live port, never a claimed link state or client identity.
 */
import {
  createLegacyMeetingLinkStatusReader,
  verifyLegacyMeetingLinkStatus,
  type ClientScopedLivePort,
  type LegacyMeetingLinkInput,
  type LegacyMeetingLinkStatus,
  type MeetingRef,
} from '@/features/meetings';

export interface MeetingsLinkStatusImportProof {
  readonly status: LegacyMeetingLinkStatus;
  readonly statusVerified: boolean;
  readonly forgedStatusRejected: boolean;
}

export async function proveMeetingsLinkStatusPublicDoorway(
  port: ClientScopedLivePort,
  legacy: LegacyMeetingLinkInput
): Promise<MeetingsLinkStatusImportProof> {
  const status = await createLegacyMeetingLinkStatusReader(port).read(legacy);
  const forged =
    status.kind === 'linked'
      ? ({
          kind: 'linked',
          meetingRef: status.meetingRef,
        } as LegacyMeetingLinkStatus)
      : ({ kind: 'folder-only' } as LegacyMeetingLinkStatus);
  return {
    status,
    statusVerified: verifyLegacyMeetingLinkStatus(status),
    forgedStatusRejected: !verifyLegacyMeetingLinkStatus(forged),
  };
}

// Compile-proof the named public exports are available to every consumer.
void createLegacyMeetingLinkStatusReader;
void verifyLegacyMeetingLinkStatus;

export type MeetingsLinkStatusPublicTypes =
  | LegacyMeetingLinkStatus
  | LegacyMeetingLinkInput
  | MeetingRef;
