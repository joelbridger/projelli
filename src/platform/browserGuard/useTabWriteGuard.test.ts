// src/platform/browserGuard/useTabWriteGuard.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SK_TAB_LOCK } from '@/config/identity';
import { useEditorStore } from '@/platform/state/editorStore';
import {
  useTabWriteGuard,
  __resetTabWriteGuardForTests,
  __forkTabWriteGuardForTests,
  shouldReleaseOnPersistedFreeze,
} from './useTabWriteGuard';
import type { TabLockGuard } from './tabLockGuard';
import { WebLocksTabGuard, type LockGrantedCallback, type LockManagerLike, type LockRequestOptions } from './webLocksTabGuard';

/** Enough of the browser Web Locks API to give the hook a real
 * WebLocksTabGuard, including its held-lock lifecycle. */
class ImmediateLockManager implements LockManagerLike {
  request(
    _name: string,
    optionsOrCallback: LockRequestOptions | LockGrantedCallback,
    maybeCallback?: LockGrantedCallback,
  ): Promise<unknown> {
    const callback = (typeof optionsOrCallback === 'function'
      ? optionsOrCallback
      : maybeCallback) as LockGrantedCallback;
    return Promise.resolve().then(() => callback({}));
  }
}

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

  it('regression: replacing the flush callback does not restart a held Web Lock or mark false contention', async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: new ImmediateLockManager(),
    });
    const startSpy = vi.spyOn(WebLocksTabGuard.prototype, 'start');
    const stopSpy = vi.spyOn(WebLocksTabGuard.prototype, 'stop');
    const firstCallback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const replacementCallback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    try {
      const hook = renderHook(
        ({ onFlushRequested }) => useTabWriteGuard(true, { onFlushRequested }),
        { initialProps: { onFlushRequested: firstCallback } },
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(hook.result.current.status).toBe('owner');
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).not.toHaveBeenCalled();

      hook.rerender({ onFlushRequested: replacementCallback });

      // A changed callback must only update the responder ref. It must not
      // release/reacquire the lock (the old loop's false-contention path).
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).not.toHaveBeenCalled();
      const guard = startSpy.mock.instances[0] as WebLocksTabGuard;
      expect((guard as unknown as { contentionEverConfirmed: boolean }).contentionEverConfirmed).toBe(false);
    } finally {
      startSpy.mockRestore();
      stopSpy.mockRestore();
      if (originalLocks) {
        Object.defineProperty(navigator, 'locks', originalLocks);
      } else {
        Reflect.deleteProperty(navigator, 'locks');
      }
    }
  });

  it('reports "blocked" when another (fresh) tab already holds the lock', () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('blocked');
  });

  it('requestTakeover flips this tab to "owner" even over an existing fresh foreign lock', async () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('blocked');

    // requestTakeover is async: it first waits (briefly) for a flush-ack
    // from the current owner before actually claiming the lock (round 5
    // P1) — nobody is listening in this test, so it runs out the clock.
    vi.useFakeTimers();
    await act(async () => {
      result.current.requestTakeover();
      await vi.advanceTimersByTimeAsync(3000);
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

  it('requestTakeover survives its own reload-triggered pagehide (regression: reload() fires a non-persisted pagehide on this tab BEFORE navigating away, which used to release the lock this call just claimed)', async () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('blocked');

    vi.useFakeTimers();
    await act(async () => {
      result.current.requestTakeover();
      await vi.advanceTimersByTimeAsync(3000);
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

  it('a real reload after requestTakeover reclaims the same lock via the one-shot handoff', async () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'some-other-tab', heartbeatAt: Date.now() }),
    );
    const first = renderHook(() => useTabWriteGuard(true));
    vi.useFakeTimers();
    await act(async () => {
      first.result.current.requestTakeover();
      await vi.advanceTimersByTimeAsync(3000);
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

  it('regression (codex-review P1, round 5): an AUTOMATIC reclaim (owner closed/went stale, nobody clicked "take over") forces the same reload-before-write path as a manual takeover', () => {
    // This tab starts blocked behind a foreign lock.
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'the-old-owner', heartbeatAt: Date.now() }),
    );
    const { result } = renderHook(() => useTabWriteGuard(true));
    expect(result.current.status).toBe('blocked');

    // jsdom's window.location.reload is non-configurable, so it can't be
    // spied on directly — replace the whole `location` object (which IS
    // configurable at the `window` level) with one whose `reload` is a spy.
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    // Not a spread of `originalLocation` — it's a Location instance (native
    // getters/prototype methods), and spreading it would silently drop
    // those. This test only needs `reload` replaced; nothing here reads any
    // other location property.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: reloadSpy },
    });

    try {
      // The old owner closes (or goes stale) with no coordination at all —
      // release its lock, then let this tab notice via a `storage` event,
      // the same way a real blocked tab would.
      act(() => {
        localStorage.removeItem(SK_TAB_LOCK);
        window.dispatchEvent(new StorageEvent('storage', { key: SK_TAB_LOCK }));
      });

      expect(result.current.status).toBe('owner');
      // Without this fix, an automatic reclaim never reloaded — this tab
      // would mount AppShell straight onto whatever stale zustand snapshot
      // it hydrated back when it was still blocked. The forced reload is
      // what guarantees a fresh rehydrate before any write can happen.
      expect(reloadSpy).toHaveBeenCalled();
      // And it went through the SAME handoff path a manual takeover uses,
      // so the reloaded page recognizes this exact lock as its own.
      const claimedTabId = (JSON.parse(localStorage.getItem(SK_TAB_LOCK) as string) as { tabId: string }).tabId;
      expect(sessionStorage.getItem('lantern:tab-takeover-handoff')).toBe(claimedTabId);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});

describe('shouldReleaseOnPersistedFreeze (coordinator finding: dirty-bfcache release)', () => {
  function makeFakeGuard(releaseOnFreeze: boolean): TabLockGuard {
    return {
      tabId: 'fake-tab',
      status: 'owner',
      start: () => {},
      stop: () => {},
      requestTakeover: () => {},
      yieldIfOwner: () => {},
      shouldRehydrateOnThisAcquisition: () => true,
      subscribe: () => () => {},
      checkNow: () => {},
      releaseOnFreeze: () => releaseOnFreeze,
    };
  }

  beforeEach(() => {
    useEditorStore.setState({ openTabs: [] });
  });

  it('is false for a substrate that never releases on freeze (heartbeat), regardless of dirty state', () => {
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(false))).toBe(false);

    useEditorStore.setState({ openTabs: [{ path: '/a', name: 'a', content: 'x', isDirty: true }] });
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(false))).toBe(false);
  });

  it('is true for a Web-Locks-style substrate (releaseOnFreeze() === true) with no dirty editor content', () => {
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(true))).toBe(true);

    useEditorStore.setState({ openTabs: [{ path: '/a', name: 'a', content: 'x', isDirty: false }] });
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(true))).toBe(true);
  });

  it('regression (coordinator finding): is false for a Web-Locks-style substrate with dirty editor content -- refuses the early release rather than risk another tab reading/writing before the pagehide flush lands', () => {
    useEditorStore.setState({ openTabs: [{ path: '/a', name: 'a', content: 'unsaved edits', isDirty: true }] });
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(true))).toBe(false);
  });

  it('is true again once ALL dirty tabs are saved (isDirty flips false) -- a single clean tab does not block release, but one dirty tab among several does', () => {
    useEditorStore.setState({
      openTabs: [
        { path: '/a', name: 'a', content: 'saved', isDirty: false },
        { path: '/b', name: 'b', content: 'saved', isDirty: false },
      ],
    });
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(true))).toBe(true);

    useEditorStore.setState({
      openTabs: [
        { path: '/a', name: 'a', content: 'saved', isDirty: false },
        { path: '/b', name: 'b', content: 'unsaved', isDirty: true },
      ],
    });
    expect(shouldReleaseOnPersistedFreeze(makeFakeGuard(true))).toBe(false);
  });
});
