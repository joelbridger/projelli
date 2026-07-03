import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

import { runRetentionSweep } from './retentionRunner';
import { useRetentionPolicyStore } from './retentionPolicyStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

beforeEach(() => {
  invokeMock.mockReset();
  useRetentionPolicyStore.setState({ policies: {}, lastSweep: {}, pendingRagCleanup: {} });
  useMatterStore.setState({
    matters: [{ id: 'm1', name: 'n', client: 'H', folderPaths: ['/ws/Clients/Henderson'], createdAt: 't' } as unknown as Matter],
  });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'retention_sweep') {
      return Promise.resolve({ deleted: [{ path: '/x/audio.wav', kind: 'audio' }], keptMeetings: 1, skippedInFlight: 0, errors: [], ragCleanupSourceIds: ['meeting:/x#0', 'meeting:/x#400000'] });
    }
    if (cmd === 'retention_take_pending_rag_cleanup') return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

describe('runRetentionSweep', () => {
  it('invokes the sweep with the stored policy and cleans RAG docs for deleted transcripts', async () => {
    useRetentionPolicyStore.getState().setPolicy('/ws', { mode: 'summary-only', audioRetentionDays: 30 });
    const rec = await runRetentionSweep('/ws', { force: true });
    expect(rec?.deletedCount).toBe(1);
    const sweepCall = invokeMock.mock.calls.find(([c]) => c === 'retention_sweep');
    expect(sweepCall?.[1]).toMatchObject({ workspaceRoot: '/ws', mode: 'summary-only', matterFolders: ['Clients/Henderson'] });
    const ragCalls = invokeMock.mock.calls.filter(([c]) => c === 'rag_delete_path');
    expect(ragCalls.map(([, args]) => (args as { path: string }).path)).toEqual(['meeting:/x#0', 'meeting:/x#400000']);
    expect(useRetentionPolicyStore.getState().lastSweep['/ws']?.deletedCount).toBe(1);
  });
  it('debounces: skips when a sweep ran within 24h, unless forced', async () => {
    useRetentionPolicyStore.getState().recordSweep('/ws', { sweptAt: new Date().toISOString(), deletedCount: 0, errors: [] });
    expect(await runRetentionSweep('/ws')).toBeNull();
    expect(invokeMock.mock.calls.some(([c]) => c === 'retention_sweep')).toBe(false);
    await runRetentionSweep('/ws', { force: true });
    expect(invokeMock.mock.calls.some(([c]) => c === 'retention_sweep')).toBe(true);
  });
  it('retries RAG cleanup left over from a crashed previous run, even during a debounced skip', async () => {
    useRetentionPolicyStore.getState().recordSweep('/ws', { sweptAt: new Date().toISOString(), deletedCount: 1, errors: [] });
    useRetentionPolicyStore.getState().setPendingRagCleanup('/ws', ['meeting:/y#0']);
    const rec = await runRetentionSweep('/ws'); // debounced — no new sweep
    expect(rec).toBeNull();
    expect(invokeMock.mock.calls.some(([c]) => c === 'retention_sweep')).toBe(false);
    const ragCalls = invokeMock.mock.calls.filter(([c]) => c === 'rag_delete_path');
    expect(ragCalls.map(([, args]) => (args as { path: string }).path)).toEqual(['meeting:/y#0']);
    expect(useRetentionPolicyStore.getState().pendingRagCleanup['/ws']).toEqual([]);
  });
  it('persists the pending RAG cleanup list before attempting it, so a partial failure survives', async () => {
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'retention_sweep') {
        return Promise.resolve({ deleted: [], keptMeetings: 0, skippedInFlight: 0, errors: [], ragCleanupSourceIds: ['meeting:/x#0', 'meeting:/x#1'] });
      }
      if (cmd === 'rag_delete_path' && args?.['path'] === 'meeting:/x#1') return Promise.reject(new Error('lancedb unavailable'));
      if (cmd === 'retention_take_pending_rag_cleanup') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const rec = await runRetentionSweep('/ws', { force: true });
    expect(rec?.errors.some((e) => e.includes('meeting:/x#1'))).toBe(true);
    // The one that failed stays pending for the next run; the one that
    // succeeded is cleared.
    expect(useRetentionPolicyStore.getState().pendingRagCleanup['/ws']).toEqual(['meeting:/x#1']);
  });
  it('recovers RAG cleanup ids Rust durably wrote but the renderer never got to persist last time', async () => {
    // Simulates: a previous run's native delete succeeded and Rust wrote
    // PENDING_RAG_CLEANUP_FILE, but the renderer crashed before this file's
    // JS-side setPendingRagCleanup ever ran, so Zustand's pendingRagCleanup
    // for '/ws' is empty on this fresh launch.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'retention_take_pending_rag_cleanup') return Promise.resolve(['meeting:/z#0']);
      return Promise.resolve(undefined);
    });
    useRetentionPolicyStore.getState().recordSweep('/ws', { sweptAt: new Date().toISOString(), deletedCount: 0, errors: [] });
    await runRetentionSweep('/ws'); // debounced — no new native sweep needed to exercise recovery
    const ragCalls = invokeMock.mock.calls.filter(([c]) => c === 'rag_delete_path');
    expect(ragCalls.map(([, args]) => (args as { path: string }).path)).toEqual(['meeting:/z#0']);
    expect(useRetentionPolicyStore.getState().pendingRagCleanup['/ws']).toEqual([]);
  });
});
