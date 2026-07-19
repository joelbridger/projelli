import { vi } from 'vitest';
import type {
  DirectClientMeetingTarget,
  SealedMeetingClientBoundary,
} from '@/features/meetings';

/**
 * Older MeetingEntry behavior tests exercise file/error rendering, not F8 seal
 * provenance. Give those tests a narrow fake mount while the F11-focused tests
 * exercise the real chokepoint and real F8 targets.
 */
vi.mock('@/features/meetings/meetingEntryHostIdentity', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/features/meetings/meetingEntryHostIdentity')
    >();
  return {
    ...actual,
    meetingEntryHostIdentity: (input: {
      activeClientBoundary: SealedMeetingClientBoundary;
      target: DirectClientMeetingTarget;
    }) => ({
      matterId: input.activeClientBoundary.matterId,
      meetingDir: input.target.meetingDir,
      folderName: input.target.folderName,
      canonicalMeeting: null,
      clientBoundary: input.activeClientBoundary,
      target: input.target,
    }),
  };
});

const TEST_CLIENT = {
  householdRef: 'household-test',
  matterId: 'm-1',
  displayName: 'The Hendersons',
} as SealedMeetingClientBoundary;

export function meetingEntryTestMount(
  meetingDir = '/ws/C/Meetings/x',
  folderName = meetingDir.split('/').pop() ?? 'x'
) {
  return {
    activeClientBoundary: TEST_CLIENT,
    target: {
      kind: 'direct-client-meeting',
      client: TEST_CLIENT,
      meetingDir,
      folderName,
    } as DirectClientMeetingTarget,
  };
}
