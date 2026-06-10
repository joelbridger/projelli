/**
 * matterSyncStore — unit tests.
 *
 * Covers:
 *   - setStatus / clear / clearMatter transitions
 *   - useMatterSyncStatus returns 'idle' for unknown matterId
 *   - getMatterSyncStatus non-reactive accessor
 *   - clear() resets everything
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useMatterSyncStore,
  getMatterSyncStatus,
} from '@/stores/matterSyncStore';
import type { MatterSyncStatus } from '@/stores/matterSyncStore';

function resetStore() {
  useMatterSyncStore.setState({ statusByMatterId: {} });
}

describe('matterSyncStore', () => {
  beforeEach(resetStore);

  it('returns idle for an unknown matter', () => {
    expect(getMatterSyncStatus('unknown-matter')).toBe('idle');
  });

  it('setStatus stores the status for a matter', () => {
    useMatterSyncStore.getState().setStatus('m-1', 'connecting');
    expect(getMatterSyncStatus('m-1')).toBe('connecting');
  });

  it('setStatus transitions through all statuses', () => {
    const statuses: MatterSyncStatus[] = [
      'idle',
      'connecting',
      'catching-up',
      'live',
      'offline',
      'error',
    ];
    for (const s of statuses) {
      useMatterSyncStore.getState().setStatus('m-1', s);
      expect(getMatterSyncStatus('m-1')).toBe(s);
    }
  });

  it('setStatus for multiple matters is independent', () => {
    useMatterSyncStore.getState().setStatus('m-1', 'live');
    useMatterSyncStore.getState().setStatus('m-2', 'error');
    useMatterSyncStore.getState().setStatus('m-3', 'offline');
    expect(getMatterSyncStatus('m-1')).toBe('live');
    expect(getMatterSyncStatus('m-2')).toBe('error');
    expect(getMatterSyncStatus('m-3')).toBe('offline');
  });

  it('clearMatter removes only the specified matter', () => {
    useMatterSyncStore.getState().setStatus('m-1', 'live');
    useMatterSyncStore.getState().setStatus('m-2', 'error');
    useMatterSyncStore.getState().clearMatter('m-1');
    expect(getMatterSyncStatus('m-1')).toBe('idle');
    expect(getMatterSyncStatus('m-2')).toBe('error');
  });

  it('clear() resets all statuses', () => {
    useMatterSyncStore.getState().setStatus('m-1', 'live');
    useMatterSyncStore.getState().setStatus('m-2', 'connecting');
    useMatterSyncStore.getState().setStatus('m-3', 'error');
    useMatterSyncStore.getState().clear();
    expect(getMatterSyncStatus('m-1')).toBe('idle');
    expect(getMatterSyncStatus('m-2')).toBe('idle');
    expect(getMatterSyncStatus('m-3')).toBe('idle');
    expect(useMatterSyncStore.getState().statusByMatterId).toEqual({});
  });

  it('statusByMatterId reflects all set statuses', () => {
    useMatterSyncStore.getState().setStatus('a', 'live');
    useMatterSyncStore.getState().setStatus('b', 'offline');
    const state = useMatterSyncStore.getState().statusByMatterId;
    expect(state).toMatchObject({ a: 'live', b: 'offline' });
  });
});
