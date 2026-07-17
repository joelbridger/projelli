import {
  readApprovedMeetingArtifacts,
  type ClientBoundary,
  type MeetingArtifactRequirement,
  type MeetingArtifactStore,
  type MeetingStore,
} from '@/features/meetings';

export function compileAskMeetingProducerImport(
  meetings: MeetingStore,
  artifacts: MeetingArtifactStore
): void {
  const boundary: ClientBoundary = {
    householdRef: 'fixture-client',
    matterId: 'fixture-matter',
  };
  const requirements: readonly MeetingArtifactRequirement[] = [
    { kind: 'summary', minimumSchemaVersion: 1 },
  ];
  void readApprovedMeetingArtifacts(meetings, artifacts, boundary, requirements);
}
