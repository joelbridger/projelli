/**
 * Keepance — Local-first AI workspace for confidential client work.
 *
 * Core Thesis: This is NOT a chat UI. It is an artifact-driven workspace
 * where AI proposes and the user approves all destructive actions.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { FileTree } from '@/components/workspace/FileTree';
import { AppShellNav } from '@/components/layout/AppShellNav';
import { ReimaginedTrustBar } from '@/components/layout/ReimaginedTrustBar';
import { ReimaginedMattersHome } from '@/components/matter/ReimaginedMattersHome';
import { ReimaginedAsk } from '@/components/ai/ReimaginedAsk';
import { ReimaginedEmailWorkspace } from '@/components/mail/ReimaginedEmailWorkspace';
import { ReimaginedDocumentsHome } from '@/components/documents/ReimaginedDocumentsHome';
import { ReimaginedAssociateHome } from '@/components/workflow/ReimaginedAssociateHome';
import { ReimaginedAuditHome } from '@/components/audit/ReimaginedAuditHome';
import { isReimaginedShell } from '@/lib/reimaginedShell';
import { MainPanel } from '@/components/layout/MainPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { McpApprovalGate } from '@/components/settings/McpApprovalGate';
import { WorkflowPanel } from '@/components/workflow/WorkflowPanel';
import { InterviewForm } from '@/components/workflow/InterviewForm';
import { CommandPalette, getDefaultCommands, type PaletteCommand } from '@/components/common/CommandPalette';
import { ShortcutsOverlay } from '@/components/ShortcutsOverlay';
import { QuickOpen } from '@/components/QuickOpen';
import { SourceCardPanel } from '@/components/research/SourceCardPanel';
import { SearchPanel } from '@/components/search/SearchPanel';
import { AuditLog } from '@/components/common/AuditLog';
import { TrashPanel } from '@/components/common/TrashPanel';
import { AIAssistantPane } from '@/components/ai/AIAssistantPane';
import { ProjectManager } from '@/components/workspace/ProjectManager';
import { AudioRecorderModal } from '@/components/audio/AudioRecorderModal';
import { Button } from '@/components/ui/button';
import { Command, Moon, Monitor, Sun, Settings } from 'lucide-react';
import { WhatsNewToast, WhatsNewModal, useWhatsNew } from '@/components/WhatsNew';
import { UpdateManager, manualUpdateCheck } from '@/components/updater/UpdateManager';
import { openExternal } from '@/utils/openExternal';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { AccountWindow } from '@/components/account/AccountWindow';
import { SettingsContent } from '@/components/settings/SettingsContent';
import { TrialBanner } from '@/components/trial';
import { hasCompletedOnboarding } from '@/components/onboarding';
import { GuidedOnboarding } from '@/components/onboarding/GuidedOnboarding';
import { ApiKeyWizard } from '@/components/onboarding/ApiKeyWizard';
import { createKeychainService } from '@/modules/models/KeychainService';
import { sendEvent } from '@/utils/telemetry';
import { FeatureTour } from '@/components/onboarding/FeatureTour';
import { useFeatureTour } from '@/hooks/useFeatureTour';
import { useSettingsStore } from '@/stores/settingsStore';
import { isLawExperience } from '@/stores/professionStore';
// M1 (v1.5) Memory: workspace RAG indexer + status UI.
import { ModelDownloadCard } from '@/components/memory/ModelDownloadCard';
import { RagProgressBanner } from '@/components/memory/RagProgressBanner';
import { useMemoryWiring } from '@/hooks/useMemoryWiring';
import { GlobalDropOverlay, useGlobalFileDrop } from '@/components/common/GlobalDropOverlay';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { saveFile } from '@/utils/saveFile';
import { useEditorStore } from '@/stores/editorStore';
import { useFileBackupStore } from '@/stores/fileBackupStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { createWorkspaceService, type WorkspaceService } from '@/modules/workspace/WorkspaceService';
import { createFSBackend } from '@/modules/workspace/BackendFactory';
import { createWebFSBackend } from '@/modules/workspace/WebFSBackend';
import type { WorkflowTemplate, WorkflowExecution, InterviewQuestion } from '@/types/workflow';
import type { TrashedItem } from '@/modules/history/TrashService';
import type { SourceCard } from '@/types/research';
import type { AuditEntry, AuditScope } from '@/types/audit';
import { AuditService, auditEventToEntry } from '@/modules/audit/AuditService';
import { createWorkflowEngine } from '@/modules/workflow/WorkflowEngine';
import { loadAllTemplates } from '@/modules/workflow/userTemplates';
import { MemoryService } from '@/modules/memory/MemoryService';
import { getActiveScope, getOrCreateSampleMatter, useMatterStore } from '@/stores/matterStore';
import { useMatterUiStore, isWorkingSurface } from '@/stores/matterUiStore';
import { MattersSidebarPanel } from '@/components/matter/MattersSidebarPanel';
import { MatterManagerDialog } from '@/components/matter/MatterManagerDialog';
import { ragVerifyCitation, type RetrievalScope } from '@/utils/tauri-commands';
import {
  createTemplatesMarketplaceService,
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
import { resolveWorkspacePath } from '@/modules/workspace/pathResolve';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isBinaryFile, arrayBufferToDataUrl, getMimeType } from '@/utils/file-utils';
import { writeDroppedFiles } from '@/utils/fileDrop';
import { requestScrollToParagraph } from '@/utils/scrollToParagraph';
import {
  createBlankSpreadsheet,
  spreadsheetBytesToDataUrl,
  dataUrlToArrayBuffer,
} from '@/utils/spreadsheet-io';
import { createBlankDocx, docxBytesToDataUrl } from '@/utils/docx-io';
import { createBlankPptx, pptxBytesToDataUrl } from '@/utils/pptx-io';
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
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { usePromptDialog } from '@/hooks/usePromptDialog';
import { PromptDialog } from '@/components/common/PromptDialog';
import { useUndoToast, UndoToastRenderer } from '@/components/common/UndoToast';

// Module-level constants so the onboarding/tour effects have stable deps
// and never need to be listed in exhaustive-deps disable comments.
const IS_TEST_MODE =
  typeof window !== 'undefined' &&
  window.location.search.includes('testMode=true');
const IS_DEMO_MODE =
  typeof window !== 'undefined' &&
  (window as unknown as { __keepanceDemo?: boolean }).__keepanceDemo === true;

function App() {
  const { t } = useTranslation();

  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(!IS_TEST_MODE && !IS_DEMO_MODE);
  const [demoOpenFailed, setDemoOpenFailed] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // Shared contract — "Ask from the matter hub prefills Search".
  // MatterHub dispatches a keepance:matter-launch event with surface='search'
  // and a question string; App sets this state; ReimaginedAsk consumes it.
  const [askPrefill, setAskPrefill] = useState<{ question: string; autoSubmit?: boolean } | null>(null);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [accountWindowOpen, setAccountWindowOpen] = useState(false);
  // Which Settings category to show on next open. Reset to undefined so a
  // later open without a category falls back to the modal's own default.
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<import('@/settings/schema').SettingCategory | undefined>(undefined);
  // Helper: open Settings, optionally deep-linked to a category.
  const openSettings = useCallback((category?: import('@/settings/schema').SettingCategory) => {
    setSettingsInitialCategory(category);
    setShowSettingsModal(true);
  }, []);
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
  // Direct trigger for the WhatsNew changelog modal from outside the
  // WhatsNewLayer (e.g. the Settings → About → "What's new" action).
  // The local hook in WhatsNewLayer still owns the toast + first-run
  // logic; this flag layers on top of it.
  const [showWhatsNewModalDirect, setShowWhatsNewModalDirect] = useState(false);
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
  // Bug 1: MatterManagerDialog open state — driven by the
  // 'keepance:open-matter-manager' custom event from ReimaginedMattersHome.
  const [matterManagerOpen, setMatterManagerOpen] = useState(false);
  // Active `.workflow` file path for the live execution. Used by the
  // sidebar "Current Execution" link and by debounced write-back so the
  // file on disk stays in sync with the running engine.
  const [activeWorkflowFilePath, setActiveWorkflowFilePath] = useState<string | null>(null);
  // F-106/F-107 — when set, the last workflow run was blocked before starting
  // because no usable AI provider was available. Cleared on the next successful run.
  const [workflowProviderError, setWorkflowProviderError] = useState<'needs-provider' | 'ollama-unreachable' | null>(null);

  // Sidebar state
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'files' | 'matters' | 'search' | 'email' | 'workflows' | 'ai-assistant' | 'research' | 'audit' | 'settings' | 'trash'>('files');
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

  // Shell-aware API key wizard — opened from reimagined shell CTAs.
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState<boolean>(false);

  // UX-04 onboarding: one-shot "open Keys sub-tab" instruction passed to
  // AIAssistantPane. Set when the onboarding card's CTA fires, cleared by
  // the pane via onRequestedTabApplied.
  const [aiAssistantRequestedTab, setAiAssistantRequestedTab] = useState<
    'chats' | 'keys' | 'settings' | undefined
  >(undefined);

  const handleRequestApiKeySetup = useCallback(() => {
    if (isReimaginedShell()) {
      setApiKeyWizardOpen(true);
    } else {
      setSidebarActiveTab('ai-assistant');
      setAiAssistantRequestedTab('keys');
    }
  }, []);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // UX-25: Theme state — 3 values: 'light' | 'dark' | 'system'.
  // 'system' follows the OS prefers-color-scheme media query.
  // Now reads from settingsStore as the canonical source. The local
  // `theme` / `setTheme` pair wraps the store so existing callers
  // keep working without refactoring every `setTheme` call.
  const settingsTheme = useSettingsStore((s) => s.getSetting<string>('theme')) as 'light' | 'dark' | 'system';
  const theme = (settingsTheme === 'light' || settingsTheme === 'dark' || settingsTheme === 'system')
    ? settingsTheme
    : 'system';
  const setTheme = useCallback((valueOrFn: 'light' | 'dark' | 'system' | ((prev: 'light' | 'dark' | 'system') => 'light' | 'dark' | 'system')) => {
    const next = typeof valueOrFn === 'function' ? valueOrFn(theme) : valueOrFn;
    useSettingsStore.getState().setSetting('theme', next);
  }, [theme]);

  // Effective theme derived from `theme` + prefers-color-scheme. We listen
  // to the media query so that a user in 'system' mode gets instant sync
  // when they change their OS setting mid-session.
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    // Safari < 14 uses addListener; modern browsers use addEventListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } else {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  const effectiveTheme: 'light' | 'dark' = theme === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : theme;

  const { rootPath, setRootPath, setFileTree, recentWorkspaces, fileTree, expandedPaths, expandAllFolders, loadRecentWorkspaces } = useWorkspaceStore();
  const { openFile, openTab, markSaved, openTabs, activeTabPath, closeTab, closeTabsByPath, toggleOutline, toggleBacklinks, splitPane, closeSplit, isSplit } = useEditorStore();
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
  const { apiKeys, handleSaveApiKey: rawSaveApiKey, handleDeleteApiKey: rawDeleteApiKey } = useApiKeys();

  // Model list auto-fetching
  const validKeyEntries = useMemo(
    () => apiKeys.filter(k => k.isValid).map(k => ({ provider: k.provider, key: k.key })),
    [apiKeys]
  );
  const { models: modelLists, refreshProvider, clearProvider } = useModelList(validKeyEntries);

  // Wrap API key handlers to also update model lists
  const handleSaveApiKey = useCallback(
    (provider: 'anthropic' | 'openai' | 'google', key: string) => {
      rawSaveApiKey(provider, key);
      refreshProvider(provider, key);
    },
    [rawSaveApiKey, refreshProvider]
  );

  const handleDeleteApiKey = useCallback(
    (provider: 'anthropic' | 'openai' | 'google') => {
      rawDeleteApiKey(provider);
      clearProvider(provider);
    },
    [rawDeleteApiKey, clearProvider]
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

  // UX-25: Theme — apply effective theme (light/dark) as class and persist
  // the user's *preference* (which may be 'system'). The effective theme
  // can be different from the preference if the user is in 'system' mode.
  useEffect(() => {
    const htmlElement = document.documentElement;
    if (effectiveTheme === 'dark') {
      htmlElement.classList.add('dark');
    } else {
      htmlElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme, effectiveTheme]);

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
    sourceCards,
    setSourceCards,
    loadSourceCards,
    handleOpenSourceFile,
    handleCreateSourceCard,
    handleUpdateSourceCard,
    handleDeleteSourceCard,
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
    chatFiles,
    setChatFiles,
    loadChatFiles,
    handleCreateNewChat,
    handleOpenChat,
    handleDeleteChat,
  } = useAIChatFiles({ rootPath, workspaceServiceRef, handleFileOpen, handleDelete });

  // Handle workspace selection
  const handleWorkspaceSelected = useCallback(async (service: WorkspaceService) => {
    // Save previous workspace's tab state before switching
    const prevRootPath = useWorkspaceStore.getState().rootPath;
    if (prevRootPath) {
      useEditorStore.getState().saveWorkspaceState(prevRootPath);
    }

    // Clear current tab state
    useEditorStore.getState().clearTabState();

    workspaceServiceRef.current = service;
    setShowWorkspaceSelector(false);

    const newRootPath = service.getRootPath();
    if (newRootPath) {
      setRootPath(newRootPath);
    }

    // Keepance 3.0 — point the encrypted audit store at this workspace and load
    // any persisted "defense file" entries. On desktop this opens the SQLCipher
    // store under `<workspace>/.keepance/audit-enc.db`; in the browser it is a
    // no-op (localStorage already loaded). Seed the live view newest-first to
    // match the AuditLog's prepend ordering. Best-effort: never block workspace
    // selection on the audit store.
    if (newRootPath) {
      try {
        await auditServiceRef.current.hydrate(newRootPath);
        const loaded = auditServiceRef.current
          .getAll()
          .slice()
          .reverse(); // store is oldest-first; UI shows newest-first
        setAuditEntries(loaded);
      } catch (err) {
        console.warn('[App] Audit store hydrate failed:', err);
      }
    }

    // Stream C1 — Construct the templates marketplace service for this
    // workspace. Each workspace gets its own install root so installed
    // templates don't leak across projects. Skipped when no backend (e.g.
    // test mode shims that bypass createFSBackend).
    const backend = service.getBackend();
    const tplStore = useTemplatesMarketplaceStore.getState();
    if (backend && newRootPath) {
      try {
        const tplService = createTemplatesMarketplaceService(backend, newRootPath);
        const reader = new TemplateMetadataReader({ fs: backend });
        templatesMarketplaceServiceRef.current = tplService;
        templatesMetadataReaderRef.current = reader;
        // Seed the store so MarketplaceTab + offline banner can read the
        // service via useTemplatesMarketplace() instead of prop drilling.
        tplStore.setMarketplace(tplService, reader);
      } catch (err) {
        console.warn('[App] Failed to construct TemplatesMarketplaceService:', err);
        templatesMarketplaceServiceRef.current = null;
        templatesMetadataReaderRef.current = null;
        tplStore.clearMarketplace();
      }
    } else {
      templatesMarketplaceServiceRef.current = null;
      templatesMetadataReaderRef.current = null;
      tplStore.clearMarketplace();
    }

    let isNewWorkspace = false;

    // Create default folders if they don't exist
    try {
      // Create docs folder
      const docsPath = `${newRootPath}/docs`;
      const docsExists = await service.exists(docsPath);
      if (!docsExists) {
        await service.mkdir(docsPath);
        console.log('Created docs folder');
        isNewWorkspace = true;
      }

      // Create AI Chats folder
      const aiChatsPath = `${newRootPath}/AI Chats`;
      const aiChatsExists = await service.exists(aiChatsPath);
      if (!aiChatsExists) {
        await service.mkdir(aiChatsPath);
        console.log('Created AI Chats folder');
        isNewWorkspace = true;
      }

      // Create Research folder (skipped in the law-first experience)
      if (!isLawExperience()) {
        const researchPath = `${newRootPath}/Research`;
        const researchExists = await service.exists(researchPath);
        if (!researchExists) {
          await service.mkdir(researchPath);
          console.log('Created Research folder');
          isNewWorkspace = true;
        }
      }

      // Create Audio Recordings folder
      const audioPath = `${newRootPath}/Audio Recordings`;
      const audioExists = await service.exists(audioPath);
      if (!audioExists) {
        await service.mkdir(audioPath);
        console.log('Created Audio Recordings folder');
        isNewWorkspace = true;
      }
    } catch (error) {
      console.error('Failed to create default folders:', error);
    }

    // CRITICAL FIX: Immediately load file tree after creating folders
    // This ensures all folders are visible right away
    try {
      const fileTree = await service.getFileTree();
      const { setFileTree } = useWorkspaceStore.getState();
      setFileTree(fileTree);
      console.log('File tree loaded, folders now visible');
    } catch (error) {
      console.error('Failed to load file tree:', error);
    }

    // Load trash metadata after workspace is selected
    const items = await loadTrashMetadata();
    setTrashItems(items);

    // Update stats
    const totalSize = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
    const oldestItem = items.length > 0
      ? items.reduce((oldest, item) =>
          item.deletedAt < oldest ? item.deletedAt : oldest,
          items[0]!.deletedAt
        )
      : undefined;
    setTrashStats({
      itemCount: items.length,
      totalSize,
      oldestItem,
    });

    // Load sources
    const cards = await loadSourceCards();
    setSourceCards(cards);

    // Load chat files
    const chats = await loadChatFiles();
    setChatFiles(chats);

    // Handle folder expansion: new workspaces expand all, existing load saved state
    if (newRootPath) {
      if (isNewWorkspace) {
        // New workspace - expand all folders by default
        // File tree is now loaded, so we can expand immediately
        const { expandAllFolders } = useWorkspaceStore.getState();
        expandAllFolders();
        console.log('All folders expanded for new workspace');
      } else {
        // Existing workspace - load saved expansion state, but also expand all as default
        const { loadExpandedPaths, expandAllFolders } = useWorkspaceStore.getState();
        const loaded = loadExpandedPaths(newRootPath);
        // If no saved state exists, expand all folders
        if (!loaded || useWorkspaceStore.getState().expandedPaths.size === 0) {
          expandAllFolders();
          console.log('No saved expansion state, expanding all folders');
        }
      }

      // Restore saved tab state for this workspace
      try {
        await useEditorStore.getState().restoreWorkspaceState(
          newRootPath,
          (path: string) => service.readFile(path),
          (path: string) => service.readFileBinary(path)
        );
        console.log('Restored workspace tab state');
      } catch (error) {
        console.error('Failed to restore workspace tab state:', error);
      }
    }
  }, [loadTrashMetadata, loadSourceCards, loadChatFiles]);


  // Handle opening a recent project directly by path (Tauri only)
  const handleOpenRecentProject = useCallback(async (workspacePath: string) => {
    try {
      const backend = await createFSBackend(workspacePath);
      const service = createWorkspaceService();
      await service.initialize(backend, workspacePath);
      await handleWorkspaceSelected(service);
    } catch (err) {
      console.error('[App] Failed to open recent project:', err);
    }
  }, [handleWorkspaceSelected]);

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

  // Handle revealing a folder in the Files tab
  const handleRevealInFolder = useCallback((_path: string) => {
    // Switch to Files tab, landing on the file browser (we're revealing a folder,
    // not opening a document).
    setDocumentsView('browser');
    setSidebarActiveTab('files');

    // The folder expansion and selection is already handled by SearchPanel
    // Just need to ensure the tab switch happens
  }, []);

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

  // Bug 1 fix: listen for the 'keepance:open-matter-manager' custom event
  // dispatched by the "New matter" buttons in ReimaginedMattersHome and open
  // MatterManagerDialog (the canonical folder-picking + creation dialog).
  useEffect(() => {
    const handler = () => { setMatterManagerOpen(true); };
    window.addEventListener('keepance:open-matter-manager', handler);
    return () => { window.removeEventListener('keepance:open-matter-manager', handler); };
  }, []);

  // F5: listen for 'keepance:open-settings' dispatched by GetStartedCard in
  // ReimaginedMattersHome. Opens Settings deep-linked to the given category.
  // Account-related categories now live in the Account window, so redirect there.
  useEffect(() => {
    const ACCOUNT_CATEGORIES = new Set(['account', 'license', 'firm', 'costs', 'integrations']);
    const handler = (e: Event) => {
      const category = (e as CustomEvent<{ category?: import('@/settings/schema').SettingCategory }>)
        .detail?.category;
      if (category && ACCOUNT_CATEGORIES.has(category)) {
        setAccountWindowOpen(true);
        return;
      }
      openSettings(category);
    };
    window.addEventListener('keepance:open-settings', handler);
    return () => { window.removeEventListener('keepance:open-settings', handler); };
  }, [openSettings]);

  // Open the Account window when the rail's account identity is clicked.
  useEffect(() => {
    const handler = () => { setAccountWindowOpen(true); };
    window.addEventListener('keepance:open-account', handler);
    return () => { window.removeEventListener('keepance:open-account', handler); };
  }, []);

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

  // Wave F — listen for 'keepance:matter-launch'. Quick-action buttons pass an
  // explicit surface (search = Ask, files = Documents, email) and jump there.
  // Selecting a matter to RETURN to it (e.g. the navy rail) passes no surface,
  // so we restore that matter's remembered working surface + focused document.
  useEffect(() => {
    const ALLOWED_SURFACES = new Set(['search', 'files', 'email', 'workflows', 'audit'] as const);
    type AllowedSurface = 'search' | 'files' | 'email' | 'workflows' | 'audit';
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ matterId?: string; surface?: string; question?: string } | null>).detail;
      if (!detail?.matterId) return;
      const matterId = detail.matterId;
      const hasExplicitSurface = ALLOWED_SURFACES.has(detail.surface as AllowedSurface);
      useMatterStore.getState().setActiveMatter(matterId);

      if (hasExplicitSurface) {
        const surface = detail.surface as AllowedSurface;
        // Launching a matter into Documents lands on its file browser, not an editor.
        if (surface === 'files') setDocumentsView('browser');
        setSidebarActiveTab(surface);
        // Prefill ReimaginedAsk when the caller includes a question and the
        // destination surface is Search (Ask).
        if (surface === 'search' && detail.question) {
          setAskPrefill({ question: detail.question, autoSubmit: true });
        }
        return;
      }

      // No explicit surface: restore the matter's remembered view (its last
      // working surface + the document it had focused), or its hub on first visit.
      const snap = useMatterUiStore.getState().getSnapshot(matterId);
      if (!snap) {
        setSidebarActiveTab('matters');
        return;
      }
      if (snap.surface === 'files' && snap.activeTabPath) {
        const tabs = useEditorStore.getState().openTabs;
        if (tabs.some((t) => t.path === snap.activeTabPath)) {
          useEditorStore.getState().setActiveTab(snap.activeTabPath);
          setDocumentsView('editor');
        } else {
          setDocumentsView('browser');
        }
      } else if (snap.surface === 'files') {
        setDocumentsView('browser');
      }
      setSidebarActiveTab(snap.surface);
    };
    window.addEventListener('keepance:matter-launch', handler);
    return () => { window.removeEventListener('keepance:matter-launch', handler); };
  }, []);

  // UX-35: shared writer that routes binary file extensions (.docx, .xlsx,
  // .pptx, .rtf, etc.) through writeFileBinary using the bytes decoded
  // from the editor's data-URL content. The Save path (handleSaveFile)
  // and the autosave interval both call into this so the two can't drift.
  //
  // Why this matters: DocxEditor (and the other binary-format editors)
  // pushes tab content as a `data:...base64,...` string. The previous
  // writeFile(path, content) path stored that string literally as UTF-8
  // text on disk, which destroyed the actual .docx/.xlsx bytes —
  // re-opening the file produced JSZip's "can't find end of central
  // directory" error because the on-disk bytes were a base64 text blob
  // instead of a zip archive.
  const writeTabContent = useCallback(
    async (path: string, content: string): Promise<void> => {
      const service = workspaceServiceRef.current;
      if (!service) return;
      if (isBinaryFile(path) && content.startsWith('data:')) {
        // Strip the data-URL prefix and decode bytes back to an ArrayBuffer
        // so the on-disk file is the actual binary format, not the text
        // encoding of it.
        const buffer = dataUrlToArrayBuffer(content);
        await service.writeFileBinary(path, buffer);
      } else {
        await service.writeFile(path, content);
      }
    },
    []
  );

  // Handle file save
  const handleSaveFile = useCallback(
    async (path: string, content: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        await writeTabContent(path, content);
        markSaved(path);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // UX-26: keep the content index current so the next search sees
        // the just-saved text. Binary writes skip this path — the index
        // builder re-extracts via extractForAI anyway on a full rebuild.
        if (!isBinaryFile(path)) {
          const name = path.split('/').pop() ?? path;
          contentIndex.upsert({ id: path, path, name, content });
        }
      } catch (error) {
        console.error('Failed to save file:', error);
      }
    },
    [markSaved, setFileTree, contentIndex, writeTabContent]
  );

  // Handle create new file
  const handleCreateFile = useCallback(
    async (parentPath: string) => {
      const name = await prompt('Enter file name:', '', {
        title: 'Create File',
        placeholder: 'myfile.txt',
        // UX-15: show the user which folder they're creating into. For
        // subfolder-right-click-create this is the most useful info.
        destinationPath: `${parentPath}/`,
      });
      if (!name || !workspaceServiceRef.current) return;

      const filePath = `${parentPath}/${name}`;
      try {
        await workspaceServiceRef.current.writeFile(filePath, '');
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
        await handleFileOpen(filePath, name);
      } catch (error) {
        console.error('Failed to create file:', error);
        window.alert("I couldn't create that. Try a different name.");
      }
    },
    [setFileTree, handleFileOpen, prompt]
  );

  // Handle create new folder
  const handleCreateFolder = useCallback(
    async (parentPath: string) => {
      const name = await prompt('Enter folder name:', '', {
        title: 'Create Folder',
        placeholder: 'my-folder',
        // UX-15: also show destination for folder creation.
        destinationPath: `${parentPath}/`,
      });
      if (!name || !workspaceServiceRef.current) return;

      const folderPath = `${parentPath}/${name}`;
      try {
        await workspaceServiceRef.current.mkdir(folderPath);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Auto-expand the newly created folder
        const { expandedPaths, setExpandedPaths } = useWorkspaceStore.getState();
        const newExpanded = new Set(expandedPaths);
        newExpanded.add(folderPath);
        setExpandedPaths(newExpanded);
      } catch (error) {
        console.error('Failed to create folder:', error);
        window.alert("I couldn't create that. Try a different name.");
      }
    },
    [setFileTree, prompt]
  );

  // Handle rename (prompts user)
  const handleRename = useCallback(
    async (path: string) => {
      const currentName = path.split('/').pop() ?? '';
      const newName = await prompt('Enter new name:', currentName, {
        title: 'Rename',
      });
      if (!newName || newName === currentName || !workspaceServiceRef.current) return;

      try {
        await workspaceServiceRef.current.rename(path, newName);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // UX-16: record the rename so Ctrl+Z can revert it within the
        // session. We store the full old/new absolute paths so undo can
        // call `rename(newPath, oldName)` without re-deriving anything.
        const parent = path.substring(0, path.lastIndexOf('/'));
        const newPath = `${parent}/${newName}`;
        renameHistoryRef.current.push({ fromPath: path, toPath: newPath });
        // UX-29: track the kind of action so Ctrl+Z can undo the most
        // recent destructive change (either rename OR delete), not just
        // the most recent rename.
        undoStackRef.current.push('rename');
      } catch (error) {
        console.error('Failed to rename:', error);
        window.alert("I couldn't rename that file. Make sure it isn't open in another app, then try again.");
      }
    },
    [setFileTree, prompt]
  );

  // Handle rename with provided name (for tab double-click)
  const handleRenameWithName = useCallback(
    async (path: string, newName: string) => {
      if (!workspaceServiceRef.current) return;
      const currentName = path.split('/').pop() ?? '';
      if (newName === currentName) return;

      try {
        await workspaceServiceRef.current.rename(path, newName);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Update the tab name in the editor store
        const oldPath = path;
        const newPath = path.substring(0, path.lastIndexOf('/') + 1) + newName;

        // Close old tab and open new one with same content if it was open.
        // Preserve the tab's group membership across the close/reopen so
        // renaming from the Tab Group Manager modal (or the dropdown) does
        // not drop the tab out of its group.
        const tab = openTabs.find(t => t.path === oldPath);
        if (tab) {
          const preservedGroupId = tab.groupId;
          closeTab(oldPath);
          await handleFileOpen(newPath, newName);
          if (preservedGroupId) {
            useEditorStore.getState().moveTabToGroup(newPath, preservedGroupId);
          }
        }

        // UX-16: track the rename for session-level Ctrl+Z undo.
        renameHistoryRef.current.push({ fromPath: oldPath, toPath: newPath });
        // UX-29: push onto the combined undo stack so Ctrl+Z knows which
        // stack to pop.
        undoStackRef.current.push('rename');
      } catch (error) {
        console.error('Failed to rename:', error);
        window.alert("I couldn't rename that file. Make sure it isn't open in another app, then try again.");
      }
    },
    [setFileTree, openTabs, closeTab, handleFileOpen]
  );


  // Handle download file
  const handleDownload = useCallback(
    async (path: string, name: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        const content = await workspaceServiceRef.current.readFile(path);

        // Use cross-platform saveFile utility (works in both browser and Tauri)
        await saveFile(content, {
          suggestedName: name,
          types: [
            {
              description: 'Text Files',
              accept: {
                'text/plain': ['.txt', '.md', '.markdown', '.json'],
              },
            },
          ],
        });
      } catch (error) {
        // User cancelled or error occurred
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to download file:', error);
        }
      }
    },
    []
  );


  // Handle move (drag and drop)
  // Refresh file tree (for AI file changes)
  const refreshFileTree = useCallback(async () => {
    if (!workspaceServiceRef.current) return;
    try {
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);

      // Update watcher snapshot to prevent false positives
      if (fileSystemWatcherRef.current) {
        await fileSystemWatcherRef.current.updateSnapshot(async () => {
          return createFileTreeSnapshot(fileTree);
        });
      }
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    }
  }, [setFileTree]);

  const handleMove = useCallback(
    async (sourcePath: string, targetPath: string) => {
      if (!workspaceServiceRef.current) return;

      try {
        const sourceName = sourcePath.split('/').pop() ?? '';
        const newPath = `${targetPath}/${sourceName}`;
        await workspaceServiceRef.current.move(sourcePath, newPath);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Failed to move:', error);
        window.alert("I couldn't move that. Try again.");
      }
    },
    [setFileTree]
  );



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

  // Handle create file at root
  const handleCreateFileAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name:', '', {
      title: 'Create File',
      placeholder: 'myfile.txt',
    });
    if (!name) return;

    const filePath = `${rootPath}/${name}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, name);
    } catch (error) {
      console.error('Failed to create file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create markdown file in a target folder (defaults to docs folder).
  // R6-1: `parentPath` lets the Documents grid create the file in the folder
  // the user currently has open; when omitted it falls back to `<root>/docs`.
  const handleCreateMarkdownAtRoot = useCallback(async (parentPath?: string) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const destDir = parentPath ?? `${rootPath}/docs`;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Markdown File',
      placeholder: 'my-document',
      destinationPath: `${destDir}/`,
      previewExtension: '.md',
    });
    if (!name) return;

    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const filePath = `${destDir}/${fileName}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '# ' + name.replace(/\.md$/, '') + '\n\n');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create markdown file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create plain text file in a target folder (defaults to docs folder).
  const handleCreateTextFileAtRoot = useCallback(async (parentPath?: string) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const destDir = parentPath ?? `${rootPath}/docs`;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Text File',
      placeholder: 'my-notes',
      destinationPath: `${destDir}/`,
      previewExtension: '.txt',
    });
    if (!name) return;

    const fileName = name.endsWith('.txt') ? name : `${name}.txt`;
    const filePath = `${destDir}/${fileName}`;
    try {
      await workspaceServiceRef.current.writeFile(filePath, '');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create text file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create rich text file in a target folder (defaults to docs folder).
  const handleCreateRichTextFileAtRoot = useCallback(async (parentPath?: string) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const destDir = parentPath ?? `${rootPath}/docs`;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Rich Text File',
      placeholder: 'my-document',
      destinationPath: `${destDir}/`,
      previewExtension: '.rt',
    });
    if (!name) return;

    const fileName = name.endsWith('.rt') || name.endsWith('.rtf') ? name : `${name}.rt`;
    const filePath = `${destDir}/${fileName}`;
    try {
      // Default to an empty paragraph so Tiptap has a valid starting state
      await workspaceServiceRef.current.writeFile(filePath, '<p></p>');
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, fileName);
    } catch (error) {
      console.error('Failed to create rich text file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create blank spreadsheet file at root (goes to docs folder)
  const handleCreateSpreadsheetAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Spreadsheet',
      placeholder: 'my-sheet',
      destinationPath: `${rootPath}/docs/`,
      previewExtension: '.xlsx',
    });
    if (!name) return;

    const fileName = name.endsWith('.xlsx') ? name : `${name}.xlsx`;
    const filePath = `${rootPath}/docs/${fileName}`;
    try {
      const bytes = createBlankSpreadsheet('xlsx');
      // ArrayBuffer copy so callers don't hold onto the typed array view.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      // Open tab with the data URL (matches the shape MainPanel expects for
      // binary document types).
      const dataUrl = spreadsheetBytesToDataUrl(bytes, 'xlsx');
      openFile(filePath, fileName, dataUrl);
    } catch (error) {
      console.error('Failed to create spreadsheet:', error);
    }
  }, [rootPath, setFileTree, openFile, prompt]);

  // Handle create blank CSV file at root (goes to docs folder)
  const handleCreateCsvAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create CSV File',
      placeholder: 'my-data',
      destinationPath: `${rootPath}/docs/`,
      previewExtension: '.csv',
    });
    if (!name) return;

    const fileName = name.endsWith('.csv') ? name : `${name}.csv`;
    const filePath = `${rootPath}/docs/${fileName}`;
    try {
      const bytes = createBlankSpreadsheet('csv');
      // CSV is text but we use the binary write path so both tabs and disk
      // see exactly the same bytes.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      const dataUrl = spreadsheetBytesToDataUrl(bytes, 'csv');
      openFile(filePath, fileName, dataUrl);
    } catch (error) {
      console.error('Failed to create CSV file:', error);
    }
  }, [rootPath, setFileTree, openFile, prompt]);

  // VG-4c — pick a Word file as the firm letterhead template. Stores its path
  // in the `letterheadTemplatePath` setting; new documents and workflow
  // deliverables then start from it. Confirms via the standard dialog.
  const handleSetLetterheadTemplate = useCallback(
    (path: string) => {
      useSettingsStore.getState().setSetting('letterheadTemplatePath', path);
      const name = path.split('/').pop() ?? path;
      void confirm(
        `New documents and workflow deliverables will now start from "${name}". You can change or clear this in Settings under Files & Workspace.`,
        {
          title: 'Letterhead template set',
          confirmLabel: 'Got it',
          cancelLabel: 'Close',
        },
      );
    },
    [confirm],
  );

  // Handle create blank .docx file at root (goes to docs folder)
  const handleCreateDocxAtRoot = useCallback(async (parentPath?: string) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    // R6-1: create in the folder the user has open when provided; otherwise
    // fall back to the canonical `<root>/docs` folder.
    const destDir = parentPath ?? `${rootPath}/docs`;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create Word Document',
      placeholder: 'my-document',
      destinationPath: `${destDir}/`,
      previewExtension: '.docx',
    });
    if (!name) return;

    const fileName = name.endsWith('.docx') ? name : `${name}.docx`;
    const filePath = `${destDir}/${fileName}`;
    try {
      // VG-4c — a new document is a straight byte copy of the letterhead
      // template when one is configured and readable (headers/footers/styles/
      // body all come along, trivially correct). On any read failure, fall
      // back to a blank document so creation never blocks.
      const templatePath = useSettingsStore
        .getState()
        .getSetting<string>('letterheadTemplatePath');
      let bytes: Uint8Array | null = null;
      if (templatePath && templatePath.trim()) {
        try {
          const templateBuf = await workspaceServiceRef.current.readFileBinary(templatePath);
          bytes = new Uint8Array(templateBuf);
        } catch (readError) {
          console.warn(
            'Could not read the letterhead template; creating a blank document instead.',
            readError,
          );
          bytes = null;
        }
      }
      if (!bytes) {
        bytes = await createBlankDocx();
      }
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      const dataUrl = docxBytesToDataUrl(bytes);
      openFile(filePath, fileName, dataUrl);
    } catch (error) {
      console.error('Failed to create Word document:', error);
    }
  }, [rootPath, setFileTree, openFile, prompt]);

  // Keepance 3.0 (WS-A / A5): the "New Document" primary action. Word (.docx)
  // is the canonical document format, so unless the user has changed the
  // "Default New Document Type" setting, a new document is a real `.docx`
  // opened in the Word editor. Markdown / plain text / rich text remain
  // available for quick notes via the same setting and the File menu.
  const handleCreateDefaultDocument = useCallback(async (parentPath?: string) => {
    const kind = useSettingsStore
      .getState()
      .getSetting<string>('defaultNewFileType');
    switch (kind) {
      case 'markdown':
        await handleCreateMarkdownAtRoot(parentPath);
        break;
      case 'plaintext':
        await handleCreateTextFileAtRoot(parentPath);
        break;
      case 'richtext':
        await handleCreateRichTextFileAtRoot(parentPath);
        break;
      case 'docx':
      default:
        // Canonical default.
        await handleCreateDocxAtRoot(parentPath);
        break;
    }
  }, [
    handleCreateMarkdownAtRoot,
    handleCreateTextFileAtRoot,
    handleCreateRichTextFileAtRoot,
    handleCreateDocxAtRoot,
  ]);

  // Handle create blank .pptx file at root (goes to docs folder)
  const handleCreatePptxAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter file name (without extension):', '', {
      title: 'Create PowerPoint Presentation',
      placeholder: 'my-deck',
      destinationPath: `${rootPath}/docs/`,
      previewExtension: '.pptx',
    });
    if (!name) return;

    const fileName = name.endsWith('.pptx') ? name : `${name}.pptx`;
    const filePath = `${rootPath}/docs/${fileName}`;
    try {
      const bytes = await createBlankPptx();
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      const dataUrl = pptxBytesToDataUrl(bytes);
      openFile(filePath, fileName, dataUrl);
    } catch (error) {
      console.error('Failed to create PowerPoint presentation:', error);
    }
  }, [rootPath, setFileTree, openFile, prompt]);

  // Handle create source file in Research folder
  const handleCreateSourceFileAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const title = await prompt('Enter source title:', '', {
      title: 'Create Source File',
      placeholder: 'Source Title',
    });
    if (!title) return;

    // Create filename from exact title + .source extension
    const filename = `${title}.source`;
    const filePath = `${rootPath}/Research/${filename}`;

    // Create initial source structure
    const newSourceCard: SourceCard = {
      id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      url: '',
      title: title,
      date_accessed: new Date().toISOString().split('T')[0]!,
      quote_or_snippet: '',
      claim_supported: '',
      reliability_notes: '',
    };

    try {
      // Ensure Research folder exists
      const researchPath = `${rootPath}/Research`;
      const researchExists = await workspaceServiceRef.current.exists(researchPath);
      if (!researchExists) {
        await workspaceServiceRef.current.mkdir(researchPath);
      }

      // Create the source file
      await workspaceServiceRef.current.writeFile(filePath, JSON.stringify(newSourceCard, null, 2));
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);
      await handleFileOpen(filePath, filename);

      // Add to sources state
      setSourceCards(prev => [...prev, newSourceCard]);
    } catch (error) {
      console.error('Failed to create source file:', error);
    }
  }, [rootPath, setFileTree, handleFileOpen, prompt]);

  // Handle create folder at root
  const handleCreateFolderAtRoot = useCallback(async () => {
    if (!workspaceServiceRef.current || !rootPath) return;
    const name = await prompt('Enter folder name:', '', {
      title: 'Create Folder',
      placeholder: 'my-folder',
    });
    if (!name) return;

    const folderPath = `${rootPath}/${name}`;
    try {
      await workspaceServiceRef.current.mkdir(folderPath);
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);

      // Auto-expand the newly created folder
      const { expandedPaths, setExpandedPaths } = useWorkspaceStore.getState();
      const newExpanded = new Set(expandedPaths);
      newExpanded.add(folderPath);
      setExpandedPaths(newExpanded);
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  }, [rootPath, setFileTree, prompt]);

  // Handle open grid view
  const handleOpenGridView = useCallback(() => {
    // Open a special "Files" tab with grid view
    openFile('__grid_view__', 'Files', '');
  }, [openFile]);

  // Handle create audio file
  const handleCreateAudioAtRoot = useCallback(() => {
    setShowAudioRecorder(true);
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

  // Handle file upload
  const handleUploadFiles = useCallback(
    async (files: FileList, targetFolder?: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Use targetFolder if provided, otherwise upload to root.
      // Always resolve to an absolute path: when targetFolder is a
      // workspace-relative folder (e.g. "docs"), the constructed filePath would
      // be relative ("docs/file.docx").  Native Tauri commands (docx_open, etc.)
      // receive paths via invoke() and call std::fs::read(path) directly —
      // a relative path resolves against the Rust process CWD, not the
      // workspace root, causing "os error 3" on Windows.
      const uploadPath = resolveWorkspacePath(rootPath, targetFolder || rootPath);

      for (const file of Array.from(files)) {
        const filePath = `${uploadPath}/${file.name}`;
        try {
          if (isBinaryFile(file.name)) {
            // Read as array buffer and write as binary
            const buffer = await file.arrayBuffer();
            await workspaceServiceRef.current.writeFileBinary(filePath, buffer);
          } else {
            // Read as text and write as string
            const content = await file.text();
            await workspaceServiceRef.current.writeFile(filePath, content);
          }
        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error);
        }
      }

      // Refresh file tree after uploads
      const fileTree = await workspaceServiceRef.current.getFileTree();
      setFileTree(fileTree);

      // UX-33: open the last uploaded file so the user sees it immediately.
      // Pass the absolute path so native commands (docx_open, etc.) can read it.
      const uploaded = Array.from(files);
      if (uploaded.length > 0) {
        const last = uploaded[uploaded.length - 1]!;
        const lastPath = `${uploadPath}/${last.name}`;
        await handleFileOpen(lastPath, last.name);
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

  // UX-28: handle a drag-and-drop of an AI chat message from AIChatViewer
  // onto the file tree. Folder drops create a new .md file; file drops
  // append the content to the existing file with a `---` separator so
  // markdown readers still render both halves. Opens the resulting file
  // in a tab either way.
  const handleDropAIMessage = useCallback(
    async (opts: { content: string; targetFolder: string; existingFilePath?: string }) => {
      const service = workspaceServiceRef.current;
      if (!service) return;
      try {
        if (opts.existingFilePath) {
          // Append. Read the current text (best-effort — fall back to
          // empty if the read fails, e.g. binary file) and tack on a
          // separator + the new content.
          let existing = '';
          try {
            existing = await service.readFile(opts.existingFilePath);
          } catch {
            existing = '';
          }
          const trimmedExisting = existing.replace(/\s+$/, '');
          const appended = trimmedExisting
            ? `${trimmedExisting}\n\n---\n\n${opts.content}\n`
            : `${opts.content}\n`;
          await service.writeFile(opts.existingFilePath, appended);
          const tree = await service.getFileTree();
          setFileTree(tree);
          await handleFileOpen(
            opts.existingFilePath,
            opts.existingFilePath.split('/').pop() ?? 'file'
          );
          return;
        }

        // New-file path: derive a filename from the message, resolve
        // against existing entries in the target folder to avoid collision.
        const { deriveFilenameFromMessage, resolveUniqueName } = await import(
          '@/utils/fileDrop'
        );
        const desired = deriveFilenameFromMessage(opts.content);
        const finalName = await resolveUniqueName(
          service,
          opts.targetFolder,
          desired
        );
        const path = `${opts.targetFolder}/${finalName}`;
        await service.writeFile(path, `${opts.content}\n`);
        const tree = await service.getFileTree();
        setFileTree(tree);
        await handleFileOpen(path, finalName);
      } catch (err) {
        console.error('[App] AI message drop failed:', err);
      }
    },
    [setFileTree, handleFileOpen]
  );

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


  // Autosave dirty tabs every 2 seconds. UX-35: routes through
  // writeTabContent so binary formats (.docx/.xlsx/.pptx/.rtf) decode
  // their data-URL content back to bytes before hitting disk — otherwise
  // re-opening the file gave "can't find end of central directory".
  useEffect(() => {
    const autosaveInterval = setInterval(async () => {
      if (!workspaceServiceRef.current) return;

      for (const tab of openTabs) {
        if (tab.isDirty) {
          try {
            await writeTabContent(tab.path, tab.content);
            markSaved(tab.path);
          } catch (error) {
            console.error('Autosave failed for:', tab.path, error);
          }
        }
      }
    }, 2000);

    return () => clearInterval(autosaveInterval);
  }, [openTabs, markSaved, writeTabContent]);


  // Build command palette commands
  const commands = useMemo<PaletteCommand[]>(() => {
    const baseCommands = getDefaultCommands({});
    const appCommands: PaletteCommand[] = [
      {
        // WS-A / A5: canonical "New Document" — creates the user's default new
        // document type (Word .docx unless changed in Settings).
        id: 'file.new-document',
        label: 'New Document',
        shortcut: 'Ctrl+N',
        category: 'file',
        action: () => {
          void handleCreateDefaultDocument();
        },
      },
      {
        id: 'file.save',
        label: 'Save File',
        shortcut: 'Ctrl+S',
        category: 'file',
        action: async () => {
          const activeTab = openTabs.find((t) => t.path === activeTabPath);
          if (activeTab && activeTab.isDirty) {
            await handleSaveFile(activeTab.path, activeTab.content);
          }
        },
      },
      {
        id: 'file.close',
        label: 'Close Tab',
        shortcut: 'Ctrl+W',
        category: 'file',
        action: () => {
          if (activeTabPath) {
            closeTab(activeTabPath);
          }
        },
      },
      {
        id: 'view.outline',
        label: 'Toggle Outline Panel',
        shortcut: 'Ctrl+Shift+O',
        category: 'view',
        action: toggleOutline,
      },
      {
        id: 'view.backlinks',
        label: 'Toggle Backlinks Panel',
        shortcut: 'Ctrl+Shift+B',
        category: 'view',
        action: toggleBacklinks,
      },
      {
        // F-509 — discoverable home for the now-functional Ctrl+B toggle.
        id: 'view.sidebar',
        label: 'Toggle Sidebar',
        shortcut: 'Ctrl+B',
        category: 'view',
        action: () => setSidebarCollapsed((v) => !v),
      },
      {
        id: 'view.tabOverflow',
        label: 'Toggle Tab Overflow (Scroll / Wrap)',
        category: 'view',
        action: () => {
          const current = useSettingsStore.getState().getSetting<string>('tabOverflow');
          useSettingsStore.getState().setSetting('tabOverflow', current === 'scroll' ? 'wrap' : 'scroll');
        },
      },
      {
        id: 'view.split',
        label: isSplit ? 'Close Split' : 'Split Editor',
        shortcut: 'Ctrl+\\',
        category: 'view',
        action: () => {
          if (isSplit) {
            closeSplit();
          } else {
            splitPane('horizontal');
          }
        },
      },
      {
        id: 'workspace.change',
        label: 'Change Workspace',
        category: 'workspace',
        action: () => setShowWorkspaceSelector(true),
      },
      {
        id: 'view.aiAssistant',
        label: 'Open AI Assistant',
        shortcut: 'Ctrl+Shift+A',
        category: 'view',
        action: () => setSidebarActiveTab('ai-assistant'),
      },
      {
        id: 'open-settings',
        label: 'Open Settings',
        shortcut: 'Ctrl+,',
        category: 'general',
        // Fix 5: no-op when Settings tab is already the active surface.
        action: () => { if (sidebarActiveTab !== 'settings') setShowSettingsModal(true); },
      },
      {
        id: 'browser.open',
        label: 'Open Browser Tab',
        category: 'view',
        action: async () => {
          const url = await prompt('Enter URL:', '', {
            title: 'Open Browser Tab',
            placeholder: 'https://example.com',
          });
          if (url) {
            handleOpenBrowserTab(url);
          }
        },
      },
    ];
    return [...appCommands, ...baseCommands];
  }, [openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, toggleBacklinks, isSplit, splitPane, closeSplit, handleOpenBrowserTab, handleCreateDefaultDocument, sidebarActiveTab]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      // Open Settings: Ctrl+,
      // Fix 5: no-op if the Settings tab is already the active surface.
      if (isMod && e.key === ',') {
        e.preventDefault();
        if (sidebarActiveTab !== 'settings') {
          setShowSettingsModal(true);
        }
        return;
      }

      // Command Palette: Ctrl+K or Ctrl+Shift+P
      if ((isMod && e.key === 'k') || (isMod && e.shiftKey && e.key === 'p')) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // UX-27: Quick-open fuzzy file switcher — Ctrl+P / Cmd+P.
      // Must come AFTER the command-palette check so Ctrl+Shift+P keeps
      // routing to the palette.
      if (isMod && !e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setShowQuickOpen(true);
        return;
      }

      // Save: Ctrl+S
      if (isMod && e.key === 's') {
        e.preventDefault();
        const activeTab = openTabs.find((t) => t.path === activeTabPath);
        if (activeTab && activeTab.isDirty) {
          await handleSaveFile(activeTab.path, activeTab.content);
        }
        return;
      }

      // Close tab: Ctrl+W
      if (isMod && e.key === 'w') {
        e.preventDefault();
        if (activeTabPath) {
          closeTab(activeTabPath);
        }
        return;
      }

      // Toggle outline: Ctrl+Shift+O
      if (isMod && e.shiftKey && e.key === 'o') {
        e.preventDefault();
        toggleOutline();
        return;
      }

      // F-509 — Ctrl+B toggles the sidebar. Documented in the shortcuts SSOT
      // (useKeyboardShortcuts.ts 'toggle-sidebar') but implemented nowhere
      // until now. Must come BEFORE the Ctrl+Shift+B branch.
      if (isMod && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
        return;
      }

      // Toggle backlinks: Ctrl+Shift+B
      if (isMod && e.shiftKey && e.key === 'b') {
        e.preventDefault();
        toggleBacklinks();
        return;
      }

      // Split/unsplit: Ctrl+\
      if (isMod && e.key === '\\') {
        e.preventDefault();
        if (isSplit) {
          closeSplit();
        } else {
          splitPane('horizontal');
        }
        return;
      }

      // Open AI Assistant: Ctrl+Shift+A
      //
      // UX-21: opens AI Assistant as a MAIN-PANEL tab (the cramped sidebar
      // was never where chat wanted to live). If a main-panel AI tab is
      // already open we just focus it; otherwise we create a fresh one.
      // The legacy sidebar button still flips the sidebar to the AI pane,
      // so power users who liked the sidebar layout keep their workflow.
      if (isMod && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        openAIAssistantTab();
        return;
      }

      // Keyboard shortcuts overlay: `?` (literal character, matches any
      // layout — on US keyboards it's Shift+/; using e.key === '?' avoids
      // worrying about layout-specific key codes).
      // Do not trigger when focus is inside an editable element.
      if (e.key === '?' && !isMod && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        e.preventDefault();
        setShowShortcutsOverlay(true);
        return;
      }

      // UX-16 / UX-29: Ctrl+Z outside any input undoes the most recent
      // destructive action in this session — either a rename OR a delete.
      // We explicitly skip when focus is in an editor-like element so
      // normal text-editing undo behaviour is preserved.
      if (isMod && !e.shiftKey && e.key === 'z') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        if (!workspaceServiceRef.current) return;

        // Pop whichever action was most recent. If the top of the stack
        // refers to a delete that's already gone (e.g. user clicked
        // Undo in the toast), fall through to the next entry.
        const kind = undoStackRef.current.pop();
        if (!kind) return;
        e.preventDefault();

        if (kind === 'delete') {
          const trashId = deleteHistoryRef.current.pop();
          if (!trashId) return;
          try {
            await handleRestoreFromTrash(trashId);
          } catch (err) {
            console.error('Failed to undo delete:', err);
            // Push it back so a subsequent Ctrl+Z can retry.
            deleteHistoryRef.current.push(trashId);
            undoStackRef.current.push('delete');
          }
          return;
        }

        // kind === 'rename'
        const last = renameHistoryRef.current.pop();
        if (!last) return;
        try {
          // Recover the original file name from the original path we stored.
          const originalName = last.fromPath.split('/').pop() ?? '';
          await workspaceServiceRef.current.rename(last.toPath, originalName);
          const fileTree = await workspaceServiceRef.current.getFileTree();
          setFileTree(fileTree);
          // If the file was open in a tab, re-open it under the old name.
          const tab = openTabs.find((t) => t.path === last.toPath);
          if (tab) {
            closeTab(last.toPath);
            await handleFileOpen(last.fromPath, originalName);
          }
        } catch (err) {
          console.error('Failed to undo rename:', err);
          // Push it back so a subsequent Ctrl+Z can retry.
          renameHistoryRef.current.push(last);
          undoStackRef.current.push('rename');
        }
        return;
      }

      // New Document: Ctrl+N (advertised in the command palette — wired here)
      // Skip when focus is inside a text input so browser autocomplete works.
      if (isMod && !e.shiftKey && e.key === 'n') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        e.preventDefault();
        void handleCreateDefaultDocument();
        return;
      }

      // Spine tab jump: Ctrl+1..7
      // 1=matters, 2=search, 3=files, 4=email, 5=workflows, 6=audit, 7=settings
      if (isMod && !e.shiftKey && e.key >= '1' && e.key <= '7') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        e.preventDefault();
        const spineTabMap: Record<string, typeof sidebarActiveTab> = {
          '1': 'matters',
          '2': 'search',
          '3': 'files',
          '4': 'email',
          '5': 'workflows',
          '6': 'audit',
          '7': 'settings',
        };
        const nextTab = spineTabMap[e.key];
        if (nextTab) {
          // Mirror the files special-case: landing on files tab shows the browser
          if (nextTab === 'files') setDocumentsView('browser');
          setSidebarActiveTab(nextTab);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, toggleBacklinks, isSplit, splitPane, closeSplit, setFileTree, handleFileOpen, handleRestoreFromTrash, openAIAssistantTab, sidebarActiveTab, handleCreateDefaultDocument, setDocumentsView]);

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
      if (isReimaginedShell()) {
        setApiKeyWizardOpen(true);
      } else {
        setSidebarActiveTab('ai-assistant');
        setAiAssistantRequestedTab('keys');
      }
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

      {/* Reimagined shell: the hero Trust Bar (elevated egress + matter scope). */}
      {isReimaginedShell() && <ReimaginedTrustBar />}

      {/* Main content area */}
      <div id="main-content" className="flex-1 flex overflow-hidden">
        {/* Sidebar with file tree, workflows, research, and settings */}
        <AppShellNav
          activeTab={sidebarActiveTab}
          onTabChange={(tab: string) => {
            // Fix 1: any click to 'files' in the spine nav lands on the Files
            // browser, even if a document was the last thing open. This is the
            // user clicking the nav (vs a file being opened programmatically),
            // so it always means "show me my files".
            if (tab === 'files') {
              setDocumentsView('browser');
            }
            setSidebarActiveTab(tab as typeof sidebarActiveTab);
          }}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onOpenGridView={handleOpenGridView}
          fileTreeContent={
            <FileTree
              onFileOpen={handleFileOpen}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRename={handleRename}
              onDelete={handleDelete}
              onMove={handleMove}
              onDownload={handleDownload}
              onCreateFileAtRoot={handleCreateFileAtRoot}
              onCreateDefaultDocument={handleCreateDefaultDocument}
              onCreateMarkdownAtRoot={handleCreateMarkdownAtRoot}
              onCreateTextFileAtRoot={handleCreateTextFileAtRoot}
              onCreateRichTextFileAtRoot={handleCreateRichTextFileAtRoot}
              onCreateSpreadsheetAtRoot={handleCreateSpreadsheetAtRoot}
              onCreateCsvAtRoot={handleCreateCsvAtRoot}
              onCreateDocxAtRoot={handleCreateDocxAtRoot}
              onCreatePptxAtRoot={handleCreatePptxAtRoot}
              onSetLetterheadTemplate={handleSetLetterheadTemplate}
              onCreateSourceFileAtRoot={handleCreateSourceFileAtRoot}
              onCreateFolderAtRoot={handleCreateFolderAtRoot}
              onUploadFiles={handleUploadFiles}
              onOpenGridView={handleOpenGridView}
              onCreateAudioAtRoot={handleCreateAudioAtRoot}
              onConfirm={confirm}
              onDropAIMessage={handleDropAIMessage}
            />
          }
          searchContent={
            <SearchPanel
              onFileSelect={handleFileOpen}
              onRevealInFolder={handleRevealInFolder}
              onContentSearch={contentIndex.search}
            />
          }
          workflowContent={
            <WorkflowPanel
              {...(isReimaginedShell() ? { heading: 'Workflows' } : {})}
              onStartWorkflow={handleStartWorkflow}
              currentExecution={currentExecution}
              runHistory={runHistory}
              // F-502 — surface a blocked run right where the user clicked
              // Run (no folder/tab exists yet for the execution-tab banner).
              providerError={workflowProviderError}
              onOpenSettings={() => openSettings('ai')}
              onFocusExecutionTab={() => {
                // Prefer the tracked active workflow file path (live run);
                // fall back to scanning open tabs for any `.workflow` file
                // so we still focus a recently-completed run if its tab is
                // open but the live state has cleared.
                const target =
                  activeWorkflowFilePath ??
                  openTabs.find((t) => isWorkflowFilePath(t.path))?.path ??
                  null;
                if (target) {
                  useEditorStore.getState().setActiveTab(target);
                }
              }}
            />
          }
          aiAssistantContent={
            <AIAssistantPane
              apiKeys={apiKeys}
              chatFiles={chatFiles}
              modelLists={modelLists}
              onSaveApiKey={handleSaveApiKey}
              onDeleteApiKey={handleDeleteApiKey}
              onCreateNewChat={handleCreateNewChat}
              onOpenChat={handleOpenChat}
              onDeleteChat={handleDeleteChat}
              onOpenAIRules={handleOpenAIRules}
              requestedTab={aiAssistantRequestedTab}
              onRequestedTabApplied={() => setAiAssistantRequestedTab(undefined)}
            />
          }
          researchContent={
            <SourceCardPanel
              cards={sourceCards}
              onCreateCard={handleCreateSourceCard}
              onUpdateCard={handleUpdateSourceCard}
              onDeleteCard={handleDeleteSourceCard}
              onOpenFile={handleOpenSourceFile}
            />
          }
          auditContent={
            <AuditLog
              entries={auditEntries}
            />
          }
          trashContent={
            <TrashPanel
              items={trashItems}
              stats={trashStats}
              onRestore={handleRestoreFromTrash}
              onPermanentDelete={handlePermanentDelete}
              onEmptyTrash={handleEmptyTrash}
              retentionPeriod={trashRetentionPeriod}
              customRetentionDays={trashCustomRetentionDays}
              onRetentionChange={handleTrashRetentionChange}
            />
          }
          mattersContent={<MattersSidebarPanel />}
          emailContent={null}
        />

        {/* Main editor panel, or a full-page reimagined surface (matters/Ask/Email). */}
        {isReimaginedShell() && sidebarActiveTab === 'matters' ? (
          <ReimaginedMattersHome />
        ) : isReimaginedShell() && sidebarActiveTab === 'search' ? (
          <ReimaginedAsk
            onSaveToDocument={async (content) => {
              if (!workspaceServiceRef.current || !rootPath) return;
              const { deriveFilenameFromMessage, resolveUniqueName } = await import('@/utils/fileDrop');
              const desired = deriveFilenameFromMessage(content);
              const finalName = await resolveUniqueName(workspaceServiceRef.current, rootPath, desired);
              const path = `${rootPath}/${finalName}`;
              await workspaceServiceRef.current.writeFile(path, `${content}\n`);
              const tree = await workspaceServiceRef.current.getFileTree();
              setFileTree(tree);
              await handleFileOpen(path, finalName);
            }}
            prefillRequest={askPrefill}
            onPrefillConsumed={() => setAskPrefill(null)}
          />
        ) : isReimaginedShell() && sidebarActiveTab === 'email' ? (
          <ReimaginedEmailWorkspace
            onSaveToWorkspace={async (content, suggestedName) => {
              if (!workspaceServiceRef.current || !rootPath) return;
              const { resolveUniqueName } = await import('@/utils/fileDrop');
              const finalName = await resolveUniqueName(workspaceServiceRef.current, rootPath, suggestedName);
              const path = `${rootPath}/${finalName}`;
              await workspaceServiceRef.current.writeFile(path, `${content}\n`);
              const tree = await workspaceServiceRef.current.getFileTree();
              setFileTree(tree);
              await handleFileOpen(path, finalName);
            }}
            onOpenSettings={() => openSettings('ai')}
          />
        ) : isReimaginedShell() && sidebarActiveTab === 'files' ? (
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
            onCreateMarkdownAtRoot={handleCreateMarkdownAtRoot}
            onCreateTextFileAtRoot={handleCreateTextFileAtRoot}
            onCreateRichTextFileAtRoot={handleCreateRichTextFileAtRoot}
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
        ) : isReimaginedShell() && sidebarActiveTab === 'workflows' ? (
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
        ) : isReimaginedShell() && sidebarActiveTab === 'audit' ? (
          <ReimaginedAuditHome entries={auditEntries} />
        ) : isReimaginedShell() && sidebarActiveTab === 'settings' ? (
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

      {/* MCP write-approval gate. Polls for sidecar write requests and renders
          the approval modal. In Privileged Matter Mode it auto-denies every MCP
          write and records each block in the audit log. */}
      <McpApprovalGate
        onAuditEvent={(event) => addAuditEntry(auditEventToEntry(event))}
      />

      {/* Bug 1: MatterManagerDialog — opened by 'keepance:open-matter-manager'
          events from the "New matter" buttons in ReimaginedMattersHome. */}
      <MatterManagerDialog open={matterManagerOpen} onOpenChange={setMatterManagerOpen} />

      {/* Interview Dialog */}
      <Dialog open={showInterviewDialog} onOpenChange={setShowInterviewDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('app.interview.title')}</DialogTitle>
            <DialogDescription>
              {t('app.interview.description')}
            </DialogDescription>
          </DialogHeader>
          {interviewQuestions && (
            <InterviewForm
              questions={interviewQuestions}
              onSubmit={handleInterviewSubmit}
              onCancel={handleInterviewCancel}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Command Palette */}
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={commands}
      />

      {/* Settings Modal — the quick, deep-linkable surface (gear / Ctrl+, /
          command palette). The same content also lives full-page as the
          Settings nav tab; both share handleSettingsAction. */}
      <SettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
        auditEntries={auditEntries}
        templates={loadAllTemplates()}
        {...(settingsInitialCategory ? { initialCategory: settingsInitialCategory } : {})}
        onAction={handleSettingsAction}
        onRestartOnboarding={handleSettingsRestartOnboarding}
      />

      {/* Account / firm window — opened from the rail's account identity. */}
      <AccountWindow
        open={accountWindowOpen}
        onOpenChange={setAccountWindowOpen}
        auditEntries={auditEntries}
      />

      {/* Keepance 3.0: rebuilt first-run wizard — the live first-run surface.
          Built above as `firstRunOverlay` so it also renders over the
          WorkspaceSelector branch (where first run usually happens). */}
      {firstRunOverlay}

      {/* v1.6: 5-step Feature Tour (auto-shows on first launch) */}
      <FeatureTour
        open={tourOpen && !showFirstRun}
        onClose={() => setTourOpen(false)}
        onComplete={() => {
          featureTour.complete();
          setTourOpen(false);
        }}
        onSkip={() => {
          featureTour.skipForNow();
          setTourOpen(false);
        }}
      />

      {/* Shell-aware API key wizard — opened from reimagined shell CTAs */}
      <ApiKeyWizard
        open={apiKeyWizardOpen}
        onOpenChange={setApiKeyWizardOpen}
        onSaveKey={(provider, key) => {
          void handleSaveOnboardingApiKey(
            provider as Parameters<typeof handleSaveOnboardingApiKey>[0],
            key
          );
        }}
      />

      {/* Keyboard Shortcuts Overlay (UX-10) */}
      <ShortcutsOverlay
        open={showShortcutsOverlay}
        onOpenChange={setShowShortcutsOverlay}
      />

      {/* UX-27: Quick-open fuzzy file switcher (Ctrl+P) */}
      <QuickOpen
        open={showQuickOpen}
        onOpenChange={setShowQuickOpen}
        fileTree={fileTree}
        onFileOpen={handleFileOpen}
      />

      {/* Audio Recorder Modal */}
      <AudioRecorderModal
        isOpen={showAudioRecorder}
        onClose={() => setShowAudioRecorder(false)}
        onSave={handleSaveAudioRecording}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Prompt Dialog */}
      <PromptDialog {...promptDialogProps} />

      {/* UX-16: Undo toast for destructive actions */}
      <UndoToastRenderer controller={undoToast} />

      {/* UX-19: Global drop overlay. Visible while files are dragged over the window. */}
      <GlobalDropOverlay visible={isFileDragging} />

      {/* UX-20: What's new toast + changelog modal */}
      <WhatsNewLayer />

      {/* Manually-triggered version of the changelog modal, opened from
          Settings → About so users can revisit release notes anytime. */}
      <WhatsNewModal
        open={showWhatsNewModalDirect}
        onOpenChange={setShowWhatsNewModalDirect}
      />

      {/* Auto-updater banner + scheduled background checks. No-op outside
          Tauri so the browser / test mode never sees it. */}
      <UpdateManager />
    </div>
  );
}

/**
 * UX-20: local wrapper so we can call the hook inside a component tree that
 * doesn't already subscribe to the app's other state. Mounted once near the
 * UndoToastRenderer.
 */
function WhatsNewLayer() {
  const { toastOpen, modalOpen, version, openModal, dismissToast, closeModal } = useWhatsNew();
  return (
    <>
      <WhatsNewToast
        open={toastOpen}
        version={version}
        onOpenModal={openModal}
        onDismiss={dismissToast}
      />
      <WhatsNewModal open={modalOpen} onOpenChange={closeModal} />
    </>
  );
}

export default App;
