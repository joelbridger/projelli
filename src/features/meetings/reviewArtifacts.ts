import {
  type FirmMeetingDirectoryGrant,
  type FirmReadableMeetingArtifactStore,
  type MeetingArtifactRequirement,
  type ReviewNeededMeetingArtifactReader,
} from './foundation/contract';

/**
 * The Actions-facing name for the foundation's sealed, firm-wide review
 * reader. It adds no persistence or selection behavior: the store re-checks
 * the owner-issued grant and the activated selection tri-state on every read.
 */
export function readReviewNeededMeetingArtifacts(
  artifacts: FirmReadableMeetingArtifactStore,
  grant: FirmMeetingDirectoryGrant,
  requirements: readonly MeetingArtifactRequirement[]
): ReviewNeededMeetingArtifactReader {
  return artifacts.reviewNeededForFirm(grant, requirements);
}
