/**
 * AppSurfaceRouter — presentational shell component that renders the correct
 * main surface for the currently active sidebar tab.
 *
 * Extracted from App.tsx (Phase 3 shell refactor) to keep App.tsx focused
 * on layout + state wiring while this file owns the surface-selection ternary.
 *
 * All handlers and state values are passed down as props. A tiny leaf wrapper
 * below uses an effect to save a client folder only after it already exists.
 * The component is purely presentational: it receives everything it needs and
 * delegates rendering to the appropriate surface component.
 */

import { useEffect, useState } from 'react';
import { CrmHome } from '@/features/crm-home';
import { ClientsSurface } from '@/features/crm-clients';
import type { AddToHouseholdRequest } from '@/features/crm-clients/adapters';
import type { CrmHouseholdAddRequest, CrmHomeRoute } from '@/features/crm-home/routes';
import { CrmAskSurface } from '@/features/crm-ask';
import { DocumentsHome } from '@/features/documents/DocumentsHome';
import { AssociateHome } from '@/features/workflows/AssociateHome';
import { SchedulingHome } from '@/features/scheduling/SchedulingHome';
import { LazyBoundary } from '@/ui/LazyBoundary';
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

import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import {
  resolveSavedDocumentDirectory,
  resolveSavedDocumentPath,
  routeSavedAskDocument,
} from '@/app/shell/routeSavedAskDocument';
import { openMatterDocumentSource } from '@/app/shell/matterDocumentNavigation';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import type {
  WorkflowExecution,
  WorkflowTemplate,
  InterviewQuestion,
  RunRecord,
} from '@/platform/types/workflow';
import type { AuditEntry } from '@/platform/types/audit';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import type { APIKey } from '@/platform/types';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { FileNode } from '@/platform/types/workspace';
import type { SettingCategory } from '@/platform/settings/schema';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { TrashRetentionPeriod } from '@/features/documents/TrashPanel';
import type { Matter } from '@/platform/types/matter';
import {
  EV_OPEN_CRM_DOCUMENT,
  EV_OPEN_ACCOUNT,
  EV_OPEN_EMAIL,
  SK_FIRM_NAME,
} from '@/config/identity';

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

export interface AppSurfaceRouterProps {
  sidebarActiveTab: AppSurface;
  askPrefill: { question: string; autoSubmit?: boolean } | null;
  setAskPrefill: React.Dispatch<
    React.SetStateAction<{ question: string; autoSubmit?: boolean } | null>
  >;
  documentsView: 'browser' | 'editor';
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
  mattersSurfaceMode: MattersSurfaceMode;
  setMattersSurfaceMode: (mode: MattersSurfaceMode) => void;
  pushNavigationSnapshot: () => void;
  currentExecution: WorkflowExecution | null;
  activeWorkflowTemplate: WorkflowTemplate | null;
  showInterviewDialog: boolean;
  interviewQuestions: InterviewQuestion[] | null;
  workflowProviderError:
    | 'needs-provider'
    | 'ollama-unreachable'
    | 'needs-client'
    | null;
  /** BUG F2 — non-null when the terminal .workflow run-record write failed to
   *  save after retries. Rendered as a Callout on the workflows home,
   *  mirroring `workflowProviderError`'s plumbing. */
  workflowSaveError: string | null;
  runHistory: RunRecord[];
  auditEntries: AuditEntry[];
  auditIntegrity: AuditIntegrityVerdict | undefined;
  verifyAuditIntegrity: () => Promise<AuditIntegrityVerdict | undefined>;
  repairAuditSeal: () => Promise<void>;
  apiKeys: APIKey[];
  rootPath: string | null | undefined;
  fileTree: FileNode[];
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  trashRetentionPeriod: TrashRetentionPeriod;
  trashCustomRetentionDays: number;
  activeWorkflowFilePath: string | null;
  openTabs: ReturnType<typeof useEditorStore.getState>['openTabs'];
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  setFileTree: (tree: FileNode[]) => void;
  openSettings: (category?: SettingCategory) => void;
  handleFileOpen: (path: string, name: string) => Promise<boolean>;
  handleCreateFile: (parentPath: string) => void;
  handleCreateFolder: (parentPath: string) => void;
  handleRename: (path: string) => void;
  handleRenameWithName: (path: string, newName: string) => Promise<void>;
  handleDelete: (path: string) => void;
  handleMove: (sourcePath: string, targetPath: string) => Promise<void>;
  handleDownload: (path: string, name: string) => void;
  handleCreateDefaultDocument: (parentPath?: string) => void;
  handleImportFiles: (folderPath?: string | null) => Promise<void>;
  handleCreateDocxAtRoot: (parentPath?: string) => Promise<void>;
  handleCreateTextFileAtRoot: () => Promise<void>;
  handleCreateFolderAtRoot: () => Promise<void>;
  handleSetLetterheadTemplate: (path: string) => void;
  handleRestoreFromTrash: (id: string) => Promise<void>;
  handlePermanentDelete: (id: string) => Promise<void>;
  handleEmptyTrash: () => Promise<void>;
  handleTrashRetentionChange: (
    period: TrashRetentionPeriod,
    customDays?: number
  ) => void;
  refreshFileTree: () => void;
  addAuditEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  handleRequestApiKeySetup: () => void;
  handleInterviewSubmit: (answers: Record<string, string>) => void;
  handleInterviewCancel: () => void;
  handleWorkflowSaveAsFile: (
    content: string,
    suggestedName: string
  ) => Promise<void>;
  handleWorkflowExportDocx: (
    content: string,
    suggestedName: string
  ) => Promise<void>;
  handleWorkflowExportPptx: (
    content: string,
    suggestedName: string
  ) => Promise<void>;
  handleStartWorkflow: (template: WorkflowTemplate) => Promise<void>;
  handleSettingsAction: (actionId: string) => void;
  handleSettingsRestartOnboarding: () => void;
  activeMatter: Matter | null;
  settingsPageFocus?: { category?: SettingCategory; key: number };
}

type BuildDocumentsHomeOptions = {
  embedded?: boolean;
  scopeFolderPaths?: string[];
  scopeMatterId?: string;
  ensureScopeFolderMatterId?: string;
};

export function AppSurfaceRouter({
  sidebarActiveTab,
  askPrefill,
  setAskPrefill,
  documentsView,
  setDocumentsView,
  setSidebarActiveTab,
  setMattersSurfaceMode,
  pushNavigationSnapshot,
  currentExecution,
  activeWorkflowTemplate,
  showInterviewDialog,
  interviewQuestions,
  workflowProviderError,
  workflowSaveError,
  runHistory,
  auditEntries,
  auditIntegrity,
  verifyAuditIntegrity,
  repairAuditSeal,
  apiKeys,
  rootPath,
  trashItems,
  trashStats,
  trashRetentionPeriod,
  trashCustomRetentionDays,
  activeWorkflowFilePath,
  openTabs,
  workspaceServiceRef,
  setFileTree,
  openSettings,
  handleFileOpen,
  handleCreateFile,
  handleCreateFolder,
  handleRename,
  handleRenameWithName,
  handleDelete,
  handleMove,
  handleDownload,
  handleCreateDefaultDocument,
  handleImportFiles,
  handleCreateDocxAtRoot,
  handleCreateTextFileAtRoot,
  handleCreateFolderAtRoot,
  handleSetLetterheadTemplate,
  handleRestoreFromTrash,
  handlePermanentDelete,
  handleEmptyTrash,
  handleTrashRetentionChange,
  refreshFileTree,
  addAuditEntry,
  handleRequestApiKeySetup,
  handleInterviewSubmit,
  handleInterviewCancel,
  handleWorkflowSaveAsFile,
  handleWorkflowExportDocx,
  handleWorkflowExportPptx,
  handleStartWorkflow,
  handleSettingsAction,
  handleSettingsRestartOnboarding,
  activeMatter,
  settingsPageFocus,
}: AppSurfaceRouterProps) {
  const [crmAddRequest, setCrmAddRequest] = useState<CrmHouseholdAddRequest | null>(null);
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

  return (
    <>
      {sidebarActiveTab === 'home' ? (
        <CrmHome
          {...(crmAddRequest ? {
            initialRoute: ({
              task: 'tasks',
              opportunity: 'pipeline',
              workflow: 'workflows',
            } satisfies Record<CrmHouseholdAddRequest['kind'], CrmHomeRoute>)[crmAddRequest.kind],
            addRequest: crmAddRequest,
            onAddRequestConsumed: () => { setCrmAddRequest(null); },
          } : {})}
        />
      ) : sidebarActiveTab === 'matters' ? (
        <ClientsSurface
          actions={{
            onAdd: (request: AddToHouseholdRequest) => {
              if (
                request.kind !== 'task' &&
                request.kind !== 'opportunity' &&
                request.kind !== 'workflow'
              ) return;
              setCrmAddRequest({
                kind: request.kind,
                householdId: request.householdRef.id,
                householdLabel: request.householdRef.label ?? 'Untitled household',
              });
              setSidebarActiveTab('home');
            },
          }}
        />
      ) : sidebarActiveTab === 'search' ? (
        <CrmAskSurface
          onSaveToDocument={async (content) => {
            if (!workspaceServiceRef.current || !rootPath) return;
            // Word-first: AI answers save as a real .docx (not markdown).
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
      ) : sidebarActiveTab === 'email' ? (
        buildEmailWorkspace({})
      ) : sidebarActiveTab === 'files' ? (
        buildDocumentsHome({})
      ) : sidebarActiveTab === 'workflows' ? (
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
              openTabs.find((t) => isWorkflowFilePath(t.path))?.path ??
              null;
            if (target) {
              useEditorStore.getState().setActiveTab(target);
            }
          }}
        />
      ) : sidebarActiveTab === 'audit' ? (
        buildActivity({})
      ) : sidebarActiveTab === 'privacy' ? (
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
      ) : sidebarActiveTab === 'scheduling' ? (
        <SchedulingHome />
      ) : sidebarActiveTab === 'settings' ? (
        // Full-page Settings surface — the SAME content as the quick modal
        // (5-section nav, search, accordion sub-sections, Export/Import/Reset),
        // rendered in the main window instead of a dialog. The gear / Ctrl+,
        // modal still works for quick, deep-linked access.
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
                templates={loadAllTemplates()}
                hasWorkspaceOpen={Boolean(rootPath)}
                onAction={handleSettingsAction}
                onRestartOnboarding={handleSettingsRestartOnboarding}
                {...(settingsPageFocus?.category
                  ? { initialCategory: settingsPageFocus.category }
                  : {})}
                extraSections={settingsNestedSections}
              />
            )}
          </LazyBoundary>
        </div>
      ) : (
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
      )}
    </>
  );
}
