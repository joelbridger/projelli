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
import { useTestModeWorkspace } from '@/app/lifecycle/useTestModeWorkspace';
import { useKeyboardShortcuts } from '@/app/commands/useKeyboardShortcuts';
import { useAppCommands } from '@/app/commands/useAppCommands';
import { useDialogManager } from '@/app/dialogs/useDialogManager';
import { useFileOperations } from '@/app/fileOps/useFileOperations';
import { useDocumentCreation } from '@/app/fileOps/useDocumentCreation';
import { useWorkflowRunner } from '@/app/workflow/useWorkflowRunner';
import { WorkspaceSelector } from '@/features/documents/workspace/WorkspaceSelector';

import { AppShellNav } from '@/app/shell/layout/AppShellNav';
import { TrustBar } from '@/app/shell/layout/TrustBar';
import { StatusBar } from '@/app/shell/layout/StatusBar';
import { AppDialogs } from '@/app/shell/AppDialogs';
import { AppSurfaceRouter } from '@/app/shell/AppSurfaceRouter';

import { ProjectManager } from '@/features/documents/workspace/ProjectManager';
import { Button } from '@/ui/button';
import { Command, Moon, Monitor, Sun, Settings } from 'lucide-react';
import { manualUpdateCheck } from '@/platform/updater/UpdateManager';
import { openExternal } from '@/platform/utils/openExternal';
import { TrialBanner } from '@/features/account/trial';
import { hasCompletedOnboarding } from '@/features/onboarding';
import { JourneyHost } from '@/features/onboarding-journey/JourneyHost';
import { journeyChapters } from '@/features/onboarding-journey/chapters';
import { persistProfessionModelDefault } from '@/platform/profile/professionModel';
import { writeSampleFiles } from '@/platform/matter/samples';
import { useProfileStore } from '@/platform/profile/profileStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import {
  createKeychainService,
  migrateLocalStorageApiKeysToKeychain,
} from '@/platform/providers/KeychainService';
import { sendEvent } from '@/platform/utils/telemetry';
import { useFeatureTour } from '@/platform/hooks/useFeatureTour';
// M1 (v1.5) Memory: workspace RAG indexer + status UI.
import { ModelDownloadCard } from '@/platform/rag/ui/ModelDownloadCard';
import { RagProgressBanner } from '@/platform/rag/ui/RagProgressBanner';
import { useMemoryWiring } from '@/platform/hooks/useMemoryWiring';
import { useGlobalFileDrop } from '@/app/shell/common/GlobalDropOverlay';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { useWorkflowStore } from '@/features/workflows/workflowStore';
import { createWorkspaceService, type WorkspaceService } from '@/platform/fs/WorkspaceService';
import { createWebFSBackend } from '@/platform/fs/WebFSBackend';
import { createFSBackend, isTauriEnvironment } from '@/platform/fs/BackendFactory';
import type { TrashedItem } from '@/platform/history/TrashService';

import type { AuditEntry } from '@/platform/types/audit';
import { AuditService } from '@/platform/audit/AuditService';
import { getOrCreateSampleMatter, useMatterStore, useActiveMatter } from '@/platform/matter/matterStore';
import { useMatterUiStore, isWorkingSurface } from '@/platform/matter/matterUiStore';

import {
  TemplateMetadataReader,
  type MarketplaceService,
} from '@/features/workflows/marketplace/svc';
import {
  isWorkflowFilePath,
} from '@/features/workflows/engine/workflowFile';
import { FileSystemWatcher, createFileTreeSnapshot } from '@/platform/fs/FileSystemWatcher';

import { isBinaryFile, arrayBufferToDataUrl, getMimeType } from '@/platform/utils/file-utils';
import { writeDroppedFiles, importPickedFiles } from '@/platform/utils/fileDrop';
import { MemoryService } from '@/platform/rag/MemoryService';
import { useSettingsStore } from '@/platform/settings/settingsStore';


import { useTrash } from '@/platform/hooks/useTrash';
import { useSourceCards } from '@/app/hooks/useSourceCards';
import { useAIChatFiles } from '@/platform/hooks/useAIChatFiles';
import { useApiKeys } from '@/platform/hooks/useApiKeys';
import { useOpenFileAIContext } from '@/platform/hooks/useOpenFileAIContext';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import { useModelList } from '@/platform/hooks/useModelList';
import { useContentIndex } from '@/platform/hooks/useContentIndex';
import { useMailSync } from '@/features/email/useMailSync';
import { useOpenEmailListener } from '@/platform/hooks/useOpenEmailListener';
import type { MailIndexChunk } from '@/platform/utils/mail-commands';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { usePromptDialog } from '@/platform/hooks/usePromptDialog';
import { useUndoToast } from '@/app/shell/common/UndoToast';

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
    apiKeyManagerOpen, setApiKeyManagerOpen,
  } = useDialogManager();
  // Tab to pre-select inside the Account window (e.g. 'connections' from the
  // email connect entry points). Cleared when the window closes.
  const [accountWindowInitialTab, setAccountWindowInitialTab] = useState<string | undefined>(undefined);
  // Shared contract — "Ask from the matter hub prefills Search".
  // MatterHub dispatches a keepance:matter-launch event with surface='search'
  // and a question string; App sets this state; Ask consumes it.
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

  // Sidebar state
  const [sidebarActiveTab, setSidebarActiveTab] = useState<AppSurface>('files');
  // Per-matter UI memory (matterUiStore): subscribe to the active matter so we
  // can save + restore each matter's last working surface and focused document.
  const activeMatterId = useMatterStore((s) => s.activeMatterId);
  const activeMatter = useActiveMatter();
  // F-509 — controlled sidebar collapse so the global Ctrl+B shortcut and the
  // command palette can drive the same collapse the chevron button does.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Fix 1: which view the Documents surface should land on. DocumentsHome
  // UNMOUNTS/REMOUNTS on every tab switch, so a counter "reset signal" can't work
  // (its refs reset on remount). Instead App owns the intent here (it persists
  // across the remount) and DocumentsHome reads it in its useState
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
  const { apiKeys, handleSaveApiKey: rawSaveApiKey, handleDeleteApiKey } = useApiKeys();

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

  useEffect(() => {
    void migrateLocalStorageApiKeysToKeychain();
  }, []);

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

  // After "Manage AI Account Keys" removes a key from the keychain, clear the
  // mirrored live API-key state (the `apiKey_<provider>` localStorage entry +
  // the in-memory apiKeys array) so the AI pane immediately stops offering that
  // provider. The keychain deletion itself happens inside ApiKeyManager.
  const handleRemoveApiKey = useCallback(
    (provider: 'anthropic' | 'openai' | 'google') => {
      handleDeleteApiKey(provider);
    },
    [handleDeleteApiKey]
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

  useTestModeWorkspace({ isTestMode: IS_TEST_MODE, rootPath, setRootPath, openFile, setFileTree, expandAllFolders, workspaceServiceRef });

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
          setDocumentsView('editor');
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
          setDocumentsView('editor');
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
    setDocumentsView('editor');
    setSidebarActiveTab('files');
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
  // the tab is added while the full-page EmailWorkspace is active,
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
    onOpenAccount: (tab?: string) => { setAccountWindowInitialTab(tab); setAccountWindowOpen(true); },
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

  // BUG-014 — "Add files" import. Opens the native file picker, copies the
  // chosen files into the workspace, and EXPLICITLY indexes each (so search
  // works without relying on the file-watcher). Surfaces per-file failures.
  const handleImportFiles = useCallback(
    async (folderPath?: string | null) => {
      const service = workspaceServiceRef.current;
      if (!service || !rootPath) return;
      let selected: string | string[] | null = null;
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        selected = await open({
          multiple: true,
          directory: false,
          title: 'Add files to your workspace',
        });
      } catch (err) {
        console.error('[App] Add files: native picker unavailable', err);
        return;
      }
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const { readFile } = await import('@tauri-apps/plugin-fs');
      const readBinary = (p: string) =>
        service.readFileBinary
          ? service.readFileBinary(p)
          : Promise.reject(new Error('binary read unsupported'));
      const binaryWs = { readBinary };

      const results = await importPickedFiles({
        service,
        targetFolder: folderPath ?? rootPath,
        paths,
        readBytes: async (p) => {
          const u8 = await readFile(p);
          const buf = new ArrayBuffer(u8.byteLength);
          new Uint8Array(buf).set(u8);
          return buf;
        },
        indexFile: (p) => MemoryService.indexFile(p),
        indexPdf: async (p) => {
          const r = await MemoryService.indexPdfFile(p, binaryWs);
          return { indexed: r.indexed, ...(r.reason ? { reason: r.reason } : {}) };
        },
      });

      const tree = await service.getFileTree();
      setFileTree(tree);
      for (const r of results) {
        if (!r.error) {
          // eslint-disable-next-line no-await-in-loop
          await handleFileOpen(r.path, r.name);
        }
      }
      if (results.length > 0) {
        const last = results[results.length - 1]!;
        if (!last.error) useEditorStore.getState().setActiveTab(last.path);
      }
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        console.error('[App] Add files: some files could not be imported', failed);
      }
      // BUG-015 — a PDF was imported but won't be searchable because PDF
      // indexing is off (the default). Don't fail silently: tell the user and
      // offer a one-tap enable (flipping the setting auto-triggers indexing).
      const pdfUnindexed = results.some((r) => r.reason === 'pdf-indexing-disabled');
      if (pdfUnindexed) {
        undoToast.show({
          message: 'Added — but PDF search is off, so this PDF will not be searchable yet.',
          actionLabel: 'Turn on PDF search',
          ttlMs: 15_000,
          onUndo: () => {
            useSettingsStore.getState().setSetting('includePdfsInWorkspaceIndex', true);
          },
        });
      }
    },
    [rootPath, setFileTree, handleFileOpen, undoToast]
  );

  const { isDragging: isFileDragging } = useGlobalFileDrop({
    onDrop: handleGlobalFileDrop,
    enabled: !!rootPath && !showWorkspaceSelector,
  });


  // Workflow execution state and handlers (extracted to useWorkflowRunner).
  const {
    currentExecution,
    activeWorkflowTemplate,
    showInterviewDialog,
    setShowInterviewDialog,
    interviewQuestions,
    workflowProviderError,
    activeWorkflowFilePath,
    handleStartWorkflow,
    handleInterviewSubmit,
    handleInterviewCancel,
    handleWorkflowSaveAsFile,
    handleWorkflowExportDocx,
    handleWorkflowExportPptx,
  } = useWorkflowRunner({
    rootPath,
    isTestMode: IS_TEST_MODE,
    apiKeys,
    completeRun,
    openTab,
    setFileTree,
    addAuditEntry,
    workspaceServiceRef,
    templatesMetadataReaderRef,
    templatesMarketplaceServiceRef,
  });

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
  const commands = useAppCommands({ openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, isSplit, splitPane, closeSplit, handleOpenBrowserTab, handleCreateDefaultDocument, sidebarActiveTab, setSidebarCollapsed, setShowWorkspaceSelector, setSidebarActiveTab, openAIAssistantTab, setShowSettingsModal, prompt });

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
  // The animated JourneyHost is the live first-run surface. It renders as a
  // full-screen overlay layered OVER the WorkspaceSelector (which handles the
  // workspace-folder pick underneath). The same trigger conditions as before;
  // only what renders has changed. `onComplete` / `onExit` both set the
  // keepance_onboarding_complete flag so the overlay never re-prompts.
  // The Feature Tour auto-shows afterward as it did before.

  // JourneyHost actions — wired to the same real App handlers GuidedOnboarding used.
  const journeyActions = useMemo(() => ({
    // saveApiKey: stores in OS keychain AND refreshes live model list state —
    // exactly the same path as handleSaveOnboardingApiKey.
    saveApiKey: handleSaveOnboardingApiKey,

    // setConfidentialityMode: writes to the settings store (persisted to
    // localStorage via the settings schema) — the same store TrustBar reads.
    setConfidentialityMode: (mode: import('@/platform/privacy/egress').ConfidentialityMode) => {
      useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
    },

    // chooseWorkspaceFolder: opens the native folder picker (same plugin path
    // WorkspaceSelector uses), builds the real WorkspaceService for that path,
    // and calls handleWorkspaceSelected so the picked folder is immediately
    // the active workspace (Ch3 can display the path while the rest of the
    // journey plays out). Returns the path string or null on cancel/error.
    chooseWorkspaceFolder: async (): Promise<string | null> => {
      try {
        const isTauri = isTauriEnvironment();
        if (isTauri) {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selectedPath = await open({
            directory: true,
            multiple: false,
            title: 'Select Workspace Folder',
          });
          if (typeof selectedPath !== 'string') return null;
          const backend = await createFSBackend(selectedPath);
          const service = createWorkspaceService();
          await service.initialize(backend, selectedPath);
          await handleWorkspaceSelected(service);
          return selectedPath;
        } else {
          // Browser env: use the Web File System Access API directory picker,
          // mirroring WorkspaceSelector's browser path exactly.
          const webBackend = createWebFSBackend();
          const handle = await webBackend.openDirectoryPicker();
          const rootPath = '/' + handle.name;
          const service = createWorkspaceService();
          await service.initialize(webBackend, rootPath);
          await handleWorkspaceSelected(service);
          return rootPath;
        }
      } catch {
        // Picker cancelled or unavailable — return null so Ch3 stays put.
        return null;
      }
    },
  }), [handleSaveOnboardingApiKey, handleWorkspaceSelected]);

  const firstRunOverlay = showFirstRun ? (
    <JourneyHost
      chapters={journeyChapters}
      actions={journeyActions}
      onComplete={async (data) => {
        // Map 'financial' (journey profession) -> 'advisor' (samples/model type)
        // for full compatibility. Compute once and reuse for both the model
        // default and the sample files so both callers see the same value.
        const mappedProfession = data.profession === 'financial' ? 'advisor' : data.profession;

        // Persist profession model default for non-cloud users (skip/local). For
        // cloud users the provider they connected in Ch5 is already stored; we
        // must not override it. So only call when aiChoice isn't 'cloud'.
        if (mappedProfession && data.aiChoice !== 'cloud') {
          persistProfessionModelDefault(mappedProfession);
        }

        // Persist display name + photo via profileStore (same store IdentityStep
        // and GuidedOnboarding's Step 2 wrote to directly).
        if (data.displayName) {
          useProfileStore.getState().setSoloName(data.displayName);
        }
        if (data.photoDataUrl) {
          useProfileStore.getState().setSoloAvatar(data.photoDataUrl);
        }

        // Create sample matters if the user opted in and we have a workspace.
        // Await with try/catch so a silent write failure does NOT navigate the
        // user to an empty sample matter (matches old GuidedOnboarding behavior).
        const sampleProfession = mappedProfession ?? 'other';
        let didWriteSamples = false;
        if (data.addSamples && workspaceServiceRef.current && rootPath) {
          try {
            await writeSampleFiles(workspaceServiceRef.current, sampleProfession);
            didWriteSamples = true;
          } catch (err) {
            console.warn('[App] journey sample copy failed:', err instanceof Error ? err.message : String(err));
          }
        }

        // Mark complete and close the overlay.
        localStorage.setItem('keepance_onboarding_complete', 'true');
        setShowFirstRun(false);

        // Navigate to a useful starting surface.
        if (didWriteSamples && rootPath) {
          try {
            const sampleMatter = getOrCreateSampleMatter(rootPath);
            useMatterStore.getState().setActiveMatter(sampleMatter.id);
            setSidebarActiveTab('search');
          } catch (err) {
            console.warn('[App] sample-matter post-journey setup failed:', err instanceof Error ? err.message : String(err));
            setSidebarActiveTab('matters');
          }
        } else {
          setSidebarActiveTab('matters');
        }
      }}
      onExit={(_data) => {
        // User skipped — mark complete so the overlay never re-prompts.
        localStorage.setItem('keepance_onboarding_complete', 'true');
        setShowFirstRun(false);
        setSidebarActiveTab('matters');
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
      // "Manage AI Account Keys" now opens the manager (list + remove + add),
      // not the add-only wizard. The manager's "Add a provider key" button
      // opens the wizard from there.
      setApiKeyManagerOpen(true);
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
      <TrustBar />

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
        <AppSurfaceRouter
          sidebarActiveTab={sidebarActiveTab}
          askPrefill={askPrefill}
          setAskPrefill={setAskPrefill}
          documentsView={documentsView}
          currentExecution={currentExecution}
          activeWorkflowTemplate={activeWorkflowTemplate}
          showInterviewDialog={showInterviewDialog}
          interviewQuestions={interviewQuestions}
          workflowProviderError={workflowProviderError}
          runHistory={runHistory}
          auditEntries={auditEntries}
          apiKeys={apiKeys}
          rootPath={rootPath}
          trashItems={trashItems}
          trashStats={trashStats}
          trashRetentionPeriod={trashRetentionPeriod}
          trashCustomRetentionDays={trashCustomRetentionDays}
          activeWorkflowFilePath={activeWorkflowFilePath}
          openTabs={openTabs}
          workspaceServiceRef={workspaceServiceRef}
          setFileTree={setFileTree}
          openFile={openFile}
          openSettings={openSettings}
          handleFileOpen={handleFileOpen}
          handleCreateFile={handleCreateFile}
          handleCreateFolder={handleCreateFolder}
          handleRename={handleRename}
          handleRenameWithName={handleRenameWithName}
          handleDelete={handleDelete}
          handleMove={handleMove}
          handleDownload={handleDownload}
          handleCreateDefaultDocument={handleCreateDefaultDocument}
          handleImportFiles={handleImportFiles}
          handleCreateDocxAtRoot={handleCreateDocxAtRoot}
          handleCreateTextFileAtRoot={handleCreateTextFileAtRoot}
          handleCreateFolderAtRoot={handleCreateFolderAtRoot}
          handleSetLetterheadTemplate={handleSetLetterheadTemplate}
          handleRestoreFromTrash={handleRestoreFromTrash}
          handlePermanentDelete={handlePermanentDelete}
          handleEmptyTrash={handleEmptyTrash}
          handleTrashRetentionChange={handleTrashRetentionChange}
          refreshFileTree={refreshFileTree}
          addAuditEntry={addAuditEntry}
          handleRequestApiKeySetup={handleRequestApiKeySetup}
          handleInterviewSubmit={handleInterviewSubmit}
          handleInterviewCancel={handleInterviewCancel}
          handleWorkflowSaveAsFile={handleWorkflowSaveAsFile}
          handleWorkflowExportDocx={handleWorkflowExportDocx}
          handleWorkflowExportPptx={handleWorkflowExportPptx}
          handleStartWorkflow={handleStartWorkflow}
          handleSettingsAction={handleSettingsAction}
          handleSettingsRestartOnboarding={handleSettingsRestartOnboarding}
          activeMatter={activeMatter}
        />
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
        accountWindowInitialTab={accountWindowInitialTab}
        onAccountWindowClosed={() => setAccountWindowInitialTab(undefined)}
        firstRunOverlay={firstRunOverlay}
        tourOpen={tourOpen}
        showFirstRun={showFirstRun}
        setTourOpen={setTourOpen}
        featureTour={featureTour}
        apiKeyWizardOpen={apiKeyWizardOpen}
        setApiKeyWizardOpen={setApiKeyWizardOpen}
        handleSaveOnboardingApiKey={handleSaveOnboardingApiKey}
        apiKeyManagerOpen={apiKeyManagerOpen}
        setApiKeyManagerOpen={setApiKeyManagerOpen}
        apiKeyKeychain={keychainRef.current}
        onApiKeyRemoved={handleRemoveApiKey}
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
