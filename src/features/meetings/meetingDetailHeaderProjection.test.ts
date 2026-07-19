import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  DirectClientMeetingTarget,
  SealedMeetingClientBoundary,
} from './foundation/contract';
import type { MeetingEntryHostIdentity } from './meetingEntryHostIdentity';
import { projectMeetingDetailHeader } from './meetingDetailHeaderProjection';

const client = {
  householdRef: 'household-a',
  matterId: 'matter-a',
  displayName: 'Alpha Household',
} as SealedMeetingClientBoundary;
const target = {
  kind: 'direct-client-meeting',
  client,
  meetingDir: '/workspace/Clients/Alpha/Meetings/meeting-a',
  folderName: 'meeting-a',
} as DirectClientMeetingTarget;
const identity = {
  matterId: client.matterId,
  meetingDir: target.meetingDir,
  folderName: target.folderName,
  canonicalMeeting: null,
  clientBoundary: client,
  target,
} as MeetingEntryHostIdentity;
const t = ((key: string) => key) as TFunction;

describe('meeting detail header projection', () => {
  it('projects exact saved header facts and binds CRM navigation to the sealed pair', () => {
    const openLinkedClient = vi.fn();
    const header = projectMeetingDetailHeader({
      identity,
      clientName: 'ignored because sealed display name wins',
      hasAudio: true,
      canEditMeeting: true,
      crmNavigation: { openLinkedClient },
      t,
      meta: {
        matterId: client.matterId,
        startedAt: '2026-07-20T09:05:00.000Z',
        consent: {
          mode: 'two-party',
          confirmedBy: 'member-a',
          confirmedAt: '2026-07-20T09:00:00.000Z',
        },
        customTitle: 'Quarterly plan review',
        typeId: 'annual-review',
        calendarEvent: {
          id: 'calendar-a',
          title: 'Quarterly plan review',
          startUtc: '2026-07-20T09:00:00.000Z',
          endUtc: '2026-07-20T10:00:00.000Z',
          joinUrl: 'https://us02web.zoom.us/j/123',
          attendees: [
            { name: 'Avery Client', email: 'avery@example.test' },
            { name: '', email: '' },
          ],
        },
      },
    });

    expect(header).toMatchObject({
      meetingName: 'Quarterly plan review',
      linkedClient: { label: 'Alpha Household', clientBoundary: client },
      dateTime: {
        startUtc: '2026-07-20T09:00:00.000Z',
        endUtc: '2026-07-20T10:00:00.000Z',
      },
      platform: 'zoom',
      attendees: [{ name: 'Avery Client', email: 'avery@example.test' }],
      type: {
        id: 'annual-review',
        label: 'meetings.types.annual-review',
      },
      audio: { state: 'available' },
      actions: {
        openLinkedClient: true,
        renameMeeting: true,
        changeMeetingType: true,
      },
    });
    header.linkedClient.open?.();
    expect(openLinkedClient).toHaveBeenCalledWith(client);
  });

  it('does not guess platform, attendees, or unsupported actions', () => {
    const header = projectMeetingDetailHeader({
      identity,
      meta: null,
      clientName: 'Alpha Household',
      hasAudio: false,
      canEditMeeting: true,
      t,
    });

    expect(header.platform).toBeNull();
    expect(header.attendees).toEqual([]);
    expect(header.actions.openLinkedClient).toBe(false);
    expect(header.actions.renameMeeting).toBe(false);
    expect(header.actions.changeMeetingType).toBe(false);
    expect(header.audio.state).toBe('no-audio');
  });

  it('preserves the recording-incomplete state after the recording tab retired', () => {
    const header = projectMeetingDetailHeader({
      identity,
      clientName: 'Alpha Household',
      hasAudio: false,
      canEditMeeting: false,
      t,
      meta: {
        matterId: client.matterId,
        startedAt: '2026-07-20T09:05:00.000Z',
        consent: {
          mode: 'two-party',
          confirmedBy: 'member-a',
          confirmedAt: '2026-07-20T09:00:00.000Z',
        },
        recordingError: {
          kind: 'disk-full',
          at: '2026-07-20T09:06:00.000Z',
          message: 'disk full',
        },
      },
    });
    expect(header.audio.state).toBe('recording-incomplete');
  });
});
