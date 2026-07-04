import { describe, it, expect, vi } from 'vitest';
import { raceDialogWithWatchdog } from './dialogWatchdog';

describe('raceDialogWithWatchdog', () => {
  it('resolves with the value when the dialog settles before the deadline', async () => {
    const result = await raceDialogWithWatchdog(Promise.resolve('/a/path'), 200);
    expect(result).toEqual({ timedOut: false, value: '/a/path' });
  });

  it('resolves with timedOut:true when the dialog never settles', async () => {
    vi.useFakeTimers();
    const pending = raceDialogWithWatchdog(new Promise(() => {}), 90_000);
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(pending).resolves.toEqual({ timedOut: true });
    vi.useRealTimers();
  });

  it('propagates a rejection from the dialog promise unchanged', async () => {
    const boom = new Error('picker unavailable');
    await expect(raceDialogWithWatchdog(Promise.reject(boom), 200)).rejects.toBe(boom);
  });

  it('ignores a late resolution after the watchdog already fired', async () => {
    vi.useFakeTimers();
    let resolveDialog: (v: string | null) => void = () => {};
    const dialogPromise = new Promise<string | null>((resolve) => { resolveDialog = resolve; });

    const pending = raceDialogWithWatchdog(dialogPromise, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ timedOut: true });

    // The real dialog "shows up late" — must not throw or affect anything.
    resolveDialog('/late/path');
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });
});
