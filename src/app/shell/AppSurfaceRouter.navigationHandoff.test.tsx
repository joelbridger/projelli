import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Home } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { AppSurface, NavigationTarget } from '@/platform/types/navigation';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';
import { useGlobalEventBus } from '@/app/lifecycle/useGlobalEventBus';
import { EV_MATTER_LAUNCH } from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';

declare module '@/platform/types/navigation' {
  interface AppSurfaceMap {
    'disposable-notes': true;
  }
}

const registryProbe = vi.hoisted(() => ({
  flags: new Map<string, boolean>(),
  lazySurfaceLoader: vi.fn<() => Promise<AppSurfaceDescriptor>>(),
  lazySurfaceResolver: vi.fn(),
  staleFlagOffResolver: vi.fn(),
}));

vi.mock('@/platform/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/flags')>()),
  isEnabled: (id: string) => registryProbe.flags.get(id) ?? true,
}));

vi.mock('@/app/shell/registry/legacyAppSurfaceDescriptors', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/shell/registry/legacyAppSurfaceDescriptors')
  >('@/app/shell/registry/legacyAppSurfaceDescriptors');

  return {
    ...actual,
    // This is a real, registered descriptor. The test turns its real registry
    // flag off after registration, so the router receives the tri-state result.
    legacyClientsSurface: {
      ...actual.legacyClientsSurface,
      availabilityFlag: 'home-surface-v1',
      resolveNavigation: registryProbe.staleFlagOffResolver,
    },
    // A lazy surface lets the real target registry prove it waits for the real
    // app-surface registry before navigating an otherwise eager alias.
    legacyTrashSurface: () => registryProbe.lazySurfaceLoader(),
  };
});

vi.mock(
  '@/app/commands/registry/legacyNavigationTargetDescriptors',
  async () => {
    const actual = await vi.importActual<
      typeof import('@/app/commands/registry/legacyNavigationTargetDescriptors')
    >('@/app/commands/registry/legacyNavigationTargetDescriptors');

    return {
      ...actual,
      legacyNavigationTargetDescriptors: [
        ...actual.legacyNavigationTargetDescriptors,
        {
          id: 'disposable-notes',
          appSurfaceId: 'disposable-notes',
          resolve: vi.fn(),
        },
      ],
    };
  }
);

vi.mock('@/app/lifecycle/useIntakeInboxSync', () => ({
  useIntakeInboxSync: vi.fn(),
}));
vi.mock('@/platform/intake/useEmailReplyIngestion', () => ({
  useEmailReplyIngestion: vi.fn(),
}));
vi.mock('@/platform/intake/useDocumentExtractionIngestion', () => ({
  useDocumentExtractionIngestion: vi.fn(),
}));

import {
  AppSurfaceRouter,
  type AppSurfaceRouterProps,
} from './AppSurfaceRouter';
import { Spine } from './layout/Spine';

function disposableNotesSurface(): AppSurfaceDescriptor {
  return {
    id: 'disposable-notes',
    labelKey: 'disposable.notes',
    icon: Home,
    placement: 'hidden',
    order: 99,
    clientContext: 'firm',
    errorLabel: 'Disposable notes',
    render: () => null,
    resolveNavigation: registryProbe.lazySurfaceResolver,
  };
}

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

function NavigationHarness({
  onNavigate,
}: {
  onNavigate: (surface: AppSurface) => void;
}) {
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
  registryProbe.flags.clear();
  registryProbe.lazySurfaceResolver.mockClear();
  registryProbe.staleFlagOffResolver.mockClear();
  useMatterStore.setState({ matters: [], activeMatterId: null });
  vi.restoreAllMocks();
});

describe('AppSurfaceRouter navigation handoff', () => {
  it('uses the real registries: waits once for a lazy surface and gives its resolver the raw intent', async () => {
    const onNavigate = vi.fn();
    registryProbe.lazySurfaceLoader.mockResolvedValue(disposableNotesSurface());
    registryProbe.lazySurfaceResolver.mockImplementation(
      (target: NavigationTarget, runtime: AppSurfaceRuntime) => {
        runtime.navigation.setSurface(target.surface);
      }
    );
    render(<NavigationHarness onNavigate={onNavigate} />);

    const source = { kind: 'note', ref: 'record-42' };
    launch({ matterId: 'm1', surface: 'disposable-notes', source });

    await waitFor(() => {
      expect(registryProbe.lazySurfaceLoader).toHaveBeenCalledTimes(1);
      expect(registryProbe.lazySurfaceResolver).toHaveBeenCalledTimes(1);
    });
    expect(registryProbe.lazySurfaceResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        matterId: 'm1',
        surface: 'disposable-notes',
        source,
      }),
      expect.any(Object)
    );
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('disposable-notes');
  });

  it('preserves the declared legacy route when its registered surface has no resolver', async () => {
    const onNavigate = vi.fn();
    useMatterStore
      .getState()
      .createMatter({ id: 'm1', name: 'M1', client: 'M1' });
    render(<NavigationHarness onNavigate={onNavigate} />);

    launch({ matterId: 'm1', surface: 'home' });

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('home');
    });
  });

  it('takes a real Spine click through the event bus to Home for a known flag-off surface without its resolver', async () => {
    const onNavigate = vi.fn();
    useMatterStore
      .getState()
      .createMatter({ id: 'm1', name: 'M1', client: 'M1' });
    registryProbe.flags.set('home-surface-v1', false);
    render(
      <>
        <NavigationHarness onNavigate={onNavigate} />
        <Spine />
      </>
    );

    fireEvent.click(await screen.findByTestId('spine-client-row-m1'));

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('home');
    });
    expect(registryProbe.staleFlagOffResolver).not.toHaveBeenCalled();
  });

  it('refuses an unknown alias without navigating or falling back', async () => {
    const onNavigate = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<NavigationHarness onNavigate={onNavigate} />);

    launch({ matterId: 'm1', surface: 'unknown-alias' });

    await waitFor(() => {
      expect(warn).toHaveBeenCalledOnce();
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('catches a rejected async surface resolver', async () => {
    const onNavigate = vi.fn();
    const error = new Error('resolver failed');
    const caught = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    registryProbe.lazySurfaceResolver.mockRejectedValueOnce(error);
    render(<NavigationHarness onNavigate={onNavigate} />);

    launch({ matterId: 'm1', surface: 'disposable-notes' });

    await waitFor(() => {
      expect(caught).toHaveBeenCalledWith(
        '[AppSurfaceRouter] Navigation target resolution failed',
        error
      );
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
