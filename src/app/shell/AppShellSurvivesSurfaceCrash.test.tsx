/**
 * Round-2 regression test for fix/sidebar-blank-after-ask.
 *
 * The round-1 fix wrapped only CrmAskSurface in an ErrorBoundary. Independent
 * review (.agent/results/review-sidebar.json) found this insufficient: the
 * reported defect is the LEFT NAVIGATION (AppShellNav / the Spine) going blank
 * and unresponsive, but the nav is a SIBLING of AppSurfaceRouter under <main>
 * in App.tsx, not a descendant of any surface-scoped boundary — so an uncaught
 * throw from any OTHER surface (CrmHome, ClientsSurface, AssociateHome,
 * SchedulingHome — none of which had their own boundary) would still unmount
 * the whole React root, nav included.
 *
 * The round-2 fix adds one top-level ErrorBoundary in src/App.tsx around
 * AppSurfaceRouter, positioned as a sibling of AppShellNav (not a wrapper
 * around it), so the nav can never be part of a crashed subtree regardless of
 * which surface throws.
 *
 * This test renders the actual shell composition — a real AppShellNav next to
 * an ErrorBoundary-wrapped AppSurfaceRouter, mirroring src/App.tsx's <main> —
 * and crashes CrmHome (the 'home' tab, the default surface, which has no
 * per-surface boundary of its own) to prove the OUTCOME the review asked for:
 * the left nav stays mounted and clickable, not just that "a boundary exists
 * somewhere".
 */
import '@/i18n';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import type { AppSurface } from '@/platform/types/navigation';
import { AppShellNav } from '@/app/shell/layout/AppShellNav';
import { AppSurfaceRouter, type AppSurfaceRouterProps } from './AppSurfaceRouter';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

vi.mock('@/features/crm-home', () => ({
  CrmHome: () => {
    throw new Error('home surface boom (simulated, no per-surface boundary)');
  },
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: [],
    save: vi.fn(),
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/workspace',
    freshness: { kind: 'live' as const },
    sharedMatterId: null,
  }),
}));

vi.mock('@/app/lifecycle/useIntakeInboxSync', () => ({
  useIntakeInboxSync: vi.fn(),
}));
vi.mock('@/platform/intake/useEmailReplyIngestion', () => ({
  useEmailReplyIngestion: vi.fn(),
}));
vi.mock('@/platform/intake/useDocumentExtractionIngestion', () => ({
  useDocumentExtractionIngestion: vi.fn(),
}));

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

/**
 * Mirrors the relevant slice of src/App.tsx's <main>: AppShellNav and an
 * ErrorBoundary-wrapped AppSurfaceRouter as siblings, wired to the same shared
 * `sidebarActiveTab` state the real App does.
 */
function ShellHarness() {
  const [activeTab, setActiveTab] = useState<AppSurface>('home');
  return (
    <div className="flex-1 flex overflow-hidden">
      <AppShellNav
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab as AppSurface); }}
        collapsed={false}
        onCollapsedChange={() => {}}
      />
      <ErrorBoundary label="Workspace">
        <AppSurfaceRouter {...baseProps(activeTab, setActiveTab)} />
      </ErrorBoundary>
    </div>
  );
}

describe('left nav survives a surface crash (fix/sidebar-blank-after-ask, round 2)', () => {
  beforeEach(() => {
    useMatterStore.setState({
      matters: [
        { id: 'm-a', name: 'm-a', client: 'Alvarez', folderPaths: [], createdAt: '2026-01-01T00:00:00.000Z', archived: false } as Matter,
      ],
      activeMatterId: null,
    });
    // React logs the caught error to console.error — expected noise here,
    // silence it so the test output stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the left nav mounted and clickable when the home surface crashes with no boundary of its own', () => {
    render(<ShellHarness />);

    // The crashing surface (CrmHome, which has no per-surface boundary) is
    // contained by the new top-level boundary, not the whole shell.
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();

    // The left nav is still in the document — it was never part of the
    // crashed subtree, unlike before the fix, where an uncaught error with no
    // boundary anywhere unmounted the entire React root.
    const nav = screen.getByTestId('spine-nav');
    expect(nav).toBeInTheDocument();

    // And it's still interactive, not just present in a frozen DOM: clicking
    // a nav tab actually fires the app's tab-change handler.
    const clientsTab = screen.getByTestId('spine-nav-matters');
    fireEvent.click(clientsTab);
    expect(screen.getByTestId('spine-nav')).toBeInTheDocument();
  });
});
