import { describe, it, expect, vi, beforeEach } from 'vitest';
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

const writeFileMock = vi.fn(async () => {});

vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: {
    getState: () => ({
      matters: [{ id: 'm-1', folderPaths: ['/ws/Clients/Hendersons'] }],
    }),
  },
}));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ rootPath: '/ws' }) },
}));

import { useMeetingStore, setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';

describe('meeting store', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    writeFileMock.mockReset();
    useMeetingStore.setState(useMeetingStore.getInitialState());
    setMeetingsWorkspaceService({ writeFile: writeFileMock, readFile: vi.fn(async () => '') } as never);
  });

  it('start → stop drives capture commands and post-processing in order', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' }) // capture_start
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 }) // capture_stop
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 }); // transcribe_meeting
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    expect(useMeetingStore.getState().status.recording).toBe(true);
    await useMeetingStore.getState().stopRecording();
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['capture_start', 'capture_stop', 'transcribe_meeting']);
    expect(useMeetingStore.getState().status.recording).toBe(false);
  });

  it('does not double-log meeting_capture_started/meeting_recorded — Rust\'s capture_start/capture_stop already append them (append_capture_audit_best_effort)', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 })
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 });
    localStorage.removeItem('audit_log_meetings');
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const raw = localStorage.getItem('audit_log_meetings');
    const entries = raw ? (JSON.parse(raw) as { action: string }[]) : [];
    expect(entries.some((e) => e.action === 'meeting_capture_started')).toBe(false);
    expect(entries.some((e) => e.action === 'meeting_recorded')).toBe(false);
  });

  it('refuses to start when already recording', async () => {
    invokeMock.mockResolvedValueOnce({ meetingDir: '/x', startedAt: 't0' });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await expect(
      useMeetingStore.getState().startRecording('m-2', { consentMode: 'one-party' }),
    ).rejects.toThrow(/already recording/i);
  });
});
