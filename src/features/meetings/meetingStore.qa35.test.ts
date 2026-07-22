/**
 * QA-35 — "recording keeps counting at zero disk free, Stop doesn't respond."
 *
 * Root-caused to two frontend bugs (the Rust side already handles a real
 * chunk-write failure correctly — see src-tauri/tests/capture_enospc.rs):
 *
 * 1. `tick()` used to be a pure client-side clock, completely disconnected
 *    from the backend — it never called `capture_status`, so a real
 *    `writeError` the Rust side already knew about was invisible to the UI.
 * 2. `stopRecording()` had no try/catch around `invoke('capture_stop')`. That
 *    call legitimately REJECTS whenever a chunk write failed during the
 *    recording (Rust's CaptureEngine::stop bails on a recorded write_error
 *    even after successfully finalizing whatever partial audio DID make it
 *    to disk) — and the old code's `set({ status: { recording: false, ... }
 *    })` sat AFTER that await, so the reject skipped it entirely, leaving
 *    the pill stuck showing "Recording" forever with a dead Stop button.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => false }));

import {
  useMeetingStore,
  checkLowDiskSpaceWarning,
  setMeetingsWorkspaceService,
} from './meetingStore';
import { needsReview } from './insights/review/meetingReviewArtifactStore';
import type { MeetingSummary } from './ClientMeetingsTab';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

const RECORDING_STATUS = {
  status: { recording: true, meetingDir: '/ws/Clients/Acme/Meetings/m1', elapsedMs: 5000, writeError: null },
  processingCount: 0,
  activeMatterId: 'm1',
  activeConsent: { consentMode: 'two-party' as const },
  lastWriteFailure: null,
};

beforeEach(() => {
  invokeMock.mockReset();
  useMeetingStore.setState(RECORDING_STATUS);
  let meetingJson = JSON.stringify({
    matterId: 'm1',
    startedAt: '2026-07-04T10:00:00Z',
    consent: {
      mode: 'two-party',
      confirmedBy: 'user',
      confirmedAt: '2026-07-04T10:00:00Z',
    },
    meetingFileVisibility: {
      version: 1,
      meetingSubject: {
        id: 'qa35-legacy-meeting',
        kind: 'meeting-note',
        lineage: 'legacy-unrestricted',
      },
      files: Object.fromEntries(
        ['meeting.json', 'audio.wav', 'transcript.json', 'notes.docx'].map(
          (fileName) => [
            fileName,
            {
              id: `qa35-legacy-meeting:${fileName}`,
              kind: 'file-reference',
              lineage: 'legacy-unrestricted',
            },
          ]
        )
      ),
    },
  });
  setMeetingsWorkspaceService({
    readFile: vi.fn(async (path: string) => {
      if (!path.endsWith('/meeting.json')) throw new Error('ENOENT');
      return meetingJson;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      if (path.endsWith('/meeting.json')) meetingJson = content;
    }),
    exists: vi.fn(async (path: string) => path.endsWith('/meeting.json')),
  } as never);
});

describe('useMeetingStore.tick — QA-35', () => {
  it('polls the REAL backend status instead of a local clock', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_status') {
        return Promise.resolve({
          recording: true,
          meetingDir: '/ws/Clients/Acme/Meetings/m1',
          elapsedMs: 42_000, // deliberately NOT 5000+1000 — proves this came from the backend
          writeError: null,
        });
      }
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().tick();

    expect(useMeetingStore.getState().status.elapsedMs).toBe(42_000);
  });

  it('auto-stops the recording within one tick when a chunk-write failure newly appears, and surfaces an honest lasting error', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_status') {
        return Promise.resolve({
          recording: true,
          meetingDir: '/ws/Clients/Acme/Meetings/m1',
          elapsedMs: 12_000,
          writeError: 'mic channel: No space left on device (os error 28)',
        });
      }
      if (cmd === 'capture_stop') {
        // Matches engine.rs's real bail! wording exactly — capture_stop
        // rejects whenever write_error was set, even though the partial
        // audio was already finalized successfully.
        return Promise.reject(
          new Error(
            'recording stopped, but part of the audio failed to save (mic channel: No space left ' +
              'on device (os error 28)); partial audio at /ws/Clients/Acme/Meetings/m1/audio.wav'
          )
        );
      }
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().tick();

    const state = useMeetingStore.getState();
    expect(state.status.recording).toBe(false);
    expect(state.lastWriteFailure).not.toBeNull();
    expect(state.lastWriteFailure?.message).toMatch(/disk is full/i);
    expect(invokeMock).toHaveBeenCalledWith('capture_stop', {});
  });

  it('does not stop again on a later tick once the same failure is already known', async () => {
    // Recording already carries the write error from a previous tick (not a
    // NEW one this call) — must not call capture_stop a second time.
    useMeetingStore.setState({
      status: { recording: true, meetingDir: '/ws/Clients/Acme/Meetings/m1', elapsedMs: 12_000, writeError: 'mic channel: No space left on device (os error 28)' },
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_status') {
        return Promise.resolve({
          recording: true,
          meetingDir: '/ws/Clients/Acme/Meetings/m1',
          elapsedMs: 13_000,
          writeError: 'mic channel: No space left on device (os error 28)',
        });
      }
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().tick();

    expect(invokeMock).not.toHaveBeenCalledWith('capture_stop', {});
    expect(useMeetingStore.getState().status.recording).toBe(true);
  });

  it('leaves the recording running on a transient capture_status bridge failure', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_status') return Promise.reject(new Error('bridge hiccup'));
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().tick();

    expect(useMeetingStore.getState().status.recording).toBe(true);
    expect(useMeetingStore.getState().status.elapsedMs).toBe(5000); // unchanged
  });
});

describe('useMeetingStore.stopRecording — QA-35 regression', () => {
  it('still resets status.recording to false when capture_stop itself rejects (previously left the pill stuck forever)', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') {
        return Promise.reject(
          new Error(
            'recording stopped, but part of the audio failed to save (mic channel: No space left ' +
              'on device (os error 28)); partial audio at /ws/Clients/Acme/Meetings/m1/audio.wav'
          )
        );
      }
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().stopRecording();

    const state = useMeetingStore.getState();
    expect(state.status.recording).toBe(false);
    expect(state.status.meetingDir).toBeNull();
    expect(state.activeMatterId).toBeNull();
    expect(state.lastWriteFailure).not.toBeNull();
  });

  it('resets status.recording to false on ANY genuine capture_stop failure, not just disk-full ones', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') return Promise.reject(new Error('some other unexpected stop failure'));
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().stopRecording();

    expect(useMeetingStore.getState().status.recording).toBe(false);
  });
});

describe('useMeetingStore.stopRecording — QA-35 review round 2', () => {
  it('double-clicking Stop only calls capture_stop once, and clears any stale disk-full pill on a clean stop', async () => {
    useMeetingStore.setState({
      lastWriteFailure: { message: 'stale from a previous meeting', at: '2026-07-04T09:00:00Z' },
    });
    let captureStopCalls = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') {
        captureStopCalls += 1;
        return Promise.resolve({
          meetingDir: '/ws/Clients/Acme/Meetings/m1',
          audioPath: '/ws/Clients/Acme/Meetings/m1/audio.wav',
          durationMs: 60_000,
        });
      }
      return Promise.resolve(null);
    });

    // Two calls fired back to back, exactly like a double-clicked Stop button.
    const [p1, p2] = [useMeetingStore.getState().stopRecording(), useMeetingStore.getState().stopRecording()];
    await Promise.all([p1, p2]);

    expect(captureStopCalls).toBe(1);
    const state = useMeetingStore.getState();
    expect(state.status.recording).toBe(false);
    expect(state.lastWriteFailure).toBeNull();
  });

  it('a benign "not recording" rejection (nothing left for this call to stop) never shows the disk-full pill', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') return Promise.reject(new Error('not recording'));
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().stopRecording();

    const state = useMeetingStore.getState();
    expect(state.status.recording).toBe(false);
    expect(state.lastWriteFailure).toBeNull();
  });

  it('a disk-full stop failure still runs the post-stop pipeline on the salvaged partial audio instead of leaving it stuck at eternal pending', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') {
        return Promise.reject(
          new Error(
            'recording stopped, but part of the audio failed to save (mic channel: No space left ' +
              'on device (os error 28)); partial audio at /ws/Clients/Acme/Meetings/m1/audio.wav'
          )
        );
      }
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().stopRecording();

    // transcribeMeetingSerialized -> runTranscribeMeeting really invokes this
    // Tauri command regardless of workspace state — proves the pipeline ran
    // rather than the old early `return` that skipped it entirely.
    expect(invokeMock).toHaveBeenCalledWith(
      'transcribe_meeting',
      expect.objectContaining({ meetingDir: '/ws/Clients/Acme/Meetings/m1' })
    );
  });

  it('a generic (non-disk-full) stop failure does NOT run the post-stop pipeline — there is no audio to transcribe', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') return Promise.reject(new Error('No space left on device (os error 28)'));
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().stopRecording();

    expect(invokeMock).not.toHaveBeenCalledWith('transcribe_meeting', expect.anything());
  });
});

function meetingWithRecordingError(hasAudio: boolean): MeetingSummary {
  return {
    dir: '/ws/Clients/Acme/Meetings/m1',
    folderName: 'm1',
    meta: {
      matterId: 'm1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      recordingError: { kind: hasAudio ? 'disk-full' : 'error', at: '2026-07-04T10:05:00Z', message: 'x' },
    },
    hasNotes: false,
    hasAudio,
    hasTranscript: false,
  };
}

describe('needsReview — QA-35 review round 2 (recording-incomplete)', () => {
  it('flags recording-incomplete when a recordingError left no salvaged audio at all', () => {
    const items = needsReview(meetingWithRecordingError(false), []);
    expect(items.some((i) => i.kind === 'recording-incomplete')).toBe(true);
  });

  it('does NOT flag recording-incomplete when the disk-full failure salvaged real audio (handled by the normal pipeline instead)', () => {
    const items = needsReview(meetingWithRecordingError(true), []);
    expect(items.some((i) => i.kind === 'recording-incomplete')).toBe(false);
  });

  it('does NOT flag recording-incomplete for a meeting with no recordingError at all', () => {
    const meeting: MeetingSummary = {
      dir: '/ws/Clients/Acme/Meetings/m1',
      folderName: 'm1',
      meta: {
        matterId: 'm1',
        startedAt: '2026-07-04T10:00:00Z',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      },
      hasNotes: false,
      hasAudio: false,
      hasTranscript: false,
    };
    const items = needsReview(meeting, []);
    expect(items.some((i) => i.kind === 'recording-incomplete')).toBe(false);
  });
});

describe('checkLowDiskSpaceWarning — QA-35 review round 3 (peak, not steady-state, disk usage)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ rootPath: '/ws' });
  });

  it('warns below 600MB free — sized off the ~128KB/s PEAK usage while finalize_session briefly holds both the raw .capture/ chunks AND the merged audio.wav on disk at once, not just the ~64KB/s steady-state chunk-write rate', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_free_disk_bytes') return Promise.resolve(400 * 1024 * 1024); // 400MiB
      return Promise.resolve(null);
    });

    // A prior version of this threshold (300MB, sized off the steady-state
    // 64KB/s chunk rate alone) would have shown NO warning at 400MB free —
    // exactly the under-warn qa5/coordinator flagged.
    await expect(checkLowDiskSpaceWarning()).resolves.toBe(true);
  });

  it('does not warn comfortably above 600MB free', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_free_disk_bytes') return Promise.resolve(2 * 1024 * 1024 * 1024); // 2GiB
      return Promise.resolve(null);
    });

    await expect(checkLowDiskSpaceWarning()).resolves.toBe(false);
  });
});
