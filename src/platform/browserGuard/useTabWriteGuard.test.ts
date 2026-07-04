// src/platform/browserGuard/useTabWriteGuard.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SK_TAB_LOCK } from '@/config/identity';
import { useTabWriteGuard, __resetTabWriteGuardForTests, __forkTabWriteGuardForTests } from './useTabWriteGuard';

describe('useTabWriteGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

  it('does NOT release the lock on a bfcache pagehide (event.persisted), only on a real close', () => {
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('owner');

    const bfcacheEvent = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(bfcacheEvent, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(bfcacheEvent);
    });

    // Still holds the lock — a bfcache freeze isn't a close.
    expect(localStorage.getItem(SK_TAB_LOCK)).not.toBeNull();

    const realCloseEvent = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(realCloseEvent, 'persisted', { value: false });
    act(() => {
      window.dispatchEvent(realCloseEvent);
    });

    expect(localStorage.getItem(SK_TAB_LOCK)).toBeNull();
  });

  it('re-checks the lock on a bfcache pageshow restore, stepping down if another tab took over while frozen', () => {
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('owner');

    // Simulate another tab claiming the lock while this one was frozen in bfcache.
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'took-over-while-frozen', heartbeatAt: Date.now() }),
    );

    const restoreEvent = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restoreEvent, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(restoreEvent);
    });

    expect(result.current.status).toBe('blocked');
  });

  it('requestTakeover survives its own reload-triggered pagehide (regression: reload() fires a non-persisted pagehide on this tab BEFORE navigating away, which used to release the lock this call just claimed)', () => {
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

    // Simulate the non-persisted pagehide that a real window.location.reload()
    // fires on this same tab before the new document actually loads.
    const reloadPagehide = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(reloadPagehide, 'persisted', { value: false });
    act(() => {
      window.dispatchEvent(reloadPagehide);
    });

    // Must still hold the lock — releasing here would let another tab's
    // heartbeat reclaim it in the gap before the reloaded page remounts,
    // so the reloaded tab would come back seeing its own takeover as a
    // foreign lock and gate itself again.
    expect(localStorage.getItem(SK_TAB_LOCK)).not.toBeNull();
    const stored = JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string };
    expect(stored.tabId).not.toBe('some-other-tab');
  });

  it('a real reload after requestTakeover reclaims the same lock via the one-shot handoff', () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const first = renderHook(() => useTabWriteGuard(true));
    act(() => {
      first.result.current.requestTakeover();
    });
    const claimedTabId = (JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string }).tabId;
    expect(sessionStorage.getItem('lantern:tab-takeover-handoff')).toBe(claimedTabId);

    // Simulate the reload: the module singleton resets (fresh JS realm), but
    // localStorage AND sessionStorage survive a reload of the same tab — so
    // fork (not reset, which would release the lock as if the tab closed).
    first.unmount();
    __forkTabWriteGuardForTests();

    const second = renderHook(() => useTabWriteGuard(true));

    // Reclaims ownership under the SAME tabId (not blocked by its own lock),
    // and the one-shot handoff key is consumed (gone) so it can't leak to a
    // tab duplicated later.
    expect(second.result.current.status).toBe('owner');
    const afterReload = JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string };
    expect(afterReload.tabId).toBe(claimedTabId);
    expect(sessionStorage.getItem('lantern:tab-takeover-handoff')).toBeNull();
  });

  it('regression (codex-review P1, round 3): duplicating a tab does not silently share write ownership', () => {
    // A duplicated tab copies sessionStorage AS-IS. Under normal operation
    // (not mid-takeover) the one-shot handoff key is absent, so this models
    // that faithfully: two independent guards with nothing in sessionStorage
    // must NOT end up agreeing on the same tabId (which is what would let
    // both believe they own an existing lock).
    const tabA = renderHook(() => useTabWriteGuard(true));
    expect(tabA.result.current.status).toBe('owner');
    const lockTabId = (JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string }).tabId;

    // "Duplicate" tab A into tab B: independent guard instance, same
    // (still-empty) sessionStorage, same shared localStorage lock. Tab A
    // is modeled as still alive (a real duplicate doesn't close the source
    // tab), so fork rather than reset.
    __forkTabWriteGuardForTests();
    const tabB = renderHook(() => useTabWriteGuard(true));

    // Tab B must NOT recognize tab A's lock as its own — it should be
    // blocked, not a second silent owner.
    expect(tabB.result.current.status).toBe('blocked');
    const lockStillTabA = (JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string }).tabId;
    expect(lockStillTabA).toBe(lockTabId);
  });
});
