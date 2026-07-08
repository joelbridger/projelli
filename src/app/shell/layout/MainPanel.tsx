// Main Panel Component
// Contains the editor area with tabs, split panes, and side panels

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiKeySetupCard,
  hasDismissedApiKeyCard,
  markApiKeyCardDismissed,
} from '@/features/onboarding/ApiKeySetupCard';
import { TabBar } from '@/features/documents/editor/TabBar';
import { AutoSaveIndicator } from '@/features/documents/editor/AutoSaveIndicator';
import { getFileIcon } from '@/platform/utils/fileIcons';
import { MarkdownEditor, type MarkdownEditorRef } from '@/features/documents/editor/MarkdownEditor';
import { FormattingToolbar, type ToolbarFileType } from '@/features/documents/editor/FormattingToolbar';
import { SplitPane } from '@/features/documents/editor/SplitPane';
import { OutlinePanel } from '@/features/documents/editor/OutlinePanel';
import { ImageViewer, VideoViewer, isImageFile, isVideoFile } from '@/features/documents/media/MediaViewer';
import { PDFViewer, isPDFFile, isSpreadsheetFile, isPresentationFile, isWordFile } from '@/features/documents/media/PDFViewer';
import { DraftFollowUpModal } from '@/features/email/DraftFollowUpModal';
import { resolveMatterIdForWorkspacePath } from '@/platform/hooks/useMemoryWiring';
import { MeetingNoteOutboundGate } from '@/features/meetings/MeetingNoteOutboundGate';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { buildDocNoteCrmWrite } from '@/features/matters/logic/crmNoteFormat';
import { EV_MATTER_LAUNCH } from '@/config/identity';

// Heavy doc libraries and feature modules are lazy-loaded so they don't land
// in the startup bundle. Mermaid (~700KB) and KaTeX are pulled in via
// MarkdownPreview; wavesurfer.js (~600KB) via WaveformEditor. xlsx, mammoth,
// docx-preview, and docx are pulled in via the respective viewer/editor
// components below. DocxViewer is still exported for read-only contexts but
// MainPanel uses DocxEditor (which also wraps viewer fallbacks) whenever the
// user can edit the file.
const loadMarkdownPreview = () =>
  import('@/features/documents/editor/MarkdownPreview').then((m) => ({ default: m.MarkdownPreview }));
const loadWaveformEditor = () =>
  import('@/features/dictation/audio/WaveformEditor').then((m) => ({ default: m.WaveformEditor }));
const loadSpreadsheetViewer = () =>
  import('@/features/documents/media/SpreadsheetViewer').then((m) => ({ default: m.SpreadsheetViewer }));
const loadDocxEditor = () =>
  import('@/features/documents/media/DocxEditor').then((m) => ({ default: m.DocxEditor }));
const loadPresentationViewer = () =>
  import('@/features/documents/media/PresentationViewer').then((m) => ({
    default: m.PresentationViewer,
  }));
import { SourceFileEditor } from '@/features/ask/research/SourceFileEditor';
import { AIChatViewer } from '@/features/ask/AIChatViewer';
import { FileGridView } from '@/features/documents/workspace/FileGridView';
import { VersionHistoryPanel, BinaryVersionHistoryPanel } from '@/features/documents/versioning';
import { BrowserPanel } from '@/features/workflows/BrowserPanel';
import { WorkflowExecutionTab } from '@/features/workflows/WorkflowExecutionTab';
import { EmailViewer } from '@/features/email/EmailViewer';
import { MatterNotesEditorWrapper } from '@/features/matters/MatterNotesEditorWrapper';
import {
  fileDataToExecution,
  isWorkflowFilePath,
  parseWorkflowFile,
} from '@/features/workflows/engine/workflowFile';
import { getVersionService } from '@/features/documents/versioning/VersionService';
import { getBinaryVersionService } from '@/features/documents/versioning';
import { useEditorStore } from '@/platform/state/editorStore';
import { useShallow } from 'zustand/react/shallow';
import { flushTab } from '@/app/fileOps/flushDirtyTabs';
import {
  useFileBackupStore,
  computeBackupPath,
  formatBackupTimestamp,
} from '@/platform/fs/fileBackupStore';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { FileText, List, PanelRightClose, FileType, X, History, Download, ChevronDown, MoreVertical, Columns, Rows, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/platform/utils/saveFile';
import { withShortcut } from '@/platform/utils/shortcuts';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { toRealProviderId } from '@/platform/privacy/activeEgressProvider';
import { resolveRedlineProvider } from './resolveRedlineProvider';
import { resolveInlineEditProvider } from './resolveInlineEditProvider';
import { modeRestrictsToLocal } from '@/platform/privacy/egress';
import { detectOllama } from '@/platform/providers/OllamaProvider';
import { useLocalLlmModelStatus } from '@/platform/hooks/useLocalLlmModelStatus';
import { isAudioFile, getFileExtension, shouldVersionFile, isDiskVersioned } from './mainPanelHelpers';
import { DocLoadingFallback, DocLegacyFallback } from './MainPanelDocFallbacks';
import { LazyBoundary } from '@/ui/LazyBoundary';

import type {
  WorkflowTemplate,
  WorkflowExecution,
  InterviewQuestion,
} from '@/platform/types/workflow';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

interface APIKey {
  provider: string;
  key: string;
  isValid: boolean;
}

interface MainPanelProps {
  onFileOpen?: (path: string, name: string) => Promise<unknown>;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void>;
  onRename?: (path: string, newName: string) => Promise<void>;
  onDownload?: (path: string, name: string) => void;
  apiKeys?: APIKey[];
  workspaceServiceRef?: React.MutableRefObject<WorkspaceService | null>;
  rootPath?: string;
  onFileTreeChange?: () => void;
  onAuditLog?: (entry: Omit<import('@/platform/types/audit').AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * M2 — forwarded to AIChatViewer so citation chips in assistant
   * responses can open the cited file at a specific paragraph index.
   * F-504: `snippet` carries the cited chunk's text for passage scroll.
   */
  onOpenFileAtPath?: (
    path: string,
    paragraphIndex?: number,
    snippet?: string,
  ) => void | Promise<void>;
  /**
   * When the user clicks the UX-04 onboarding card's "Add API key" button,
   * this fires so the parent can switch to the AI Assistant sidebar + Keys
   * sub-tab. Optional — if omitted, the card still renders but its CTA is a
   * no-op (not a realistic production state; present for safety).
   */
  onRequestApiKeySetup?: () => void;

  // Workflow execution tab support
  /** The active workflow execution state (null when no workflow is running). */
  workflowExecution?: WorkflowExecution | null;
  /** The template for the active workflow execution. */
  workflowTemplate?: WorkflowTemplate | null;
  /** Interview questions for the current workflow step (null when not interviewing). */
  workflowInterviewQuestions?: InterviewQuestion[] | null;
  /** Called when the user submits interview answers in the workflow tab. */
  onWorkflowInterviewSubmit?: (answers: Record<string, string>) => void;
  /** Called when the user cancels the running workflow. */
  onWorkflowCancel?: () => void;
  /** Called to save workflow output as a file. */
  onWorkflowSaveAsFile?: (content: string, suggestedName: string) => void;
  /** Called to export workflow output as .docx. */
  onWorkflowExportDocx?: (content: string, suggestedName: string) => void;
  /** Called to export workflow output as .pptx. */
  onWorkflowExportPptx?: (content: string, suggestedName: string) => void;
  /**
   * F-106/F-107 — when set, the workflow run was blocked because no usable AI
   * provider is available. The WorkflowExecutionTab renders a blocking UI.
   */
  workflowProviderError?: 'needs-provider' | 'ollama-unreachable' | 'needs-client' | null;
  /** Called when the user clicks "Open AI Settings" in the provider-error UI. */
  onOpenSettings?: () => void;
  /**
   * R4: when true, the built-in TabBar is hidden so the parent (the unified
   * Documents tab strip in DocumentsHome) can act as the sole tab
   * strip. Without this the Documents surface would show two tab bars.
   */
  hideTabBar?: boolean;
}

export function MainPanel({
  onFileOpen,
  onMove,
  onRename,
  onDownload,
  apiKeys = [],
  workspaceServiceRef,
  rootPath,
  onFileTreeChange,
  onAuditLog,
  onOpenFileAtPath,
  onRequestApiKeySetup,
  workflowExecution,
  workflowTemplate,
  workflowInterviewQuestions,
  onWorkflowInterviewSubmit,
  onWorkflowCancel,
  onWorkflowSaveAsFile,
  onWorkflowExportDocx,
  onWorkflowExportPptx,
  workflowProviderError,
  onOpenSettings,
  hideTabBar = false,
}: MainPanelProps = {}) {
  const { t } = useTranslation();
  // Perf (P1.2): exact-data-only selector. The old bare `useEditorStore()`
  // call subscribed to every field in the store (tab groups, pending-rename
  // state, pane layout, tab-overflow mode, …) even though MainPanel reads
  // none of those — so it re-rendered on changes that had nothing to do
  // with what it shows. useShallow keeps this destructure ergonomic while
  // only re-rendering when one of THESE fields actually changes.
  const {
    openTabs,
    activeTabPath,
    updateContent,
    isSplit,
    splitDirection,
    secondaryTabPath,
    splitPane,
    closeSplit,
    setSecondaryTab,
    showOutline,
    toggleOutline,
  } = useEditorStore(useShallow((s) => ({
    openTabs: s.openTabs,
    activeTabPath: s.activeTabPath,
    updateContent: s.updateContent,
    isSplit: s.isSplit,
    splitDirection: s.splitDirection,
    secondaryTabPath: s.secondaryTabPath,
    splitPane: s.splitPane,
    closeSplit: s.closeSplit,
    setSecondaryTab: s.setSecondaryTab,
    showOutline: s.showOutline,
    toggleOutline: s.toggleOutline,
  })));

  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const secondaryTab = openTabs.find((t) => t.path === secondaryTabPath);

  // Smoke P0 #5: "Send to Wealthbox" from a normal docx note enqueues into
  // the same CRM write-back queue MatterNotesEditor's shared-matter notes
  // use — the advisor still approves in the review card, this only queues.
  const enqueueCrmWrite = useCrmWriteQueueStore((s) => s.enqueue);

  // Editor refs for formatting toolbar
  const primaryEditorRef = useRef<MarkdownEditorRef>(null);
  const secondaryEditorRef = useRef<MarkdownEditorRef>(null);


  // Preview mode state - default to false due to WYSIWYG usability issues
  // (cursor placement broken, Enter creates hashtags instead of line breaks)
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Wave 0: the note/document the "Draft follow-up" modal is currently open for.
  const [followUpFor, setFollowUpFor] = useState<{
    name: string;
    content: string;
    matterId: string;
  } | null>(null);

  // Inline rename state for the editor title strip. Independent from the
  // tab-bar inline rename (which is double-click) so this works whether
  // the tab is visible in the bar or hidden inside a group chip.
  const [titleEditingPath, setTitleEditingPath] = useState<string | null>(null);
  const [titleEditingName, setTitleEditingName] = useState('');
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const startTitleRename = useCallback((path: string, currentName: string) => {
    const dot = currentName.lastIndexOf('.');
    const base = dot > 0 ? currentName.slice(0, dot) : currentName;
    setTitleEditingPath(path);
    setTitleEditingName(base);
  }, []);

  const submitTitleRename = useCallback(async () => {
    if (!titleEditingPath || !onRename) {
      setTitleEditingPath(null);
      setTitleEditingName('');
      return;
    }
    const trimmed = titleEditingName.trim();
    const tab = openTabs.find((t) => t.path === titleEditingPath);
    if (!tab || !trimmed) {
      setTitleEditingPath(null);
      setTitleEditingName('');
      return;
    }
    const dot = tab.name.lastIndexOf('.');
    const ext = dot > 0 ? tab.name.slice(dot) : '';
    const newName = trimmed.includes('.') ? trimmed : `${trimmed}${ext}`;
    if (newName === tab.name) {
      setTitleEditingPath(null);
      setTitleEditingName('');
      return;
    }
    try {
      await onRename(titleEditingPath, newName);
    } catch (err) {
      console.error('Title rename failed:', err);
    } finally {
      setTitleEditingPath(null);
      setTitleEditingName('');
    }
  }, [titleEditingPath, titleEditingName, onRename, openTabs]);

  // Autofocus + select the basename when rename kicks in.
  useLayoutEffect(() => {
    if (!titleEditingPath) return;
    const input = titleInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [titleEditingPath]);

  // Version history state
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const versionService = getVersionService();
  // WS-A / A5: bump to force the DocxEditor to remount and re-open from disk
  // after a `.docx` version is restored (the engine reads by path on mount).
  const [docxReloadNonce, setDocxReloadNonce] = useState(0);

  // UX-24: auto-close the version-history panel when the active file
  // switches to a non-versioned type (e.g. a .xlsx). Keeps the panel from
  // showing stale history for a file that can't actually produce versions.
  useEffect(() => {
    if (!activeTabPath) return;
    const extension = getFileExtension(activeTabPath);
    if (!shouldVersionFile(extension) && showVersionHistory) {
      setShowVersionHistory(false);
    }
  }, [activeTabPath, showVersionHistory]);

  // UX-13: Compact toolbar overflow.
  // At narrow widths the right-side toolbar (History / Split / Outline /
  // Backlinks, etc.) wraps below the tab row, creating an awkward two-row
  // layout. When the tab bar container reports a width below the breakpoint,
  // we render a "…" overflow menu instead of showing every action inline.
  // Save, Auto-save, and Download stay visible — those are the critical
  // items a user needs on every file.
  //
  // Breakpoint: 900px for the entire MainPanel. Below that, squeeze items
  // into the overflow menu. Using a plain ResizeObserver rather than CSS
  // container queries for browser compatibility with the Tauri webview.
  const toolbarContainerRef = useRef<HTMLDivElement | null>(null);
  const [isToolbarCompact, setIsToolbarCompact] = useState(false);
  useEffect(() => {
    const el = toolbarContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      setIsToolbarCompact(w < 900);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // WS-C honesty — confidentiality mode for the DOCX AI redline. In Local-only
  // mode the redline must run on a LOCAL model (Ollama), so we route the
  // DocxEditor's redline provider to 'ollama' and discover a local model to
  // use. Outside Local-only the redline uses the SAME resolved provider the
  // rest of the app does (trust bar / egress) — NOT a hardcoded default.
  // Without this, DocxEditor falls back to its 'anthropic' default, so a BYOK
  // user whose only valid key is non-Anthropic (e.g. OpenAI) gets "add a key"
  // and the redline button stays disabled despite a working key. The hook
  // returns 'ollama' in Local-only mode (matching redlineLocalOnly) and the
  // resolved cloud provider otherwise, so all surfaces agree.
  const confidentialityMode = useConfidentialityMode();
  const redlineLocalOnly = modeRestrictsToLocal(confidentialityMode);
  // Narrow the badge status to a REAL provider id (null for 'none' /
  // 'local-pending' / "checking"): a badge sentinel must never enter redline /
  // inline-edit provider resolution (fix round 2, item 2).
  const activeEgressProvider = toRealProviderId(useActiveEgressProvider(confidentialityMode));
  // F-503 — in Local-only mode prefer the embedded Lantern Local AI for the
  // redline / inline edit when its model is downloaded + ready (it needs no
  // separate Ollama daemon), the same on-device default Ask / Chat / Client Map
  // / workflows use. Off-desktop the hook stays 'idle', so this is false there.
  const redlineLocalModelReady = useLocalLlmModelStatus().state === 'ready';
  // Resolve the redline provider reactively from the user's actual keys so the
  // button is never dead when a usable key exists (a key added this session, or
  // a stale higher-priority key masking a valid one). Prefers the trust-bar
  // provider when it has a valid key, so the surfaces still agree. See
  // resolveRedlineProvider for the full rule order (BUG-009).
  const redlineProvider = useMemo(
    () =>
      resolveRedlineProvider({
        localOnly: redlineLocalOnly,
        egressProvider: activeEgressProvider,
        apiKeys,
        localModelReady: redlineLocalModelReady,
      }),
    [redlineLocalOnly, activeEgressProvider, apiKeys, redlineLocalModelReady],
  );
  const [redlineOllamaModel, setRedlineOllamaModel] = useState<string | undefined>(undefined);
  useEffect(() => {
    // Only discover an Ollama model when the redline actually resolved to Ollama.
    // For the embedded Lantern Local AI ('lantern-local') the model id is the
    // provider's own default, so we leave redlineOllamaModel undefined.
    if (!redlineLocalOnly || redlineProvider !== 'ollama') {
      setRedlineOllamaModel(undefined);
      return;
    }
    let cancelled = false;
    void detectOllama().then((result) => {
      if (cancelled) return;
      setRedlineOllamaModel(result.reachable ? result.models[0] : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [redlineLocalOnly, redlineProvider]);

  // UX-04 onboarding: has the user dismissed the API key setup card in this
  // session? Reset to the live sessionStorage value each mount so a page
  // reload ("full session restart") brings the card back when keys are still
  // missing.
  const [apiKeyCardDismissed, setApiKeyCardDismissed] = useState<boolean>(
    () => hasDismissedApiKeyCard()
  );

  const handleDismissApiKeyCard = useCallback(() => {
    markApiKeyCardDismissed();
    setApiKeyCardDismissed(true);
  }, []);

  // First-edit backup hook. For binary formats (.xlsx/.docx) we write a
  // snapshot of the original on-disk bytes to a `.backup-YYYYMMDD-HHMMSS.ext`
  // sibling BEFORE the user's first edit hits disk. Subsequent edits this
  // session skip — one backup per file per session is the contract.
  const hasBackup = useFileBackupStore((s) => s.hasBackup);
  const markBackedUp = useFileBackupStore((s) => s.markBackedUp);

  const writeBackupIfNeeded = useCallback(
    async (path: string) => {
      if (hasBackup(path)) return;
      const service = workspaceServiceRef?.current;
      if (!service) {
        // No workspace service (e.g. test mode with a synthetic tab) — nothing
        // to back up to. Still mark it so we don't repeatedly attempt the
        // backup on every edit.
        markBackedUp(path);
        return;
      }
      try {
        // Does the original file exist on disk? If not (e.g. a test tab that
        // was openFile'd directly into memory), there's nothing to back up.
        const exists = await service.exists(path);
        if (!exists) {
          markBackedUp(path);
          return;
        }
        const originalBytes = await service.readFileBinary(path);
        const timestamp = formatBackupTimestamp();
        const backupPath = computeBackupPath(path, timestamp);
        await service.writeFileBinary(backupPath, originalBytes);
        markBackedUp(path);
        // Refresh tree so the new backup file shows up in the sidebar.
        onFileTreeChange?.();
      } catch (err) {
        console.warn('[MainPanel] Failed to write backup for', path, err);
        // Mark anyway — repeated failed attempts would keep spamming the
        // console and still not help the user.
        markBackedUp(path);
      }
    },
    [hasBackup, markBackedUp, workspaceServiceRef, onFileTreeChange]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeTabPath) {
        updateContent(activeTabPath, content);

        // Save version for versionable files
        const extension = getFileExtension(activeTabPath);
        if (shouldVersionFile(extension)) {
          // Debounce version saves - only save if significant change
          const existingVersions = versionService.getVersions(activeTabPath);
          const lastVersion = existingVersions[0];

          // Don't save if content hasn't changed significantly
          if (!lastVersion || lastVersion.content !== content) {
            void versionService.saveVersion(activeTabPath, content, 'Auto-saved version');
          }
        }
      }
    },
    [activeTabPath, updateContent, versionService]
  );

  const handleSecondaryContentChange = useCallback(
    (content: string) => {
      if (secondaryTabPath) {
        updateContent(secondaryTabPath, content);

        // Save version for versionable files
        const extension = getFileExtension(secondaryTabPath);
        if (shouldVersionFile(extension)) {
          const existingVersions = versionService.getVersions(secondaryTabPath);
          const lastVersion = existingVersions[0];

          if (!lastVersion || lastVersion.content !== content) {
            void versionService.saveVersion(secondaryTabPath, content, 'Auto-saved version');
          }
        }
      }
    },
    [secondaryTabPath, updateContent, versionService]
  );

  const handleSplitHorizontal = useCallback(() => {
    splitPane('horizontal');
  }, [splitPane]);

  const handleSplitVertical = useCallback(() => {
    splitPane('vertical');
  }, [splitPane]);

  const handleCloseSplit = useCallback(() => {
    closeSplit();
  }, [closeSplit]);

  const handleHeadingClick = useCallback((lineNumber: number) => {
    // In a real implementation, this would scroll the editor to the line
    console.log('Navigate to line:', lineNumber);
    // TODO: Implement scroll-to-line in MarkdownEditor
  }, []);

  // Check if a file is a text file that can be edited
  const isTextFile = (extension: string | undefined): boolean => {
    if (!extension) return true; // No extension = likely text
    const nonTextExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar', 'gz', 'aichat'];
    return !nonTextExtensions.includes(extension.toLowerCase());
  };

  // Render a single editor pane
  const renderEditorPane = (
    tab: typeof activeTab,
    onContentChange: (content: string) => void,
    isSecondary = false
  ) => {
    if (!tab) {
      // UX-04: Show API key setup card in the "no file open" slot when:
      //   - a workspace is open (rootPath set),
      //   - no API keys have been configured,
      //   - the user hasn't dismissed the card this session,
      //   - this is the primary (non-secondary) pane.
      // Otherwise fall back to the plain "No file open" placeholder.
      const shouldShowApiKeyCard =
        !isSecondary &&
        Boolean(rootPath) &&
        apiKeys.length === 0 &&
        !apiKeyCardDismissed;

      if (shouldShowApiKeyCard) {
        return (
          <ApiKeySetupCard
            onAddKey={() => onRequestApiKeySetup?.()}
            onDismiss={handleDismissApiKeyCard}
          />
        );
      }

      return (
        <div
          data-testid="main-panel-empty"
          className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full"
        >
          <FileText className="h-16 w-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">{t('layout.main-panel.no-file-open-title')}</p>
          <p className="text-sm">{t('layout.main-panel.no-file-open-hint')}</p>
        </div>
      );
    }

    const extension = getFileExtension(tab.path);
    const isImage = isImageFile(extension);
    const isVideo = isVideoFile(extension);
    const isAudio = isAudioFile(extension);
    const isPDF = isPDFFile(extension);
    const isSpreadsheet = isSpreadsheetFile(extension);
    const isPresentation = isPresentationFile(extension);
    const isWord = isWordFile(extension);
    const isText = isTextFile(extension);
    const editorRef = isSecondary ? secondaryEditorRef : primaryEditorRef;

    // For media files, the content is a data URL or blob URL
    const renderContent = () => {
      // Check for browser tab
      if (tab.type === 'browser') {
        return (
          <BrowserPanel
            {...(tab.metadata?.url ? { initialUrl: tab.metadata.url } : {})}
            className="h-full"
          />
        );
      }
      // Lantern 3.0 email viewer tab — read-only view of one stored message.
      // The message id rides in metadata.mailSourceId (falling back to the tab
      // path, which is the `mail:<id>` key for citation-opened messages).
      if (tab.type === 'email') {
        const sourceId = tab.metadata?.mailSourceId ?? tab.path;
        return <EmailViewer sourceId={sourceId} className="h-full" />;
      }
      // Firm shared-matter notes tab. Path is `matter-notes:/<localMatterId>`.
      // MatterNotesEditorWrapper resolves the matter + boots the sync client.
      if (tab.path.startsWith('matter-notes:/')) {
        const localMatterId = tab.path.slice('matter-notes:/'.length);
        return (
          <MatterNotesEditorWrapper
            localMatterId={localMatterId}
            workspaceService={workspaceServiceRef?.current ?? null}
            className="h-full min-w-0"
          />
        );
      }
      // Workflow execution tab — dispatched purely by the `.workflow`
      // extension so the same renderer covers (a) a freshly-opened live run
      // whose tab path is the real `.workflow` file, and (b) a past run
      // re-opened from the file tree. When the live engine state matches
      // the file's runId, prefer the in-memory execution so progress
      // updates flow through. Otherwise re-hydrate from the file content.
      if (isWorkflowFilePath(tab.path)) {
        const parsed = parseWorkflowFile(tab.content);
        if (!parsed) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>{t('layout.main-panel.workflow-load-failed')}</p>
            </div>
          );
        }
        const isLive =
          workflowExecution?.runId === parsed.runId &&
          workflowTemplate?.id === parsed.template.id;
        const liveExecution = isLive
          ? workflowExecution
          : fileDataToExecution(parsed);
        const liveTemplate = isLive ? workflowTemplate : parsed.template;
        const liveInterview = isLive ? (workflowInterviewQuestions ?? null) : null;
        return (
          <div data-testid="workflow-execution-tab-wrapper" className="h-full min-w-0 overflow-hidden">
            <WorkflowExecutionTab
              template={liveTemplate ?? parsed.template}
              execution={liveExecution ?? null}
              interviewQuestions={liveInterview}
              onInterviewSubmit={(answers) => onWorkflowInterviewSubmit?.(answers)}
              onCancel={() => onWorkflowCancel?.()}
              {...(onWorkflowSaveAsFile ? { onSaveAsFile: onWorkflowSaveAsFile } : {})}
              {...(onWorkflowExportDocx ? { onExportDocx: onWorkflowExportDocx } : {})}
              {...(onWorkflowExportPptx ? { onExportPptx: onWorkflowExportPptx } : {})}
              {...(onFileOpen ? { onFileOpen: (path: string, name: string) => { void onFileOpen(path, name); } } : {})}
              {...(workflowProviderError ? { providerError: workflowProviderError } : {})}
              {...(onOpenSettings ? { onOpenSettings } : {})}
              className="h-full"
            />
          </div>
        );
      }
      // UX-21: AI Assistant main-panel tab. Runs the same AIChatViewer as
      // `.aichat` files but with its chatData pulled from the tab's
      // content (or a fresh-session default if the content is empty).
      // The tab itself is NOT written to disk — it's a transient UI
      // surface. Closing the tab drops the conversation unless the user
      // exports it or saves a copy from within the viewer.
      if (tab.type === 'ai-assistant') {
        let chatData: import('@/platform/types/ai').AIChatFile;
        try {
          chatData = tab.content
            ? (JSON.parse(tab.content) as import('@/platform/types/ai').AIChatFile)
            : {
                id: tab.path,
                title: tab.name || 'AI Assistant',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                messages: [],
              };
        } catch {
          chatData = {
            id: tab.path,
            title: tab.name || 'AI Assistant',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            messages: [],
          };
        }
        return (
          <div data-testid="ai-assistant-tab" className="h-full">
            <AIChatViewer
              chatData={chatData}
              onSave={async (updatedChat) => {
                onContentChange(JSON.stringify(updatedChat, null, 2));
              }}
              apiKeys={apiKeys}
              {...(workspaceServiceRef && { workspaceServiceRef })}
              {...(rootPath && { rootPath })}
              {...(onFileTreeChange && { onFileTreeChange })}
              {...(onAuditLog && { onAuditLog })}
              {...(onOpenFileAtPath && { onOpenFileAtPath })}
              className="h-full"
            />
          </div>
        );
      }
      // Check for grid view special tab
      if (tab.path === '__grid_view__') {
        const gridViewProps: {
          onFileOpen: (path: string, name: string) => Promise<unknown>;
          onMove?: (sourcePath: string, targetPath: string) => Promise<void>;
          className: string;
        } = {
          onFileOpen: onFileOpen || (async () => {}),
          className: 'h-full',
        };
        if (onMove) {
          gridViewProps.onMove = onMove;
        }
        return <FileGridView {...gridViewProps} />;
      }
      // Check for .source files
      if (tab.path.endsWith('.source')) {
        return (
          <SourceFileEditor
            filePath={tab.path}
            initialContent={tab.content}
            onSave={async (content) => {
              // BUG-048: update the tab THEN actually persist to disk before
              // resolving, so the editor's "saved" state is honest (it used to
              // only update tab memory and rely on the 2s autosave — the UI said
              // "saved" while the .source file on disk lagged). flushTab routes
              // through the write coordinator + revision-checked markSaved.
              onContentChange(content);
              await flushTab(tab.path);
            }}
            className="h-full"
          />
        );
      }
      // Check for .aichat files
      if (tab.path.endsWith('.aichat')) {
        try {
          const chatData = JSON.parse(tab.content) as import('@/platform/types/ai').AIChatFile;
          return (
            <AIChatViewer
              chatData={chatData}
              onSave={async (updatedChat) => {
                onContentChange(JSON.stringify(updatedChat, null, 2));
              }}
              apiKeys={apiKeys}
              {...(workspaceServiceRef && { workspaceServiceRef })}
              {...(rootPath && { rootPath })}
              {...(onFileTreeChange && { onFileTreeChange })}
              {...(onAuditLog && { onAuditLog })}
              {...(onOpenFileAtPath && { onOpenFileAtPath })}
              className="h-full"
            />
          );
        } catch (error) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>{t('layout.main-panel.chat-load-failed', { message: error instanceof Error ? error.message : t('layout.main-panel.unknown-error') })}</p>
            </div>
          );
        }
      }
      if (isImage) {
        return <ImageViewer src={tab.content} alt={tab.name} />;
      }
      // Audio check runs BEFORE video — .webm and .ogg are containers
      // that can hold audio OR video, but in Lantern they're used for
      // audio recording. Route to WaveformEditor first so recorded audio
      // gets the waveform + edit tools, not a bare HTML5 video player.
      if (isAudio) {
        return (
          <LazyBoundary
            loader={loadWaveformEditor}
            resetKey={tab.path}
            fallback={<DocLoadingFallback fileName={tab.name} />}
            label={tab.name}
          >
            {(WaveformEditor) => (
              <WaveformEditor
                audioSrc={tab.content}
                filename={tab.name}
                className="h-full"
              />
            )}
          </LazyBoundary>
        );
      }
      if (isVideo) {
        return <VideoViewer src={tab.content} />;
      }
      if (isPDF) {
        return <PDFViewer src={tab.content} fileName={tab.name} />;
      }
      if (isSpreadsheet) {
        return (
          <LazyBoundary
            loader={loadSpreadsheetViewer}
            resetKey={tab.path}
            fallback={<DocLoadingFallback fileName={tab.name} />}
            label={tab.name}
          >
            {(SpreadsheetViewer) => (
              <SpreadsheetViewer
                src={tab.content}
                fileName={tab.name}
                onContentChange={onContentChange}
                onFirstEdit={() => writeBackupIfNeeded(tab.path)}
              />
            )}
          </LazyBoundary>
        );
      }
      if (isPresentation) {
        return (
          <LazyBoundary
            loader={loadPresentationViewer}
            resetKey={tab.path}
            fallback={<DocLoadingFallback fileName={tab.name} />}
            label={tab.name}
          >
            {(PresentationViewer) => (
              <PresentationViewer
                src={tab.content}
                fileName={tab.name}
                filePath={tab.path}
              />
            )}
          </LazyBoundary>
        );
      }
      if (isWord) {
        // `.docx` gets the new in-house OOXML editor (WS-A / A3): faithful
        // tracked-changes rendering + accept/reject + comments, backed by the
        // Rust engine which reads/writes the file by PATH (preserving every
        // unmodeled part of the package). It manages its own save via the
        // engine, so it takes `filePath` (the real on-disk path) rather than
        // routing data-URL content back through `onContentChange`. `src` is the
        // tab's data URL, used only for the browser/test read-only fallback.
        // `.doc` (legacy binary) still gets the LibreOffice-convert fallback.
        if (extension?.toLowerCase() === 'docx') {
          return (
            // E3: for a meeting note, resolve whether it's cleared to leave the
            // app; the reason (if blocked) disables the outbound toolbar actions.
            <MeetingNoteOutboundGate tabPath={tab.path} workspaceService={workspaceServiceRef?.current ?? null}>
              {(outboundBlockedReason) => (
                <LazyBoundary
                  loader={loadDocxEditor}
                  resetKey={tab.path}
                  fallback={<DocLoadingFallback fileName={tab.name} />}
                  label={tab.name}
                >
                  {(DocxEditor) => (
                    // WS-C honesty — in Local-only mode the redline runs on the
                    // local model (Ollama) so nothing leaves the machine.
                    <DocxEditor
                      key={`docx-${tab.path}-${docxReloadNonce}`}
                      filePath={tab.path}
                      src={tab.content}
                      fileName={tab.name}
                      onFirstEdit={() => writeBackupIfNeeded(tab.path)}
                      onAfterSave={handleDocxAfterSave}
                      {...(onRename ? { onRenameFile: (newName: string) => { void onRename(tab.path, newName); } } : {})}
                      {...(onDownload ? { onDownload: () => { onDownload(tab.path, tab.name); } } : {})}
                      {...(shouldVersionFile(getFileExtension(tab.path)) ? {
                        versionHistoryLabel: t('media.docx-editor.history-with-count', {
                          count: versionService.getVersionCount(tab.path),
                        }),
                        onToggleHistory: () => { setShowVersionHistory((value) => !value); },
                      } : {})}
                      {...(!isSplit ? {
                        onSplitHorizontal: handleSplitHorizontal,
                        onSplitVertical: handleSplitVertical,
                      } : {})}
                      onToggleOutline={toggleOutline}
                      apiKeys={apiKeys}
                      aiProvider={redlineProvider}
                      {...(redlineLocalOnly && redlineOllamaModel ? { aiModel: redlineOllamaModel } : {})}
                      {...(onAuditLog ? { onAuditLog } : {})}
                      {...(outboundBlockedReason ? { outboundBlockedReason } : {})}
                      onDraftFollowUp={(plainText) => {
                        setFollowUpFor({
                          name: tab.name,
                          content: plainText,
                          matterId: resolveMatterIdForWorkspacePath(tab.path, rootPath),
                        });
                      }}
                      {...(() => {
                        const matterIdForFile = resolveMatterIdForWorkspacePath(tab.path, rootPath);
                        return matterIdForFile === UNASSIGNED_MATTER_ID ? {} : {
                          onSendToWealthbox: (plainText: string) => {
                            const write = buildDocNoteCrmWrite(tab.path, matterIdForFile, plainText);
                            if (!write) return false;
                            enqueueCrmWrite(write);
                            return true;
                          },
                          onReviewWealthboxQueue: () => {
                            window.dispatchEvent(
                              new CustomEvent(EV_MATTER_LAUNCH, { detail: { matterId: matterIdForFile, surface: 'matters' } }),
                            );
                          },
                        };
                      })()}
                    />
                  )}
                </LazyBoundary>
              )}
            </MeetingNoteOutboundGate>
          );
        }
        return (
          <DocLegacyFallback
            tabName={tab.name}
            tabPath={tab.path}
            tabContent={tab.content}
            onFileOpen={onFileOpen}
          />
        );
      }
      // Check if it's a markdown or text file for formatting support
      // .txt files now get full formatting toolbar (bold, italic, headers, etc.)
      const isMarkdown = extension === 'md' || extension === 'markdown' || extension === 'txt' || !extension;

      if (isPreviewMode && isMarkdown && !isSecondary) {
        return (
          <LazyBoundary
            loader={loadMarkdownPreview}
            resetKey={tab.path}
            fallback={<DocLoadingFallback fileName={tab.name} />}
            label={tab.name}
          >
            {(MarkdownPreview) => (
              <MarkdownPreview
                content={tab.content}
                className="h-full"
              />
            )}
          </LazyBoundary>
        );
      }

      // `.rtf` and `.rt` (internal rich text) are no longer supported editors.
      // Fall through to MarkdownEditor for plain-text rendering of the raw
      // content, which is the safest no-crash fallback.

      return (
        <MarkdownEditor
          ref={editorRef}
          key={tab.path}
          initialContent={tab.content}
          onChange={onContentChange}
          filePath={tab.path}
          writeImage={async ({ path, bytes }) => {
            // Q13 — route image paste writes through the same
            // WorkspaceService the rest of the app uses. The service
            // creates parent folders on demand, so `media/YYYY-MM/` is
            // handled automatically.
            const service = workspaceServiceRef?.current;
            if (!service) return;
            if (await service.exists(path)) return;
            await service.writeFileBinary(path, bytes);
            onFileTreeChange?.();
          }}
          hasWorkspace={() => Boolean(workspaceServiceRef?.current)}
          // BUG-012 — wire the inline "Ask AI" edit to the SAME resolved
          // provider the redline + trust bar use. Without this getAiProvider
          // the hook's getProvider() was null and the inline edit silently
          // no-opped for every user. Local-only mode uses the detected Ollama
          // model so nothing leaves the machine.
          getAiProvider={() =>
            resolveInlineEditProvider({
              provider: redlineProvider,
              apiKeys,
              ...(redlineLocalOnly && redlineOllamaModel
                ? { model: redlineOllamaModel }
                : {}),
            })
          }
        />
      );
    };

    // Check if this is a markdown or text file for toolbar display
    const ext = getFileExtension(tab.path);
    const isMarkdown = ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext;

    // A5: derive the file type for the context-sensitive toolbar.
    const toolbarFileType: ToolbarFileType = (() => {
      const e = ext?.toLowerCase();
      if (e === 'md' || e === 'markdown') return 'md';
      if (e === 'txt') return 'txt';
      if (e === 'docx') return 'docx';
      return 'other';
    })();

    return (
      <div className="h-full flex flex-col min-w-0">
        {/* Secondary pane header with file selector and close button */}
        {isSecondary && (
          <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/50">
            <span className="text-xs text-muted-foreground mr-2">Split View:</span>
            <select
              value={secondaryTabPath ?? ''}
              onChange={(e) => setSecondaryTab(e.target.value || null)}
              className="text-sm bg-transparent border-none outline-none flex-1 min-w-0"
            >
              {openTabs.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 ml-2 text-xs flex items-center gap-1"
              onClick={handleCloseSplit}
              title={withShortcut('Close split view', ['Ctrl', '\\'])}
            >
              <X className="h-3 w-3" />
              Close
            </Button>
          </div>
        )}
        {/* Formatting toolbar for markdown and text files (.md, .markdown, .txt) */}
        {/* A5: fileType prop makes the toolbar context-sensitive to the extension */}
        {/* Skip toolbar for grid view and other special views */}
        {isText && isMarkdown && tab.path !== '__grid_view__' && (
          <FormattingToolbar
            editorRef={editorRef}
            isPreviewMode={isPreviewMode && !isSecondary}
            onTogglePreview={!isSecondary ? () => setIsPreviewMode(prev => !prev) : undefined}
            fileContent={tab.content}
            fileName={tab.name}
            fileType={toolbarFileType}
            onDraftFollowUp={() => {
              setFollowUpFor({
                name: tab.name,
                content: tab.content,
                matterId: resolveMatterIdForWorkspacePath(tab.path, rootPath),
              });
            }}
          />
        )}
        {/* File title display with the same colored file-type icon shown
            in the file tree + tab bar, so the active file's identity is
            consistent across every surface. */}
        {tab.path !== '__grid_view__' && toolbarFileType !== 'docx' && (() => {
          const ext = tab.name.split('.').pop()?.toLowerCase();
          const { Icon, color } = getFileIcon(ext);
          const isEditing = titleEditingPath === tab.path;
          return (
            <div className="px-3 py-2 border-b bg-muted/20 flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color} flex-shrink-0`} />
              {isEditing ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleEditingName}
                  onChange={(e) => setTitleEditingName(e.target.value)}
                  onBlur={() => void submitTitleRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void submitTitleRename();
                    } else if (e.key === 'Escape') {
                      setTitleEditingPath(null);
                      setTitleEditingName('');
                    }
                  }}
                  className="text-sm font-medium bg-background border rounded px-1 py-0 min-w-0 max-w-[280px]"
                  size={Math.max(titleEditingName.length + 1, 8)}
                />
              ) : (
                <h2 className="text-sm font-medium text-foreground/80 truncate min-w-0">
                  {tab.name}
                </h2>
              )}
              {!isEditing && (
                <button
                  type="button"
                  className="h-6 w-6 p-0 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                  title="Rename file"
                  aria-label={`Rename ${tab.name}`}
                  onClick={() => startTitleRename(tab.path, tab.name)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })()}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    );
  };

  const showRightPanel = showOutline || showVersionHistory;

  const handleRestoreVersion = useCallback(
    (content: string) => {
      if (activeTabPath) {
        updateContent(activeTabPath, content);
        // Save the restoration as a new version
        void versionService.saveVersion(activeTabPath, content, 'Restored from version history');
      }
    },
    [activeTabPath, updateContent, versionService]
  );

  // WS-A / A5: after DocxEditor saves a `.docx` to disk via the engine, take a
  // binary-safe version snapshot into the workspace `.versions/` area. The
  // editor owns its own save (the tab never goes dirty), so this is the only
  // snapshot hook for `.docx`.
  const handleDocxAfterSave = useCallback(
    async ({ filePath, author }: { filePath: string; author: 'user' | 'ai' }) => {
      const vs = getBinaryVersionService(workspaceServiceRef?.current ?? null);
      if (!vs) return;
      try {
        await vs.saveVersion(filePath, {
          author,
          message: author === 'ai' ? 'AI redline' : 'Auto-saved version',
        });
      } catch (err) {
        console.warn('[MainPanel] docx version snapshot failed for', filePath, err);
      }
    },
    [workspaceServiceRef]
  );

  // WS-A / A5: after a `.docx` version is restored on disk, remount the editor
  // so it re-opens the (now restored) file via the engine.
  const handleDocxRestored = useCallback(() => {
    setDocxReloadNonce((n) => n + 1);
    onFileTreeChange?.();
  }, [onFileTreeChange]);

  // UX-13: export handlers live at render-top so both the inline toolbar
  // button and the overflow menu can share them.
  const exportAsDocx = useCallback(async () => {
    if (!activeTab) return;
    try {
      const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
      const bytes = await markdownToDocxBytes(activeTab.content, activeTab.name);
      const suggestedName = activeTab.name.replace(/\.(md|markdown|txt)$/i, '') + '.docx';
      await saveFile(bytes, {
        suggestedName,
        types: [
          {
            description: 'Word Documents',
            accept: {
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            },
          },
        ],
      });
    } catch (error) {
      console.error('Failed to export to .docx:', error);
    }
  }, [activeTab]);

  const exportAsPptx = useCallback(async () => {
    if (!activeTab) return;
    try {
      const { markdownToPptxBytes } = await import('@/platform/utils/pptx-io');
      const bytes = await markdownToPptxBytes(activeTab.content);
      const suggestedName = activeTab.name.replace(/\.(md|markdown|txt)$/i, '') + '.pptx';
      await saveFile(bytes, {
        suggestedName,
        types: [
          {
            description: 'PowerPoint Presentations',
            accept: {
              'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
            },
          },
        ],
      });
    } catch (error) {
      console.error('Failed to export to .pptx:', error);
    }
  }, [activeTab]);

  const ext = activeTab ? getFileExtension(activeTab.path)?.toLowerCase() : undefined;
  const activeIsDocx = ext === 'docx';
  const showMainPanelToolbar = !activeIsDocx || !hideTabBar;
  const isMarkdownLike = !!activeTab && (ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext);
  const isVersionable = !!activeTab && shouldVersionFile(getFileExtension(activeTab.path));
  const canSplit = !!activeTab && !isSplit;

  return (
    <div data-testid="main-panel" className="flex-1 min-w-0 flex flex-col h-full">
      {/* Tab bar with split controls */}
      {/* F-509: `min-w-0` is load-bearing. Without it this `flex-1` panel keeps
          its flexbox-default `min-width: auto` (= min-content), so a wide tab
          (e.g. a workflow execution run) refuses to shrink and overflows the
          parent `overflow-hidden` row. The browser then scrolls that row to
          reveal the focused element, sliding the fixed-width sidebar off the
          left edge — which read as "the workflow tab hides the sidebar".
          `min-w-0` lets the panel shrink to the available width instead, so
          the sidebar keeps its place. (Closing the tab used to "restore" the
          layout precisely because it removed the overflow source.) */}
      {showMainPanelToolbar && (
      <div
        ref={toolbarContainerRef}
        data-testid="main-panel-toolbar"
        data-compact={isToolbarCompact ? 'true' : 'false'}
        className="flex items-center border-b min-w-0 w-full"
      >
        {!hideTabBar ? (
          <div className="flex-1 min-w-0 w-0 overflow-hidden">
            <TabBar {...(onRename ? { onRenameFile: onRename } : {})} />
          </div>
        ) : (
          <div className="flex-1 min-w-0" />
        )}
        {!activeIsDocx && (
        <div className={cn('flex items-center gap-1 px-2', !hideTabBar && 'border-l')}>
          {/*
            UX-17: reactive auto-save indicator. Shows "Saved · Ns ago"
            when clean, "Unsaved changes" when dirty, and updates every
            second via the indicator's own setInterval. Kept compact so it
            reads as a quiet status dot rather than a prose label.
          */}
          <AutoSaveIndicator
            isDirty={!!activeTab?.isDirty}
            {...(activeTab?.lastSaved !== undefined
              ? { lastSavedAt: activeTab.lastSaved }
              : {})}
          />

          {/* Export — primary action for markdown files, always inline. */}
          {isMarkdownLike && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid="workflow-export-menu"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  title="Export to other formats"
                >
                  <FileType className="h-3.5 w-3.5 mr-1" />
                  Export
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  data-testid="workflow-export-docx"
                  onClick={exportAsDocx}
                >
                  <FileType className="h-3.5 w-3.5 mr-2 text-blue-600" />
                  {t('layout.main-panel.export.save-as-docx')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="workflow-export-pptx"
                  onClick={exportAsPptx}
                >
                  <FileType className="h-3.5 w-3.5 mr-2 text-orange-600" />
                  {t('layout.main-panel.export.save-as-pptx')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}


          {/*
            UNIFIED OVERFLOW — single "…" button holds secondary controls
            (Download, History, Split, Outline, Backlinks) in both wide and
            compact modes. Keeps the header strip calm at a glance while
            keeping every action reachable.
          */}
          {activeTab && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid="toolbar-overflow"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title="More actions"
                  aria-label="More actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                data-testid="toolbar-overflow-menu"
                align="end"
                className="w-52"
              >
                {/* Download — inside overflow since FormattingToolbar Export covers markdown */}
                <DropdownMenuItem
                  data-testid="toolbar-download"
                  onClick={() => onDownload?.(activeTab.path, activeTab.name)}
                >
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Download
                </DropdownMenuItem>

                {isVersionable && (
                  <DropdownMenuItem
                    data-testid="toolbar-history"
                    onClick={() => setShowVersionHistory(!showVersionHistory)}
                  >
                    <History className="h-3.5 w-3.5 mr-2" />
                    History ({versionService.getVersionCount(activeTab.path)})
                  </DropdownMenuItem>
                )}

                {canSplit && (
                  <>
                    <DropdownMenuItem
                      data-testid="toolbar-overflow-split-h"
                      onClick={handleSplitHorizontal}
                    >
                      <Columns className="h-3.5 w-3.5 mr-2" />
                      Split horizontally
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="toolbar-overflow-split-v"
                      onClick={handleSplitVertical}
                    >
                      <Rows className="h-3.5 w-3.5 mr-2" />
                      Split vertically
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuItem
                  data-testid="toolbar-overflow-outline"
                  onClick={toggleOutline}
                >
                  <List className="h-3.5 w-3.5 mr-2" />
                  Toggle outline
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        )}
      </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 overflow-hidden">
          {isSplit && secondaryTab ? (
            <SplitPane
              direction={splitDirection}
              onClose={(paneIndex) => {
                if (paneIndex === 1) {
                  handleCloseSplit();
                }
              }}
            >
              {renderEditorPane(activeTab, handleContentChange)}
              {renderEditorPane(secondaryTab, handleSecondaryContentChange, true)}
            </SplitPane>
          ) : (
            renderEditorPane(activeTab, handleContentChange)
          )}
        </div>

        {/* Right panel (outline/backlinks) */}
        {showRightPanel && (
          <div className="w-64 border-l bg-muted/20 flex flex-col">
            <div className="flex items-center justify-between px-2 py-1 border-b">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {showOutline ? 'Outline' : 'Version History'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => {
                  if (showOutline) toggleOutline();
                  if (showVersionHistory) setShowVersionHistory(false);
                }}
                title="Close panel"
                aria-label="Close panel"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              {showOutline && activeTab && (
                <OutlinePanel
                  content={activeTab.content}
                  onHeadingClick={handleHeadingClick}
                />
              )}
              {showVersionHistory && activeTab && (
                isDiskVersioned(activeTab.path) ? (
                  <BinaryVersionHistoryPanel
                    filePath={activeTab.path}
                    fileName={activeTab.name}
                    fs={workspaceServiceRef?.current ?? null}
                    onRestored={handleDocxRestored}
                    onClose={() => setShowVersionHistory(false)}
                    className="h-full"
                  />
                ) : (
                  <VersionHistoryPanel
                    filePath={activeTab.path}
                    fileName={activeTab.name}
                    currentContent={activeTab.content}
                    onRestore={handleRestoreVersion}
                    onClose={() => setShowVersionHistory(false)}
                    className="h-full"
                  />
                )
              )}
            </div>
            {/* Panel tabs at bottom */}
            {(showOutline || showVersionHistory) && (
              <div className="flex border-t">
                <button
                  onClick={() => {
                    if (!showOutline) {
                      if (showVersionHistory) setShowVersionHistory(false);
                      toggleOutline();
                    }
                  }}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-medium transition-colors',
                    showOutline
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <List className="h-3 w-3 inline mr-1" />
                  Outline
                </button>
                {activeTab && shouldVersionFile(getFileExtension(activeTab.path)) && (
                  <button
                    onClick={() => {
                      if (!showVersionHistory) {
                        if (showOutline) toggleOutline();
                        setShowVersionHistory(true);
                      }
                    }}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium transition-colors border-l',
                      showVersionHistory
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <History className="h-3 w-3 inline mr-1" />
                    History
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {followUpFor != null && (
        <DraftFollowUpModal
          open
          onOpenChange={(o) => {
            if (!o) setFollowUpFor(null);
          }}
          noteName={followUpFor.name}
          noteContent={followUpFor.content}
          matterId={followUpFor.matterId}
        />
      )}
    </div>
  );
}

export default MainPanel;
