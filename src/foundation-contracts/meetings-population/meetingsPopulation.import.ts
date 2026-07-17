/**
 * Third-contributor PAVED-PATH proof for the canonical meetings population path.
 * It imports only the public Meetings doorway, as the shell and other consumers
 * must — and, unlike a bare import-and-void stub, it actually EXECUTES the
 * doorway: it builds the population service, creates + links a canonical
 * meeting, resolves the un-forgeable open target, and shows that a
 * hand-constructed target is rejected. The trusted authority (matters +
 * workspace) is derived by the contract from the platform stores the caller has
 * seeded; the consumer never hands identity in.
 */
import {
  createFirmMeetingDirectoryReader,
  createMeetingPopulationService,
  grantFirmMeetingDirectoryAccess,
  resolveMeetingOpenTarget,
  verifyMeetingOpenTarget,
  type ClientScopedLivePort,
  type CreateMeetingDraft,
  type FirmMeetingDirectoryReader,
  type LegacyMeetingLink,
  type LegacyMeetingLinkInput,
  type MeetingOpenTarget,
  type MeetingPopulationService,
} from '@/features/meetings';

export interface MeetingsPopulationPavedPathResult {
  readonly linkedMeetingId: string;
  readonly openTargetVerified: boolean;
  readonly forgedTargetRejected: boolean;
  readonly firmListCount: number;
}

/**
 * Run the whole public paved path against a caller-provided live-record port.
 * The caller must have seeded the trusted matter store + active workspace so the
 * contract can derive authority; this proof supplies NO matters, filesystem, or
 * authorization of its own — that is the point.
 */
export async function proveMeetingsPopulationPavedPath(
  port: ClientScopedLivePort,
  draft: CreateMeetingDraft,
  legacy: LegacyMeetingLinkInput
): Promise<MeetingsPopulationPavedPathResult> {
  const service: MeetingPopulationService =
    createMeetingPopulationService(port);
  const linked = await service.createAndLink(draft, legacy);

  const target: MeetingOpenTarget = await service.openTarget(linked.id);
  const openTargetVerified = verifyMeetingOpenTarget(target);

  // A consumer that hand-builds the same shape gets NO authority: it is not in
  // the trusted seal, so the host contract refuses to believe it.
  const forged = {
    kind: 'linked-legacy-meeting',
    meeting: linked,
    client: { householdRef: linked.householdRef, matterId: linked.matterId },
    legacyLink: linked.legacyLink ?? {
      meetingDir: legacy.meetingDir,
      linkedAt: linked.createdAt,
    },
    meetingDir: legacy.meetingDir,
  } as unknown as MeetingOpenTarget;
  const forgedTargetRejected = !verifyMeetingOpenTarget(forged);

  const grant = grantFirmMeetingDirectoryAccess([linked.matterId]);
  const reader: FirmMeetingDirectoryReader | null = grant
    ? createFirmMeetingDirectoryReader(port, grant)
    : null;
  const firmListCount = reader ? (await reader.list()).length : 0;

  return {
    linkedMeetingId: linked.id,
    openTargetVerified,
    forgedTargetRejected,
    firmListCount,
  };
}

// Compile-proof the surface is importable even when the paved path is not run.
void createFirmMeetingDirectoryReader;
void createMeetingPopulationService;
void grantFirmMeetingDirectoryAccess;
void resolveMeetingOpenTarget;
void verifyMeetingOpenTarget;

export type MeetingsPopulationImportProof =
  | FirmMeetingDirectoryReader
  | LegacyMeetingLink
  | MeetingOpenTarget
  | MeetingPopulationService;
