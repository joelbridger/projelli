// src/platform/browserGuard/tabLockGuard.test.ts
import { describe, it, expect } from 'vitest';
import { createTabGuard } from './tabLockGuard';
import { WebLocksTabGuard, type LockManagerLike, type LockGrantedCallback, type LockRequestOptions } from './webLocksTabGuard';
import { TabWriteGuard } from './tabWriteGuard';

class FakeLockManager implements LockManagerLike {
  request(
    _name: string,
    optionsOrCallback: LockRequestOptions | LockGrantedCallback,
    maybeCallback?: LockGrantedCallback,
  ): Promise<unknown> {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as LockGrantedCallback;
    return Promise.resolve(callback({}));
  }
}

describe('createTabGuard', () => {
  it('picks WebLocksTabGuard when a lock manager is available', () => {
    const guard = createTabGuard('test:key', { locks: new FakeLockManager() });
    expect(guard).toBeInstanceOf(WebLocksTabGuard);
    guard.stop();
  });

  it('falls back to TabWriteGuard (heartbeat) when no lock manager is available', () => {
    // jsdom (this project's unit-test environment) has no navigator.locks,
    // and no `locks` option is injected here -- the real-world fallback path
    // for browsers without the Web Locks API.
    const guard = createTabGuard('test:key');
    expect(guard).toBeInstanceOf(TabWriteGuard);
    guard.stop();
  });

  it('passes tabId through to whichever substrate is selected', () => {
    const webLocksGuard = createTabGuard('test:key', { locks: new FakeLockManager(), tabId: 'fixed-id' });
    expect(webLocksGuard.tabId).toBe('fixed-id');
    webLocksGuard.stop();

    const heartbeatGuard = createTabGuard('test:key', { tabId: 'fixed-id-2' });
    expect(heartbeatGuard.tabId).toBe('fixed-id-2');
    heartbeatGuard.stop();
  });
});
