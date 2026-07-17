import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { AppSurface, NavigationTarget } from '@/platform/types/navigation';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import type {
  MatterNavigationTarget,
  NavigationTargetDescriptor,
} from '@/app/commands/registry/navigationTargetRegistry';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';
import { useGlobalEventBus } from '@/app/lifecycle/useGlobalEventBus';
import { EV_MATTER_LAUNCH } from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';

const handoff = vi.hoisted(() => ({
  descriptors: null as readonly NavigationTargetDescriptor[] | null,
  surfaces: new Map<string, AppSurfaceDescriptor | undefined>(),
}));

vi.mock('@/app/commands/registry/navigationTargetRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/commands/registry/navigationTargetRegistry')>();
  return {
    ...actual,
    resolveNavigationTargetDescriptor: (target: MatterNavigationTarget) =>
      handoff.descriptors === null
        ? actual.resolveNavigationTargetDescriptor(target)
        : handoff.descriptors.find((descriptor) => descriptor.id === target.surface),
  };
});

vi.mock('@/app/shell/registry/appSurfaceRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/shell/registry/appSurfaceRegistry')>();
  return {
    ...actual,
    getAppSurfaceDescriptor: (id: AppSurface) =>
      handoff.surfaces.has(id)
        ? handoff.surfaces.get(id)
        : actual.getAppSurfaceDescriptor(id),
  };
});

vi.mock('@/app/lifecycle/useIntakeInboxSync', () => ({ useIntakeInboxSync: vi.fn() }));
vi.mock('@/platform/intake/useEmailReplyIngestion', () => ({ useEmailReplyIngestion: vi.fn() }));
vi.mock('@/platform/intake/useDocumentExtractionIngestion', () => ({
  useDocumentExtractionIngestion: vi.fn(),
}));

import { AppSurfaceRouter, type AppSurfaceRouterProps } from './AppSurfaceRouter';

function baseProps(
  sidebarActiveTab: AppSurface,
  setSidebarActiveTab: (tab: AppSurface) => void
): AppSurfaceRouterProps {
  return {
    sidebarActiveTab,
    askPrefill: null,
    setAskPrefill: vi.fn(),
    documentsView: 'browser',
    setDocumentsView: vi.fn(),
    setSidebarActiveTab,
    mattersSurfaceMode: 'all-clients',
    setMattersSurfaceMode: vi.fn(),
    pushNavigationSnapshot: vi.fn(),
    currentExecution: null,
    activeWorkflowTemplate: null,
    showInterviewDialog: false,
    interviewQuestions: null,
    workflowProviderError: null,
    workflowSaveError: null,
    runHistory: [],
    auditEntries: [],
    auditIntegrity: undefined,
    verifyAuditIntegrity: vi.fn(() => Promise.resolve(undefined)),
    repairAuditSeal: vi.fn(() => Promise.resolve()),
    apiKeys: [],
    rootPath: '/workspace',
    fileTree: [],
    trashItems: [],
    trashStats: { itemCount: 0, totalSize: 0, oldestItem: undefined },
    trashRetentionPeriod: 30,
    trashCustomRetentionDays: 30,
    activeWorkflowFilePath: null,
    openTabs: [],
    workspaceServiceRef: { current: null },
    setFileTree: vi.fn(),
    openSettings: vi.fn(),
    handleFileOpen: vi.fn(() => Promise.resolve(false)),
    handleCreateFile: vi.fn(),
    handleCreateFolder: vi.fn(),
    handleRename: vi.fn(),
    handleRenameWithName: vi.fn(() => Promise.resolve()),
    handleDelete: vi.fn(),
    handleMove: vi.fn(() => Promise.resolve()),
    handleDownload: vi.fn(),
    handleCreateDefaultDocument: vi.fn(),
    handleImportFiles: vi.fn(() => Promise.resolve()),
    handleCreateDocxAtRoot: vi.fn(() => Promise.resolve()),
    handleCreateTextFileAtRoot: vi.fn(() => Promise.resolve()),
    handleCreateFolderAtRoot: vi.fn(() => Promise.resolve()),
    handleSetLetterheadTemplate: vi.fn(),
    handleRestoreFromTrash: vi.fn(() => Promise.resolve()),
    handlePermanentDelete: vi.fn(() => Promise.resolve()),
    handleEmptyTrash: vi.fn(() => Promise.resolve()),
    handleTrashRetentionChange: vi.fn(),
    refreshFileTree: vi.fn(),
    addAuditEntry: vi.fn(),
    handleRequestApiKeySetup: vi.fn(),
    handleInterviewSubmit: vi.fn(),
    handleInterviewCancel: vi.fn(),
    handleWorkflowSaveAsFile: vi.fn(() => Promise.resolve()),
    handleWorkflowExportDocx: vi.fn(() => Promise.resolve()),
    handleWorkflowExportPptx: vi.fn(() => Promise.resolve()),
    handleStartWorkflow: vi.fn(() => Promise.resolve()),
    handleSettingsAction: vi.fn(),
    handleSettingsRestartOnboarding: vi.fn(),
    activeMatter: null,
  };
}

function NavigationHarness({ onNavigate }: { onNavigate: (surface: AppSurface) => void }) {
  const [surface, setSurface] = useState<AppSurface>('home');
  const navigate = (next: AppSurface) => {
    onNavigate(next);
    setSurface(next);
  };
  useGlobalEventBus({
    onOpenMatterManager: vi.fn(),
    onOpenClientSettings: vi.fn(),
    onOpenNewGroup: vi.fn(),
    onOpenAccount: vi.fn(),
    openSettings: vi.fn(),
    setSidebarActiveTab: navigate,
    setDocumentsView: vi.fn(),
    setAskPrefill: vi.fn(),
  });
  return <AppSurfaceRouter {...baseProps(surface, navigate)} />;
}

function launch(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(EV_MATTER_LAUNCH, { detail }));
}

afterEach(() => {
  cleanup();
  handoff.descriptors = null;
  handoff.surfaces.clear();
  useMatterStore.setState({ matters: [], activeMatterId: null });
  vi.restoreAllMocks();
});

describe('AppSurfaceRouter navigation handoff', () => {
  it('preserves the declared legacy route when its registered surface has no resolver', async () => {
    const onNavigate = vi.fn();
    useMatterStore.getState().createMatter({ id: 'm1', name: 'M1', client: 'M1' });
    render(<NavigationHarness onNavigate={onNavigate} />);

    launch({ matterId: 'm1', surface: 'files' });

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('matters');
    });
  });

  it('uses a disposable non-Meetings surface resolver once through the real event-bus route', async () => {
    const onNavigate = vi.fn();
    const resolveNavigation = vi.fn((target: NavigationTarget, runtime: AppSurfaceRuntime) => {
      runtime.navigation.setSurface(target.surface);
    });
    handoff.descriptors = [
      { id: 'disposable-notes', appSurfaceId: 'search', resolve: vi.fn() },
    ];
    const realSearch = await import('@/app/shell/registry/appSurfaceRegistry').then(
      ({ getAppSurfaceDescriptors }) =>
        getAppSurfaceDescriptors().find((descriptor) => descriptor.id === 'search')
    );
    if (!realSearch) throw new Error('Expected the registered Ask surface');
    handoff.surfaces.set('search', {
      ...realSearch,
      resolveNavigation,
    });
    render(<NavigationHarness onNavigate={onNavigate} />);

    const source = { kind: 'note', ref: 'record-42' };
    launch({ matterId: 'm1', surface: 'disposable-notes', source });

    await waitFor(() => {
      expect(resolveNavigation).toHaveBeenCalledTimes(1);
    });
    expect(resolveNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: 'm1', surface: 'search', source }),
      expect.any(Object)
    );
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('search');
  });

  it('sends a known but unavailable surface safely Home without calling a stale resolver', async () => {
    const onNavigate = vi.fn();
    handoff.descriptors = [{ id: 'flag-off', appSurfaceId: 'search', resolve: vi.fn() }];
    handoff.surfaces.set('search', undefined);
    render(<NavigationHarness onNavigate={onNavigate} />);

    launch({ matterId: 'm1', surface: 'flag-off', source: { ref: 'record-42' } });

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('home');
    });
    expect(handoff.descriptors[0]?.resolve).not.toHaveBeenCalled();
  });

  it('refuses an unknown alias without navigating or falling back', async () => {
    const onNavigate = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handoff.descriptors = [];
    render(<NavigationHarness onNavigate={onNavigate} />);

    launch({ matterId: 'm1', surface: 'unknown-alias' });

    await waitFor(() => {
      expect(warn).toHaveBeenCalledOnce();
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
