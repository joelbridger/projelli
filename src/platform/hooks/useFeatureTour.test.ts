import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SK_SETTINGS } from '@/config/identity';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useFeatureTour } from './useFeatureTour';

describe('useFeatureTour', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      featuresTourCompleted: false,
      featuresTourSkippedThisSession: false,
    });
  });

  it('auto-shows on a fresh install', () => {
    const { result } = renderHook(() => useFeatureTour());
    expect(result.current.shouldAutoShow).toBe(true);
  });

  it('finishing the tour stops auto-show', () => {
    const { result } = renderHook(() => useFeatureTour());
    act(() => { result.current.complete(); });
    expect(result.current.shouldAutoShow).toBe(false);
    expect(useSettingsStore.getState().featuresTourCompleted).toBe(true);
  });

  it('skipping the tour also stops auto-show, not just for the current session', () => {
    const { result } = renderHook(() => useFeatureTour());
    act(() => { result.current.skipForNow(); });
    expect(result.current.shouldAutoShow).toBe(false);
    expect(useSettingsStore.getState().featuresTourCompleted).toBe(true);
  });

  it('a skip survives a simulated app restart (persisted flag, not session-only)', async () => {
    const { result } = renderHook(() => useFeatureTour());
    act(() => { result.current.skipForNow(); });

    // Simulate an app restart: fresh module graph re-reading localStorage,
    // the way a real relaunch rehydrates the persisted settings store. This
    // is the exact regression the bug report described — the tour used to
    // reappear on every subsequent launch after a skip.
    expect(localStorage.getItem(SK_SETTINGS)).not.toBeNull();
    vi.resetModules();
    const restarted = await import('@/platform/settings/settingsStore');
    expect(restarted.useSettingsStore.getState().featuresTourCompleted).toBe(true);
  });

  it('"Reset Feature Tour" (Settings) makes the tour auto-show again', () => {
    const { result } = renderHook(() => useFeatureTour());
    act(() => { result.current.skipForNow(); });
    expect(result.current.shouldAutoShow).toBe(false);

    act(() => { result.current.restart(); });
    expect(result.current.shouldAutoShow).toBe(true);
  });
});
