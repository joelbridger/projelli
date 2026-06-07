/**
 * G5: useMailSync — subscribes to mail-sync-progress (always) and
 * mail-index-chunk (when onMailChunk is provided).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

import { listen } from '@tauri-apps/api/event';
import { useMailSync } from '@/hooks/useMailSync';

describe('useMailSync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('subscribes to mail-sync-progress on mount', async () => {
    renderHook(() => useMailSync({ onMailChunk: undefined }));
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith('mail-sync-progress', expect.any(Function));
  });

  it('subscribes to mail-index-chunk when onMailChunk provided', async () => {
    const onMailChunk = vi.fn();
    renderHook(() => useMailSync({ onMailChunk }));
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith('mail-index-chunk', expect.any(Function));
  });

  it('does NOT subscribe to mail-index-chunk when onMailChunk is absent', async () => {
    renderHook(() => useMailSync());
    await Promise.resolve();
    const calls = (listen as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    const chunkCalls = calls.filter(([event]) => event === 'mail-index-chunk');
    expect(chunkCalls).toHaveLength(0);
  });
});
