import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withMeetingNotesTimeout,
  MeetingNotesTimeoutError,
  isMeetingNotesTimeoutError,
  MEETING_NOTES_TIMEOUT_MS,
} from '@/features/meetings/meetingNotesTimeout';

describe('withMeetingNotesTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with MeetingNotesTimeoutError when the provider call never settles (the hang)', async () => {
    // QA-31 repro: provider.sendMessage never resolves (dead network, stalled
    // proxy, model stuck loading) — before the fix this hung tryGenerateNotes
    // forever, which meant meetingStore's finally() that clears processingCount
    // never ran either.
    const neverSettles = (_signal: AbortSignal) =>
      new Promise<string>(() => {
        /* intentionally never resolves */
      });

    const raced = withMeetingNotesTimeout(neverSettles, MEETING_NOTES_TIMEOUT_MS);
    const assertion = expect(raced).rejects.toMatchObject({ name: 'MeetingNotesTimeoutError' });

    await vi.advanceTimersByTimeAsync(MEETING_NOTES_TIMEOUT_MS + 1);
    await assertion;
  });

  it('still rejects with MeetingNotesTimeoutError (not a generic AbortError) when the runner reacts to abort() by rejecting immediately (codex-review)', async () => {
    // An abort-aware provider (like ClaudeProvider, whose fetch is wired to
    // this same signal) rejects the instant abort() fires. If that beat our
    // own MeetingNotesTimeoutError in the Promise.race, the persisted
    // notesError.kind would silently downgrade from 'timeout' to 'error'.
    const abortAwareHang = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new DOMException('The operation was aborted', 'AbortError')); });
      });

    const raced = withMeetingNotesTimeout(abortAwareHang, MEETING_NOTES_TIMEOUT_MS);
    const assertion = expect(raced).rejects.toMatchObject({ name: 'MeetingNotesTimeoutError' });

    await vi.advanceTimersByTimeAsync(MEETING_NOTES_TIMEOUT_MS + 1);
    await assertion;
  });

  it('aborts the signal passed to the runner when it times out', async () => {
    let sawSignal: AbortSignal | undefined;
    const hang = (signal: AbortSignal) => {
      sawSignal = signal;
      return new Promise<string>(() => {});
    };
    const raced = withMeetingNotesTimeout(hang, MEETING_NOTES_TIMEOUT_MS);
    const assertion = expect(raced).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(MEETING_NOTES_TIMEOUT_MS + 1);
    await assertion;
    expect(sawSignal?.aborted).toBe(true);
  });

  it('passes a value through untouched when it settles in time', async () => {
    await expect(
      withMeetingNotesTimeout(() => Promise.resolve('notes markdown'), MEETING_NOTES_TIMEOUT_MS),
    ).resolves.toBe('notes markdown');
  });

  it('propagates the underlying rejection (not a timeout) when the provider fails fast', async () => {
    await expect(
      withMeetingNotesTimeout(() => Promise.reject(new Error('provider exploded')), MEETING_NOTES_TIMEOUT_MS),
    ).rejects.toThrow('provider exploded');
  });

  it('clears the timer once settled so no dangling timeout remains', async () => {
    await withMeetingNotesTimeout(() => Promise.resolve('ok'), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isMeetingNotesTimeoutError recognizes the error type and rejects non-timeouts', () => {
    expect(isMeetingNotesTimeoutError(new MeetingNotesTimeoutError(1000))).toBe(true);
    expect(isMeetingNotesTimeoutError(new Error('nope'))).toBe(false);
    expect(isMeetingNotesTimeoutError(null)).toBe(false);
  });
});
