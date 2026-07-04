import { describe, it, expect, beforeEach } from 'vitest';
import { useRetentionPolicyStore, sanitizePolicy, DEFAULT_RETENTION_POLICY } from './retentionPolicyStore';

beforeEach(() => {
  useRetentionPolicyStore.setState({ policies: {}, lastSweep: {}, pendingRagCleanup: {} });
});

describe('sanitizePolicy', () => {
  it('coerces garbage to the data-safe default (delete nothing)', () => {
    expect(sanitizePolicy(null)).toEqual(DEFAULT_RETENTION_POLICY);
    expect(sanitizePolicy({ mode: 'nuke-it-all', audioRetentionDays: 5 })).toEqual(DEFAULT_RETENTION_POLICY);
    expect(sanitizePolicy({ mode: 'delete-audio-after-days', audioRetentionDays: -3 }).audioRetentionDays).toBe(1);
    expect(sanitizePolicy({ mode: 'delete-audio-after-days', audioRetentionDays: 99999 }).audioRetentionDays).toBe(3650);
    expect(sanitizePolicy({ mode: 'summary-only', audioRetentionDays: 30 }).mode).toBe('summary-only');
  });
});

describe('useRetentionPolicyStore', () => {
  it('defaults to keep-everything per workspace and round-trips set/get', () => {
    const s = useRetentionPolicyStore.getState();
    expect(s.getPolicy('/ws-a')).toEqual(DEFAULT_RETENTION_POLICY);
    s.setPolicy('/ws-a', { mode: 'delete-audio-after-days', audioRetentionDays: 14 });
    expect(useRetentionPolicyStore.getState().getPolicy('/ws-a').audioRetentionDays).toBe(14);
    expect(useRetentionPolicyStore.getState().getPolicy('/ws-b')).toEqual(DEFAULT_RETENTION_POLICY);
  });
  it('records the last sweep per workspace', () => {
    useRetentionPolicyStore.getState().recordSweep('/ws-a', { sweptAt: 't1', deletedCount: 3, errors: [] });
    expect(useRetentionPolicyStore.getState().lastSweep['/ws-a']?.deletedCount).toBe(3);
  });
  it('tracks pending RAG cleanup ids per workspace so a crash mid-cleanup is recoverable', () => {
    useRetentionPolicyStore.getState().setPendingRagCleanup('/ws-a', ['meeting:/x#0', 'meeting:/x#400000']);
    expect(useRetentionPolicyStore.getState().pendingRagCleanup['/ws-a']).toEqual(['meeting:/x#0', 'meeting:/x#400000']);
    useRetentionPolicyStore.getState().clearPendingRagCleanupId('/ws-a', 'meeting:/x#0');
    expect(useRetentionPolicyStore.getState().pendingRagCleanup['/ws-a']).toEqual(['meeting:/x#400000']);
  });
});
