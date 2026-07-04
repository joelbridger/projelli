// src/platform/browserGuard/useTabWriteGuard.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SK_TAB_LOCK } from '@/config/identity';
import { useTabWriteGuard, __resetTabWriteGuardForTests } from './useTabWriteGuard';

describe('useTabWriteGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    __resetTabWriteGuardForTests();
  });

  it('is a permanent no-op reporting "owner" when disabled (desktop/Tauri, test mode)', () => {
    const { result } = renderHook(() => useTabWriteGuard(false));
    expect(result.current.status).toBe('owner');
    expect(localStorage.getItem(SK_TAB_LOCK)).toBeNull();
  });

  it('claims ownership and writes the lock when enabled with no existing holder', () => {
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('owner');
    expect(localStorage.getItem(SK_TAB_LOCK)).not.toBeNull();
  });

  it('reports "blocked" when another (fresh) tab already holds the lock', () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('blocked');
  });

  it('requestTakeover flips this tab to "owner" even over an existing fresh foreign lock', () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('blocked');

    act(() => {
      result.current.requestTakeover();
    });

    expect(result.current.status).toBe('owner');
    const stored = JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string };
    expect(stored.tabId).not.toBe('some-other-tab');
  });
});
