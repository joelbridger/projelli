import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from './liveRecords';

const boundary = vi.hoisted(() => ({
  mode: 'matter-only' as 'matter-only' | 'full-pair' | 'all-matters' | 'blocked' | 'disagreement',
  saved: [] as LiveCrmRecord[],
  ensureRelay: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  publish: vi.fn<(record: LiveCrmRecord) => void>(),
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

const liveMatter = {
  id: 'local-a',
  name: 'Alpha',
  client: 'Alpha',
  folderPaths: ['/workspace/Alpha'],
  createdAt: '2026-07-18T00:00:00.000Z',
  shared: true,
  firmMatterId: 'firm-a',
};

function decision(operationClass: 'matter-scoped' | 'client-scoped') {
  switch (boundary.mode) {
    case 'matter-only':
      return operationClass === 'matter-scoped'
        ? { kind: 'matter' as const, sourceKind: 'matter-only' as const, matter: liveMatter, client: null }
        : { kind: 'refused' as const, reason: 'client-required' as const, message: 'This action needs a confirmed client.' };
    case 'full-pair':
      return {
        kind: 'matter' as const,
        sourceKind: 'matter' as const,
        matter: liveMatter,
        client: { provider: 'wealthbox' as const, householdId: 'household-a', displayName: 'Alpha' },
      };
    case 'all-matters':
      return operationClass === 'matter-scoped'
        ? { kind: 'all-matters' as const, client: null }
        : { kind: 'refused' as const, reason: 'client-required' as const, message: 'This action needs a confirmed client.' };
    case 'blocked':
      return { kind: 'refused' as const, reason: 'blocked-unresolved' as const, message: 'The selected client is still unresolved.' };
    case 'disagreement':
      return { kind: 'refused' as const, reason: 'follower-disagreement' as const, message: 'The client selection is still catching up.' };
  }
}

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: (request: { operationClass: 'matter-scoped' | 'client-scoped' }) =>
    decision(request.operationClass),
  readSelectionOperationDecision: (request: { operationClass: 'matter-scoped' | 'client-scoped' }) =>
    decision(request.operationClass),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: (...args: unknown[]) => boundary.ensureRelay(...args),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: (record: LiveCrmRecord) => {
    boundary.publish(record);
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));

import { useLiveCrmRecords } from './useLiveCrmRecords';

function record(matterId?: string): LiveCrmRecord {
  return {
    id: 'task-a',
    kind: 'task',
    ...(matterId ? { matterId } : {}),
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

describe('useLiveCrmRecords authoritative selection', () => {
  beforeEach(() => {
    boundary.mode = 'matter-only';
    boundary.saved = [];
    boundary.ensureRelay.mockReset().mockResolvedValue(null);
    boundary.publish.mockReset();
    boundary.invoke.mockReset().mockImplementation((command: string, args?: { record?: LiveCrmRecord }) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(boundary.saved));
      if (command === 'crm_live_upsert' && args?.record) {
        boundary.saved = [structuredClone(args.record)];
        return Promise.resolve(structuredClone(args.record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  it('lets matter-only save an explicitly matter-owned record but refuses client-derived firm routing and relay', async () => {
    const { result } = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(boundary.invoke).toHaveBeenCalledWith('crm_live_list', undefined);
    });

    await act(async () => {
      await result.current.save(record('local-a'));
    });
    expect(boundary.saved[0]).toMatchObject({ matterId: 'local-a' });
    await expect(result.current.save(record('firm'))).rejects.toThrow('confirmed client');
    expect(result.current.sharedMatterId).toBeNull();
    expect(boundary.ensureRelay).not.toHaveBeenCalled();
  });

  it('uses a full client pair for firm delivery and relay', async () => {
    boundary.mode = 'full-pair';
    const { result } = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(boundary.ensureRelay).toHaveBeenCalledWith('firm-a', expect.any(Function));
    });

    await act(async () => {
      await result.current.save(record('firm'));
    });
    expect(boundary.saved[0]).toMatchObject({ matterId: 'firm-a' });
    expect(result.current.sharedMatterId).toBe('firm-a');
  });

  it('preserves an explicit all-matters save without inventing a client relay', async () => {
    boundary.mode = 'all-matters';
    const { result } = renderHook(() => useLiveCrmRecords());

    await act(async () => {
      await result.current.save(record('firm'));
    });

    expect(boundary.saved[0]).toMatchObject({ matterId: 'firm' });
    expect(result.current.sharedMatterId).toBeNull();
    expect(boundary.ensureRelay).not.toHaveBeenCalled();
  });

  it('refuses and surfaces blocked selection before any CRM mutation', async () => {
    boundary.mode = 'blocked';
    const { result } = renderHook(() => useLiveCrmRecords());
    await expect(result.current.save(record('local-a'))).rejects.toThrow('still unresolved');
    expect(boundary.saved).toEqual([]);
    expect(boundary.publish).not.toHaveBeenCalled();
  });

  it('refuses forced source/follower disagreement before CRM relay or mutation', async () => {
    boundary.mode = 'disagreement';
    const { result } = renderHook(() => useLiveCrmRecords());

    await expect(result.current.save(record('local-a'))).rejects.toThrow('still catching up');
    expect(result.current.sharedMatterId).toBeNull();
    expect(boundary.ensureRelay).not.toHaveBeenCalled();
    expect(boundary.saved).toEqual([]);
  });
});
