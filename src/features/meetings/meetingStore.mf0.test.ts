import '@/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => false }));

import {
  setMeetingsWorkspaceService,
  useMeetingStore,
  type MeetingCalendarEventMeta,
  type MeetingMeta,
} from './meetingStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

const MEETING_DIR = '/ws/Clients/Acme/Meetings/2026-07-07T10-00-00Z';
const MEETING_JSON = `${MEETING_DIR}/meeting.json`;
const BASE_META: MeetingMeta = {
  matterId: 'matter-1',
  startedAt: '2026-07-07T10:00:00.000Z',
  consent: {
    mode: 'two-party',
    confirmedBy: 'advisor',
    confirmedAt: '2026-07-07T10:00:00.000Z',
  },
};

function makeWorkspace(files: Map<string, string>): WorkspaceService {
  return {
    async readFile(path: string) {
      return files.get(path) ?? null;
    },
    async writeFile(path: string, content: string) {
      files.set(path, content);
    },
    async exists(path: string) {
      return files.has(path);
    },
  } as unknown as WorkspaceService;
}

function resetStore(): void {
  useMeetingStore.setState({
    status: { recording: false, meetingDir: null, elapsedMs: 0, writeError: null },
    processingCount: 0,
    activeMatterId: null,
    activeConsent: null,
    noticeCardStatus: null,
    lastWriteFailure: null,
  });
}

describe('MF0 calendar event metadata', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_start') {
        return Promise.resolve({ meetingDir: MEETING_DIR, startedAt: BASE_META.startedAt });
      }
      return Promise.resolve(null);
    });
    resetStore();
    useWorkspaceStore.setState({ rootPath: '/ws' });
    useMatterStore.setState({
      matters: [{ id: 'matter-1', name: 'Acme', folderPaths: ['/ws/Clients/Acme'] }],
    } as Partial<ReturnType<typeof useMatterStore.getState>>);
  });

  it('writes the selected calendar event into meeting.json when recording starts', async () => {
    const files = new Map([[MEETING_JSON, JSON.stringify(BASE_META)]]);
    setMeetingsWorkspaceService(makeWorkspace(files));
    const calendarEvent: MeetingCalendarEventMeta = {
      id: 'outlook:event-123',
      title: 'Acme annual review',
      startUtc: '2026-07-07T10:00:00.000Z',
      endUtc: '2026-07-07T11:00:00.000Z',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/acme',
      attendees: [
        { email: 'alex@acme.test', name: 'Alex Acme' },
        { email: 'sam@acme.test', name: 'Sam Acme' },
      ],
    };

    await useMeetingStore.getState().startRecording('matter-1', {
      consentMode: 'two-party',
      calendarEvent,
    });

    const saved = JSON.parse(files.get(MEETING_JSON) ?? '{}') as MeetingMeta;
    expect(saved.calendarEvent).toEqual(calendarEvent);
    expect(saved.calendarTitle).toBe('Acme annual review');
  });

  it('leaves calendar event metadata absent for ad-hoc recordings', async () => {
    const files = new Map([[MEETING_JSON, JSON.stringify(BASE_META)]]);
    setMeetingsWorkspaceService(makeWorkspace(files));

    await useMeetingStore.getState().startRecording('matter-1', {
      consentMode: 'two-party',
    });

    const saved = JSON.parse(files.get(MEETING_JSON) ?? '{}') as MeetingMeta;
    expect(saved).not.toHaveProperty('calendarEvent');
    expect(saved).not.toHaveProperty('calendarTitle');
  });
});
