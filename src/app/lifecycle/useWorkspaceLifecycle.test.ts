/**
 * useWorkspaceLifecycle — QA-33 regression coverage for handleOpenRecentProject.
 *
 * Before this fix, a failed "reopen a recent workspace" (used by both the
 * toolbar's Recent Projects menu and the silent boot-time auto-resume) was
 * swallowed into a bare `console.error` — nothing was ever shown to the user.
 * These tests pin down that a failure now (a) surfaces an honest,
 * dismissible message via `workspaceOpenError`, and (b) never throws out of
 * `handleOpenRecentProject`, since useAutoResumeWorkspace relies on that to
 * stay safe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import type { AuditEntry } from '@/platform/types/audit';
import type { AuditEntryRecord } from '@/platform/utils/tauri-commands';

type TauriEventHandler = (event: { payload: unknown }) => void;

const {
  createFSBackendMock,
  initializeMock,
  listenMock,
  eventHandlers,
  unlistenMocks,
} = vi.hoisted(() => ({
  createFSBackendMock: vi.fn(),
  initializeMock: vi.fn(),
  listenMock: vi.fn(),
  eventHandlers: new Map<string, TauriEventHandler>(),
  unlistenMocks: new Map<string, () => void>(),
}));

vi.mock('@/platform/fs/BackendFactory', () => ({
  createFSBackend: createFSBackendMock,
}));

vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => ({ initialize: initializeMock }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

import {
  useWorkspaceLifecycle,
  type UseWorkspaceLifecycleOptions,
} from './useWorkspaceLifecycle';
import { TimeoutError } from '@/lib/withTimeout';
import {
  useAppNavigationStore,
  type AppNavigationSnapshot,
} from '@/platform/state/appNavigationStore';
import { CRM_AUDIT_APPENDED_EVENT } from '@/platform/utils/wealthbox-commands';
import { WRITEBACK_AUDIT_APPENDED_EVENT } from '@/platform/utils/external-write-commands';

type AuditEntriesUpdate = AuditEntry[] | ((prev: AuditEntry[]) => AuditEntry[]);

function makeOptions(): UseWorkspaceLifecycleOptions {
  return {
    workspaceServiceRef: createRef() as never,
    auditServiceRef: {
      current: { hydrate: vi.fn(), getAll: () => [], verifyIntegrity: vi.fn() },
    } as never,
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

function installTauriWindowMarker(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
  });
}

function makeAuditRecord(id: string, action: string): AuditEntryRecord {
  const timestamp = '2026-07-10T00:00:00.000Z';
  const description = `${action} audit row`;
  const payload = {
    id,
    timestamp,
    action,
    description,
    model: undefined,
    inputs: { proposalId: 'proposal-1' },
    outputs: { receiptRef: 'receipt-1' },
    userDecision: undefined,
    metadata: {
      scope: { kind: 'matter', matterId: 'matter-1' },
      source: 'writeback-backend',
    },
  };

  return {
    id,
    timestamp,
    action,
    description,
    payloadJson: JSON.stringify(payload),
  };
}

function attachAuditEntriesState(options: UseWorkspaceLifecycleOptions): {
  state: { entries: AuditEntry[] };
  setAuditEntries: ReturnType<typeof vi.fn>;
} {
  const state: { entries: AuditEntry[] } = { entries: [] };
  const setAuditEntries = vi.fn((next: AuditEntriesUpdate) => {
    state.entries =
      typeof next === 'function' ? next(state.entries) : next;
  });
  options.setAuditEntries = setAuditEntries as never;
  return { state, setAuditEntries };
}

function emitAuditEvent(eventName: string, payload: AuditEntryRecord): void {
  const handler = eventHandlers.get(eventName);
  expect(handler).toBeDefined();
  handler?.({ payload });
}

beforeEach(() => {
  listenMock.mockReset();
  eventHandlers.clear();
  unlistenMocks.clear();
  if (typeof window !== 'undefined') {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Reflect.deleteProperty(window, '__TAURI__');
  }
  listenMock.mockImplementation(
    (eventName: string, handler: TauriEventHandler) => {
      eventHandlers.set(eventName, handler);
      const unlisten: () => void = vi.fn(() => {
        eventHandlers.delete(eventName);
      });
      unlistenMocks.set(eventName, unlisten);
      return Promise.resolve(unlisten);
    }
  );
});

describe('useWorkspaceLifecycle — handleOpenRecentProject (QA-33)', () => {
  beforeEach(() => {
    createFSBackendMock.mockReset();
    initializeMock.mockReset();
    useAppNavigationStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('surfaces an honest, classified message when the credential service is unavailable', async () => {
    createFSBackendMock.mockRejectedValue({
      kind: 'serviceUnavailable',
      message: 'the OS credential storage service did not respond in time',
    });

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await act(async () => {
      await result.current.handleOpenRecentProject('/some/workspace');
    });

    expect(result.current.workspaceOpenError).toContain(
      "credential storage service isn't running"
    );
  });

  it('never throws out of handleOpenRecentProject — auto-resume relies on this', async () => {
    createFSBackendMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await expect(
      act(async () => {
        await result.current.handleOpenRecentProject('/some/workspace');
      })
    ).resolves.not.toThrow();

    expect(result.current.workspaceOpenError).toBe('boom');
  });

  it('surfaces a TimeoutError message for a genuinely hung native open', async () => {
    createFSBackendMock.mockRejectedValue(
      new TimeoutError('Opening the workspace', 30_000)
    );

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await act(async () => {
      await result.current.handleOpenRecentProject('/some/workspace');
    });

    expect(result.current.workspaceOpenError).toBe(
      'Opening the workspace timed out after 30s'
    );
  });

  it('dismissWorkspaceOpenError clears the message', async () => {
    createFSBackendMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await act(async () => {
      await result.current.handleOpenRecentProject('/some/workspace');
    });
    expect(result.current.workspaceOpenError).toBe('boom');

    act(() => {
      result.current.dismissWorkspaceOpenError();
    });
    expect(result.current.workspaceOpenError).toBeNull();
  });

  it('clears Back history when a different workspace is opened', async () => {
    const oldSnapshot: AppNavigationSnapshot = {
      rootPath: '/old-workspace',
      sidebarActiveTab: 'matters',
      activeMatterId: 'old-client',
      clientMapHubId: 'old-client',
      clientMapHubTab: 'overview',
      documentsView: 'browser',
      activeTabPath: null,
      mattersSurfaceMode: 'client-map',
    };
    useAppNavigationStore.getState().push(oldSnapshot);

    const options = makeOptions();
    const service = {
      getRootPath: () => '/new-workspace',
      getBackend: () => null,
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      getFileTree: vi.fn().mockResolvedValue([]),
      readFile: vi.fn(),
      readFileBinary: vi.fn(),
    };

    const { result } = renderHook(() => useWorkspaceLifecycle(options));
    await act(async () => {
      await result.current.handleWorkspaceSelected(service as never);
    });

    expect(useAppNavigationStore.getState().stack).toHaveLength(0);
  });

  it('opens the workspace when the encrypted Activity Log keychain call never returns', async () => {
    vi.useFakeTimers();
    const options = makeOptions();
    options.auditServiceRef.current.hydrate = vi.fn(
      () => new Promise<boolean>(() => undefined)
    ) as never;
    const service = {
      getRootPath: () => '/new-workspace',
      getBackend: () => null,
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      getFileTree: vi.fn().mockResolvedValue([]),
      readFile: vi.fn(),
      readFileBinary: vi.fn(),
    };

    const { result } = renderHook(() => useWorkspaceLifecycle(options));
    let opening!: Promise<boolean>;
    act(() => {
      opening = result.current.handleWorkspaceSelected(service as never);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await opening;
    });

    expect(options.setShowWorkspaceSelector).toHaveBeenCalledWith(false);
    expect(options.setRootPath).toHaveBeenCalledWith('/new-workspace');
    expect(options.setAuditIntegrity).toHaveBeenCalledWith(undefined);
  });
});

describe('useWorkspaceLifecycle — live audit events', () => {
  it('pushes writeback audit rows into the live Activity Log and keeps the CRM listener wired', async () => {
    installTauriWindowMarker();
    const options = makeOptions();
    const { state } = attachAuditEntriesState(options);

    const { unmount } = renderHook(() => useWorkspaceLifecycle(options));

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith(
        CRM_AUDIT_APPENDED_EVENT,
        expect.any(Function)
      );
      expect(listenMock).toHaveBeenCalledWith(
        WRITEBACK_AUDIT_APPENDED_EVENT,
        expect.any(Function)
      );
    });

    const writebackRecord = makeAuditRecord(
      'writeback-audit-1',
      'external_write.upsert_income'
    );
    act(() => {
      emitAuditEvent(WRITEBACK_AUDIT_APPENDED_EVENT, writebackRecord);
    });

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      id: 'writeback-audit-1',
      description: 'external_write.upsert_income audit row',
      metadata: {
        scope: { kind: 'matter', matterId: 'matter-1' },
        source: 'writeback-backend',
      },
    });

    act(() => {
      emitAuditEvent(WRITEBACK_AUDIT_APPENDED_EVENT, writebackRecord);
    });
    expect(state.entries).toHaveLength(1);

    const crmRecord = makeAuditRecord('crm-audit-1', 'wealthbox.sync');
    act(() => {
      emitAuditEvent(CRM_AUDIT_APPENDED_EVENT, crmRecord);
    });
    expect(state.entries.map((entry) => entry.id)).toEqual([
      'crm-audit-1',
      'writeback-audit-1',
    ]);

    await act(async () => {
      await Promise.resolve();
    });
    unmount();

    expect(unlistenMocks.get(CRM_AUDIT_APPENDED_EVENT)).toHaveBeenCalledTimes(
      1
    );
    expect(
      unlistenMocks.get(WRITEBACK_AUDIT_APPENDED_EVENT)
    ).toHaveBeenCalledTimes(1);
  });

  it('cleans up both audit listeners if the hook unmounts before listener setup resolves', async () => {
    installTauriWindowMarker();
    const options = makeOptions();
    attachAuditEntriesState(options);
    const pending: Array<{
      resolve: (fn: () => void) => void;
      unlisten: () => void;
    }> = [];

    listenMock.mockImplementation(
      (eventName: string, handler: TauriEventHandler) => {
        eventHandlers.set(eventName, handler);
        const unlisten: () => void = vi.fn(() => {
          eventHandlers.delete(eventName);
        });
        return new Promise<() => void>((resolve) => {
          pending.push({ resolve, unlisten });
        });
      }
    );

    const { unmount } = renderHook(() => useWorkspaceLifecycle(options));

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith(
        CRM_AUDIT_APPENDED_EVENT,
        expect.any(Function)
      );
      expect(listenMock).toHaveBeenCalledWith(
        WRITEBACK_AUDIT_APPENDED_EVENT,
        expect.any(Function)
      );
    });

    unmount();
    for (const { resolve, unlisten } of pending) {
      resolve(unlisten);
    }

    await waitFor(() => {
      expect(pending).toHaveLength(2);
      expect(pending[0]?.unlisten).toHaveBeenCalledTimes(1);
      expect(pending[1]?.unlisten).toHaveBeenCalledTimes(1);
    });
  });
});
