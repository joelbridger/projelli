/**
 * AppSurfaceRouter — presentational shell component that renders the correct
 * main surface for the currently active sidebar tab.
 *
 * The active descriptor comes from appSurfaceRegistry, which is also the
 * source for shell navigation. There is no second route switch in this file.
 *
 * Production capabilities arrive through AppSurfaceRuntimeProvider in grouped
 * domains. The old flat props remain as a test/embedding compatibility seam.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CrmHome,
  type CrmHomeRoute,
  type CrmHouseholdAddRequest,
} from '@/features/crm-home';
import { ClientsSurface, createDirectoryComposition } from '@/features/crm-clients';
import { advisorFiltersDirectoryContribution } from '@/features/crm-clients/extensions/advisor-filters';
import { crmListSortDirectoryContribution } from '@/features/crm-clients/extensions/sort';
import { crmTagsRailDirectoryContribution } from '@/features/crm-clients/extensions/tags-rail';
import { contactTableDirectoryContribution } from '@/features/crm-clients/extensions/contact-table';

// The one coordinator-owned composition of feature directory contributions
// (each contribution is itself flag-gated and inert while its flag is off).
const directoryComposition = createDirectoryComposition(
  advisorFiltersDirectoryContribution,
  crmListSortDirectoryContribution,
  crmTagsRailDirectoryContribution,
  contactTableDirectoryContribution
);
import type { AddToHouseholdRequest } from '@/features/crm-clients/adapters';
import { CrmAskSurface } from '@/features/crm-ask';
import { DocumentsHome } from '@/features/documents/DocumentsHome';
import { AssociateHome } from '@/features/workflows/AssociateHome';
import { SchedulingHome } from '@/features/scheduling/SchedulingHome';
import { LazyBoundary } from '@/ui/LazyBoundary';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { MainPanel } from '@/app/shell/layout/MainPanel';
import { SurfaceLoadingFallback } from '@/app/shell/common/SurfaceLoadingFallback';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import { requestScrollToParagraph } from '@/platform/utils/scrollToParagraph';
import { resolveWorkspacePath } from '@/platform/fs/pathResolve';
import { workspacePath } from '@/platform/fs/appPath';
import { isWorkflowFilePath } from '@/features/workflows/engine/workflowFile';
import { useEditorStore } from '@/platform/state/editorStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useIntakeInboxSync } from '@/platform/intake/useIntakeInboxSync';
import { useEmailReplyIngestion } from '@/platform/intake/useEmailReplyIngestion';
import { resolveEmailProvider } from '@/features/email/resolveEmailProvider';
import { useDocumentExtractionIngestion } from '@/platform/intake/useDocumentExtractionIngestion';
import { resolveDocumentExtractionProvider } from '@/features/intake/resolveDocumentExtractionProvider';
import { openRunArtifactFromWorkflows } from '@/app/shell/openRunArtifactFromWorkflows';

import type { AppSurface, NavigationTarget } from '@/platform/types/navigation';
import {
  NAVIGATION_TARGET_DISPATCH_EVENT,
  resolveNavigationTargetDescriptor,
  type MatterNavigationTarget,
} from '@/app/commands/registry/navigationTargetRegistry';
import {
  resolveSavedDocumentDirectory,
  resolveSavedDocumentPath,
  routeSavedAskDocument,
} from '@/app/shell/routeSavedAskDocument';
import { openMatterDocumentSource } from '@/app/shell/matterDocumentNavigation';
import {
  EV_OPEN_CRM_DOCUMENT,
  EV_OPEN_ACCOUNT,
  EV_OPEN_EMAIL,
  SK_FIRM_NAME,
} from '@/config/identity';
import {
  legacyRouterPropsToCapabilities,
  useOptionalAppSurfaceCapabilities,
  type AppSurfaceRuntime,
  type LegacyAppSurfaceRouterProps,
} from '@/app/shell/runtime/AppSurfaceRuntime';
import {
  SAFE_APP_SURFACE_ID,
  getAppSurfaceDescriptor,
  resolveAppSurfaceDescriptor,
} from '@/app/shell/registry/appSurfaceRegistry';
import { useAppSurfaceRegistry } from '@/app/shell/runtime/useAppSurfaceRegistry';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';
import { useFlag } from '@/platform/flags';
import { SharedClientSurface } from '@/app/shell/SharedClientBar';
import {
  resolveClientDocumentFolderPaths,
  shouldBackfillClientDocumentFolder,
} from '@/app/shell/clientDocumentFolderPaths';

// Email, Activity Log, Privacy Center, and the full-page Settings surface are
// lazy-loaded: each is a large, self-contained screen (Settings alone pulls
// every settings section) that a user may never open in a given session.
// Client Map (matters), Ask, and Documents stay eager — those are the primary
// demo path and must open instantly with no Suspense flash.
const loadEmailWorkspace = () =>
  import('@/features/email/EmailWorkspace').then((m) => ({
    default: m.EmailWorkspace,
  }));
const loadAuditHome = () =>
  import('@/features/audit/AuditHome').then((m) => ({ default: m.AuditHome }));
const loadPrivacyCenterHome = () =>
  import('@/features/privacy/PrivacyCenterHome').then((m) => ({
    default: m.PrivacyCenterHome,
  }));
const loadSettingsContent = () => import('@/features/settings/SettingsContent');

export type AppSurfaceRouterProps =
  | { sidebarActiveTab: AppSurface }
  | LegacyAppSurfaceRouterProps;

type BuildDocumentsHomeOptions = {
  embedded?: boolean;
  scopeFolderPaths?: string[];
  scopeMatterId?: string;
  ensureScopeFolderMatterId?: string;
};

export function AppSurfaceRouter(props: AppSurfaceRouterProps) {
  const sharedClientBarEnabled = useFlag('shared-client-bar');
  const v1ShellFrameEnabled = useFlag('v1-shell-frame');
  const providedCapabilities = useOptionalAppSurfaceCapabilities();
  const capabilities =
    providedCapabilities ??
    ('askPrefill' in props ? legacyRouterPropsToCapabilities(props) : null);
  if (!capabilities) {
    throw new Error(
      'AppSurfaceRouter requires AppSurfaceRuntimeProvider or legacy router props'
    );
  }

  const { sidebarActiveTab } = props;
  const {
    navigation: {
      setSurface: setSidebarActiveTab,
      setMattersSurfaceMode,
      pushSnapshot: pushNavigationSnapshot,
    },
    workspace: {
      rootPath,
      activeMatter,
      apiKeys,
      serviceRef: workspaceServiceRef,
      setFileTree,
      refreshFileTree,
      requestApiKeySetup: handleRequestApiKeySetup,
      openSelector: onOpenWorkspace,
    },
    documents: {
      view: documentsView,
      setView: setDocumentsView,
      open: handleFileOpen,
      createFile: handleCreateFile,
      createFolder: handleCreateFolder,
      rename: handleRename,
      renameWithName: handleRenameWithName,
      delete: handleDelete,
      move: handleMove,
      download: handleDownload,
      createDefault: handleCreateDefaultDocument,
      importFiles: handleImportFiles,
      createDocxAtRoot: handleCreateDocxAtRoot,
      createTextFileAtRoot: handleCreateTextFileAtRoot,
      createFolderAtRoot: handleCreateFolderAtRoot,
      setLetterheadTemplate: handleSetLetterheadTemplate,
      trashItems,
      trashStats,
      trashRetentionPeriod,
      trashCustomRetentionDays,
      restoreFromTrash: handleRestoreFromTrash,
      permanentlyDelete: handlePermanentDelete,
      emptyTrash: handleEmptyTrash,
      changeTrashRetention: handleTrashRetentionChange,
    },
    ask: { prefill: askPrefill, setPrefill: setAskPrefill },
    workflows: {
      currentExecution,
      activeTemplate: activeWorkflowTemplate,
      showInterviewDialog,
      interviewQuestions,
      providerError: workflowProviderError,
      saveError: workflowSaveError,
      runHistory,
      activeFilePath: activeWorkflowFilePath,
      openTabs,
      submitInterview: handleInterviewSubmit,
      cancelInterview: handleInterviewCancel,
      saveAsFile: handleWorkflowSaveAsFile,
      exportDocx: handleWorkflowExportDocx,
      exportPptx: handleWorkflowExportPptx,
      start: handleStartWorkflow,
    },
    audit: {
      entries: auditEntries,
      integrity: auditIntegrity,
      verifyIntegrity: verifyAuditIntegrity,
      repairSeal: repairAuditSeal,
      addEntry: addAuditEntry,
    },
    settings: {
      open: openSettings,
      action: handleSettingsAction,
      restartOnboarding: handleSettingsRestartOnboarding,
      pageFocus: settingsPageFocus,
    },
  } = capabilities;
  const [crmAddRequest, setCrmAddRequest] = useState<CrmHouseholdAddRequest | null>(null);
  const registryState = useAppSurfaceRegistry();
  const requestedDescriptor = registryState.descriptors.find(
    (descriptor) => descriptor.id === sidebarActiveTab
  );

  useEffect(() => {
    if (!registryState.ready || requestedDescriptor) return;
    console.error(
      `[AppSurfaceRouter] Unknown surface "${sidebarActiveTab}"; falling back to "${SAFE_APP_SURFACE_ID}".`
    );
    void sendDiagnosticEvent({
      event: 'error_caught',
      component: 'AppSurfaceRouter',
      code: 'unknown_surface',
    });
  }, [registryState.ready, requestedDescriptor, sidebarActiveTab]);

  useEffect(() => {
    if (registryState.error) {
      console.error(
        '[AppSurfaceRouter] Surface registry load failed:',
        registryState.error
      );
    }
  }, [registryState.error]);

  useIntakeInboxSync({ workspaceService: workspaceServiceRef.current });
  useEmailReplyIngestion({ resolveEmailProvider });
  useDocumentExtractionIngestion({
    resolveDocumentExtractionProvider,
    workspaceService: workspaceServiceRef.current,
  });

  // CRM document links are only pointers. Opening one must use the normal
  // Documents viewer, so format-specific editors and save behavior stay in
  // their existing home.
  useEffect(() => {
    const openCrmDocument = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: unknown; name?: unknown }>).detail;
      if (!detail || typeof detail.path !== 'string' || !detail.path) return;
      const name = typeof detail.name === 'string' && detail.name ? detail.name : detail.path.split(/[\\/]/).pop() || detail.path;
      void handleFileOpen(detail.path, name).then((opened) => {
        if (!opened) return;
        setDocumentsView('editor');
        setSidebarActiveTab('files');
      });
    };
    window.addEventListener(EV_OPEN_CRM_DOCUMENT, openCrmDocument);
    return () => window.removeEventListener(EV_OPEN_CRM_DOCUMENT, openCrmDocument);
  }, [handleFileOpen, setDocumentsView, setSidebarActiveTab]);
  // Privacy Center + Activity Log are nested as sections inside the Settings
  // screen (the gear opens Settings). Built here so SettingsContent stays
  // decoupled from these surfaces' data wiring.
  const settingsNestedSections = [
    {
      id: 'privacy-center',
      label: 'Privacy Center',
      testid: 'settings-category-privacy-center',
      content: (
        <LazyBoundary
          loader={loadPrivacyCenterHome}
          fallback={<SurfaceLoadingFallback />}
          label="Privacy Center"
        >
          {(PrivacyCenterHome) => (
            <PrivacyCenterHome
              auditEntries={auditEntries}
              activeMatter={activeMatter}
            />
          )}
        </LazyBoundary>
      ),
    },
    {
      id: 'activity-log',
      label: 'Activity Log',
      testid: 'settings-category-activity-log',
      // LazyBoundary's own error boundary covers both a failed chunk fetch
      // AND a malformed audit row thrown later — a bad row must never
      // white-screen the Settings page.
      content: (
        <LazyBoundary
          loader={loadAuditHome}
          fallback={<SurfaceLoadingFallback />}
          label="Activity Log"
        >
          {(AuditHome) => (
            <AuditHome
              entries={auditEntries}
              integrity={auditIntegrity}
              onVerifyIntegrity={verifyAuditIntegrity}
              onRepairSeal={repairAuditSeal}
            />
          )}
        </LazyBoundary>
      ),
    },
  ];

  // ── Scoped per-client surfaces (Client Map hub sub-tabs) ────────────────────
  // Documents and Email are no longer global destinations: the hub renders them
  // scoped to the active client as sub-tabs. These builders produce the SAME
  // surfaces the (now programmatic-only) global `files`/`email` branches use, so
  // there is one wiring of every handler. The global `files` branch survives as
  // the editor host for Ctrl+P / Ask-citation document opens (editor-as-mode).
  const documentsMainPanel = () => (
    <MainPanel
      onFileOpen={handleFileOpen}
      onMove={handleMove}
      onRename={handleRenameWithName}
      onDownload={handleDownload}
      apiKeys={apiKeys}
      workspaceServiceRef={workspaceServiceRef}
      {...(rootPath ? { rootPath } : {})}
      onFileTreeChange={refreshFileTree}
      onAuditLog={addAuditEntry}
      onOpenFileAtPath={async (p, paragraphIndex, snippet) => {
        if (!rootPath) return;
        // resolveWorkspacePath detects an already-absolute path (POSIX, drive-
        // letter, or UNC) regardless of separator style, so a Windows path that
        // disagrees with rootPath on `\` vs `/` is no longer double-prefixed.
        const absPath = resolveWorkspacePath(rootPath, p);
        const name = absPath.split(/[\\/]/).pop() ?? absPath;
        await handleFileOpen(absPath, name);
        if (typeof paragraphIndex === 'number') {
          requestScrollToParagraph({
            path: absPath,
            paragraphIndex,
            ...(snippet ? { snippet } : {}),
          });
        }
      }}
      onRequestApiKeySetup={handleRequestApiKeySetup}
      workflowExecution={currentExecution}
      workflowTemplate={activeWorkflowTemplate}
      workflowInterviewQuestions={
        showInterviewDialog ? null : interviewQuestions
      }
      onWorkflowInterviewSubmit={handleInterviewSubmit}
      onWorkflowCancel={handleInterviewCancel}
      onWorkflowSaveAsFile={handleWorkflowSaveAsFile}
      onWorkflowExportDocx={handleWorkflowExportDocx}
      onWorkflowExportPptx={handleWorkflowExportPptx}
      workflowProviderError={workflowProviderError}
      onOpenSettings={() => openSettings('ai')}
      hideTabBar={true}
    />
  );

  const buildDocumentsHome = (opts: BuildDocumentsHomeOptions) => (
    <DocumentsHome
      // Per-client key so switching clients on the same sub-tab REMOUNTS this
      // surface (fresh currentFolderPath etc.) instead of reusing the prior
      // client's instance and writing new files into the prior client's folder
      // (matter isolation). Undefined for the global browser.
      key={opts.scopeMatterId}
      // Shared documentsView is passed in both modes so a file-open inside the
      // surface still flips to the editor. Embedded mode forces only the INITIAL
      // landing to the scoped file list (see DocumentsHome's `embedded` handling)
      // so it never mounts into a stale editor pane showing another client's
      // file — without freezing later browser->editor transitions.
      documentsView={documentsView}
      onFileOpen={handleFileOpen}
      onCreateFile={handleCreateFile}
      onCreateFolder={(parentPath) => {
        ensureScopeFolderForDocumentsHome(opts);
        handleCreateFolder(parentPath);
      }}
      onRename={handleRename}
      onRenameFile={handleRenameWithName}
      onDelete={handleDelete}
      onMove={handleMove}
      onDownload={handleDownload}
      onCreateDefaultDocument={(parentPath) => {
        ensureScopeFolderForDocumentsHome(opts);
        handleCreateDefaultDocument(parentPath);
      }}
      onImportFiles={(folderPath) => {
        ensureScopeFolderForDocumentsHome(opts);
        return handleImportFiles(folderPath);
      }}
      onCreateDocxAtRoot={(parentPath) => {
        ensureScopeFolderForDocumentsHome(opts);
        return handleCreateDocxAtRoot(parentPath);
      }}
      onCreateTextFileAtRoot={handleCreateTextFileAtRoot}
      onCreateFolderAtRoot={handleCreateFolderAtRoot}
      onSetLetterheadTemplate={handleSetLetterheadTemplate}
      trashItems={trashItems}
      trashStats={trashStats}
      onRestore={handleRestoreFromTrash}
      onPermanentDelete={handlePermanentDelete}
      onEmptyTrash={handleEmptyTrash}
      retentionPeriod={trashRetentionPeriod}
      customRetentionDays={trashCustomRetentionDays}
      onRetentionChange={handleTrashRetentionChange}
      {...(opts.embedded ? { embedded: true } : {})}
      {...(opts.scopeFolderPaths
        ? { scopeFolderPaths: opts.scopeFolderPaths }
        : {})}
      {...(opts.scopeMatterId ? { scopeMatterId: opts.scopeMatterId } : {})}
      mainPanelContent={documentsMainPanel()}
    />
  );

  function ensureScopeFolderForDocumentsHome(opts: BuildDocumentsHomeOptions): void {
    if (!opts.ensureScopeFolderMatterId || !opts.scopeFolderPaths) return;
    const folderPath = opts.scopeFolderPaths[0];
    useMatterStore.getState().setFolderPaths(opts.ensureScopeFolderMatterId, opts.scopeFolderPaths);
    const workspaceService = workspaceServiceRef.current;
    if (folderPath && workspaceService) {
      void workspaceService
        .mkdir(folderPath)
        .then(() => workspaceService.getFileTree())
        .then((tree) => {
          setFileTree(tree);
        })
        .catch((error: unknown) => {
          console.warn('[AppSurfaceRouter] could not create client document folder:', error);
        });
    }
  }

  const buildEmailWorkspace = (opts: {
    embedded?: boolean;
    scopeMatterId?: string;
  }) => (
    <LazyBoundary
      loader={loadEmailWorkspace}
      // A render error on one client's Email must not stay stuck when the
      // embedded per-client sub-tab switches to a DIFFERENT client — same
      // `loadEmailWorkspace` loader, different content.
      resetKey={opts.scopeMatterId}
      fallback={<SurfaceLoadingFallback />}
      label="Email"
    >
      {(EmailWorkspace) => (
        <EmailWorkspace
          // Per-client key — remount on client switch so Email selections / open
          // detail don't carry from one client into the next (matter isolation).
          key={opts.scopeMatterId}
          onSaveToWorkspace={async (content, suggestedName) => {
            if (!workspaceServiceRef.current || !rootPath) return;
            // Word-first: saved email content becomes a real .docx.
            const { resolveUniqueName } =
              await import('@/platform/utils/fileDrop');
            const { markdownToDocxBytes, docxBytesToDataUrl } =
              await import('@/platform/utils/docx-io');
            const firmName = (() => {
              try {
                return localStorage.getItem(SK_FIRM_NAME) ?? '';
              } catch {
                return '';
              }
            })();
            const base = suggestedName.replace(/\.(md|markdown|txt)$/i, '');
            const targetDir = resolveSavedDocumentDirectory({
              rootPath,
              activeMatter,
            });
            const finalName = await resolveUniqueName(
              workspaceServiceRef.current,
              targetDir,
              `${base}.docx`
            );
            const path = resolveSavedDocumentPath({
              rootPath,
              activeMatter,
              fileName: finalName,
            });
            const bytes = await markdownToDocxBytes(content, finalName, {
              firmName,
            });
            const buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            await workspaceServiceRef.current.writeFileBinary(path, buffer);
            const tree = await workspaceServiceRef.current.getFileTree();
            setFileTree(tree);
            routeSavedAskDocument({
              activeMatter,
              savedDocument: {
                path,
                name: finalName,
                content: docxBytesToDataUrl(bytes),
              },
              setDocumentsView,
              setSidebarActiveTab,
              setMattersSurfaceMode,
              pushNavigationSnapshot,
            });
          }}
          onOpenSettings={() => {
            window.dispatchEvent(
              new CustomEvent(EV_OPEN_ACCOUNT, {
                detail: { tab: 'connections' },
              })
            );
          }}
          {...(opts.embedded ? { embedded: true } : {})}
        />
      )}
    </LazyBoundary>
  );

  const buildActivity = (opts: { scopeMatterId?: string; clientMapSectionKey?: string; clientMapSectionTitle?: string }) => (
    // LazyBoundary's error boundary is the "auditable / inspectable" trust
    // surface guard: it contains BOTH a failed chunk fetch and a malformed
    // audit row thrown later, so neither can white-screen the whole app.
    // resetKey: a render error on one client's Activity log must not stay
    // stuck when the embedded per-client sub-tab switches clients — same
    // `loadAuditHome` loader, different content.
    <LazyBoundary
      loader={loadAuditHome}
      resetKey={opts.scopeMatterId}
      fallback={<SurfaceLoadingFallback />}
      label="Activity Log"
    >
      {(AuditHome) => (
        // Per-client key — remount on client switch so the Activity detail panel
        // / filters don't carry from one client into the next (matter isolation).
        <AuditHome
          key={opts.scopeMatterId}
          entries={auditEntries}
          integrity={auditIntegrity}
          onVerifyIntegrity={verifyAuditIntegrity}
          onRepairSeal={repairAuditSeal}
          {...(opts.scopeMatterId ? { scopeMatterId: opts.scopeMatterId } : {})}
          {...(opts.clientMapSectionKey ? {
            clientMapSectionKey: opts.clientMapSectionKey,
            ...(opts.clientMapSectionTitle ? { clientMapSectionTitle: opts.clientMapSectionTitle } : {}),
          } : {})}
        />
      )}
    </LazyBoundary>
  );

  const crmHomeHandoff = crmAddRequest
    ? {
        initialRoute: (
          {
            task: 'tasks',
            opportunity: 'pipeline',
            workflow: 'workflows',
          } satisfies Record<CrmHouseholdAddRequest['kind'], CrmHomeRoute>
        )[crmAddRequest.kind],
        addRequest: crmAddRequest,
        onAddRequestConsumed: () => {
          setCrmAddRequest(null);
        },
      }
    : undefined;
  const renderHome = (): ReactNode => <CrmHome {...crmHomeHandoff} />;

  /**
   * Resolve one safe client-owned folder before any Documents write. Existing
   * mappings are bounded to the open workspace; clients without a mapping get
   * the same collision-safe folder derivation used by the New Client flow.
   */
  const prepareClientDocumentsFolder = async (matterId: string): Promise<string | null> => {
    if (!rootPath) return null;
    const store = useMatterStore.getState();
    const matter = store.matters.find((candidate) => candidate.id === matterId && !candidate.archived);
    if (!matter) return null;

    const resolvedFolderPaths = resolveClientDocumentFolderPaths({
      matter,
      matters: store.matters,
      workspaceRoot: rootPath,
    });
    const folderPath = resolvedFolderPaths[0];
    if (!folderPath) return null;

    if (shouldBackfillClientDocumentFolder(matter, resolvedFolderPaths)) {
      store.setFolderPaths(matterId, resolvedFolderPaths);
    }
    const workspaceService = workspaceServiceRef.current;
    if (workspaceService) {
      await workspaceService.mkdir(folderPath);
      setFileTree(await workspaceService.getFileTree());
    }
    return folderPath;
  };

  const renderClients = (): ReactNode => (
    <ClientsSurface
      directoryComposition={directoryComposition}
      actions={{
        onAdd: (request: AddToHouseholdRequest) => {
          if (
            request.kind !== 'task' &&
            request.kind !== 'opportunity' &&
            request.kind !== 'workflow'
          )
            return;
          setCrmAddRequest({
            kind: request.kind,
            householdId: request.householdRef.id,
            householdLabel: request.householdRef.label ?? 'Untitled household',
          });
          setSidebarActiveTab('home');
        },
        onCreateClientDocument: async (matterId) => {
          const folderPath = await prepareClientDocumentsFolder(matterId);
          if (folderPath) {
            handleCreateDefaultDocument(folderPath);
          }
        },
        onCreateClientFolder: async (matterId) => {
          const folderPath = await prepareClientDocumentsFolder(matterId);
          if (folderPath) handleCreateFolder(folderPath);
        },
        onImportClientFiles: async (matterId) => {
          const folderPath = await prepareClientDocumentsFolder(matterId);
          if (folderPath) await handleImportFiles(folderPath);
        },
      }}
    />
  );

  const renderAsk = (): ReactNode => (
    <ErrorBoundary label="Ask">
      <CrmAskSurface
        onSaveToDocument={async (content) => {
          if (!workspaceServiceRef.current || !rootPath) return;
          const { deriveFilenameFromMessage, resolveUniqueName } =
            await import('@/platform/utils/fileDrop');
          const { markdownToDocxBytes, docxBytesToDataUrl } =
            await import('@/platform/utils/docx-io');
          const firmName = (() => {
            try {
              return localStorage.getItem(SK_FIRM_NAME) ?? '';
            } catch {
              return '';
            }
          })();
          const base = deriveFilenameFromMessage(content).replace(
            /\.(md|markdown|txt)$/i,
            ''
          );
          const targetDir = resolveSavedDocumentDirectory({
            rootPath,
            activeMatter,
          });
          const finalName = await resolveUniqueName(
            workspaceServiceRef.current,
            targetDir,
            `${base}.docx`
          );
          const path = resolveSavedDocumentPath({
            rootPath,
            activeMatter,
            fileName: finalName,
          });
          const bytes = await markdownToDocxBytes(content, finalName, {
            firmName,
          });
          const buffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buffer).set(bytes);
          await workspaceServiceRef.current.writeFileBinary(path, buffer);
          const tree = await workspaceServiceRef.current.getFileTree();
          setFileTree(tree);
          routeSavedAskDocument({
            activeMatter,
            savedDocument: {
              path,
              name: finalName,
              content: docxBytesToDataUrl(bytes),
            },
            setDocumentsView,
            setSidebarActiveTab,
            setMattersSurfaceMode,
            pushNavigationSnapshot,
          });
        }}
        prefillRequest={askPrefill}
        onPrefillConsumed={() => setAskPrefill(null)}
        onAuditLog={addAuditEntry}
        onOpenFileAtPath={(p, _paragraphIndex, snippet, matterId) => {
          if (typeof p === 'string' && p.startsWith('mail:')) {
            window.dispatchEvent(
              new CustomEvent(EV_OPEN_EMAIL, { detail: { sourceId: p } })
            );
            return;
          }
          const citationMatterId = matterId ?? activeMatter?.id;
          if (citationMatterId && typeof p === 'string') {
            void openMatterDocumentSource({
              matterId: citationMatterId,
              ref: p,
              ...(snippet ? { snippet } : {}),
              service: workspaceServiceRef.current,
              handlers: {
                setDocumentsView,
                setSidebarActiveTab,
                setMattersSurfaceMode,
                pushNavigationSnapshot,
              },
            });
          }
        }}
      />
    </ErrorBoundary>
  );

  const renderWorkflows = (): ReactNode => (
    <AssociateHome
      onStartWorkflow={handleStartWorkflow}
      currentExecution={currentExecution}
      runHistory={runHistory}
      providerError={workflowProviderError}
      saveError={workflowSaveError}
      onOpenSettings={() => openSettings('ai')}
      onOpenRunArtifact={(path, name) =>
        openRunArtifactFromWorkflows({
          path,
          name,
          handleFileOpen,
          setSidebarActiveTab,
          setDocumentsView,
          setMattersSurfaceMode,
          pushNavigationSnapshot,
        })
      }
      onFocusExecutionTab={() => {
        const target =
          activeWorkflowFilePath ??
          openTabs.find((tab) => isWorkflowFilePath(tab.path))?.path ??
          null;
        if (target) useEditorStore.getState().setActiveTab(target);
      }}
    />
  );

  const renderPrivacy = (): ReactNode => (
    <LazyBoundary
      loader={loadPrivacyCenterHome}
      fallback={<SurfaceLoadingFallback />}
      label="Privacy Center"
    >
      {(PrivacyCenterHome) => (
        <PrivacyCenterHome
          auditEntries={auditEntries}
          activeMatter={activeMatter}
        />
      )}
    </LazyBoundary>
  );

  const hostedSettings = {
    open: openSettings,
    action: handleSettingsAction,
    restartOnboarding: handleSettingsRestartOnboarding,
    loadTemplates: loadAllTemplates,
    extraSections: settingsNestedSections,
    ...(settingsPageFocus ? { pageFocus: settingsPageFocus } : {}),
  };

  const renderSettings = (): ReactNode => (
    <div
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      data-testid="settings-page"
    >
      <LazyBoundary
        loader={loadSettingsContent}
        fallback={<SurfaceLoadingFallback />}
        label="Settings"
      >
        {(SettingsContent) => (
          <SettingsContent
            key={settingsPageFocus?.key ?? 0}
            variant="page"
            auditEntries={auditEntries}
            templates={hostedSettings.loadTemplates()}
            hasWorkspaceOpen={Boolean(rootPath)}
            onAction={handleSettingsAction}
            onRestartOnboarding={handleSettingsRestartOnboarding}
            {...(settingsPageFocus?.category
              ? { initialCategory: settingsPageFocus.category }
              : {})}
            extraSections={hostedSettings.extraSections}
          />
        )}
      </LazyBoundary>
    </div>
  );

  const renderMainPanel = (): ReactNode => (
    <MainPanel
      onFileOpen={handleFileOpen}
      onMove={handleMove}
      onRename={handleRenameWithName}
      onDownload={handleDownload}
      apiKeys={apiKeys}
      workspaceServiceRef={workspaceServiceRef}
      {...(rootPath ? { rootPath } : {})}
      onFileTreeChange={refreshFileTree}
      onAuditLog={addAuditEntry}
      // M2 — Citations in AI responses navigate through here. We
      // resolve the retrieval path (workspace-relative) to the full
      // workspace path, then reuse the existing file-open pipeline.
      // F-504: the cited chunk's text (`snippet`) is carried through
      // so the editor can bring the exact passage on screen by search
      // (the paragraph index is a CHUNK index, only good for an
      // approximate fallback).
      onOpenFileAtPath={async (p, paragraphIndex, snippet) => {
        if (!rootPath) return;
        // `workspacePath` recognizes an already-absolute `p` via
        // `isAbsolutePath` (not a naive `startsWith(rootPath)`, which fails
        // closed/open incorrectly when `p`'s drive-letter case or separator
        // style differs from `rootPath`) and passes it through unchanged
        // instead of doubling it.
        const absPath = workspacePath(rootPath, p);
        const name = absPath.split('/').pop() ?? absPath;
        await handleFileOpen(absPath, name);
        // F-504 — editor scroll request. requestScrollToParagraph both
        // dispatches the event (already-mounted editors) and stashes a
        // pending slot the freshly-mounted editor consumes (mount race).
        if (typeof paragraphIndex === 'number') {
          requestScrollToParagraph({
            path: absPath,
            paragraphIndex,
            ...(snippet ? { snippet } : {}),
          });
        }
      }}
      onRequestApiKeySetup={handleRequestApiKeySetup}
      workflowExecution={currentExecution}
      workflowTemplate={activeWorkflowTemplate}
      workflowInterviewQuestions={
        showInterviewDialog ? null : interviewQuestions
      }
      onWorkflowInterviewSubmit={handleInterviewSubmit}
      onWorkflowCancel={handleInterviewCancel}
      onWorkflowSaveAsFile={handleWorkflowSaveAsFile}
      onWorkflowExportDocx={handleWorkflowExportDocx}
      onWorkflowExportPptx={handleWorkflowExportPptx}
      workflowProviderError={workflowProviderError}
      onOpenSettings={() => openSettings('ai')}
    />
  );

  const runtime: AppSurfaceRuntime = {
    ...capabilities,
    ...(crmHomeHandoff ? { crmHomeHandoff } : {}),
    settings: hostedSettings,
    legacy: {
      home: renderHome,
      clients: renderClients,
      ask: renderAsk,
      email: () => buildEmailWorkspace({}),
      documents: () => buildDocumentsHome({}),
      workflows: renderWorkflows,
      audit: () => buildActivity({}),
      privacy: renderPrivacy,
      scheduling: () => <SchedulingHome {...(onOpenWorkspace ? { onOpenWorkspace } : {})} />,
      settings: renderSettings,
      mainPanel: renderMainPanel,
    },
  };
  const navigationRuntimeRef = useRef(runtime);
  navigationRuntimeRef.current = runtime;

  // The event bus has already validated only the minimum request shape and
  // forwarded the raw intent here. This is the single navigation owner: alias
  // lookup, surface availability, and the existing runtime all meet here.
  useEffect(() => {
    const onNavigationTarget = (event: Event) => {
      const target = (
        event as CustomEvent<Partial<MatterNavigationTarget> | null>
      ).detail;
      if (!target?.matterId) return;

      const resolved = resolveNavigationTargetDescriptor(
        target as MatterNavigationTarget
      );
      void Promise.resolve(resolved)
        .then((targetDescriptor) => {
          if (!targetDescriptor) {
            console.warn(
              `[AppSurfaceRouter] Refused unknown navigation target "${target.surface ?? ''}".`
            );
            return;
          }

          const surfaceResolution = resolveAppSurfaceDescriptor(
            targetDescriptor.appSurfaceId
          );
          if (surfaceResolution.status === 'known-but-unavailable') {
            console.error(
              `[AppSurfaceRouter] Navigation target "${targetDescriptor.id}" points to unavailable surface "${targetDescriptor.appSurfaceId}"; falling back to "${SAFE_APP_SURFACE_ID}".`
            );
            void sendDiagnosticEvent({
              event: 'error_caught',
              component: 'AppSurfaceRouter',
              code: 'unknown_surface',
            });
            setSidebarActiveTab(SAFE_APP_SURFACE_ID);
            return;
          }

          if (surfaceResolution.status === 'unknown') {
            console.warn(
              `[AppSurfaceRouter] Refused navigation target "${targetDescriptor.id}" with unknown surface "${targetDescriptor.appSurfaceId}".`
            );
            return;
          }

          const surfaceDescriptor = surfaceResolution.descriptor;

          if (surfaceDescriptor.resolveNavigation) {
            const resolvedTarget: NavigationTarget = {
              ...target,
              surface: targetDescriptor.appSurfaceId,
            };
            const navigationResult = surfaceDescriptor.resolveNavigation(
              resolvedTarget,
              navigationRuntimeRef.current
            );
            return Promise.resolve(navigationResult);
          }

          return targetDescriptor.resolve(target as MatterNavigationTarget, {
            setSurface: setSidebarActiveTab,
            setDocumentsView,
            setAskPrefill,
            setMattersSurfaceMode,
            pushNavigationSnapshot,
          });
        })
        .catch((error: unknown) => {
          console.error(
            '[AppSurfaceRouter] Navigation target resolution failed',
            error
          );
        });
    };

    window.addEventListener(
      NAVIGATION_TARGET_DISPATCH_EVENT,
      onNavigationTarget
    );
    return () => {
      window.removeEventListener(
        NAVIGATION_TARGET_DISPATCH_EVENT,
        onNavigationTarget
      );
    };
  }, [
    pushNavigationSnapshot,
    setAskPrefill,
    setDocumentsView,
    setMattersSurfaceMode,
    setSidebarActiveTab,
  ]);

  if (!requestedDescriptor && !registryState.ready) {
    return <SurfaceLoadingFallback />;
  }

  const descriptor =
    requestedDescriptor ?? getAppSurfaceDescriptor(SAFE_APP_SURFACE_ID);
  if (!descriptor) {
    throw new Error(
      `[AppSurfaceRouter] Safe fallback "${SAFE_APP_SURFACE_ID}" is not registered`
    );
  }

  return (
    <SharedClientSurface
      enabled={sharedClientBarEnabled && !v1ShellFrameEnabled}
      clientContext={descriptor.clientContext}
    >
      {descriptor.render(runtime)}
    </SharedClientSurface>
  );
}
