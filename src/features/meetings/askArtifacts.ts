import {
  approvedMeetingArtifactsForClient,
  type ApprovedMeetingArtifactReader,
  type SealedMeetingClientBoundary,
  type MeetingArtifactRequirement,
  type MeetingArtifactStore,
  type MeetingStore,
} from './foundation/contract';

/**
 * The Ask-facing name for the existing approved-only reader. It forwards the
 * exact caller boundary and allowed-kind requirements without adding a read
 * path or retaining either one.
 */
export function readApprovedMeetingArtifacts(
  meetings: MeetingStore,
  artifacts: MeetingArtifactStore,
  boundary: SealedMeetingClientBoundary,
  requirements: readonly MeetingArtifactRequirement[]
): ApprovedMeetingArtifactReader {
  return approvedMeetingArtifactsForClient(
    meetings,
    artifacts,
    boundary,
    requirements
  );
}
