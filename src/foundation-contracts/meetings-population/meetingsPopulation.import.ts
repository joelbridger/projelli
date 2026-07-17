/**
 * Third-contributor compile proof for the canonical meetings population path.
 * This imports only the public Meetings doorway, as the shell and other
 * consumers must do.
 */
import {
  createFirmMeetingDirectoryReader,
  createMeetingPopulationService,
  resolveMeetingOpenTarget,
  type FirmMeetingDirectoryReader,
  type LegacyMeetingLink,
  type MeetingOpenTarget,
  type MeetingPopulationService,
} from '@/features/meetings';

void createFirmMeetingDirectoryReader;
void createMeetingPopulationService;
void resolveMeetingOpenTarget;

export type MeetingsPopulationImportProof =
  | FirmMeetingDirectoryReader
  | LegacyMeetingLink
  | MeetingOpenTarget
  | MeetingPopulationService;
