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
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(setItem).not.toHaveBeenCalled();

    getItem.mockReturnValue(null);
    const writeBlockedIntakeId = `blocked-write-${crypto.randomUUID()}`;
    const firstWriteBlocked = getOrCreateSessionMarker(writeBlockedIntakeId);
    const secondWriteBlocked = getOrCreateSessionMarker(writeBlockedIntakeId);

    expect(firstWriteBlocked).toMatch(/^[a-f0-9-]{32,}$/iu);
    expect(secondWriteBlocked).toBe(firstWriteBlocked);
    expect(setItem).toHaveBeenCalledTimes(2);
  });
});
