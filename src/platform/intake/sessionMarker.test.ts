import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOrCreateSessionMarker } from '../../../intake-page/src/sessionMarker';

describe('getOrCreateSessionMarker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a valid in-memory marker when browser storage cannot be read or written', () => {
    const storageError = new DOMException('Browser storage is unavailable.', 'SecurityError');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw storageError;
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw storageError;
    });
    const readBlockedIntakeId = `blocked-read-${crypto.randomUUID()}`;

    const firstReadBlocked = getOrCreateSessionMarker(readBlockedIntakeId);
    const secondReadBlocked = getOrCreateSessionMarker(readBlockedIntakeId);

    expect(firstReadBlocked).toMatch(/^[a-f0-9-]{32,}$/iu);
    expect(secondReadBlocked).toBe(firstReadBlocked);
    // The in-memory map (populated on the first call) is checked before
    // localStorage, so the second call for the same intakeId never touches
    // storage at all - only the first call reads or writes it.
    expect(getItem).toHaveBeenCalledTimes(1);
    // Read and write failures are handled independently: a broken getItem
    // does not skip the setItem attempt, since real browsers can fail one
    // without the other.
    expect(setItem).toHaveBeenCalledTimes(1);

    getItem.mockReturnValue(null);
    const writeBlockedIntakeId = `blocked-write-${crypto.randomUUID()}`;
    const firstWriteBlocked = getOrCreateSessionMarker(writeBlockedIntakeId);
    const secondWriteBlocked = getOrCreateSessionMarker(writeBlockedIntakeId);

    expect(firstWriteBlocked).toMatch(/^[a-f0-9-]{32,}$/iu);
    expect(secondWriteBlocked).toBe(firstWriteBlocked);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('is single-flight: concurrent-looking calls for the same intake id never mint two markers', () => {
    // Regression for a bug where two `boot()` calls (e.g. React StrictMode's
    // dev-only double-invoked effects, each racing real async WebCrypto work
    // before reaching this function) could both see localStorage empty and
    // mint different markers for what is really one browser, which the
    // advisor's desktop then flagged as a second device.
    const intakeId = `race-${crypto.randomUUID()}`;
    const markers = Array.from({ length: 20 }, () => getOrCreateSessionMarker(intakeId));
    expect(new Set(markers).size).toBe(1);
  });

  it('pins to the first decision even if localStorage is overwritten out from under it', () => {
    const intakeId = `pinned-${crypto.randomUUID()}`;
    const first = getOrCreateSessionMarker(intakeId);

    // Simulate a second boot() call's earlier localStorage.setItem (or any
    // other same-origin write) landing between two calls for this module.
    window.localStorage.setItem(`lantern.intake.session.${intakeId}`, 'a-different-marker');

    const second = getOrCreateSessionMarker(intakeId);
    expect(second).toBe(first);
    expect(second).not.toBe('a-different-marker');
  });

  it('picks up a marker already persisted from an earlier page load', () => {
    const intakeId = `resumed-${crypto.randomUUID()}`;
    window.localStorage.setItem(`lantern.intake.session.${intakeId}`, 'from-a-prior-visit');

    expect(getOrCreateSessionMarker(intakeId)).toBe('from-a-prior-visit');
  });
});
