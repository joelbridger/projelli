/**
 * Keepance — Local-first AI workspace for confidential client work.
 *
 * Core Thesis: This is NOT a chat UI. It is an artifact-driven workspace
 * where AI proposes and the user approves all destructive actions.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useGlobalEventBus, type AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import { useAutosave } from '@/app/lifecycle/useAutosave';
import { useThemeManager } from '@/app/lifecycle/useThemeManager';
import { useWorkspaceLifecycle } from '@/app/lifecycle/useWorkspaceLifecycle';
import { useKeyboardShortcuts } from '@/app/commands/useKeyboardShortcuts';
import { useAppCommands } from '@/app/commands/useAppCommands';
import { useDialogManager } from '@/app/dialogs/useDialogManager';
import { useFileOperations } from '@/app/fileOps/useFileOperations';
import { useDocumentCreation } from '@/app/fileOps/useDocumentCreation';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';

import { AppShellNav } from '@/components/layout/AppShellNav';
import { ReimaginedTrustBar } from '@/components/layout/ReimaginedTrustBar';
import { ReimaginedMattersHome } from '@/components/matter/ReimaginedMattersHome';
import { ReimaginedAsk } from '@/components/ai/ReimaginedAsk';
import { ReimaginedEmailWorkspace } from '@/components/mail/ReimaginedEmailWorkspace';
import { ReimaginedDocumentsHome } from '@/components/documents/ReimaginedDocumentsHome';
import { ReimaginedAssociateHome } from '@/components/workflow/ReimaginedAssociateHome';
import { ReimaginedAuditHome } from '@/components/audit/ReimaginedAuditHome';
import { MainPanel } from '@/components/layout/MainPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { AppDialogs } from '@/app/shell/AppDialogs';

import { ProjectManager } from '@/components/workspace/ProjectManager';
import { Button } from '@/components/ui/button';
import { Command, Moon, Monitor, Sun, Settings } from 'lucide-react';
import { manualUpdateCheck } from '@/components/updater/UpdateManager';
import { openExternal } from '@/utils/openExternal';
import { SettingsContent } from '@/components/settings/SettingsContent';
import { TrialBanner } from '@/components/trial';
import { hasCompletedOnboarding } from '@/components/onboarding';
import { GuidedOnboarding } from '@/components/onboarding/GuidedOnboarding';
import { createKeychainService } from '@/modules/models/KeychainService';
import { sendEvent } from '@/utils/telemetry';
import { useFeatureTour } from '@/hooks/useFeatureTour';
import { useSettingsStore } from '@/stores/settingsStore';
// M1 (v1.5) Memory: workspace RAG indexer + status UI.
import { ModelDownloadCard } from '@/components/memory/ModelDownloadCard';
import { RagProgressBanner } from '@/components/memory/RagProgressBanner';
import { useMemoryWiring } from '@/hooks/useMemoryWiring';
import { useGlobalFileDrop } from '@/components/common/GlobalDropOverlay';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { saveFile } from '@/utils/saveFile';
import { useEditorStore } from '@/stores/editorStore';
import { useFileBackupStore } from '@/stores/fileBackupStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { createWorkspaceService, type WorkspaceService } from '@/modules/workspace/WorkspaceService';
import { createWebFSBackend } from '@/modules/workspace/WebFSBackend';
import type { WorkflowTemplate, WorkflowExecution, InterviewQuestion } from '@/types/workflow';
import type { TrashedItem } from '@/modules/history/TrashService';

import type { AuditEntry, AuditScope } from '@/types/audit';
import { AuditService, auditEventToEntry } from '@/modules/audit/AuditService';
import { createWorkflowEngine } from '@/modules/workflow/WorkflowEngine';
import { loadAllTemplates } from '@/modules/workflow/userTemplates';
import { MemoryService } from '@/modules/memory/MemoryService';
import { getActiveScope, getOrCreateSampleMatter, useMatterStore } from '@/stores/matterStore';
import { useMatterUiStore, isWorkingSurface } from '@/stores/matterUiStore';

import { ragVerifyCitation, type RetrievalScope } from '@/utils/tauri-commands';
import {
  TemplateMetadataReader,
  type MarketplaceService,
} from '@/modules/marketplace';
import {
  resolveTemplateModel,
  resolveWorkflowProvider,
  TEMPLATE_MODEL_OVERRIDES_KEY,
  type TemplateModelOverride,
} from '@/modules/workflow/resolveTemplateModel';
import type { TemplateProviderId } from '@/types/workflow';
import {
  appendCompletedInterviewAnswers,
  buildWorkflowFilename,
  executionToFileData,
  isWorkflowFilePath,
} from '@/modules/workflow/workflowFile';
import type { WorkflowFileData } from '@/types/workflow';
import { createMockProvider } from '@/modules/models/MockProvider';
import { createClaudeProvider } from '@/modules/models/ClaudeProvider';
import { createOpenAIProvider } from '@/modules/models/OpenAIProvider';
import { createGeminiProvider } from '@/modules/models/GeminiProvider';
import { OllamaProvider, detectOllama, OLLAMA_DEFAULT_MODEL } from '@/modules/models/OllamaProvider';
// F-502 — workflow provider resolution must honor the confidentiality mode.
// getConfidentialityMode is the non-reactive read (correct inside a handler).
import { modeRestrictsToLocal } from '@/modules/privacy/egress';
import { getConfidentialityMode } from '@/hooks/useConfidentialityMode';
import { FileSystemWatcher, createFileTreeSnapshot } from '@/modules/workspace/FileSystemWatcher';

import { isBinaryFile, arrayBufferToDataUrl, getMimeType } from '@/utils/file-utils';
import { writeDroppedFiles } from '@/utils/fileDrop';
import { requestScrollToParagraph } from '@/utils/scrollToParagraph';


import { useTrash } from '@/hooks/useTrash';
import { useSourceCards } from '@/hooks/useSourceCards';
import { useAIChatFiles } from '@/hooks/useAIChatFiles';
import { useApiKeys } from '@/hooks/useApiKeys';
import { useOpenFileAIContext } from '@/hooks/useOpenFileAIContext';
import { useFileContextStore } from '@/stores/fileContextStore';
import { useTemplatesMarketplaceStore } from '@/stores/templatesMarketplaceStore';
import { buildOpenFilesPromptBlock } from '@/components/ai/AIChatViewer';
import { useModelList } from '@/hooks/useModelList';
import { useContentIndex } from '@/hooks/useContentIndex';
import { useMailSync } from '@/hooks/useMailSync';
import { useOpenEmailListener } from '@/hooks/useOpenEmailListener';
import type { MailIndexChunk } from '@/utils/mail-commands';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { usePromptDialog } from '@/hooks/usePromptDialog';
import { useUndoToast } from '@/components/common/UndoToast';

// Module-level constants so the onboarding/tour effects have stable deps
// and never need to be listed in exhaustive-deps disable comments.
const IS_TEST_MODE =
  typeof window !== 'undefined' &&
  window.location.search.includes('testMode=true');
const IS_DEMO_MODE =
  typeof window !== 'undefined' &&
  (window as unknown as { __keepanceDemo?: boolean }).__keepanceDemo === true;

function App() {
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(!IS_TEST_MODE && !IS_DEMO_MODE);
  const [demoOpenFailed, setDemoOpenFailed] = useState(false);
  const {
    showCommandPalette, setShowCommandPalette,
    showShortcutsOverlay, setShowShortcutsOverlay,
    showQuickOpen, setShowQuickOpen,
    showAudioRecorder, setShowAudioRecorder,
    showSettingsModal, setShowSettingsModal,
    settingsInitialCategory,
    openSettings,
    accountWindowOpen, setAccountWindowOpen,
    matterManagerOpen, setMatterManagerOpen,
    showWhatsNewModalDirect, setShowWhatsNewModalDirect,
    apiKeyWizardOpen, setApiKeyWizardOpen,
  } = useDialogManager();
  // Shared contract — "Ask from the matter hub prefills Search".
  // MatterHub dispatches a keepance:matter-launch event with surface='search'
  // and a question string; App sets this state; ReimaginedAsk consumes it.
  const [askPrefill, setAskPrefill] = useState<{ question: string; autoSubmit?: boolean } | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const featureTour = useFeatureTour();

  // First-run onboarding: the rebuilt FirstRunWizard is the live first-run
  // surface (welcome -> profession -> workspace -> data map -> AI setup ->
  // demo -> done). It supersedes the old WelcomeOnboardingDialog, which had
  // only the email/telemetry consent step — the wizard now owns the welcome
  // moment. Triggered when there is no completed-onboarding flag AND no recent
  // workspace (matching the wizard's documented first-run condition), and
  // suppressed in test/demo modes. `?forceOnboarding=true` forces it for QA.
  const [showFirstRun, setShowFirstRun] = useState(false);

  // Anonymous telemetry: emit one app_launch event per session, gated
  // by user consent. Other lifecycle events (trial_start, trial_end,
  // license_activated, license_deactivated) live in their respective
  // hooks so they fire from the source of the state change.
  useEffect(() => {
    void sendEvent('app_launch');
    // Mount the wizard after a tiny delay so the workspace selector gets to
    // render first — the wizard then layers over it as a full-screen overlay,
    // honoring the existing path-input vs file-picker flow underneath.
    const forceOnboarding =
      typeof window !== 'undefined' &&
      window.location.search.includes('forceOnboarding=true');
    const noRecentWorkspaces =
      useWorkspaceStore.getState().recentWorkspaces.length === 0;
    const shouldShow =
      (!hasCompletedOnboarding() &&
        noRecentWorkspaces &&
        !IS_TEST_MODE &&
        !IS_DEMO_MODE) ||
      forceOnboarding;
    if (shouldShow) {
      const id = setTimeout(() => setShowFirstRun(true), 1200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, []);

  // v1.6: auto-show feature tour on first launch (post-first-run wizard) once
  // the sidebar testids exist in the DOM. Persistent flag stops re-triggering.
  // Suppressed in test mode (other E2E specs) unless the URL explicitly opts
  // in via ?forceTour=true. The dedicated tour spec uses the opt-in, which
  // also bypasses the persistent completed/skipped flags for fast iteration.
  // The tour must not open while the onboarding overlay is still visible.
  const FORCE_TOUR = typeof window !== 'undefined' &&
                     window.location.search.includes('forceTour=true');
  useEffect(() => {
    if ((IS_TEST_MODE || IS_DEMO_MODE) && !FORCE_TOUR) return;
    if (!FORCE_TOUR && !featureTour.shouldAutoShow) return;
    // Do not open the tour while the onboarding overlay is open.
    if (showFirstRun) return;
    const timeoutId = setTimeout(() => setTourOpen(true), 800);
    return () => clearTimeout(timeoutId);
  }, [FORCE_TOUR, featureTour.shouldAutoShow, showFirstRun]);
  const workspaceServiceRef = useRef<WorkspaceService | null>(null);
  const fileSystemWatcherRef = useRef<FileSystemWatcher | null>(null);

  // Keepance 3.0 — the audit "defense file" persistence layer. On the desktop
  // this writes every AI-action audit entry to a SQLCipher-ENCRYPTED store at
  // rest; in the browser it falls back to (unencrypted) localStorage. Created
  // once and pointed at the active workspace in `handleWorkspaceSelected`. The
  // `auditEntries` React state below is the live view; `addAuditEntry` both
  // updates that state and persists through this service.
  const auditServiceRef = useRef<AuditService>(new AuditService());

  // Stream C1 — Templates Marketplace service. Constructed once when a
  // workspace is selected (each workspace gets its own install root under
  // `<workspaceRoot>/.keepance/templates`). The metadata reader reads
  // installed entries off disk and adapts them into WorkflowTemplate for the
  // engine. Both refs are nullable until a workspace is loaded.
  const templatesMarketplaceServiceRef = useRef<MarketplaceService | null>(null);
  const templatesMetadataReaderRef = useRef<TemplateMetadataReader | null>(null);
  // Workflow state
  const [currentExecution, setCurrentExecution] = useState<WorkflowExecution | null>(null);
  const [activeWorkflowTemplate, setActiveWorkflowTemplate] = useState<WorkflowTemplate | null>(null);
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[] | null>(null);
  const [interviewResolver, setInterviewResolver] = useState<((answers: Record<string, string>) => void) | null>(null);
  const [interviewRejecter, setInterviewRejecter] = useState<((error: Error) => void) | null>(null);
  const [showInterviewDialog, setShowInterviewDialog] = useState(false);
  // Active `.workflow` file path for the live execution. Used by the
  // sidebar "Current Execution" link and by debounced write-back so the
  // file on disk stays in sync with the running engine.
  const [activeWorkflowFilePath, setActiveWorkflowFilePath] = useState<string | null>(null);
  // F-106/F-107 — when set, the last workflow run was blocked before starting
  // because no usable AI provider was available. Cleared on the next successful run.
  const [workflowProviderError, setWorkflowProviderError] = useState<'needs-provider' | 'ollama-unreachable' | null>(null);

  // Sidebar state
  const [sidebarActiveTab, setSidebarActiveTab] = useState<AppSurface>('files');
  // Per-matter UI memory (matterUiStore): subscribe to the active matter so we
  // can save + restore each matter's last working surface and focused document.
  const activeMatterId = useMatterStore((s) => s.activeMatterId);
  // F-509 — controlled sidebar collapse so the global Ctrl+B shortcut and the
  // command palette can drive the same collapse the chevron button does.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Fix 1: which view the Documents surface should land on. ReimaginedDocumentsHome
  // UNMOUNTS/REMOUNTS on every tab switch, so a counter "reset signal" can't work
  // (its refs reset on remount). Instead App owns the intent here (it persists
  // across the remount) and ReimaginedDocumentsHome reads it in its useState
  // initializer on mount. Clicking the Documents nav, revealing a folder, or
  // launching a matter into Documents => 'browser' (the file list). Opening an
  // email/file into the Documents area => 'editor' (that document).
  const [documentsView, setDocumentsView] = useState<'browser' | 'editor'>('browser');

  const handleRequestApiKeySetup = useCallback(() => {
    setApiKeyWizardOpen(true);
  }, []);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  const { theme, setTheme, effectiveTheme } = useThemeManager();

  const { rootPath, setRootPath, setFileTree, recentWorkspaces, fileTree, expandedPaths, expandAllFolders, loadRecentWorkspaces } = useWorkspaceStore();
  const { openFile, openTab, markSaved, openTabs, activeTabPath, closeTab, closeTabsByPath, toggleOutline, splitPane, closeSplit, isSplit } = useEditorStore();
  const { runHistory, completeRun } = useWorkflowStore();

  // M1 (v1.5) Memory: install the workspace RAG indexer once we know
  // which workspace is open. Watches `rootPath` and re-arms on switch.
  // M3 (v1.5) Facts: the same hook wires the FactsService singleton
  // to the active workspace via the WorkspaceService ref.
  useMemoryWiring(rootPath, workspaceServiceRef.current);

  // Keep the AI ambient file-context store in sync with whatever tabs are
  // open. Mounted at App level so a single subscription drives every chat.
  useOpenFileAIContext();

  // UX-26: full-text content index across the workspace. Builds once per
  // workspace open; per-file updates flow through the returned `upsert`.
  // We pass the service from the ref (not reactive) — the hook rebuilds
  // when rootPath changes, so a switch wire-up gives us a fresh index.
  const contentIndex = useContentIndex({
    rootPath,
    service: workspaceServiceRef.current,
    fileTree,
  });

  // G5: Feed decrypted mail text into the in-memory MiniSearch index via the
  // mail-index-chunk Tauri event. The decrypted text never touches disk —
  // it lives only in the renderer process's MiniSearch instance.
  // Stable identity (useCallback) so useMailSync subscribes once and does not
  // tear down / re-create the listener on every render (which would drop chunks
  // fired during an active sync).
  const handleMailChunk = useCallback((chunk: MailIndexChunk) => {
    contentIndex.upsert({
      id: `mail:${chunk.docId}`,
      path: `mail:${chunk.docId}`,
      name: chunk.subject || 'Email',
      content: chunk.decryptedText,
    });
  }, [contentIndex.upsert]);
  useMailSync({ onMailChunk: handleMailChunk });

  // API key management
  const { apiKeys, handleSaveApiKey: rawSaveApiKey } = useApiKeys();

  // Model list auto-fetching
  const validKeyEntries = useMemo(
    () => apiKeys.filter(k => k.isValid).map(k => ({ provider: k.provider, key: k.key })),
    [apiKeys]
  );
  const { refreshProvider } = useModelList(validKeyEntries);

  // Wrap API key handlers to also update model lists
  const handleSaveApiKey = useCallback(
    (provider: 'anthropic' | 'openai' | 'google', key: string) => {
      rawSaveApiKey(provider, key);
      refreshProvider(provider, key);
    },
    [rawSaveApiKey, refreshProvider]
  );


  // Shared KeychainService for the first-run wizard's "connect an AI" step.
  // This is the same secure-storage path ApiKeySettings/ApiKeyWizard use
  // (KeychainService.setKey: OS keychain in Tauri, obfuscated localStorage in
  // the browser). Created once for the app lifetime.
  const keychainRef = useRef(createKeychainService());

  // Persist a key entered during onboarding through the canonical keychain
  // path, then mirror it into the live API-key state + model list so the AI
  // pane sees the connected provider immediately (no parallel state — we reuse
  // both the keychain and the existing handleSaveApiKey wiring). A bad-format
  // key throws here so the wizard's AI step surfaces the error and stays put.
  const handleSaveOnboardingApiKey = useCallback(
    async (provider: 'anthropic' | 'openai' | 'google', key: string) => {
      await keychainRef.current.setKey(provider, key);
      handleSaveApiKey(provider, key);
    },
    [handleSaveApiKey]
  );

  // Trash management
  const {
    trashItems,
    trashStats,
    trashRetentionPeriod,
    trashCustomRetentionDays,
    saveTrashMetadata,
    loadTrashMetadata,
    handleRestoreFromTrash,
    handlePermanentDelete,
    handleEmptyTrash,
    handleTrashRetentionChange,
    setTrashItems,
    setTrashStats,
  } = useTrash({ rootPath, workspaceServiceRef });

  // Confirmation dialogs
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Prompt dialogs
  const { prompt, dialogProps: promptDialogProps } = usePromptDialog();

  // UX-16: undo toast controller for destructive actions (delete/rename).
  const undoToast = useUndoToast();

  // UX-16: in-session rename history per-file so Ctrl+Z can revert the
  // most recent rename. The value is an array of { fromPath, toPath }
  // tuples in the order they happened; popping the tail gives us the
  // last rename to undo. We don't persist this across app reloads —
  // "session" is literally the current tab's lifetime.
  const renameHistoryRef = useRef<Array<{ fromPath: string; toPath: string }>>([]);

  // UX-29: session-scoped delete history so Ctrl+Z can restore the most
  // recent deletion. We keep just the trash `id` — `handleRestoreFromTrash`
  // resolves it back to the original path. The combined `undoStackRef`
  // below records the order of destructive actions so Ctrl+Z always undoes
  // the most recent of any kind.
  const deleteHistoryRef = useRef<Array<string>>([]);
  const undoStackRef = useRef<Array<'rename' | 'delete'>>([]);

  // Auto-expand all folders when file tree is first loaded or changes
  useEffect(() => {
    if (fileTree.length > 0 && expandedPaths.size === 0 && rootPath) {
      // File tree exists but nothing is expanded - expand all folders
      setTimeout(() => {
        expandAllFolders();
        console.log('Auto-expanded all folders on file tree load');
      }, 100); // Small delay to ensure React state is updated
    }
  }, [fileTree, expandedPaths.size, expandAllFolders, rootPath]);

  // File system watcher - auto-refresh when external changes detected
  useEffect(() => {
    if (!rootPath || !workspaceServiceRef.current) {
      // No workspace loaded, stop any existing watcher
      if (fileSystemWatcherRef.current) {
        fileSystemWatcherRef.current.stop();
        fileSystemWatcherRef.current = null;
      }
      return;
    }

    // Create and start watcher
    const watcher = new FileSystemWatcher({
      pollInterval: 3000, // Check every 3 seconds
      onFileTreeChange: async () => {
        console.log('FileSystemWatcher: External file changes detected, refreshing file tree...');
        if (workspaceServiceRef.current) {
          try {
            const newFileTree = await workspaceServiceRef.current.getFileTree();
            setFileTree(newFileTree);
          } catch (error) {
            console.error('FileSystemWatcher: Failed to refresh file tree:', error);
          }
        }
      },
    });

    // Start watching
    watcher.start(async () => {
      if (!workspaceServiceRef.current) return '';
      try {
        const currentTree = await workspaceServiceRef.current.getFileTree();
        return createFileTreeSnapshot(currentTree);
      } catch (error) {
        console.error('FileSystemWatcher: Failed to get file tree snapshot:', error);
        return '';
      }
    });

    fileSystemWatcherRef.current = watcher;

    // Cleanup on unmount or workspace change
    return () => {
      if (fileSystemWatcherRef.current) {
        fileSystemWatcherRef.current.stop();
        fileSystemWatcherRef.current = null;
      }
    };
  }, [rootPath, setFileTree]);

  // Test mode: Initialize mock workspace for E2E tests
  useEffect(() => {
    if (IS_TEST_MODE && !rootPath) {
      // Set a mock workspace path
      setRootPath('/test-workspace');

      // Pre-load 2 demo tabs for testing
      const demoTab1Path = '/test-workspace/docs/test1.md';
      const demoTab1Content = '# Test Document 1\n\nThis is a test markdown document.';

      const demoTab2Path = '/test-workspace/docs/test2.txt';
      const demoTab2Content = 'This is a plain text document for testing the formatting toolbar.';

      // Normal E2E opens the two demo tabs. Recording mode
      // (?testMode=true&recordMatter=1) opens a seeded legal matter instead,
      // set up at the end of this block. The two paths never overlap, so the
      // existing E2E specs are untouched.
      const RECORD_MATTER = typeof window !== 'undefined' &&
        window.location.search.includes('recordMatter');
      if (!RECORD_MATTER) {
        openFile(demoTab1Path, 'test1.md', demoTab1Content);
        openFile(demoTab2Path, 'test2.txt', demoTab2Content);

        // R4 fix: seed a synthetic fileTree so the DocumentGridView is not
        // empty in test mode. The mock workspace service's getFileTree()
        // always returns [] (no real filesystem). We seed the two demo files
        // inside a 'docs' folder so folder drill-down is also testable.
        setFileTree([
          {
            id: '/test-workspace/docs',
            name: 'docs',
            path: '/test-workspace/docs',
            type: 'folder',
            children: [
              {
                id: demoTab1Path,
                name: 'test1.md',
                path: demoTab1Path,
                type: 'file',
                extension: 'md',
              },
              {
                id: demoTab2Path,
                name: 'test2.txt',
                path: demoTab2Path,
                type: 'file',
                extension: 'txt',
              },
            ],
          },
        ] as Parameters<typeof setFileTree>[0]);
      }

      // Expose openFile for Playwright tests so specs can inject fixture
      // files (e.g. binary data URLs) directly into the editor store without
      // going through the Tauri filesystem layer.
      (window as unknown as { __openTestFile?: typeof openFile }).__openTestFile = openFile;

      // Also expose the file-context store + prompt builder so ambient-context
      // tests can inspect extracted contents and verify system-prompt wiring
      // without needing to open an AI chat tab (providers talk to real URLs).
      (window as unknown as {
        __fileContextStore?: typeof useFileContextStore;
      }).__fileContextStore = useFileContextStore;
      (window as unknown as {
        __buildSystemPromptForTest?: (baseRole?: string) => string;
      }).__buildSystemPromptForTest = (
        baseRole = 'You are a helpful AI assistant.'
      ) => {
        const files = useFileContextStore.getState().getActiveContexts();
        return `${baseRole}${buildOpenFilesPromptBlock(files)}`;
      };

      // Expose the editor store so document-editing tests can inspect
      // `isDirty` and `content` without racing the React tree. Also expose
      // the backup store so tests can verify a backup was (or wasn't)
      // written for a given path.
      (window as unknown as {
        __editorStore?: typeof useEditorStore;
      }).__editorStore = useEditorStore;
      (window as unknown as {
        __fileBackupStore?: typeof useFileBackupStore;
      }).__fileBackupStore = useFileBackupStore;
      // UX-14: expose the workspace store so breadcrumb tests can set a
      // synthetic rootPath and inspect selectPath/expandedPaths behaviour.
      (window as unknown as {
        __workspaceStore?: typeof useWorkspaceStore;
      }).__workspaceStore = useWorkspaceStore;
      // R4: expose a setFileTree helper so Playwright tests can inject a
      // synthetic tree (folders + files) directly into the workspace store
      // and verify the DocumentGridView renders it correctly.
      (window as unknown as {
        __setTestFileTree?: (tree: Parameters<typeof setFileTree>[0]) => void;
      }).__setTestFileTree = (tree) => { setFileTree(tree); };

      // Install a mock workspace service for document-editing tests so the
      // FIRST-edit backup path exercises the real write-binary call through
      // MainPanel. The mock is an in-memory key/value map with a small set of
      // pre-seeded files (populated on first use by tests via __mockWrite).
      if (!workspaceServiceRef.current) {
        const mockFs = new Map<string, ArrayBuffer>();
        const mockDirs = new Set<string>();
        const textEncoder = new TextEncoder();
        // Helpers that synthesize folder semantics over a flat key map so
        // the AI chat persistence flow (mkdir + list + readFile) and any
        // other code that recurses into folders keeps working in test mode.
        const folderHasChildren = (folderPath: string) => {
          const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
          for (const key of mockFs.keys()) {
            if (key.startsWith(prefix)) return true;
          }
          return false;
        };
        const mockService = {
          async exists(path: string): Promise<boolean> {
            return mockFs.has(path) || folderHasChildren(path);
          },
          async readFile(path: string): Promise<string> {
            const buf = mockFs.get(path);
            if (!buf) throw new Error(`Not found: ${path}`);
            return new TextDecoder().decode(buf);
          },
          async readFileBinary(path: string): Promise<ArrayBuffer> {
            const buf = mockFs.get(path);
            if (!buf) throw new Error(`Not found: ${path}`);
            return buf;
          },
          async writeFile(path: string, content: string): Promise<void> {
            const bytes = textEncoder.encode(content);
            // Copy into a detached ArrayBuffer so callers can't mutate the
            // map's stored buffer.
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            mockFs.set(path, copy);
          },
          async writeFileBinary(path: string, content: ArrayBuffer): Promise<void> {
            const copy = new ArrayBuffer(content.byteLength);
            new Uint8Array(copy).set(new Uint8Array(content));
            mockFs.set(path, copy);
          },
          async mkdir(path: string): Promise<void> {
            // Track explicit (possibly empty) folders so getFileTree + list show
            // them even before they contain a file. Real backends persist the dir.
            mockDirs.add(path.replace(/\/+$/, ''));
          },
          async list(path: string): Promise<Array<{ name: string; path: string; type: 'file' | 'folder' }>> {
            const prefix = path.endsWith('/') ? path : `${path}/`;
            const directChildren = new Map<string, 'file' | 'folder'>();
            for (const key of mockFs.keys()) {
              if (!key.startsWith(prefix)) continue;
              const rest = key.slice(prefix.length);
              const slashIdx = rest.indexOf('/');
              if (slashIdx === -1) {
                directChildren.set(rest, 'file');
              } else {
                directChildren.set(rest.slice(0, slashIdx), 'folder');
              }
            }
            return Array.from(directChildren.entries()).map(([name, type]) => ({
              name,
              path: `${prefix}${name}`,
              type,
            }));
          },
          async getFileTree() {
            // Build a nested file/folder tree from the flat mock fs + the
            // explicit dir set, so the Documents grid reflects real files AND
            // folders the user creates (the no-op version returned nothing, so
            // created folders never appeared in test mode).
            type N = { id: string; path: string; name: string; type: 'file' | 'folder'; extension?: string; children: N[] };
            const TEST_ROOT = '/test-workspace';
            const entries = new Map<string, 'file' | 'folder'>();
            const addAncestors = (p: string): void => {
              let parent = p.slice(0, p.lastIndexOf('/'));
              while (parent.length > TEST_ROOT.length) {
                if (!entries.has(parent)) entries.set(parent, 'folder');
                parent = parent.slice(0, parent.lastIndexOf('/'));
              }
            };
            for (const key of mockFs.keys()) {
              if (!key.startsWith(`${TEST_ROOT}/`)) continue;
              entries.set(key, 'file');
              addAncestors(key);
            }
            for (const dir of mockDirs) {
              if (!dir.startsWith(`${TEST_ROOT}/`)) continue;
              if (!entries.has(dir)) entries.set(dir, 'folder');
              addAncestors(dir);
            }
            const nodeMap = new Map<string, N>();
            const tops: N[] = [];
            const sorted = [...entries.entries()].sort(
              (a, b) => a[0].split('/').length - b[0].split('/').length,
            );
            for (const [path, type] of sorted) {
              const name = path.slice(path.lastIndexOf('/') + 1);
              const dotIdx = name.lastIndexOf('.');
              const node: N = {
                id: path,
                path,
                name,
                type,
                children: [],
                ...(type === 'file' && dotIdx > 0 ? { extension: name.slice(dotIdx + 1) } : {}),
              };
              nodeMap.set(path, node);
              const parent = path.slice(0, path.lastIndexOf('/'));
              const pn = nodeMap.get(parent);
              if (parent === TEST_ROOT || !pn) tops.push(node);
              else pn.children.push(node);
            }
            return tops;
          },
          async stat(path: string) {
            if (mockFs.has(path)) {
              return { type: 'file' as const, size: mockFs.get(path)?.byteLength ?? 0 };
            }
            if (folderHasChildren(path)) {
              return { type: 'folder' as const, size: 0 };
            }
            throw new Error(`Not found: ${path}`);
          },
          async delete(path: string) {
            mockFs.delete(path);
          },
          async rename(oldPath: string, newName: string) {
            // Real WorkspaceService.rename takes (oldPath, newName) where
            // newName is just the basename; it derives the new path from
            // oldPath's parent dir. Mirror that so dev-mode mirrors prod.
            const slashIdx = oldPath.lastIndexOf('/');
            const parent = slashIdx === -1 ? '' : oldPath.slice(0, slashIdx);
            const newPath = parent ? `${parent}/${newName}` : newName;
            const buf = mockFs.get(oldPath);
            if (buf) {
              const copy = new ArrayBuffer(buf.byteLength);
              new Uint8Array(copy).set(new Uint8Array(buf));
              mockFs.set(newPath, copy);
              mockFs.delete(oldPath);
            }
          },
          async move(from: string, to: string) {
            // Real WorkspaceService.move takes (from, to) as FULL paths (App's
            // handleMove computes `to = targetFolder + '/' + basename`). Relocate
            // the file — or every descendant when `from` is a folder — so the
            // Documents grid + tree drag-and-drop work in dev/test mode just like
            // production (where TauriFSBackend.move does the real rename).
            const fromBuf = mockFs.get(from);
            if (fromBuf) {
              const copy = new ArrayBuffer(fromBuf.byteLength);
              new Uint8Array(copy).set(new Uint8Array(fromBuf));
              mockFs.set(to, copy);
              mockFs.delete(from);
            } else {
              // Folder move: re-key every file under `from/` to `to/`.
              const fromPrefix = `${from}/`;
              const movedKeys: Array<[string, ArrayBuffer]> = [];
              for (const [key, buf] of mockFs.entries()) {
                if (key.startsWith(fromPrefix)) {
                  const rest = key.slice(fromPrefix.length);
                  const copy = new ArrayBuffer(buf.byteLength);
                  new Uint8Array(copy).set(new Uint8Array(buf));
                  movedKeys.push([`${to}/${rest}`, copy]);
                  mockFs.delete(key);
                }
              }
              for (const [key, buf] of movedKeys) mockFs.set(key, buf);
            }
            // Keep the explicit-dir set in sync for empty folders.
            if (mockDirs.has(from)) {
              mockDirs.delete(from);
              mockDirs.add(to);
            }
            const fromDirPrefix = `${from}/`;
            for (const dir of [...mockDirs]) {
              if (dir.startsWith(fromDirPrefix)) {
                mockDirs.delete(dir);
                mockDirs.add(`${to}/${dir.slice(fromDirPrefix.length)}`);
              }
            }
          },
        };
        workspaceServiceRef.current = mockService as unknown as WorkspaceService;
        // Seed the two demo tabs into the mock filesystem too so that any
        // workspace op which goes through the real fs path (rename, exists,
        // readFile during reopen-after-rename) finds them. Without this seed
        // the editor store has tabs but mockFs has nothing.
        const seedText = (path: string, content: string) => {
          const bytes = textEncoder.encode(content);
          const copy = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copy).set(bytes);
          mockFs.set(path, copy);
        };
        seedText('/test-workspace/docs/test1.md', '# Test Document 1\n\nThis is a test markdown document.');
        seedText('/test-workspace/docs/test2.txt', 'This is a plain text document for testing the formatting toolbar.');
        (window as unknown as {
          __mockWorkspaceFs?: {
            list: () => string[];
            has: (p: string) => boolean;
            seed: (p: string, bytes: ArrayBuffer) => void;
          };
        }).__mockWorkspaceFs = {
          list: () => Array.from(mockFs.keys()),
          has: (p: string) => mockFs.has(p),
          seed: (p: string, bytes: ArrayBuffer) => {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(new Uint8Array(bytes));
            mockFs.set(p, copy);
          },
        };
      }

      // Stream C1 — expose the templates marketplace store for E2E specs so
      // they can seed a synthetic service (no Tauri backend in test mode) and
      // drive Browse/Install/Uninstall flows end-to-end via the real React UI.
      (window as unknown as {
        __templatesMarketplaceStore?: typeof useTemplatesMarketplaceStore;
      }).__templatesMarketplaceStore = useTemplatesMarketplaceStore;

      console.log('Test mode enabled: Mock workspace initialized with 2 demo tabs + mock FS');

      // Recording mode: seed a realistic legal matter (Halvorsen Estate),
      // populate the tree, and open the deposition notes so the app can be
      // screen-recorded for the marketing site. Recording-only; gated by
      // ?recordMatter so the normal E2E path is unchanged.
      if (RECORD_MATTER) {
        const DIR = '/test-workspace/Halvorsen Estate';
        const depoNotes = [
          '# Deposition Notes: Markus Halvorsen',
          '',
          '**Matter:** Halvorsen Estate v. Cedar Point Holdings, LLC',
          '**Deponent:** Markus Halvorsen (defendant, managing member)',
          '**Date:** April 14, 2026',
          '',
          '## Testimony to remember',
          '',
          '- **p. 12** Did he see the second appraisal before closing? "No. I never saw a second appraisal. The first one was the only number I had."',
          '- **p. 31** Sale closed "sometime in November, I think the 20th or so."',
          '- **p. 47** What did he review before closing? "I reviewed all the paperwork the accountant sent over. The appraisals, the title work, the closing statement. All of it."',
          '- **p. 52** He and the accountant "talked every week without fail" during the sale.',
          '- **p. 68** He was "traveling most of October and November" and "hard to reach."',
          '',
          '## My flags',
          '',
          '- p. 12 vs p. 47 looks like a straight contradiction on the second appraisal. Pull Exhibit 9.',
          '- p. 52 vs p. 68 is softer. Worth a follow-up.',
          '',
        ].join('\n');
        const depoChat = JSON.stringify({
          version: 1, id: 'demo-depo', title: 'Deposition contradictions',
          created: '2026-04-15T09:12:00.000Z', updated: '2026-04-15T09:14:00.000Z',
          provider: 'anthropic', model: 'claude-sonnet-4-6',
          messages: [
            { role: 'user', content: 'Read my Deposition Notes for the Halvorsen matter. Find any places where his testimony contradicts itself, with page cites.', timestamp: '2026-04-15T09:12:00.000Z' },
            { role: 'assistant', content: 'Here is what stands out.\n\n**The clear one: the second appraisal.** On page 12 he says "No. I never saw a second appraisal." On page 47 he says he reviewed "all the paperwork the accountant sent over. The appraisals, the title work, the closing statement. All of it." Those two cannot both be true if the second appraisal was in that batch. Your note points at Exhibit 9, the appraisal transmittal. If that shows the appraisal going to him before closing, page 12 is the problem.\n\n**The softer one: availability.** Page 52 has him talking to the accountant "every week without fail" during the sale. Page 68 has him "traveling most of October and November" and "hard to reach." Worth a follow-up to pin down which it was.\n\nI am not drawing a legal conclusion, just showing you where the record disagrees with itself. Confirm each cite against the certified transcript.', timestamp: '2026-04-15T09:14:00.000Z' },
          ],
        }, null, 2);
        const matterFiles = [
          { path: `${DIR}/Deposition Notes.md`, name: 'Deposition Notes.md', content: depoNotes },
          { path: `${DIR}/Deposition contradictions.aichat`, name: 'Deposition contradictions.aichat', content: depoChat },
          { path: `${DIR}/Privilege Log.md`, name: 'Privilege Log.md', content: '# Privilege Log\n\n| Date | Author | Recipient | Privilege | Description |\n|---|---|---|---|---|\n| 2024-09-02 | Client | Me | Attorney-Client | Client request for advice re appraisal discrepancy |\n| 2024-10-11 | Me | (file) | Work Product | Internal analysis in anticipation of litigation |\n' },
          { path: `${DIR}/Case Timeline.md`, name: 'Case Timeline.md', content: '# Case Timeline\n\n- 2024-08-15 First appraisal delivered ($4.2M).\n- [2024-09-01] Second appraisal commissioned. Halvorsen denies seeing it (Depo p. 12).\n- [2024-11-20] Sale closes. Confirm against the recorded deed.\n- 2025-02 Estate files suit.\n' },
          { path: `${DIR}/Client Intake Summary.md`, name: 'Client Intake Summary.md', content: '# Client Intake Summary\n\n**Client:** Estate of Anders Halvorsen\n**Matter:** Below-value sale; concealed second appraisal.\n\nFlag: confirm the limitations period and calendar it.\n' },
        ];
        const svc = workspaceServiceRef.current;
        if (svc) {
          void Promise.all(matterFiles.map((f) => svc.writeFile(f.path, f.content))).then(() => {
            setFileTree([
              {
                id: DIR, name: 'Halvorsen Estate', path: DIR, type: 'folder',
                children: matterFiles.map((f) => ({
                  id: f.path, name: f.name, path: f.path, type: 'file',
                  extension: f.name.split('.').pop(),
                })),
              },
            ] as Parameters<typeof setFileTree>[0]);
            expandAllFolders();
            const depo = matterFiles[0]!;
            openFile(depo.path, depo.name, depo.content);
          });
        }
      }
    }
  }, [IS_TEST_MODE, rootPath, setRootPath, openFile]);

  // Load recent workspaces from localStorage on mount
  useEffect(() => {
    loadRecentWorkspaces();
  }, [loadRecentWorkspaces]);

  // Stream C1 Group VIII — Deferred check-for-updates on workspace load.
  //
  // We subscribe to the templates marketplace store rather than reading a ref
  // so the check re-runs each time the user switches workspaces (each
  // workspace gets its own MarketplaceService instance with its own install
  // root). The 2-second delay keeps cold start snappy by skipping the network
  // round trip until the editor is interactive. Errors are swallowed: a
  // failed network call leaves the badge at 0 and the user can still install
  // / refresh by hand.
  useEffect(() => {
    const status = { cancelled: false };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCheck = (svc: MarketplaceService) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (status.cancelled) return;
        void (async () => {
          try {
            const updates = await svc.checkForUpdates();
            if (status.cancelled) return;
            useTemplatesMarketplaceStore.getState().setUpdateCount(updates.length);
          } catch (err) {
            console.warn('[App] checkForUpdates failed; badge remains hidden:', err);
          }
        })();
      }, 2000);
    };
    const unsubscribe = useTemplatesMarketplaceStore.subscribe((state, prev) => {
      if (state.service === prev.service) return;
      if (!state.service) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        useTemplatesMarketplaceStore.getState().setUpdateCount(0);
        return;
      }
      scheduleCheck(state.service);
    });
    // Run once for the current state too (subscribe only fires on change).
    const current = useTemplatesMarketplaceStore.getState().service;
    if (current) scheduleCheck(current);
    return () => {
      status.cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Handle file open (must be defined before useSourceCards)
  const handleFileOpen = useCallback(
    async (path: string, name: string) => {
      if (!workspaceServiceRef.current) return;

      // Auto-expand parent folders to show file location
      const { expandedPaths, setExpandedPaths } = useWorkspaceStore.getState();
      const parts = path.split('/');
      const newExpanded = new Set(expandedPaths);

      // Add all parent folder paths to expanded set
      for (let i = 1; i < parts.length - 1; i++) {
        const folderPath = parts.slice(0, i + 1).join('/');
        newExpanded.add(folderPath);
      }

      // Update expanded paths if any new folders were added
      if (newExpanded.size > expandedPaths.size) {
        setExpandedPaths(newExpanded);
      }

      try {
        if (isBinaryFile(name)) {
          // Read binary content for binary files (images, videos, PDFs, etc.)
          const buffer = await workspaceServiceRef.current.readFileBinary(path);
          const mimeType = getMimeType(name);
          const dataUrl = arrayBufferToDataUrl(buffer, mimeType);
          openFile(path, name, dataUrl);
        } else {
          const content = await workspaceServiceRef.current.readFile(path);
          // `.workflow` files are routed via openTab with the dedicated
          // type so MainPanel's extension-based dispatch + the dedup logic
          // both see a stable type and re-clicks from the tree refresh
          // the in-memory content rather than dropping the tab type.
          if (isWorkflowFilePath(path)) {
            openTab(path, name, content, 'workflow-execution');
          } else {
            openFile(path, name, content);
          }
        }
      } catch (error) {
        console.error('Failed to open file:', error);
        window.alert("I couldn't open that file. It may have been moved, or it's too large to preview.");
      }
    },
    [openFile, openTab]
  );

  // Source card management (must be defined before handleWorkspaceSelected)
  const {
    setSourceCards,
    loadSourceCards,
  } = useSourceCards({ rootPath, workspaceServiceRef, handleFileOpen });

  // Handle delete (moves to trash instead of permanent delete) - must be defined before useAIChatFiles
  const handleDelete = useCallback(
    async (path: string) => {
      const fileName = path.split('/').pop() ?? 'unknown';
      const confirmed = await confirm(`Are you sure you want to delete "${fileName}"?`, {
        title: 'Delete File',
        variant: 'destructive',
        confirmLabel: 'Delete',
      });
      if (!confirmed || !workspaceServiceRef.current || !rootPath) return;

      try {
        // Get file stats for trash entry
        const stat = await workspaceServiceRef.current.stat(path);

        // Create trash folder if it doesn't exist
        const trashFolderPath = `${rootPath}/.trash`;
        const trashExists = await workspaceServiceRef.current.exists(trashFolderPath);
        if (!trashExists) {
          await workspaceServiceRef.current.mkdir(trashFolderPath);
        }

        // Move file to trash with timestamp prefix
        const timestamp = Date.now();
        const trashPath = `${trashFolderPath}/${timestamp}_${fileName}`;
        await workspaceServiceRef.current.move(path, trashPath);

        // Create trash item entry
        const trashedItem: TrashedItem = {
          id: `trash_${timestamp}_${Math.random().toString(36).slice(2, 9)}`,
          originalPath: path,
          trashPath,
          name: fileName,
          type: stat.type,
          deletedAt: new Date(),
          size: stat.size,
        };

        // Update trash state and persist
        const newItems = [trashedItem, ...trashItems];
        setTrashItems(newItems);

        // Update stats
        const totalSize = newItems.reduce((sum, item) => sum + (item.size ?? 0), 0);
        const oldestItem = newItems.length > 0
          ? newItems.reduce((oldest, item) =>
              item.deletedAt < oldest ? item.deletedAt : oldest,
              newItems[0]!.deletedAt
            )
          : undefined;
        setTrashStats({
          itemCount: newItems.length,
          totalSize,
          oldestItem,
        });

        // Persist trash metadata
        await saveTrashMetadata(newItems);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Close all tabs for the deleted file (handles duplicates and split panes)
        closeTabsByPath(path);

        // UX-26: drop from the content index so stale hits don't linger.
        contentIndex.remove(path);

        // UX-16: 10-second undo toast. Clicking Undo restores the file
        // from Trash to its original path. Auto-dismissing commits the
        // destructive action (no extra confirmation required).
        undoToast.show({
          message: `"${fileName}" moved to Trash`,
          ttlMs: 10_000,
          onUndo: async () => {
            try {
              await handleRestoreFromTrash(trashedItem.id);
              // UX-29: once undone via the toast, drop the corresponding
              // entry so Ctrl+Z doesn't try to restore it a second time.
              const idx = deleteHistoryRef.current.lastIndexOf(trashedItem.id);
              if (idx >= 0) deleteHistoryRef.current.splice(idx, 1);
              const stackIdx = undoStackRef.current.lastIndexOf('delete');
              if (stackIdx >= 0) undoStackRef.current.splice(stackIdx, 1);
            } catch (err) {
              console.error('Failed to undo delete:', err);
            }
          },
        });

        // UX-29: record the deletion on the session-scoped delete history
        // so Ctrl+Z can restore it even after the toast has expired
        // (within the same session).
        deleteHistoryRef.current.push(trashedItem.id);
        undoStackRef.current.push('delete');
      } catch (error) {
        console.error('Failed to delete:', error);
        window.alert("I couldn't move that to Trash. Check that your workspace has space, then try again.");
      }
    },
    [setFileTree, rootPath, closeTabsByPath, trashItems, saveTrashMetadata, setTrashStats, setTrashItems, confirm, undoToast, handleRestoreFromTrash, contentIndex]
  );

  // AI Chat Files Management (must be defined after handleDelete and handleFileOpen)
  const {
    setChatFiles,
    loadChatFiles,
  } = useAIChatFiles({ rootPath, workspaceServiceRef, handleFileOpen, handleDelete });

  // Handle workspace selection and recent-project opening (extracted to hook)
  const { handleWorkspaceSelected, handleOpenRecentProject } = useWorkspaceLifecycle({
    workspaceServiceRef, auditServiceRef, templatesMarketplaceServiceRef, templatesMetadataReaderRef,
    setShowWorkspaceSelector, setAuditEntries, setRootPath,
    loadTrashMetadata, setTrashItems, setTrashStats,
    loadSourceCards, setSourceCards, loadChatFiles, setChatFiles,
  });

  // Demo build (keepance.com/try): auto-open the OPFS workspace that
  // WebDemoSeeder pre-populated, so the visitor lands inside the seeded
  // matter instead of the "pick a folder" screen. Mirrors the browser
  // open path in WorkspaceSelector, but sources the directory handle from
  // OPFS rather than a user folder picker.
  useEffect(() => {
    if (!IS_DEMO_MODE || rootPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        const demoDir = await opfsRoot.getDirectoryHandle('keepance-demo', { create: true });
        const backend = createWebFSBackend();
        backend.setRootHandle(demoDir);
        const service = createWorkspaceService();
        await service.initialize(backend, '/keepance-demo');
        if (cancelled) return;
        await handleWorkspaceSelected(service);
      } catch (err) {
        console.error('[App] demo workspace auto-open failed:', err);
        if (!cancelled) setDemoOpenFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [IS_DEMO_MODE, rootPath, handleWorkspaceSelected]);


  // Handle opening browser tab
  const handleOpenBrowserTab = useCallback(
    (url: string, title?: string) => {
      // Generate a unique path for the browser tab
      const tabPath = `__browser__${Date.now()}`;
      const tabName = title || new URL(url).hostname;

      openTab(tabPath, tabName, '', 'browser', { url });
    },
    [openTab]
  );

  // UX-21: open (or focus) the AI Assistant as a main-panel tab. We look
  // for an existing `ai-assistant` tab first so Ctrl+Shift+A doesn't spam
  // new tabs, then fall back to creating a fresh one. The sidebar AI pane
  // keeps working independently — this is purely additive.
  const openAIAssistantTab = useCallback(() => {
    const existing = useEditorStore
      .getState()
      .openTabs.find((t) => t.type === 'ai-assistant');
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.path);
      return;
    }
    const tabPath = `__ai_assistant__${Date.now()}`;
    openTab(tabPath, 'AI Assistant', '', 'ai-assistant');
  }, [openTab]);

  // WS-B/C — open the read-only email viewer when an email citation is clicked
  // in chat. AIChatViewer dispatches `keepance:open-email` for `mail:<id>`
  // sources; this hook turns that into an `email` tab. (Extracted to
  // useOpenEmailListener so the wiring is unit-tested.)
  //
  // Bug 2 fix: wrap openTab so opening an email first navigates to the
  // 'files' sidebar tab (where MainPanel + EmailViewer live). Without this,
  // the tab is added while the full-page ReimaginedEmailWorkspace is active,
  // so the email opens invisibly and the user sees nothing happen.
  useOpenEmailListener(
    useCallback(
      (
        id: string,
        label: string,
        content: string,
        type: 'email',
        meta: { mailSourceId: string },
      ) => {
        // Opening an email shows it in the Documents area editor, not the browser.
        setDocumentsView('editor');
        setSidebarActiveTab('files');
        openTab(id, label, content, type, meta);
      },
      [openTab],
    ),
  );

  // Shell-wide `keepance:*` CustomEvent wiring (matter manager, settings,
  // account, matter launch). See src/app/lifecycle/useGlobalEventBus.ts.
  useGlobalEventBus({
    onOpenMatterManager: () => setMatterManagerOpen(true),
    onOpenAccount: () => setAccountWindowOpen(true),
    openSettings,
    setSidebarActiveTab,
    setDocumentsView,
    setAskPrefill,
  });

  // Per-matter UI memory: as the user works inside a matter, keep its snapshot
  // (last working surface + focused document) up to date, so returning to the
  // matter later restores it. Hub/Settings are NOT remembered (browse/config),
  // so opening a matter's hub never clobbers its remembered work.
  useEffect(() => {
    if (!activeMatterId) return;
    if (!isWorkingSurface(sidebarActiveTab)) return;
    useMatterUiStore.getState().saveSnapshot(activeMatterId, {
      surface: sidebarActiveTab,
      activeTabPath: sidebarActiveTab === 'files' ? (activeTabPath ?? null) : null,
    });
  }, [activeMatterId, sidebarActiveTab, activeTabPath]);

  const {
    writeTabContent,
    handleSaveFile,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleRenameWithName,
    handleDownload,
    refreshFileTree,
    handleMove,
  } = useFileOperations({
    workspaceServiceRef,
    fileSystemWatcherRef,
    handleFileOpen,
    prompt,
    setFileTree,
    markSaved,
    contentIndex,
    openTabs,
    closeTab,
    renameHistoryRef,
    undoStackRef,
  });

  const {
    handleCreateTextFileAtRoot,
    handleSetLetterheadTemplate,
    handleCreateDocxAtRoot,
    handleCreateDefaultDocument,
    handleCreateFolderAtRoot,
  } = useDocumentCreation({ workspaceServiceRef, rootPath, setFileTree, prompt, confirm, handleFileOpen, openFile });



  // Audit log helper - logs all AI actions to the audit log.
  //
  // Persists through the AuditService (encrypted-at-rest on desktop,
  // localStorage in the browser) AND mirrors the entry into the live React
  // state the AuditLog renders. We let the service mint the id/timestamp so the
  // persisted row and the on-screen row are identical. Append-only on both
  // sides: we only ever prepend a new entry.
  const addAuditEntry = useCallback((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    const newEntry = auditServiceRef.current.log(entry.action, entry.description, {
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      inputs: entry.inputs,
      outputs: entry.outputs,
      ...(entry.userDecision !== undefined ? { userDecision: entry.userDecision } : {}),
      metadata: entry.metadata,
    });
    // Preserve any cost/token/provider fields the caller set (the structured
    // `log` API doesn't take them, but model-call entries carry them for the
    // cost dashboard). Re-attach onto the persisted entry's identity.
    const merged: AuditEntry = {
      ...newEntry,
      ...(entry.tokensIn !== undefined ? { tokensIn: entry.tokensIn } : {}),
      ...(entry.tokensOut !== undefined ? { tokensOut: entry.tokensOut } : {}),
      ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}),
      ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
    };
    setAuditEntries((prev) => [merged, ...prev]);
  }, []);


  // Handle save audio recording
  const handleSaveAudioRecording = useCallback(
    async (audioBlob: Blob, filename: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Ensure Audio Recordings folder exists
      const audioPath = `${rootPath}/Audio Recordings`;
      const audioExists = await workspaceServiceRef.current.exists(audioPath);
      if (!audioExists) {
        await workspaceServiceRef.current.mkdir(audioPath);
      }

      const filePath = `${audioPath}/${filename}`;
      try {
        // Convert blob to array buffer
        const arrayBuffer = await audioBlob.arrayBuffer();
        await workspaceServiceRef.current.writeFileBinary(filePath, arrayBuffer);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Open the audio file
        await handleFileOpen(filePath, filename);
      } catch (error) {
        console.error('Failed to save audio recording:', error);
      }
    },
    [rootPath, setFileTree, handleFileOpen]
  );


  // UX-19: Global drag-and-drop upload. Handles files dropped anywhere on
  // the window. Target folder resolves to the nearest `data-folder-path`
  // ancestor of the drop target, or workspace root if no folder was under
  // the cursor. Newly-written files are opened in tabs after the write.
  const handleGlobalFileDrop = useCallback(
    async (files: File[], folderPath: string | null) => {
      const service = workspaceServiceRef.current;
      if (!service || !rootPath) return;
      const targetFolder = folderPath ?? rootPath;
      try {
        const results = await writeDroppedFiles({
          service,
          targetFolder,
          files,
        });
        // Refresh tree
        const tree = await service.getFileTree();
        setFileTree(tree);
        // Open each written file in a tab. Opening sequentially keeps the
        // tab order consistent with the drop order.
        for (const r of results) {
          await handleFileOpen(r.path, r.name);
        }
        // UX-33: activate the last-dropped file so the user lands on
        // something they just dropped rather than the previously-active tab.
        if (results.length > 0) {
          const last = results[results.length - 1]!;
          useEditorStore.getState().setActiveTab(last.path);
        }
      } catch (err) {
        console.error('[App] Drag-drop upload failed:', err);
      }
    },
    [rootPath, setFileTree, handleFileOpen]
  );

  const { isDragging: isFileDragging } = useGlobalFileDrop({
    onDrop: handleGlobalFileDrop,
    enabled: !!rootPath && !showWorkspaceSelector,
  });


  // Handle starting a workflow
  const handleStartWorkflow = useCallback(
    async (template: WorkflowTemplate) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Fix 4 — clear any error from a previous blocked run so that the
      // currently-active tab (which may be a completed workflow) is not
      // rendered as a blocking screen while this new attempt is in flight.
      // The error is scoped to this invocation and set/cleared only here.
      setWorkflowProviderError(null);

      // Compute the folder path early so we can derive the run metadata.
      // The folder itself is NOT created yet — we wait until provider
      // resolution succeeds so a blocked run leaves nothing on disk (Fix 3).
      const startTime = new Date();
      const timestamp = startTime.toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_');
      const workflowFolderName = `${template.name} - ${timestamp}`;
      const workflowFolderPath = `${rootPath}/${workflowFolderName}`;

      // Load AI Rules if available — needed before resolution so it can be
      // threaded into the provider constructor below.
      let aiRulesContent: string | undefined;
      try {
        const rulesPath = `${rootPath}/ai-rules.md`;
        const exists = await workspaceServiceRef.current.exists(rulesPath);
        if (exists) {
          aiRulesContent = await workspaceServiceRef.current.readFile(rulesPath);
        }
      } catch (error) {
        console.debug('No AI rules file found:', error);
      }

      // F-106/F-107 — Provider resolution for workflows.
      //
      // Resolution order (highest priority first):
      //   1. Explicit per-template override (user pinned in Settings > Templates)
      //   2. Template's own defaultProvider / defaultModel
      //   3. Global default (first available cloud key)
      //
      // Safety invariants (enforced by the pure resolveWorkflowProvider helper
      // which is unit-tested in tests/unit/workflow/):
      //   - ollama-pinned + unreachable  → 'ollama-unreachable' (NEVER 'cloud')
      //   - no key + !testMode           → 'needs-provider'     (NEVER 'mock')
      //   - no key + testMode            → 'mock'
      const anthropicKey = apiKeys.find((k) => k.provider === 'anthropic')?.key;
      const openaiKey = apiKeys.find((k) => k.provider === 'openai')?.key;
      const googleKey = apiKeys.find((k) => k.provider === 'google')?.key;

      // Q8 — honor the template's own default provider/model plus any
      // per-template override the user pinned in Settings.
      const overrides =
        (useSettingsStore.getState().getSetting<
          Record<string, TemplateModelOverride> | undefined
        >(TEMPLATE_MODEL_OVERRIDES_KEY) ?? {});
      const globalProvider: TemplateProviderId = anthropicKey
        ? 'claude'
        : openaiKey
          ? 'openai'
          : googleKey
            ? 'gemini'
            : 'claude';
      const resolution = resolveTemplateModel({
        template,
        overrides,
        globalDefault: { provider: globalProvider, model: '' },
      });

      const pickedProvider = resolution.provider;
      const pickedModel = resolution.model || undefined;

      // F-107 — probe Ollama reachability when the template is pinned to it.
      // We pass the result into the pure helper rather than doing the async
      // check inside it, keeping resolveWorkflowProvider synchronous/testable.
      // F-502 — ALSO probe in local-only confidentiality mode: the resolver
      // must land on an installed local model (or block honestly) no matter
      // what the template/global default says, so it needs reachability plus
      // the installed tag list.
      const localOnly = modeRestrictsToLocal(getConfidentialityMode());
      let ollamaReachable = false;
      let installedOllamaModels: string[] = [];
      if (pickedProvider === 'ollama' || localOnly) {
        const ollamaStatus = await detectOllama();
        ollamaReachable = ollamaStatus.reachable;
        installedOllamaModels = ollamaStatus.models;
      }

      // Pure resolution — decides kind, never creates providers or side-effects.
      const providerResolution = resolveWorkflowProvider({
        pickedProvider,
        pickedModel,
        anthropicKey,
        openaiKey,
        googleKey,
        ollamaReachable,
        isTestMode: IS_TEST_MODE,
        localOnly,
        installedOllamaModels,
      });

      // Handle the two early-return blocking cases BEFORE creating the folder
      // (Fix 3 — no empty folder litter on blocked runs).
      if (providerResolution.kind === 'needs-provider') {
        setWorkflowProviderError('needs-provider');
        return;
      }
      if (providerResolution.kind === 'ollama-unreachable') {
        setWorkflowProviderError('ollama-unreachable');
        return;
      }

      // Provider resolution succeeded — create the workflow folder now.
      try {
        await workspaceServiceRef.current.mkdir(workflowFolderPath);
        console.log(`Created workflow folder: ${workflowFolderName}`);
      } catch (error) {
        console.error('Failed to create workflow folder:', error);
        return;
      }

      // Stable runId — both the live execution state and the persisted
      // file share this id so MainPanel can match the live engine to the
      // file's tab and prefer the in-memory state over the on-disk
      // snapshot during a running execution.
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const workflowFilename = buildWorkflowFilename(template, startTime);
      const workflowFilePath = `${workflowFolderPath}/${workflowFilename}`;

      // Track artifacts and completed interview answers as the engine runs.
      // These accumulate alongside execution state and get written into the
      // .workflow file on every flush.
      const artifacts: string[] = [];
      let completedAnswers: { stepName: string; answers: Record<string, string> }[] = [];
      let lastSeenStepIndex = -1;

      // Debounced write helper. Holds the most recent file payload and
      // flushes after 1.5s of quiet. Terminal-state writes use
      // `flushImmediate=true` so completion / failure / cancellation
      // always lands on disk synchronously.
      let pendingFileData: WorkflowFileData | null = null;
      let writeTimer: ReturnType<typeof setTimeout> | null = null;
      const writeFileNow = async (data: WorkflowFileData) => {
        try {
          const json = JSON.stringify(data, null, 2);
          await workspaceServiceRef.current!.writeFile(workflowFilePath, json);
          // Keep the open tab's in-memory content in lockstep with disk so
          // MainPanel re-renders WorkflowExecutionTab against the latest
          // snapshot if the user clicks away and back.
          useEditorStore.getState().updateContent(workflowFilePath, json);
          // Flag the tab as saved so the dirty indicator stays clean.
          useEditorStore.getState().markSaved(workflowFilePath);
        } catch (err) {
          console.warn('[workflow] Failed to write .workflow file:', err);
        }
      };
      const scheduleWrite = (data: WorkflowFileData, flushImmediate = false) => {
        pendingFileData = data;
        if (flushImmediate) {
          if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
          }
          void writeFileNow(data);
          return;
        }
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
          writeTimer = null;
          if (pendingFileData) void writeFileNow(pendingFileData);
        }, 1500);
      };

      // Provider assignment — construct the concrete Provider instance from
      // the resolution result. All blocking cases already returned above.
      let provider;
      if (providerResolution.kind === 'ollama') {
        // F-107 — Ollama branch. Reachability confirmed above; construct the
        // local provider. Zero cost, zero network egress.
        provider = new OllamaProvider({
          model: providerResolution.model ?? OLLAMA_DEFAULT_MODEL,
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log(
          `Using Ollama (${providerResolution.model ?? OLLAMA_DEFAULT_MODEL}) for workflow generation [source=${resolution.source}]`
        );
      } else if (providerResolution.kind === 'cloud') {
        const { provider: cloudProvider, model: cloudModel, key } = providerResolution;
        if (cloudProvider === 'claude') {
          provider = createClaudeProvider({
            apiKey: key,
            dangerouslySkipPermissions: true,
            ...(cloudModel ? { model: cloudModel } : {}),
            ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
          });
          console.log(
            `Using Claude API (${cloudModel ?? 'default'}) for workflow generation [source=${resolution.source}]`
          );
        } else if (cloudProvider === 'openai') {
          provider = createOpenAIProvider({
            apiKey: key,
            ...(cloudModel ? { model: cloudModel } : {}),
            ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
          });
          console.log(
            `Using OpenAI API (${cloudModel ?? 'default'}) for workflow generation [source=${resolution.source}]`
          );
        } else {
          // gemini
          provider = createGeminiProvider({
            apiKey: key,
            ...(cloudModel ? { model: cloudModel } : {}),
            ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
          });
          console.log(
            `Using Gemini API (${cloudModel ?? 'default'}) for workflow generation [source=${resolution.source}]`
          );
        }
      } else {
        // mock — IS_TEST_MODE only; resolveWorkflowProvider guarantees
        // we never reach this outside testMode.
        provider = createMockProvider();
        console.log('testMode: using mock provider (no real keys configured)');
      }

      const engine = createWorkflowEngine(
        provider,
        {
          writeFile: async (path: string, content: string) => {
            // Write files inside the workflow folder
            const filename = path.split('/').pop() || path;
            const fullPath = `${workflowFolderPath}/${filename}`;
            await workspaceServiceRef.current!.writeFile(fullPath, content);
            // Track the artifact so the .workflow file has a record of
            // what the run produced.
            if (!artifacts.includes(filename)) {
              artifacts.push(filename);
            }
            // Refresh file tree after write
            const fileTree = await workspaceServiceRef.current!.getFileTree();
            setFileTree(fileTree);
          },
          readFile: async (path: string) => {
            // Read from workflow folder if relative path, otherwise use absolute
            const filename = path.split('/').pop() || path;
            const fullPath = path.startsWith('/') ? path : `${workflowFolderPath}/${filename}`;
            return workspaceServiceRef.current!.readFile(fullPath);
          },
          // WS-D — binary deliverables (the Word .docx a workflow produces) land
          // in the same workflow folder under the active matter. Tracked as an
          // artifact so the .workflow file records what the run produced.
          writeFileBinary: async (path: string, bytes: Uint8Array) => {
            const filename = path.split('/').pop() || path;
            const fullPath = `${workflowFolderPath}/${filename}`;
            // ArrayBuffer slice keeps TS happy regardless of the byte view's offset.
            const buffer = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            await workspaceServiceRef.current!.writeFileBinary(fullPath, buffer);
            if (!artifacts.includes(filename)) {
              artifacts.push(filename);
            }
            const fileTree = await workspaceServiceRef.current!.getFileTree();
            setFileTree(fileTree);
          },
        },
        // Interview handler - shows dialog and waits for user answers
        async (_stepId, questions) => {
          return new Promise<Record<string, string>>((resolve, reject) => {
            setInterviewQuestions(questions);
            setInterviewResolver(() => resolve);
            setInterviewRejecter(() => reject);
            setShowInterviewDialog(true);
          });
        },
        // Progress handler
        (stepIndex, stepName, status) => {
          console.log(`Workflow step ${stepIndex}: ${stepName} - ${status}`);
          const live = engine.getExecution();
          if (!live) return;
          setCurrentExecution({ ...live });
          // Build accumulated interview answers when we cross a step
          // boundary so the persisted file has the same structure the
          // tab UI displays.
          if (live.currentStepIndex > lastSeenStepIndex && live.currentStepIndex > 0) {
            completedAnswers = appendCompletedInterviewAnswers(
              completedAnswers,
              live.template,
              live.currentStepIndex - 1,
              live.inputs
            );
            lastSeenStepIndex = live.currentStepIndex;
          }
          // Schedule a debounced snapshot. Step transitions count as
          // "important enough" but not so urgent that we need to flush
          // synchronously — terminal states do that below.
          scheduleWrite(
            executionToFileData({
              execution: live,
              workflowFolderPath,
              completedAnswers,
              artifacts,
            })
          );
        },
        {
          // Stream C1 — Surface marketplace-installed templates alongside
          // built-ins on `engine.availableTemplates()`. Reader + service refs
          // are nullable until a workspace is loaded; the resolver returns []
          // in that case rather than throwing.
          getCommunityTemplates: async () => {
            const reader = templatesMetadataReaderRef.current;
            const svc = templatesMarketplaceServiceRef.current;
            if (!reader || !svc) return [];
            return reader.list(svc);
          },
          // WS-D — litigation `analyze` step dependencies. Retrieval is scoped to
          // the ACTIVE matter and privilege is EXCLUDED (the safe default on
          // MemoryService.retrieve). Every finding's citation is verified against
          // the local store via rag_verify_citation. The Word renderer is the
          // shared structured-deliverable serializer.
          analyzeDeps: {
            getScope: (): RetrievalScope => getActiveScope() as RetrievalScope,
            retrieve: async (query, topK, scope, perSourceCap) => {
              // F-510 — the finder's per-source diversity cap rides through
              // (privilege stays EXCLUDED, the 4th positional default).
              const hits = await MemoryService.retrieve(query, topK, scope, false, perSourceCap);
              // Audit (3.0 provenance) — the litigation `analyze` step runs a
              // matter-scoped, privilege-EXCLUDED retrieval (the safe default on
              // MemoryService.retrieve). Record the scope, the privilege
              // decision, and the result so the workflow's research is provable.
              const auditScope: AuditScope =
                scope.kind === 'matter'
                  ? { kind: 'matter', matterId: scope.matterId }
                  : { kind: 'allMatters' };
              const topScore = hits.reduce<number | null>(
                (max, h) => (max === null ? h.score : Math.max(max, h.score)),
                null,
              );
              addAuditEntry(auditEventToEntry({
                type: 'scope_active',
                timestamp: new Date().toISOString(),
                payload: { scope: auditScope },
              }));
              addAuditEntry(auditEventToEntry({
                type: 'privilege_evaluated',
                timestamp: new Date().toISOString(),
                payload: { excluded: true },
              }));
              addAuditEntry(auditEventToEntry({
                type: 'retrieval_executed',
                timestamp: new Date().toISOString(),
                payload: {
                  query,
                  scope: auditScope,
                  hitCount: hits.length,
                  topScore,
                  // F-510 — record the diversity cap only when one was applied.
                  ...(perSourceCap !== undefined ? { perSourceCap } : {}),
                },
              }));
              return hits;
            },
            verifyCitation: async (citationId, claimedMatterId, quotedText) => {
              const verdict = await ragVerifyCitation(citationId, claimedMatterId, quotedText);
              // CitationVerdict.verdict is one of verified|notFound|matterMismatch|
              // textMismatch — exactly the values the analysis pipeline records.
              // Audit (3.0 provenance) — record the verdict for each cited source.
              addAuditEntry(auditEventToEntry({
                type: 'citation_verified',
                timestamp: new Date().toISOString(),
                payload: { citationId, verdict: verdict.verdict },
              }));
              return verdict.verdict;
            },
            serializeContradictions: async (result, meta) => {
              const { serializeContradictionsDocx } = await import('@/utils/docx-io');
              const firmName = (() => {
                try {
                  return localStorage.getItem('keepance_firm_name') ?? '';
                } catch {
                  return '';
                }
              })();
              return serializeContradictionsDocx(result, meta, { firmName });
            },
          },
        }
      );

      try {
        const initialExecution: WorkflowExecution = {
          runId,
          template,
          currentStepIndex: 0,
          status: 'running',
          inputs: {},
          stepOutputs: [],
          startTime,
        };
        setCurrentExecution(initialExecution);
        setActiveWorkflowTemplate(template);
        setActiveWorkflowFilePath(workflowFilePath);

        // Initial snapshot. Status='running' so re-opening the file
        // mid-run shows the workflow tab in its starting state.
        const initialData = executionToFileData({
          execution: initialExecution,
          workflowFolderPath,
          completedAnswers: [],
          artifacts: [],
          status: 'running',
        });
        const initialJson = JSON.stringify(initialData, null, 2);
        await workspaceServiceRef.current.writeFile(workflowFilePath, initialJson);

        // Open the workflow tab pointing at the real file path. Type stays
        // 'workflow-execution' so editor-store metadata is unchanged, but
        // MainPanel routes purely on `.workflow` extension.
        openTab(workflowFilePath, workflowFilename, initialJson, 'workflow-execution');

        // Refresh tree so the new file shows up in the sidebar before
        // execution starts.
        try {
          const fileTree = await workspaceServiceRef.current.getFileTree();
          setFileTree(fileTree);
        } catch {
          // Non-fatal: tree refresh failure shouldn't block the run.
        }

        const runRecord = await engine.execute(template);
        completeRun(runRecord);

        // Final snapshot for the completed run. Pull the engine's last
        // execution state so endTime + final status are reflected.
        const finalExecution = engine.getExecution() ?? initialExecution;
        scheduleWrite(
          executionToFileData({
            execution: finalExecution,
            workflowFolderPath,
            completedAnswers,
            artifacts,
            status: finalExecution.status === 'failed' ? 'failed' : 'completed',
          }),
          true
        );

        // Keep template around so the completed tab can still show output.
        // setActiveWorkflowTemplate is cleared only on cancel.
        setCurrentExecution(null);
        setActiveWorkflowFilePath(null);

        // Refresh file tree after workflow completes
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Workflow failed:', error);
        const failedExecution = engine.getExecution();
        if (failedExecution) {
          scheduleWrite(
            executionToFileData({
              execution: failedExecution,
              workflowFolderPath,
              completedAnswers,
              artifacts,
              status: 'failed',
            }),
            true
          );
        }
        setCurrentExecution(null);
        setActiveWorkflowFilePath(null);
      }
    },
    [rootPath, setFileTree, completeRun, apiKeys, openTab, addAuditEntry]
  );

  // Handle interview form submission
  const handleInterviewSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (interviewResolver) {
        interviewResolver(answers);
        setInterviewResolver(null);
        setInterviewRejecter(null);
        setInterviewQuestions(null);
        setShowInterviewDialog(false);
      }
    },
    [interviewResolver]
  );

  // Handle interview form cancel
  const handleInterviewCancel = useCallback(() => {
    // Reject the promise so the workflow engine knows the interview was cancelled
    if (interviewRejecter) {
      interviewRejecter(new Error('User cancelled'));
    }
    setShowInterviewDialog(false);
    setInterviewQuestions(null);
    setInterviewResolver(null);
    setInterviewRejecter(null);
    setCurrentExecution(null);
    setActiveWorkflowTemplate(null);
    setActiveWorkflowFilePath(null);
    // Cancellation flushes a `cancelled` status to the .workflow file via
    // the catch branch in handleStartWorkflow when the engine throws —
    // but if the user cancels before the engine has thrown back into the
    // try/catch, the snapshot may still report 'running'. The catch path
    // covers the common case; this is an acceptable trade-off.
  }, [interviewRejecter]);

  // Workflow execution tab: save output as a markdown file
  const handleWorkflowSaveAsFile = useCallback(
    async (content: string, suggestedName: string) => {
      try {
        await saveFile(content, {
          suggestedName,
          types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md'] } }],
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to save workflow output:', error);
        }
      }
    },
    []
  );

  // Workflow execution tab: export output as .docx
  const handleWorkflowExportDocx = useCallback(
    async (content: string, suggestedName: string) => {
      try {
        const { markdownToDocxBytes } = await import('@/utils/docx-io');
        // Read firm name from localStorage — the WorkflowExecutionTab input persists it there
        const firmName = (() => {
          try { return localStorage.getItem('keepance_firm_name') ?? ''; } catch { return ''; }
        })();
        const bytes = await markdownToDocxBytes(content, suggestedName, { firmName });
        await saveFile(bytes, {
          suggestedName,
          types: [
            {
              description: 'Word Documents',
              accept: {
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                  ['.docx'],
              },
            },
          ],
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to export workflow output as .docx:', error);
        }
      }
    },
    []
  );

  // Workflow execution tab: export output as .pptx
  // T3-4: When the output contains a ```json code fence with a valid SlideJSON
  // array (produced by NDA-Safe Slide Outliner and other deck workflows), the
  // structured path is used — themed slides, tables, and speaker notes. Falls
  // back to the plain markdown-to-pptx path when no slide JSON is present.
  const handleWorkflowExportPptx = useCallback(
    async (content: string, suggestedName: string) => {
      try {
        const pptxIo = await import('@/utils/pptx-io');

        // Try the structured path first
        const slideJSON = (() => {
          const match = content.match(/```json\s*(\[[\s\S]*?\])\s*```/);
          if (!match) return null;
          try {
            const parsed = JSON.parse(match[1]!);
            if (
              Array.isArray(parsed) &&
              parsed.length > 0 &&
              typeof parsed[0]?.title === 'string' &&
              typeof parsed[0]?.layout === 'string'
            ) {
              return parsed as import('@/utils/pptx-io').SlideJSON[];
            }
          } catch {
            // malformed JSON — fall through to markdown path
          }
          return null;
        })();

        const firmNameRaw = (() => {
          try { return localStorage.getItem('keepance_firm_name') ?? ''; } catch { return ''; }
        })();
        const pptxOptions: import('@/utils/pptx-io').PptxExportOptions = firmNameRaw
          ? { firmName: firmNameRaw }
          : {};

        const bytes = slideJSON
          ? await pptxIo.buildPptxFromSlideJSON(slideJSON, pptxOptions)
          : await pptxIo.markdownToPptxBytes(content);

        await saveFile(bytes, {
          suggestedName,
          types: [
            {
              description: 'PowerPoint Presentations',
              accept: {
                'application/vnd.openxmlformats-officedocument.presentationml.presentation':
                  ['.pptx'],
              },
            },
          ],
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to export workflow output as .pptx:', error);
        }
      }
    },
    []
  );

  // Handle opening AI Rules file
  const handleOpenAIRules = useCallback(async () => {
    if (!rootPath || !workspaceServiceRef.current) return;

    const rulesPath = `${rootPath}/ai-rules.md`;

    try {
      // Check if file exists
      const exists = await workspaceServiceRef.current.exists(rulesPath);

      if (!exists) {
        // Create default AI rules file
        const defaultContent = `# AI Rules

This file contains rules and guidelines for AI assistants in this workspace.

## General Guidelines
- Be helpful, accurate, and concise
- Follow user instructions carefully
- Ask for clarification when needed

## Specific Rules
- Add your custom rules here
- AI will read and follow these rules in all chats
`;
        await workspaceServiceRef.current.writeFile(rulesPath, defaultContent);
        refreshFileTree();
      }

      // Open the file
      await handleFileOpen(rulesPath, 'ai-rules.md');
    } catch (error) {
      console.error('Failed to open AI rules file:', error);
    }
  }, [rootPath, handleFileOpen, refreshFileTree]);


  // Autosave dirty tabs every 2 seconds. See src/app/lifecycle/useAutosave.ts.
  // Routes through writeTabContent so binary formats (.docx/.xlsx/.pptx) decode
  // their data-URL content back to bytes before hitting disk.
  useAutosave(openTabs, writeTabContent, markSaved, workspaceServiceRef);


  // Command-palette commands. See src/app/commands/useAppCommands.ts.
  const commands = useAppCommands({ openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, isSplit, splitPane, closeSplit, handleOpenBrowserTab, handleCreateDefaultDocument, sidebarActiveTab, setSidebarCollapsed, setShowWorkspaceSelector, setSidebarActiveTab, setShowSettingsModal, prompt });

  // Global keyboard shortcuts. See src/app/commands/useKeyboardShortcuts.ts.
  useKeyboardShortcuts({
    sidebarActiveTab, openTabs, activeTabPath, isSplit,
    setShowSettingsModal, setShowCommandPalette, setShowQuickOpen,
    setSidebarCollapsed, setShowShortcutsOverlay, setFileTree, setDocumentsView, setSidebarActiveTab,
    handleSaveFile, closeTab, toggleOutline, splitPane, closeSplit,
    openAIAssistantTab, handleRestoreFromTrash, handleFileOpen, handleCreateDefaultDocument,
    workspaceServiceRef, undoStackRef, deleteHistoryRef, renameHistoryRef,
  });

  // Show workspace selector if no workspace is open (unless in test mode).
  // Keepance 3.0: the rebuilt first-run wizard is the live first-run surface.
  // It renders as a full-screen overlay (fixed inset-0 z-50) layered OVER
  // whatever is behind it — most often the WorkspaceSelector, since first run
  // happens before a workspace is chosen — so the existing path-input vs
  // file-picker flow is preserved underneath. We build it once here and render
  // it in both the WorkspaceSelector branch and the main app branch so it shows
  // regardless of which one is active (e.g. ?forceOnboarding with a workspace
  // already open). It supersedes the old WelcomeOnboardingDialog, which only
  // had the email/telemetry consent step; the wizard owns the welcome moment
  // now. `onComplete` (the wizard's markComplete) sets
  // `keepance_onboarding_complete`; on skip we set the same flag so first-run
  // never re-prompts. The Feature Tour then auto-shows as it does today.
  const firstRunOverlay = showFirstRun ? (
    <GuidedOnboarding
      onSaveKey={handleSaveOnboardingApiKey}
      {...(workspaceServiceRef.current
        ? { workspace: workspaceServiceRef.current }
        : {})}
      onComplete={(opts) => {
        setShowFirstRun(false);
        if (opts?.writeSamples && rootPath) {
          try {
            const sampleMatter = getOrCreateSampleMatter(rootPath);
            useMatterStore.getState().setActiveMatter(sampleMatter.id);
            setSidebarActiveTab('search');
          } catch (err) {
            console.warn('[App] sample-matter post-onboarding setup failed:', err instanceof Error ? err.message : String(err));
            // Landing on Matters ensures the Get-started card is visible.
            setSidebarActiveTab('matters');
          }
        } else {
          // No samples written: land on Matters so the Get-started card is visible.
          setSidebarActiveTab('matters');
        }
      }}
    />
  ) : null;

  // The WorkspaceSelector is now a full-viewport branded page — no wrapper needed.
  if (!IS_TEST_MODE && (showWorkspaceSelector || !rootPath) && !(IS_DEMO_MODE && !demoOpenFailed)) {
    const canDismiss = Boolean(rootPath);
    return (
      <>
        {/* One-time embedding-model download banner: mounted here as well as
            in the main shell (same both-branches pattern as firstRunOverlay
            below — the branches are exclusive, so only one instance ever
            exists). Mounting runs useModelStatus's probe, so a brand-new
            user's download starts during onboarding rather than after it,
            and returning to the selector mid-download keeps the progress
            visible. The selector is a fixed full-viewport page (z-50), so
            the banner needs its own fixed top-of-screen layer above it. */}
        <div className="fixed inset-x-0 top-0 z-[60]">
          <ModelDownloadCard />
        </div>
        <WorkspaceSelector
          open={true}
          onWorkspaceSelected={handleWorkspaceSelected}
          onDismiss={canDismiss ? () => setShowWorkspaceSelector(false) : undefined}
        />
        {firstRunOverlay}
      </>
    );
  }

  // Shared Settings action handler — used by BOTH the quick Settings modal and
  // the full-page Settings nav tab so every action link (Manage AI keys, Check
  // for updates, Open website, …) behaves identically in either surface.
  const handleSettingsAction = (actionId: string) => {
    if (actionId === 'open-ai-keys') {
      setApiKeyWizardOpen(true);
    } else if (actionId === 'open-api-key-tutorial') {
      setApiKeyWizardOpen(true);
    } else if (actionId === 'open-ai-rules') {
      void handleOpenAIRules();
    } else if (actionId === 'updater-check-now') {
      void manualUpdateCheck();
    } else if (actionId === 'open-whats-new') {
      setShowWhatsNewModalDirect(true);
    } else if (actionId === 'open-website') {
      void openExternal('https://keepance.com');
    } else if (actionId === 'open-github') {
      void openExternal('https://github.com/keepance/keepance');
    } else if (actionId === 'reset-feature-tour') {
      featureTour.restart();
      setTimeout(() => setTourOpen(true), 300);
    }
  };
  const handleSettingsRestartOnboarding = () => {
    setShowFirstRun(true);
  };

  // Get current project name from root path
  const currentProjectName = rootPath?.split('/').pop() ?? 'Unnamed Project';

  return (
    <div className="h-screen flex flex-col bg-background text-foreground" data-testid="app-container">
      {/* Accessibility: skip link so keyboard users can bypass the nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded focus:bg-background focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* Header bar with project switcher */}
      <header className="flex items-center justify-between h-10 px-2 border-b bg-muted/30 shrink-0" data-testid="app-header">
        <div className="flex items-center gap-2">
          <ProjectManager
            currentProjectName={currentProjectName}
            onSwitchProject={() => setShowWorkspaceSelector(true)}
            onOpenRecentProject={handleOpenRecentProject}
            recentProjects={recentWorkspaces}
          />
        </div>
        <div className="flex items-center gap-2">
          {/*
            UX-25: 3-state theme toggle. Cycles system → light → dark → system.
            Icon reflects the *preference* (not the effective theme), so a user
            in 'system' mode always sees the Monitor icon even if the OS is
            currently dark. The title gives both the preference and the
            effective theme when in 'system' mode.
          */}
          <Button
            data-testid="theme-toggle"
            data-theme={theme}
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              // Cycle: system → light → dark → system
              setTheme((prev) => {
                if (prev === 'system') return 'light';
                if (prev === 'light') return 'dark';
                return 'system';
              });
            }}
            title={
              theme === 'system'
                ? `System theme (currently ${effectiveTheme})`
                : theme === 'light'
                  ? 'Light theme'
                  : 'Dark theme'
            }
            aria-label={
              theme === 'system'
                ? `System theme (currently ${effectiveTheme})`
                : theme === 'light'
                  ? 'Light theme'
                  : 'Dark theme'
            }
          >
            {theme === 'system' ? (
              <Monitor data-testid="theme-icon-system" className="h-4 w-4" />
            ) : theme === 'light' ? (
              <Sun data-testid="theme-icon-light" className="h-4 w-4" />
            ) : (
              <Moon data-testid="theme-icon-dark" className="h-4 w-4" />
            )}
          </Button>
          <Button
            data-testid="settings-gear"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              // Fix 5: no-op when Settings tab is already the active surface.
              if (sidebarActiveTab !== 'settings') {
                setShowSettingsModal(true);
              }
            }}
            title="Settings (Ctrl+,)"
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            data-testid="command-palette-button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setShowCommandPalette(true)}
            title="Command Palette (Ctrl+K)"
          >
            <Command className="h-3 w-3 mr-1" />
            Ctrl+K
          </Button>
        </div>
      </header>

      {/* Memory: model download + live indexing progress banners. Each
          renders only while its work is in flight (one-time embedding-model
          download / workspace indexer running, or briefly after it
          completes); otherwise it returns null and adds zero layout. */}
      <ModelDownloadCard />
      <RagProgressBanner />

      {/* Trial countdown banner — only renders during the final week of
          the free trial (or once expired) and when no license is active.
          Otherwise null and zero layout. */}
      <TrialBanner onActivate={() => openSettings('license')} />

      {/* The hero Trust Bar (elevated egress + matter scope). */}
      <ReimaginedTrustBar />

      {/* Main content area */}
      <div id="main-content" className="flex-1 flex overflow-hidden">
        {/* Sidebar with file tree, workflows, research, and settings */}
        <AppShellNav
          activeTab={sidebarActiveTab}
          onTabChange={(tab: string) => {
            // Any click to 'files' in the spine nav lands on the Files browser,
            // even if a document was the last thing open. This is the user
            // clicking the nav (vs a file being opened programmatically), so it
            // always means "show me my files".
            if (tab === 'files') {
              setDocumentsView('browser');
            }
            setSidebarActiveTab(tab as typeof sidebarActiveTab);
          }}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />

        {/* Main editor panel, or a full-page reimagined surface (matters/Ask/Email). */}
        {sidebarActiveTab ==='matters' ? (
          <ReimaginedMattersHome />
        ) : sidebarActiveTab ==='search' ? (
          <ReimaginedAsk
            onSaveToDocument={async (content) => {
              if (!workspaceServiceRef.current || !rootPath) return;
              // Word-first: AI answers save as a real .docx (not markdown).
              const { deriveFilenameFromMessage, resolveUniqueName } = await import('@/utils/fileDrop');
              const { markdownToDocxBytes, docxBytesToDataUrl } = await import('@/utils/docx-io');
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
          />
        ) : sidebarActiveTab ==='email' ? (
          <ReimaginedEmailWorkspace
            onSaveToWorkspace={async (content, suggestedName) => {
              if (!workspaceServiceRef.current || !rootPath) return;
              // Word-first: saved email content becomes a real .docx.
              const { resolveUniqueName } = await import('@/utils/fileDrop');
              const { markdownToDocxBytes, docxBytesToDataUrl } = await import('@/utils/docx-io');
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
            onOpenSettings={() => openSettings('ai')}
          />
        ) : sidebarActiveTab ==='files' ? (
          <ReimaginedDocumentsHome
            documentsView={documentsView}
            onFileOpen={handleFileOpen}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRename={handleRename}
            onDelete={handleDelete}
            onMove={handleMove}
            onDownload={handleDownload}
            onCreateDefaultDocument={handleCreateDefaultDocument}
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
          <ReimaginedAssociateHome
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
          <ReimaginedAuditHome entries={auditEntries} />
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
      </div>

      {/* Status bar. showFileContext=true only on the Documents/editor surface
          (files tab) so the breadcrumb never shows stale editor context when
          the user is on Search, Email, Workflows, etc. (A8.2). */}
      <StatusBar
        onOpenSettings={() => openSettings('license')}
        showFileContext={sidebarActiveTab === 'files'}
      />

      <AppDialogs
        addAuditEntry={addAuditEntry}
        matterManagerOpen={matterManagerOpen}
        setMatterManagerOpen={setMatterManagerOpen}
        showInterviewDialog={showInterviewDialog}
        setShowInterviewDialog={setShowInterviewDialog}
        interviewQuestions={interviewQuestions}
        handleInterviewSubmit={handleInterviewSubmit}
        handleInterviewCancel={handleInterviewCancel}
        showCommandPalette={showCommandPalette}
        setShowCommandPalette={setShowCommandPalette}
        commands={commands}
        showSettingsModal={showSettingsModal}
        setShowSettingsModal={setShowSettingsModal}
        auditEntries={auditEntries}
        settingsInitialCategory={settingsInitialCategory}
        handleSettingsAction={handleSettingsAction}
        handleSettingsRestartOnboarding={handleSettingsRestartOnboarding}
        accountWindowOpen={accountWindowOpen}
        setAccountWindowOpen={setAccountWindowOpen}
        firstRunOverlay={firstRunOverlay}
        tourOpen={tourOpen}
        showFirstRun={showFirstRun}
        setTourOpen={setTourOpen}
        featureTour={featureTour}
        apiKeyWizardOpen={apiKeyWizardOpen}
        setApiKeyWizardOpen={setApiKeyWizardOpen}
        handleSaveOnboardingApiKey={handleSaveOnboardingApiKey}
        showShortcutsOverlay={showShortcutsOverlay}
        setShowShortcutsOverlay={setShowShortcutsOverlay}
        showQuickOpen={showQuickOpen}
        setShowQuickOpen={setShowQuickOpen}
        fileTree={fileTree}
        handleFileOpen={handleFileOpen}
        showAudioRecorder={showAudioRecorder}
        setShowAudioRecorder={setShowAudioRecorder}
        handleSaveAudioRecording={handleSaveAudioRecording}
        confirmDialogProps={confirmDialogProps}
        promptDialogProps={promptDialogProps}
        undoToast={undoToast}
        isFileDragging={isFileDragging}
        showWhatsNewModalDirect={showWhatsNewModalDirect}
        setShowWhatsNewModalDirect={setShowWhatsNewModalDirect}
      />
    </div>
  );
}

export default App;
