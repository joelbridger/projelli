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

  it('calls the real transcribe_meeting with workspaceRoot + meetingDir + model', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 })
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const transcribeCall = invokeMock.mock.calls.find((c) => c[0] === 'transcribe_meeting');
    expect(transcribeCall?.[1]).toEqual({ workspaceRoot: '/ws', meetingDir: '/ws/C/Meetings/x', model: null });
  });

  it('skips transcribe_meeting in battery-saver (batch) mode', async () => {
    const { useSettingsStore } = await import('@/platform/settings/settingsStore');
    useSettingsStore.getState().setSetting('meetings.transcribeMode', 'batch');
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['capture_start', 'capture_stop']);
    useSettingsStore.getState().setSetting('meetings.transcribeMode', 'live');
  });

  it('extends the Rust-authored meeting.json rather than reconstructing/overwriting matterId/startedAt/consent', async () => {
    // Rust's finalize_session (session.rs's MeetingMeta) already wrote this
    // by the time capture_stop resolves — the REAL start time and consent,
    // not what a TS-side reconstruction from stop-time state would produce.
    const rustWritten = {
      matterId: 'm-1',
      startedAt: '2026-07-02T17:00:00Z', // the real recording start, not stop time
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-02T17:00:00Z', note: '' },
    };
    const readFileMock = vi.fn(async (p: string) => (p.endsWith('meeting.json') ? JSON.stringify(rustWritten) : ''));
    setMeetingsWorkspaceService({ writeFile: writeFileMock, readFile: readFileMock } as never);
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' })
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 })
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await useMeetingStore.getState().stopRecording();
    const metaWrite = writeFileMock.mock.calls.find((c) => (c[0] as string).endsWith('meeting.json'));
    const written = JSON.parse(metaWrite?.[1] as string) as typeof rustWritten;
    expect(written.startedAt).toBe('2026-07-02T17:00:00Z');
    expect(written.consent).toEqual(rustWritten.consent);
    expect(written.matterId).toBe('m-1');
  });

  // 2026-07-04 UX review S1 (coordinator codex pass): processing is a JOB
  // COUNT, not a shared boolean — meeting A's pipeline finishing must not
  // hide the "writing your notes" indicator while meeting B's is mid-write.
  it('keeps processingCount truthful across overlapping post-stop pipelines', async () => {
    const deferred: Array<(v: unknown) => void> = [];
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === 'capture_start') return Promise.resolve({ meetingDir: `/ws/C/Meetings/m${String(deferred.length)}`, startedAt: 't0' });
      if (cmd === 'capture_stop') return Promise.resolve({ meetingDir: `/ws/C/Meetings/m${String(deferred.length)}`, audioPath: 'a.wav', durationMs: 60000 });
      // transcribe_meeting: park each pipeline until the test releases it
      return new Promise((resolve) => deferred.push(resolve));
    });

    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    const p1 = useMeetingStore.getState().stopRecording();
    await vi.waitFor(() => { expect(useMeetingStore.getState().processingCount).toBe(1); });

    // Meeting B starts + stops while A's notes are still being written.
    await useMeetingStore.getState().startRecording('m-1', { consentMode: 'one-party' });
    const p2 = useMeetingStore.getState().stopRecording();
    await vi.waitFor(() => { expect(useMeetingStore.getState().processingCount).toBe(2); });

    // A finishes first — the indicator must STAY up for B.
    deferred[0]?.({ transcriptPath: 't.json', segmentCount: 1 });
    await p1;
    expect(useMeetingStore.getState().processingCount).toBe(1);

    deferred[1]?.({ transcriptPath: 't.json', segmentCount: 1 });
    await p2;
    expect(useMeetingStore.getState().processingCount).toBe(0);
  });

  it('refuses to start when already recording', async () => {
    invokeMock.mockResolvedValueOnce({ meetingDir: '/x', startedAt: 't0' });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await expect(
      useMeetingStore.getState().startRecording('m-2', { consentMode: 'one-party' }),
    ).rejects.toThrow(/already recording/i);
  });

  // QA-20b: when capture_start rejects (e.g. Rust's "no microphone device"
  // error from CpalSource::resolve_device), the rejection must propagate to
  // the caller — not be swallowed — so ClientMeetingsTab's catch can surface
  // it via ConsentDialog's inline error (2026-07-04 UX review, finding B6),
  // and the store must not be left in a half-recording state.
  it('surfaces a capture_start rejection (no microphone device) and leaves status untouched', async () => {
    invokeMock.mockRejectedValueOnce(new Error('no microphone device'));
    const s = useMeetingStore.getState();
    await expect(
      s.startRecording('m-1', { consentMode: 'one-party' }),
    ).rejects.toThrow(/no microphone device/i);
    const status = useMeetingStore.getState().status;
    expect(status.recording).toBe(false);
    expect(status.meetingDir).toBeNull();
    expect(useMeetingStore.getState().activeMatterId).toBeNull();
  });
});
