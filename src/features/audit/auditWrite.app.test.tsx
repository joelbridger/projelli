import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appBridge = vi.hoisted(() => ({
  setMatterAuditEmitter: vi.fn(),
  setMatterAuditEmitterAsync: vi.fn(),
}));
const tauriBridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return {
    ...actual,
    invoke: tauriBridge.invoke,
    isTauri: tauriBridge.isTauri,
  };
});

vi.mock('@tauri-apps/api/event', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/event')>();
  return {
    ...actual,
    listen: vi.fn(() => Promise.resolve(() => undefined)),
  };
});

vi.mock('@/platform/matter/matterStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/matter/matterStore')>();
  return {
    ...actual,
    setMatterAuditEmitter: appBridge.setMatterAuditEmitter,
    setMatterAuditEmitterAsync: appBridge.setMatterAuditEmitterAsync,
  };
});

vi.mock('@/platform/utils/telemetry', () => ({
  sendEvent: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@/platform/providers/OllamaProvider', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/platform/providers/OllamaProvider')
    >();
  return {
    ...actual,
    detectOllama: vi.fn(() =>
      Promise.resolve({ reachable: false, models: [] })
    ),
  };
});

vi.mock('@/platform/providers/KeychainService', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/platform/providers/KeychainService')
    >();
  return {
    ...actual,
    createKeychainService: () => ({
      setKey: vi.fn(() => Promise.resolve(undefined)),
      getKey: vi.fn(() => Promise.resolve(null)),
      deleteKey: vi.fn(() => Promise.resolve(undefined)),
      hasKey: vi.fn(() => Promise.resolve(false)),
      getMaskedKey: vi.fn(() => Promise.resolve(null)),
      validateKey: vi.fn(() => Promise.resolve({ valid: true })),
      isEnvKey: vi.fn(() => Promise.resolve(false)),
      getStoredKeys: vi.fn(() => []),
    }),
    migrateLocalStorageApiKeysToKeychain: vi.fn(() =>
      Promise.resolve(undefined)
    ),
  };
});

vi.mock('@/app/lifecycle/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({
    handleWorkspaceSelected: vi.fn(() => Promise.resolve(true)),
    handleOpenRecentProject: vi.fn(() => Promise.resolve(undefined)),
    workspaceOpenError: null,
    dismissWorkspaceOpenError: vi.fn(),
  }),
}));

vi.mock('@/app/shell/AppSurfaceRouter', () => ({
  AppSurfaceRouter: () => <div data-testid="audit-app-router" />,
}));

function liveAuditPersistenceStatus(entries: unknown[]): string {
  const status = (
    entries[0] as { metadata?: Record<string, unknown> } | undefined
  )?.metadata?.['auditPersistenceStatus'];
  return typeof status === 'string' ? status : 'none';
}

vi.mock('@/app/shell/runtime/AppSurfaceRuntimeProvider', () => ({
  AppSurfaceRuntimeProvider: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: { audit: { entries: unknown[] } };
  }) => (
    <>
      <div data-testid="live-audit-count">{value.audit.entries.length}</div>
      <div data-testid="live-audit-status">
        {liveAuditPersistenceStatus(value.audit.entries)}
      </div>
      {children}
    </>
  ),
}));

vi.mock('@/app/shell/AppDialogs', () => ({ AppDialogs: () => null }));
vi.mock('@/features/meetings/RecordPill', () => ({ RecordPill: () => null }));
vi.mock('@/features/meetings/MeetingAutoJoinScheduler', () => ({
  MeetingAutoJoinScheduler: () => null,
}));
vi.mock('@/features/meetings/AutoJoinMeetingsPanel', () => ({
  AutoJoinMeetingsPanel: () => null,
}));
vi.mock('@/app/shell/layout/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('@/platform/rag/ui/ModelDownloadCard', () => ({
  ModelDownloadCard: () => null,
}));
vi.mock('@/platform/rag/ui/LocalAiDownloadCard', () => ({
  LocalAiDownloadCard: () => null,
}));
vi.mock('@/platform/rag/ui/RagProgressBanner', () => ({
  RagProgressBanner: () => null,
}));
vi.mock('@/platform/rag/ui/ScopeUpdateBanner', () => ({
  ScopeUpdateBanner: () => null,
}));
vi.mock('@/features/account/trial', () => ({ TrialBanner: () => null }));

window.history.pushState({}, '', '/?testMode=true');

import {
  emitAuditEntry,
  setAuditWriteEmitter,
  type AuditWriteEmitter,
  type AuditWriteEntry,
} from '@/features/audit';

const { default: App } = await import('@/App');

const legacyEntry: AuditWriteEntry = {
  action: 'file_create',
  description: 'Legacy caller created one file',
  model: undefined,
  inputs: {},
  outputs: { path: 'Clients/Adams/plan.docx' },
  userDecision: 'auto',
  metadata: { auditEventType: 'file_create' },
};

function installedLegacyAsyncWriter(): AuditWriteEmitter {
  const call = [...appBridge.setMatterAuditEmitterAsync.mock.calls]
    .reverse()
    .find(([emitter]) => typeof emitter === 'function');
  if (!call)
    throw new Error('App did not install its legacy async audit writer');
  return call[0] as AuditWriteEmitter;
}

function persistedRows(): Array<Record<string, unknown>> {
  const raw = localStorage.getItem('audit_log_default');
  if (!raw) throw new Error('Expected the canonical audit log to be persisted');
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  appBridge.setMatterAuditEmitter.mockClear();
  appBridge.setMatterAuditEmitterAsync.mockClear();
  tauriBridge.invoke.mockReset();
  tauriBridge.invoke.mockResolvedValue(undefined);
  tauriBridge.isTauri.mockReset();
  tauriBridge.isTauri.mockReturnValue(false);
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  setAuditWriteEmitter(null);
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  setAuditWriteEmitter(null);
});

describe('App canonical audit-write registration', () => {
  it('keeps a legacy registered caller pending in live state until the canonical save settles', async () => {
    Reflect.set(window, '__TAURI_INTERNALS__', {});
    tauriBridge.isTauri.mockReturnValue(true);
    let resolveAppend: (() => void) | undefined;
    tauriBridge.invoke.mockImplementation((command: string) => {
      if (command === 'audit_append') {
        return new Promise((resolve) => {
          resolveAppend = () => {
            resolve(undefined);
          };
        });
      }
      return Promise.resolve(undefined);
    });

    const app = render(<App />);
    await waitFor(() => {
      expect(appBridge.setMatterAuditEmitterAsync).toHaveBeenCalled();
    });

    const legacyWriter = installedLegacyAsyncWriter();
    let result: Awaited<ReturnType<AuditWriteEmitter>> | undefined;
    await act(async () => {
      result = await legacyWriter(legacyEntry);
    });

    expect(result?.id).toMatch(/^audit_/);
    expect(result?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result?.metadata['auditPersistenceStatus']).toBe('pending');
    const liveCounts = screen.getAllByTestId('live-audit-count');
    expect(liveCounts.length).toBeGreaterThan(0);
    for (const count of liveCounts) {
      expect(count).toHaveTextContent('1');
    }
    for (const status of screen.getAllByTestId('live-audit-status')) {
      expect(status).toHaveTextContent('pending');
    }

    const appendCalls = tauriBridge.invoke.mock.calls.filter(
      ([command]) => command === 'audit_append'
    );
    expect(appendCalls).toHaveLength(1);
    const record = (
      appendCalls[0]?.[1] as
        | { entry?: { payloadJson?: string } }
        | undefined
    )?.entry;
    if (!record?.payloadJson) {
      throw new Error('Expected the canonical encrypted audit record');
    }
    expect(JSON.parse(record.payloadJson)).toMatchObject({
      id: result?.id,
      timestamp: result?.timestamp,
      action: legacyEntry.action,
      description: legacyEntry.description,
      metadata: { auditPersistenceStatus: 'saved' },
    });

    const finishAppend = resolveAppend;
    if (!finishAppend) throw new Error('Expected a pending canonical append');
    await act(async () => {
      finishAppend();
      await Promise.resolve();
    });
    await waitFor(() => {
      for (const status of screen.getAllByTestId('live-audit-status')) {
        expect(status).toHaveTextContent('saved');
      }
    });
    expect(result?.metadata['auditPersistenceStatus']).toBe('saved');

    app.unmount();
    expect(appBridge.setMatterAuditEmitterAsync).toHaveBeenLastCalledWith(null);
    await expect(emitAuditEntry(legacyEntry)).rejects.toThrow(
      'Canonical audit writer is unavailable'
    );
  });

  it('persists a public write and preserves it after App recreates the service', async () => {
    const durableEntry: AuditWriteEntry = {
      ...legacyEntry,
      action: 'egress',
      description: 'Public consumer requires a saved audit row',
      metadata: { auditEventType: 'egress' },
    };

    const firstApp = render(<App />);
    const firstResult = await emitAuditEntry(durableEntry);
    expect(firstResult.metadata['auditPersistenceStatus']).toBe('saved');
    expect(persistedRows()).toHaveLength(1);
    firstApp.unmount();

    const secondApp = render(<App />);
    const secondResult = await emitAuditEntry({
      ...legacyEntry,
      description: 'A later row after service recreation',
    });
    const rowsAfterReload = persistedRows();

    expect(rowsAfterReload).toHaveLength(2);
    expect(rowsAfterReload[0]).toMatchObject({
      id: firstResult.id,
      timestamp: firstResult.timestamp,
      description: durableEntry.description,
    });
    expect(rowsAfterReload[0]?.['metadata']).toEqual(
      expect.objectContaining({ auditPersistenceStatus: 'saved' })
    );
    expect(rowsAfterReload[1]).toMatchObject({
      id: secondResult.id,
      timestamp: secondResult.timestamp,
      description: 'A later row after service recreation',
    });
    expect(new Set(rowsAfterReload.map((row) => row['id'])).size).toBe(2);

    secondApp.unmount();
  });

  it('rejects the public write when the canonical append fails', async () => {
    Reflect.set(window, '__TAURI_INTERNALS__', {});
    tauriBridge.isTauri.mockReturnValue(true);
    let rejectAppend: ((error: Error) => void) | undefined;
    tauriBridge.invoke.mockImplementation((command: string) => {
      if (command === 'audit_append') {
        return new Promise((_resolve, reject) => {
          rejectAppend = reject;
        });
      }
      return Promise.resolve(undefined);
    });

    const app = render(<App />);
    const publicWrite = emitAuditEntry(legacyEntry);
    let settled = false;
    const settlement = publicWrite.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await Promise.resolve();
    expect(settled).toBe(false);

    const failAppend = rejectAppend;
    if (!failAppend) throw new Error('Expected a pending canonical append');
    failAppend(new Error('encrypted audit store unavailable'));

    await expect(publicWrite).rejects.toThrow(
      'Audit entry could not be saved durably: encrypted audit store unavailable'
    );
    await settlement;
    expect(settled).toBe(true);
    expect(
      tauriBridge.invoke.mock.calls.filter(
        ([command]) => command === 'audit_append'
      )
    ).toHaveLength(1);

    app.unmount();
  });

  it('keeps simultaneous public writes in canonical append order and history', async () => {
    const app = render(<App />);
    const firstEntry: AuditWriteEntry = {
      ...legacyEntry,
      description: 'First simultaneous public write',
    };
    const secondEntry: AuditWriteEntry = {
      ...legacyEntry,
      description: 'Second simultaneous public write',
    };

    const [firstResult, secondResult] = await Promise.all([
      emitAuditEntry(firstEntry),
      emitAuditEntry(secondEntry),
    ]);
    const rows = persistedRows();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row['id'])).toEqual([
      firstResult.id,
      secondResult.id,
    ]);
    expect(rows.map((row) => row['description'])).toEqual([
      firstEntry.description,
      secondEntry.description,
    ]);
    expect(new Set(rows.map((row) => row['id'])).size).toBe(2);
    for (const row of rows) {
      expect(row['metadata']).toEqual(
        expect.objectContaining({ auditPersistenceStatus: 'saved' })
      );
    }
    await waitFor(() => {
      for (const count of screen.getAllByTestId('live-audit-count')) {
        expect(count).toHaveTextContent('2');
      }
      for (const status of screen.getAllByTestId('live-audit-status')) {
        expect(status).toHaveTextContent('saved');
      }
    });

    app.unmount();
  });
});
