/**
 * AppSurfaceRouter — presentational shell component that renders the correct
 * main surface for the currently active sidebar tab.
 *
 * Extracted from App.tsx (Phase 3 shell refactor) to keep App.tsx focused
 * on layout + state wiring while this file owns the surface-selection ternary.
 *
 * All handlers and state values are passed down as props — no hooks here.
 * The component is purely presentational: it receives everything it needs and
 * delegates rendering to the appropriate surface component.
 */

import { MattersHome } from '@/features/matters/MattersHome';
import { Ask } from '@/features/ask/Ask';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';
import { DocumentsHome } from '@/features/documents/DocumentsHome';
import { AssociateHome } from '@/features/workflows/AssociateHome';
import { AuditHome } from '@/features/audit/AuditHome';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { PrivacyCenterHome } from '@/features/privacy/PrivacyCenterHome';
import { MainPanel } from '@/app/shell/layout/MainPanel';
import { SettingsContent } from '@/features/settings/SettingsContent';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import { requestScrollToParagraph } from '@/platform/utils/scrollToParagraph';
import { isWorkflowFilePath } from '@/features/workflows/engine/workflowFile';
import { useEditorStore } from '@/platform/state/editorStore';

import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { WorkflowExecution, WorkflowTemplate, InterviewQuestion, RunRecord } from '@/platform/types/workflow';
import type { AuditEntry } from '@/platform/types/audit';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import type { APIKey } from '@/platform/types';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { FileNode } from '@/platform/types/workspace';
import type { SettingCategory } from '@/platform/settings/schema';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { TrashRetentionPeriod } from '@/features/documents/TrashPanel';
import type { Matter } from '@/platform/types/matter';

export interface AppSurfaceRouterProps {
  sidebarActiveTab: AppSurface;
  askPrefill: { question: string; autoSubmit?: boolean } | null;
  setAskPrefill: React.Dispatch<React.SetStateAction<{ question: string; autoSubmit?: boolean } | null>>;
  documentsView: 'browser' | 'editor';
  currentExecution: WorkflowExecution | null;
  activeWorkflowTemplate: WorkflowTemplate | null;
  showInterviewDialog: boolean;
  interviewQuestions: InterviewQuestion[] | null;
  workflowProviderError: 'needs-provider' | 'ollama-unreachable' | null;
  runHistory: RunRecord[];
  auditEntries: AuditEntry[];
  auditIntegrity: AuditIntegrityVerdict | undefined;
  verifyAuditIntegrity: () => Promise<AuditIntegrityVerdict | undefined>;
  apiKeys: APIKey[];
  rootPath: string | null | undefined;
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  trashRetentionPeriod: TrashRetentionPeriod;
  trashCustomRetentionDays: number;
  activeWorkflowFilePath: string | null;
  openTabs: ReturnType<typeof useEditorStore.getState>['openTabs'];
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  setFileTree: (tree: FileNode[]) => void;
  openFile: (path: string, name: string, content: string) => void;
  openSettings: (category?: SettingCategory) => void;
  handleFileOpen: (path: string, name: string) => Promise<void>;
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
  handleTrashRetentionChange: (period: TrashRetentionPeriod, customDays?: number) => void;
  refreshFileTree: () => void;
  addAuditEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  handleRequestApiKeySetup: () => void;
  handleInterviewSubmit: (answers: Record<string, string>) => void;
  handleInterviewCancel: () => void;
  handleWorkflowSaveAsFile: (content: string, suggestedName: string) => Promise<void>;
  handleWorkflowExportDocx: (content: string, suggestedName: string) => Promise<void>;
  handleWorkflowExportPptx: (content: string, suggestedName: string) => Promise<void>;
  handleStartWorkflow: (template: WorkflowTemplate) => Promise<void>;
  handleSettingsAction: (actionId: string) => void;
  handleSettingsRestartOnboarding: () => void;
  activeMatter: Matter | null;
}

export function AppSurfaceRouter({
  sidebarActiveTab,
  askPrefill,
  setAskPrefill,
  documentsView,
  currentExecution,
  activeWorkflowTemplate,
  showInterviewDialog,
  interviewQuestions,
  workflowProviderError,
  runHistory,
  auditEntries,
  auditIntegrity,
  verifyAuditIntegrity,
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
  openFile,
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
}: AppSurfaceRouterProps) {
  // Privacy Center + Activity Log are nested as sections inside the Settings
  // screen (the gear opens Settings). Built here so SettingsContent stays
  // decoupled from these surfaces' data wiring.
  const settingsNestedSections = [
    {
      id: 'privacy-center',
      label: 'Privacy Center',
      testid: 'settings-category-privacy-center',
      content: <PrivacyCenterHome auditEntries={auditEntries} activeMatter={activeMatter} />,
    },
    {
      id: 'activity-log',
      label: 'Activity Log',
      testid: 'settings-category-activity-log',
      // Same error-boundary guard the standalone Activity Log surface uses:
      // a malformed audit row must never white-screen the Settings page.
      content: (
        <ErrorBoundary label="Activity Log">
          <AuditHome
            entries={auditEntries}
            integrity={auditIntegrity}
            onVerifyIntegrity={verifyAuditIntegrity}
          />
        </ErrorBoundary>
      ),
    },
  ];

  return (
    <>
      {sidebarActiveTab ==='matters' ? (
        <MattersHome onAuditLog={addAuditEntry} />
      ) : sidebarActiveTab ==='search' ? (
        <Ask
          onSaveToDocument={async (content) => {
            if (!workspaceServiceRef.current || !rootPath) return;
            // Word-first: AI answers save as a real .docx (not markdown).
            const { deriveFilenameFromMessage, resolveUniqueName } = await import('@/platform/utils/fileDrop');
            const { markdownToDocxBytes, docxBytesToDataUrl } = await import('@/platform/utils/docx-io');
            const firmName = (() => { try { return localStorage.getItem('keepance_firm_name') ?? ''; } catch { return ''; } })();
            const base = deriveFilenameFromMessage(content).replace(/\.(md|markdown|txt)$/i, '');
            const finalName = await resolveUniqueName(workspaceServiceRef.current, rootPath, `${base}.docx`);
            const path = `${rootPath}/${finalName}`;
            const bytes = await markdownToDocxBytes(content, finalName, { firmName });
            const buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            await workspaceServiceRef.current.writeFileBinary(path, buffer);
            const tree = await workspaceServiceRef.current.getFileTree();
            setFileTree(tree);
            openFile(path, finalName, docxBytesToDataUrl(bytes));
          }}
          prefillRequest={askPrefill}
          onPrefillConsumed={() => setAskPrefill(null)}
          onAuditLog={addAuditEntry}
          onOpenFileAtPath={(p) => {
            // Wave 2 — email relocation: an email citation in an Ask answer opens
            // the light EmailViewer reading view (via keepance:open-email, the
            // same path the .aichat chat uses). Without this the Ask surface
            // dispatched nothing, so email citations were a dead click. Document
            // citations keep their in-place SourcePanel passage; their dedicated
            // citation viewer lands in Wave 3.
            if (typeof p === 'string' && p.startsWith('mail:')) {
              window.dispatchEvent(new CustomEvent('keepance:open-email', { detail: { sourceId: p } }));
            }
          }}
        />
      ) : sidebarActiveTab ==='email' ? (
        <EmailWorkspace
          onSaveToWorkspace={async (content, suggestedName) => {
            if (!workspaceServiceRef.current || !rootPath) return;
            // Word-first: saved email content becomes a real .docx.
            const { resolveUniqueName } = await import('@/platform/utils/fileDrop');
            const { markdownToDocxBytes, docxBytesToDataUrl } = await import('@/platform/utils/docx-io');
            const firmName = (() => { try { return localStorage.getItem('keepance_firm_name') ?? ''; } catch { return ''; } })();
            const base = suggestedName.replace(/\.(md|markdown|txt)$/i, '');
            const finalName = await resolveUniqueName(workspaceServiceRef.current, rootPath, `${base}.docx`);
            const path = `${rootPath}/${finalName}`;
            const bytes = await markdownToDocxBytes(content, finalName, { firmName });
            const buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            await workspaceServiceRef.current.writeFileBinary(path, buffer);
            const tree = await workspaceServiceRef.current.getFileTree();
            setFileTree(tree);
            openFile(path, finalName, docxBytesToDataUrl(bytes));
          }}
          onOpenSettings={() => {
            window.dispatchEvent(new CustomEvent('keepance:open-account', { detail: { tab: 'connections' } }));
          }}
        />
      ) : sidebarActiveTab ==='files' ? (
        <DocumentsHome
          documentsView={documentsView}
          onFileOpen={handleFileOpen}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          onMove={handleMove}
          onDownload={handleDownload}
          onCreateDefaultDocument={handleCreateDefaultDocument}
          onImportFiles={handleImportFiles}
          onCreateDocxAtRoot={handleCreateDocxAtRoot}
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
          mainPanelContent={
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
                const absPath = p.startsWith(rootPath)
                  ? p
                  : `${rootPath}/${p}`.replace(/\/+/g, '/');
                const name = absPath.split('/').pop() ?? absPath;
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
              workflowInterviewQuestions={showInterviewDialog ? null : interviewQuestions}
              onWorkflowInterviewSubmit={handleInterviewSubmit}
              onWorkflowCancel={handleInterviewCancel}
              onWorkflowSaveAsFile={handleWorkflowSaveAsFile}
              onWorkflowExportDocx={handleWorkflowExportDocx}
              onWorkflowExportPptx={handleWorkflowExportPptx}
              workflowProviderError={workflowProviderError}
              onOpenSettings={() => openSettings('ai')}
              hideTabBar={true}
            />
          }
        />
      ) : sidebarActiveTab ==='workflows' ? (
        <AssociateHome
          onStartWorkflow={handleStartWorkflow}
          currentExecution={currentExecution}
          runHistory={runHistory}
          providerError={workflowProviderError}
          onOpenSettings={() => openSettings('ai')}
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
      ) : sidebarActiveTab ==='audit' ? (
        // Error boundary: the Activity Log is the "auditable / inspectable" trust
        // surface, so one malformed audit row must never white-screen the whole
        // app — contain any render failure here. (The data layer is also guarded
        // against missing inputs/outputs/metadata via asRecord.)
        <ErrorBoundary label="Activity Log">
          <AuditHome
            entries={auditEntries}
            integrity={auditIntegrity}
            onVerifyIntegrity={verifyAuditIntegrity}
          />
        </ErrorBoundary>
      ) : sidebarActiveTab ==='privacy' ? (
        <PrivacyCenterHome auditEntries={auditEntries} activeMatter={activeMatter} />
      ) : sidebarActiveTab ==='settings' ? (
        // Full-page Settings surface — the SAME content as the quick modal
        // (5-section nav, search, accordion sub-sections, Export/Import/Reset),
        // rendered in the main window instead of a dialog. The gear / Ctrl+,
        // modal still works for quick, deep-linked access.
        <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="settings-page">
          <SettingsContent
            variant="page"
            auditEntries={auditEntries}
            templates={loadAllTemplates()}
            onAction={handleSettingsAction}
            onRestartOnboarding={handleSettingsRestartOnboarding}
            extraSections={settingsNestedSections}
          />
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
          const absPath = p.startsWith(rootPath)
            ? p
            : `${rootPath}/${p}`.replace(/\/+/g, '/');
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
        workflowInterviewQuestions={showInterviewDialog ? null : interviewQuestions}
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
