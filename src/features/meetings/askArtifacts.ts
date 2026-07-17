import {
  approvedMeetingArtifactsForClient,
  type ApprovedMeetingArtifactReader,
  type ClientBoundary,
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
  boundary: ClientBoundary | null | undefined,
  requirements: readonly MeetingArtifactRequirement[]
): ApprovedMeetingArtifactReader | null {
  if (!boundary?.householdRef.trim() || !boundary.matterId.trim()) return null;
  return approvedMeetingArtifactsForClient(
    meetings,
    artifacts,
    boundary,
    requirements
  );
}
