/**
 * QA-93 stage B — the workspace-switch choke-point reloads per-workspace stores.
 *
 * `useWorkspaceLifecycle` subscribes to the workspace root and swaps the matter +
 * client-map stores whenever it changes. This proves that driving `setRootPath`
 * (the ONE action every open path — Open Existing, Recent Projects, boot
 * auto-resume — funnels through) actually swaps the visible clients, end to end
 * through the real subscription + rehydrate + one-time migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createRef } from 'react';

import { useWorkspaceLifecycle, type UseWorkspaceLifecycleOptions } from './useWorkspaceLifecycle';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  getCitationVerificationCacheSnapshotForTests,
  resetCitationVerificationForTests,
  useCitationVerification,
} from '@/features/ask/citationVerification';
import type { AnswerCitation } from '@/features/ask/askHelpers';
import type { ImportStatus } from '@/features/ask/useStillImporting';
import type { CitationVerdict } from '@/platform/utils/tauri-commands';
import {
  useMatterStore,
  getMatters,
  setMatterAuditEmitter,
  clearPendingMatterMigrationAudit,
} from '@/platform/matter/matterStore';
import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';

const { ragVerifyCitationsBatchMock, useStillImportingMock } = vi.hoisted(() => ({
  ragVerifyCitationsBatchMock: vi.fn(),
  useStillImportingMock: vi.fn<() => ImportStatus>(),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragVerifyCitationsBatch: (...args: unknown[]): unknown => ragVerifyCitationsBatchMock(...args),
  };
});

vi.mock('@/features/ask/useStillImporting', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/ask/useStillImporting')>();
  return { ...original, useStillImporting: (): ImportStatus => useStillImportingMock() };
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeOptions(): UseWorkspaceLifecycleOptions {
  return {
    workspaceServiceRef: createRef() as never,
    auditServiceRef: { current: { hydrate: vi.fn().mockResolvedValue(true), getAll: () => [], verifyIntegrity: vi.fn() } } as never,
    templatesMarketplaceServiceRef: createRef() as never,
    templatesMetadataReaderRef: createRef() as never,
    setShowWorkspaceSelector: vi.fn(),
    setAuditEntries: vi.fn(),
    setAuditIntegrity: vi.fn(),
    setRootPath: vi.fn(),
    loadTrashMetadata: vi.fn().mockResolvedValue([]),
    setTrashItems: vi.fn(),
    setTrashStats: vi.fn(),
    loadSourceCards: vi.fn().mockResolvedValue([]),
    setSourceCards: vi.fn(),
    loadChatFiles: vi.fn().mockResolvedValue([]),
    setChatFiles: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
  };
}

function makeWorkspaceService(root: string): never {
  return {
    getRootPath: () => root,
    getBackend: () => null,
    exists: () => Promise.resolve(true),
    mkdir: () => Promise.resolve(),
    getFileTree: () => Promise.resolve([]),
    readFile: () => Promise.resolve(''),
    readFileBinary: () => Promise.resolve(new Uint8Array()),
  } as never;
}

const baseMatter = {
  name: 'C', client: 'C', mailFolderPaths: [], crmHouseholdKeys: [], onedriveFolderKeys: [],
  boxFolderKeys: [], esignKeys: [], jotformKeys: [], sharefileFolderKeys: [], meetingKeys: [],
  zocksKeys: [], addeparKeys: [], privileged: false, mcpAccessGranted: false, shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  localStorage.clear();
  resetCitationVerificationForTests();
  ragVerifyCitationsBatchMock.mockReset();
  useStillImportingMock.mockReset().mockReturnValue('idle');
  setActiveWorkspaceScopeRoot(null);
  useWorkspaceStore.setState({ rootPath: null });
  useMatterStore.setState({ matters: [], activeMatterId: null, snapshots: {}, cache: {}, statusByMatterId: {} });
  clearPendingMatterMigrationAudit();
  setMatterAuditEmitter(null);
});
afterEach(() => {
  resetCitationVerificationForTests();
  setActiveWorkspaceScopeRoot(null);
  useWorkspaceStore.setState({ rootPath: null });
  clearPendingMatterMigrationAudit();
  setMatterAuditEmitter(null);
});

describe('QA-93 stage B — switching the workspace root swaps the visible matters', () => {
  it('driving setRootPath through the lifecycle subscription reloads matters for that workspace', () => {
    // Legacy global data with a matter in each of two workspaces.
    localStorage.setItem('lantern:matters', JSON.stringify({
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Acme'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Gamma'] },
        ],
        activeMatterId: null,
      },
      version: 10,
    }));

    const { unmount } = renderHook(() => useWorkspaceLifecycle(makeOptions()));

    // Open workspace A — only A's client is visible.
    act(() => { useWorkspaceStore.getState().setRootPath('/wsA'); });
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);

    // Switch to workspace B — the client list swaps, no bleed from A.
    act(() => { useWorkspaceStore.getState().setRootPath('/wsB'); });
    expect(getMatters().map((m) => m.id)).toEqual(['b1']);

    // Back to A — A's client again.
    act(() => { useWorkspaceStore.getState().setRootPath('/wsA'); });
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);

    unmount();
  });

  it('ROUND 3 (Codex F1): opening a workspace whose migration dropped relative mappings delivers the audit entry AFTER the open completes', async () => {
    // Legacy client with one proven mapping and one unproven (relative) one.
    localStorage.setItem('lantern:matters', JSON.stringify({
      state: {
        matters: [{ ...baseMatter, id: 'mix', name: 'Hendricks', folderPaths: ['Clients/Legacy', '/wsA/Acme'] }],
        activeMatterId: null,
      },
      version: 10,
    }));
    const emitted: string[] = [];
    setMatterAuditEmitter((entry) => { emitted.push(entry.description); });

    const options = makeOptions();
    // Wire the option through to the real store so the QA-93 subscription
    // (root change → scoped-store reload → migration) actually runs, exactly
    // like App.tsx wires it.
    options.setRootPath = (p: string) => { useWorkspaceStore.getState().setRootPath(p); };
    const { result, unmount } = renderHook(() => useWorkspaceLifecycle(options));

    await act(async () => {
      await result.current.handleWorkspaceSelected(makeWorkspaceService('/wsA'));
    });

    // The migration's dropped-mapping trail reached the live Activity Log.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('Hendricks');
    expect(emitted[0]).toContain('"Clients/Legacy"');

    unmount();
  });

  it('ROUND 4: keeps migration audit entries pending when audit hydrate does not reach the new workspace, then flushes later', async () => {
    localStorage.setItem('lantern:matters', JSON.stringify({
      state: {
        matters: [{ ...baseMatter, id: 'mix', name: 'Hendricks', folderPaths: ['Clients/Legacy', '/wsA/Acme'] }],
        activeMatterId: null,
      },
      version: 10,
    }));
    const emitted: string[] = [];
    setMatterAuditEmitter((entry) => { emitted.push(entry.description); });

    const options = makeOptions();
    options.auditServiceRef.current.hydrate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true) as never;
    options.setRootPath = (p: string) => { useWorkspaceStore.getState().setRootPath(p); };
    const { result, unmount } = renderHook(() => useWorkspaceLifecycle(options));

    await act(async () => {
      await result.current.handleWorkspaceSelected(makeWorkspaceService('/wsA'));
    });
    expect(emitted).toEqual([]);

    await act(async () => {
      await result.current.handleWorkspaceSelected(makeWorkspaceService('/wsA'));
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('Hendricks');
    expect(emitted[0]).toContain('"Clients/Legacy"');

    unmount();
  });

  it('ROUND 4: emits one overflow audit entry when migration drops folder links for more than 500 clients', async () => {
    localStorage.setItem('lantern:matters', JSON.stringify({
      state: {
        matters: Array.from({ length: 502 }, (_unused, index) => ({
          ...baseMatter,
          id: `client-${index}`,
          name: `Client ${index}`,
          folderPaths: [`Clients/Legacy ${index}`, `/wsA/Clients/Client ${index}`],
        })),
        activeMatterId: null,
      },
      version: 10,
    }));
    const emitted: Array<{ description: string; metadata: Record<string, unknown> }> = [];
    setMatterAuditEmitter((entry) => {
      emitted.push({ description: entry.description, metadata: entry.metadata });
    });

    const options = makeOptions();
    options.setRootPath = (p: string) => { useWorkspaceStore.getState().setRootPath(p); };
    const { result, unmount } = renderHook(() => useWorkspaceLifecycle(options));

    await act(async () => {
      await result.current.handleWorkspaceSelected(makeWorkspaceService('/wsA'));
    });

    const individualEntries = emitted.filter(
      (entry) => entry.metadata['auditEventType'] === 'matter_migration_folder_link_dropped',
    );
    const overflowEntry = emitted.find(
      (entry) => entry.metadata['auditEventType'] === 'matter_migration_folder_link_drop_overflow',
    );
    expect(individualEntries).toHaveLength(500);
    expect(overflowEntry?.metadata['omittedClientCount']).toBe(2);
    expect(overflowEntry?.description).toContain('2 more clients were affected');

    unmount();
  });

  it('a matter created in one workspace never appears in another', () => {
    const { unmount } = renderHook(() => useWorkspaceLifecycle(makeOptions()));

    act(() => { useWorkspaceStore.getState().setRootPath('/wsA'); });
    act(() => { useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme', folderPaths: ['/wsA/Acme'] }); });
    expect(getMatters()).toHaveLength(1);

    act(() => { useWorkspaceStore.getState().setRootPath('/wsB'); });
    expect(getMatters()).toEqual([]);

    unmount();
  });

  it('ROUND 5: a workspace switch clears citation verification so an old in-flight result cannot land in the new workspace', async () => {
    const firstCheck = deferred<CitationVerdict[]>();
    const secondCheck = deferred<CitationVerdict[]>();
    ragVerifyCitationsBatchMock
      .mockReturnValueOnce(firstCheck.promise)
      .mockReturnValueOnce(secondCheck.promise);
    const onAuditLog = vi.fn();
    const citation: AnswerCitation = {
      n: 1,
      label: 'plan.docx',
      excerpt: 'The client wants to retire at 62.',
      path: 'Clients/Acme/plan.docx',
      locator: 'p.1',
      verified: false,
      id: 'chunk-workspace-race',
      matterId: 'matter-acme',
    };

    const lifecycle = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    const verifier = renderHook(() => useCitationVerification([citation], onAuditLog));

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);
    });
    expect(getCitationVerificationCacheSnapshotForTests().requestedKeys).toHaveLength(1);

    act(() => {
      useWorkspaceStore.getState().setRootPath('/wsA');
    });

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(2);
    });

    firstCheck.resolve([{ verdict: 'verified' } satisfies CitationVerdict]);
    await act(async () => {
      await firstCheck.promise;
    });

    expect(onAuditLog).not.toHaveBeenCalled();
    expect(getCitationVerificationCacheSnapshotForTests().verdictKeys).toEqual([]);

    secondCheck.resolve([{ verdict: 'verified' } satisfies CitationVerdict]);
    await waitFor(() => {
      expect(onAuditLog).toHaveBeenCalledTimes(1);
    });
    expect(getCitationVerificationCacheSnapshotForTests().verdictKeys).toHaveLength(1);

    verifier.unmount();
    lifecycle.unmount();
  });
});
