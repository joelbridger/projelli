import {
  type FirmMeetingDirectoryGrant,
  type FirmReadableMeetingArtifactStore,
  type MeetingArtifactRequirement,
  type ReviewNeededMeetingArtifactReader,
} from './foundation/contract';

/**
 * The raw G2 doorway for the sealed, firm-wide review reader. The store
 * re-checks the owner-issued grant and activated selection tri-state on every
 * read and archive transition. UI consumers use `MeetingReviewInboxReader`,
 * which adds the exact selected-client projection and never exposes raw G2.
 */
export function readReviewNeededMeetingArtifacts(
  artifacts: FirmReadableMeetingArtifactStore,
  grant: FirmMeetingDirectoryGrant,
  requirements: readonly MeetingArtifactRequirement[]
): ReviewNeededMeetingArtifactReader {
  return artifacts.reviewNeededForFirm(grant, requirements);
}
