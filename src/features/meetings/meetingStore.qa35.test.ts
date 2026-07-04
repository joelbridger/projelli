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

import { useMeetingStore } from './meetingStore';

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

  it('resets status.recording to false on ANY capture_stop failure, not just disk-full ones', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'capture_stop') return Promise.reject(new Error('not recording'));
      return Promise.resolve(null);
    });

    await useMeetingStore.getState().stopRecording();

    expect(useMeetingStore.getState().status.recording).toBe(false);
  });
});
