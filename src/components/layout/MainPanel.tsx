// Main Panel Component
// Contains the editor area with tabs, split panes, and side panels

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  ApiKeySetupCard,
  hasDismissedApiKeyCard,
  markApiKeyCardDismissed,
} from '@/components/onboarding/ApiKeySetupCard';
import { TabBar } from '@/components/editor/TabBar';
import { AutoSaveIndicator } from '@/components/editor/AutoSaveIndicator';
import { getFileIcon } from '@/utils/fileIcons';
import { MarkdownEditor, type MarkdownEditorRef } from '@/components/editor/MarkdownEditor';
import { MarkdownPreview } from '@/components/editor/MarkdownPreview';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { FormattingToolbar } from '@/components/editor/FormattingToolbar';
import { PluginToolbarButtons } from '@/components/plugins/PluginToolbarButtons';
import { SplitPane, SplitPaneControls } from '@/components/editor/SplitPane';
import { OutlinePanel } from '@/components/editor/OutlinePanel';
import { BacklinksPanel } from '@/components/editor/BacklinksPanel';
import { ImageViewer, VideoViewer, isImageFile, isVideoFile } from '@/components/media/MediaViewer';
import { PDFViewer, isPDFFile, isSpreadsheetFile, isPresentationFile, isWordFile } from '@/components/media/PDFViewer';

// Heavy doc libraries (xlsx ~500KB, docx-preview ~300KB, mammoth ~200KB,
// docx ~500KB) are lazy-loaded so markdown-only users don't download them up
// front. DocxViewer is still exported for read-only contexts but MainPanel
// uses DocxEditor (which also wraps viewer fallbacks) whenever the user can
// edit the file.
const SpreadsheetViewer = lazy(() =>
  import('@/components/media/SpreadsheetViewer').then((m) => ({ default: m.SpreadsheetViewer }))
);
const DocxEditor = lazy(() =>
  import('@/components/media/DocxEditor').then((m) => ({ default: m.DocxEditor }))
);
const PresentationViewer = lazy(() =>
  import('@/components/media/PresentationViewer').then((m) => ({
    default: m.PresentationViewer,
  }))
);
const RtfEditor = lazy(() =>
  import('@/components/media/RtfEditor').then((m) => ({ default: m.RtfEditor }))
);
import { Whiteboard } from '@/components/whiteboard/Whiteboard';
import { SourceFileEditor } from '@/components/research/SourceFileEditor';
import { AIChatViewer } from '@/components/ai/AIChatViewer';
import { FileGridView } from '@/components/workspace/FileGridView';
import { WaveformEditor } from '@/components/audio/WaveformEditor';
import { VersionHistoryPanel } from '@/components/version/VersionHistoryPanel';
import { BinaryVersionHistoryPanel } from '@/components/version/BinaryVersionHistoryPanel';
import { BrowserPanel } from '@/components/workflow/BrowserPanel';
import { WorkflowExecutionTab } from '@/components/workflow/WorkflowExecutionTab';
import { EmailViewer } from '@/components/mail/EmailViewer';
import { MatterNotesEditorWrapper } from '@/components/matter/MatterNotesEditorWrapper';
import {
  fileDataToExecution,
  isWorkflowFilePath,
  parseWorkflowFile,
} from '@/modules/workflow/workflowFile';
import { getVersionService } from '@/modules/versioning/VersionService';
import { getBinaryVersionService } from '@/modules/versioning';
import { useEditorStore } from '@/stores/editorStore';
import {
  useFileBackupStore,
  computeBackupPath,
  formatBackupTimestamp,
} from '@/stores/fileBackupStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileText, List, Link2, PanelRightClose, FileType, X, History, Download, ChevronDown, Loader2, MoreHorizontal, Columns, Rows, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/utils/saveFile';
import { markdownToDocxBytes } from '@/utils/docx-io';
import { markdownToPptxBytes } from '@/utils/pptx-io';
import { detectLibreOffice, convertDocToDocx } from '@/utils/tauri-commands';
import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';
import { withShortcut } from '@/utils/shortcuts';
import { useConfidentialityMode } from '@/hooks/useConfidentialityMode';
import { modeRestrictsToLocal } from '@/modules/privacy/egress';
import { detectOllama } from '@/modules/models/OllamaProvider';

/**
 * Check if a file is a whiteboard file
 */
function isWhiteboardFile(extension: string | undefined): boolean {
  if (!extension) return false;
  return extension.toLowerCase() === 'whiteboard';
}

/**
 * Check if a file is an audio file
 */
function isAudioFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const ext = extension.toLowerCase();
  return ext === 'webm' || ext === 'wav' || ext === 'mp3' || ext === 'ogg' || ext === 'm4a';
}

/**
 * Get file extension from a path
 */
function getFileExtension(path: string): string | undefined {
  const parts = path.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

/**
 * Check if a file type should have version history
 */
function shouldVersionFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const ext = extension.toLowerCase();
  // Version text-based editable files + the canonical `.docx` document format
  // (WS-A / A5 — binary-safe, on-disk snapshots for `.docx`).
  return ext === 'md' || ext === 'txt' || ext === 'json' || ext === 'source' || ext === 'aichat' || ext === 'whiteboard' || ext === 'docx';
}

/** True when version history for this file lives on disk (binary-safe). */
function isDiskVersioned(path: string): boolean {
  return path.toLowerCase().endsWith('.docx');
}

/**
 * Download a file with save dialog (cross-platform: browser & Tauri)
 */
async function downloadFileWithDialog(content: string | Blob, filename: string, mimeType: string) {
  try {
    // Determine file types based on extension
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: any[] = [];

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      types.push({
        description: 'Spreadsheet Files',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          'application/vnd.ms-excel': ['.xls'],
          'text/csv': ['.csv'],
        },
      });
    } else if (ext === 'pptx' || ext === 'ppt') {
      types.push({
        description: 'Presentation Files',
        accept: {
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
          'application/vnd.ms-powerpoint': ['.ppt'],
        },
      });
    } else if (ext === 'docx' || ext === 'doc') {
      types.push({
        description: 'Word Documents',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/msword': ['.doc'],
        },
      });
    } else {
      types.push({
        description: 'All Files',
        accept: { [mimeType]: [`.${ext}`] },
      });
    }

    // Convert Blob to ArrayBuffer if needed
    let saveContent: string | ArrayBuffer;
    if (content instanceof Blob) {
      saveContent = await content.arrayBuffer();
    } else {
      saveContent = content;
    }

    // Use cross-platform saveFile utility
    await saveFile(saveContent, {
      suggestedName: filename,
      types,
    });
  } catch (error) {
    // User cancelled or error occurred
    if (error instanceof Error && error.name !== 'AbortError') {
      console.error('Failed to download file:', error);
    }
  }
}

import type {
  WorkflowTemplate,
  WorkflowExecution,
  InterviewQuestion,
} from '@/types/workflow';

interface APIKey {
  provider: string;
  key: string;
  isValid: boolean;
}

interface MainPanelProps {
  onFileOpen?: (path: string, name: string) => Promise<void>;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void>;
  onRename?: (path: string, newName: string) => Promise<void>;
  onDownload?: (path: string, name: string) => void;
  apiKeys?: APIKey[];
  workspaceServiceRef?: React.MutableRefObject<any>;
  rootPath?: string;
  onFileTreeChange?: () => void;
  onAuditLog?: (entry: Omit<import('@/types/audit').AuditEntry, 'id' | 'timestamp'>) => void;
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
  workflowProviderError?: 'needs-provider' | 'ollama-unreachable' | null;
  /** Called when the user clicks "Open AI Settings" in the provider-error UI. */
  onOpenSettings?: () => void;
  /**
   * Stream C3 — emits whenever the focused CodeMirror EditorView ref changes
   * (file open / close, tab switch, primary editor remount). The receiver
   * (App.tsx) routes this into the PluginManager's `setActiveEditor` so
   * plugins always see the editor the user is currently looking at.
   */
  onActiveEditorChange?: (
    ref: React.MutableRefObject<MarkdownEditorRef | null> | null,
  ) => void;
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
  onActiveEditorChange,
}: MainPanelProps = {}) {
  const { t } = useTranslation();
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
    showBacklinks,
    toggleOutline,
    toggleBacklinks,
  } = useEditorStore();

  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const secondaryTab = openTabs.find((t) => t.path === secondaryTabPath);

  // Editor refs for formatting toolbar
  const primaryEditorRef = useRef<MarkdownEditorRef>(null);
  const secondaryEditorRef = useRef<MarkdownEditorRef>(null);

  // Stream C3 — notify App.tsx whenever the active editor surface changes
  // so the PluginManager can re-point its editor accessor. Fires on tab
  // switches and when the editor mounts / unmounts (active path null = no
  // editor available). The ref itself is stable; what's changing is the
  // EditorView attached underneath, which `buildPluginEditorHandle` reads
  // lazily on every plugin call.
  useEffect(() => {
    if (!onActiveEditorChange) return;
    if (activeTabPath) {
      onActiveEditorChange(primaryEditorRef);
    } else {
      onActiveEditorChange(null);
    }
  }, [activeTabPath, onActiveEditorChange]);

  // Preview mode state - default to false due to WYSIWYG usability issues
  // (cursor placement broken, Enter creates hashtags instead of line breaks)
  const [isPreviewMode, setIsPreviewMode] = useState(false);

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
  // use. Outside Local-only the redline stays on the default cloud provider
  // (unchanged behaviour). This keeps redlining inside Local-only on-machine —
  // nothing leaves the device, matching the egress promise.
  const redlineLocalOnly = modeRestrictsToLocal(useConfidentialityMode());
  const [redlineOllamaModel, setRedlineOllamaModel] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!redlineLocalOnly) {
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
  }, [redlineLocalOnly]);

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
            versionService.saveVersion(activeTabPath, content, 'Auto-saved version');
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
            versionService.saveVersion(secondaryTabPath, content, 'Auto-saved version');
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

  const handleBacklinkClick = useCallback((path: string) => {
    // In a real implementation, this would open the file
    console.log('Open backlink:', path);
    // The actual file opening would be handled by App.tsx
  }, []);

  // Check if a file is a text file that can be edited
  const isTextFile = (extension: string | undefined): boolean => {
    if (!extension) return true; // No extension = likely text
    const nonTextExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar', 'gz', 'whiteboard', 'aichat'];
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
    const isWhiteboard = isWhiteboardFile(extension);
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
      // Keepance 3.0 email viewer tab — read-only view of one stored message.
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
              {...(onFileOpen ? { onFileOpen: (path: string, name: string) => { onFileOpen(path, name); } } : {})}
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
        let chatData: import('@/types/ai').AIChatFile;
        try {
          chatData = tab.content
            ? (JSON.parse(tab.content) as import('@/types/ai').AIChatFile)
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
          onFileOpen: (path: string, name: string) => Promise<void>;
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
              onContentChange(content);
            }}
            className="h-full"
          />
        );
      }
      // Check for .aichat files
      if (tab.path.endsWith('.aichat')) {
        try {
          const chatData = JSON.parse(tab.content) as import('@/types/ai').AIChatFile;
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
      if (isWhiteboard) {
        return (
          <Whiteboard
            initialData={tab.content}
            onSave={async (data) => {
              onContentChange(data);
            }}
            className="h-full"
          />
        );
      }
      if (isImage) {
        return <ImageViewer src={tab.content} alt={tab.name} />;
      }
      // Audio check runs BEFORE video — .webm and .ogg are containers
      // that can hold audio OR video, but in Keepance they're used for
      // audio recording. Route to WaveformEditor first so recorded audio
      // gets the waveform + edit tools, not a bare HTML5 video player.
      if (isAudio) {
        return (
          <WaveformEditor
            audioSrc={tab.content}
            filename={tab.name}
            className="h-full"
          />
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
          <Suspense fallback={<DocLoadingFallback fileName={tab.name} />}>
            <SpreadsheetViewer
              src={tab.content}
              fileName={tab.name}
              onContentChange={onContentChange}
              onFirstEdit={() => writeBackupIfNeeded(tab.path)}
            />
          </Suspense>
        );
      }
      if (isPresentation) {
        return (
          <Suspense fallback={<DocLoadingFallback fileName={tab.name} />}>
            <PresentationViewer
              src={tab.content}
              fileName={tab.name}
              filePath={tab.path}
            />
          </Suspense>
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
            <Suspense fallback={<DocLoadingFallback fileName={tab.name} />}>
              {/* WS-C honesty — in Local-only mode the redline runs on the
                  local model (Ollama) so nothing leaves the machine. */}
              <DocxEditor
                key={`docx-${tab.path}-${docxReloadNonce}`}
                filePath={tab.path}
                src={tab.content}
                fileName={tab.name}
                onFirstEdit={() => writeBackupIfNeeded(tab.path)}
                onAfterSave={handleDocxAfterSave}
                apiKeys={apiKeys}
                {...(redlineLocalOnly ? { aiProvider: 'ollama' as const } : {})}
                {...(redlineLocalOnly && redlineOllamaModel ? { aiModel: redlineOllamaModel } : {})}
                {...(onAuditLog ? { onAuditLog } : {})}
              />
            </Suspense>
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
      const isRtf = extension === 'rtf';
      const isInternalRichText = extension === 'rt';

      if (isPreviewMode && isMarkdown && !isSecondary) {
        return (
          <MarkdownPreview
            content={tab.content}
            className="h-full"
          />
        );
      }

      // `.rtf` goes through the dedicated RtfEditor (Phase 6) which parses
      // the RTF bytes and round-trips through TipTap. The legacy path that
      // routed `.rtf` here as though it were the internal `.rt` format
      // meant users saw raw RTF markup instead of a rendered document.
      if (isRtf) {
        return (
          <Suspense fallback={<DocLoadingFallback fileName={tab.name} />}>
            <RtfEditor
              src={tab.content}
              fileName={tab.name}
              onContentChange={onContentChange}
              onFirstEdit={() => writeBackupIfNeeded(tab.path)}
            />
          </Suspense>
        );
      }

      // Keepance's internal `.rt` format (HTML-serialized TipTap state).
      if (isInternalRichText) {
        return (
          <RichTextEditor
            initialContent={tab.content}
            onChange={onContentChange}
            className="h-full"
          />
        );
      }

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
        />
      );
    };

    // Check if this is a markdown or text file for toolbar display
    const ext = getFileExtension(tab.path);
    const isMarkdown = ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext;

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
        {/* .txt files now have full formatting options (bold, italic, headers, etc.) */}
        {/* Skip toolbar for grid view and other special views */}
        {isText && isMarkdown && tab.path !== '__grid_view__' && (
          <FormattingToolbar
            editorRef={editorRef}
            isPreviewMode={isPreviewMode && !isSecondary}
            onTogglePreview={!isSecondary ? () => setIsPreviewMode(prev => !prev) : undefined}
            fileContent={tab.content}
            fileName={tab.name}
          />
        )}
        {/* File title display with the same colored file-type icon shown
            in the file tree + tab bar, so the active file's identity is
            consistent across every surface. */}
        {tab.path !== '__grid_view__' && (() => {
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

  const showRightPanel = showOutline || showBacklinks || showVersionHistory;

  const handleRestoreVersion = useCallback(
    (content: string) => {
      if (activeTabPath) {
        updateContent(activeTabPath, content);
        // Save the restoration as a new version
        versionService.saveVersion(activeTabPath, content, 'Restored from version history');
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
      <div
        ref={toolbarContainerRef}
        data-testid="main-panel-toolbar"
        data-compact={isToolbarCompact ? 'true' : 'false'}
        className="flex items-center border-b min-w-0 w-full"
      >
        <div className="flex-1 min-w-0 w-0 overflow-hidden">
          <TabBar {...(onRename ? { onRenameFile: onRename } : {})} />
        </div>
        <div className="flex items-center gap-1 px-2 border-l">
          {/*
            UX-17: reactive auto-save indicator. Shows "Saved · Ns ago"
            when clean, "Unsaved changes" when dirty, and updates every
            second via the indicator's own setInterval. The saving and
            error states are reserved for future use when the auto-save
            subscription surfaces those states — for now we simply
            reflect dirty/clean.
          */}
          <AutoSaveIndicator
            isDirty={!!activeTab?.isDirty}
            {...(activeTab?.lastSaved !== undefined
              ? { lastSavedAt: activeTab.lastSaved }
              : {})}
          />

          {/* Download — always visible (critical action). */}
          {activeTab && (
            <Button
              data-testid="toolbar-download"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onDownload?.(activeTab.path, activeTab.name)}
              title="Download file"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Download
            </Button>
          )}

          {/*
            EXPANDED LAYOUT — everything inline when width allows.
            The export dropdown is its own menu (markdown only).
            History + Split + Outline + Backlinks spread inline.
          */}
          {!isToolbarCompact && (
            <>
              {isVersionable && (
                <Button
                  data-testid="toolbar-history"
                  variant="ghost"
                  size="sm"
                  className={cn('h-7 px-2 text-xs', showVersionHistory && 'bg-accent')}
                  onClick={() => setShowVersionHistory(!showVersionHistory)}
                  title="View version history"
                >
                  <History className="h-3.5 w-3.5 mr-1" />
                  History ({versionService.getVersionCount(activeTab!.path)})
                </Button>
              )}
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
              <SplitPaneControls
                onSplitHorizontal={canSplit ? handleSplitHorizontal : undefined}
                onSplitVertical={canSplit ? handleSplitVertical : undefined}
                canSplit={canSplit}
              />
              <Button
                data-testid="toolbar-outline"
                variant="ghost"
                size="sm"
                className={cn('h-7 w-7 p-0', showOutline && 'bg-accent')}
                onClick={toggleOutline}
                title={withShortcut('Toggle outline panel', ['Ctrl', 'Shift', 'O'])}
                aria-label={withShortcut('Toggle outline panel', ['Ctrl', 'Shift', 'O'])}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                data-testid="toolbar-backlinks"
                variant="ghost"
                size="sm"
                className={cn('h-7 w-7 p-0', showBacklinks && 'bg-accent')}
                onClick={toggleBacklinks}
                title={withShortcut('Toggle backlinks panel', ['Ctrl', 'Shift', 'B'])}
                aria-label={withShortcut('Toggle backlinks panel', ['Ctrl', 'Shift', 'B'])}
              >
                <Link2 className="h-4 w-4" />
              </Button>
            </>
          )}

          {/*
            PLUGIN TOOLBAR — buttons contributed by installed plugins. Renders
            nothing when there are no plugin contributions, so the layout for
            users without plugins is unchanged. Lives between the built-in
            expanded controls and the compact overflow so it always sits
            after the core editor actions.
          */}
          <PluginToolbarButtons />

          {/*
            COMPACT LAYOUT — single "…" button opens a DropdownMenu with
            History / Split / Outline / Backlinks / Export as sub-items.
            Only visible when the container width is below the breakpoint.
            Save and Download stay inline above.
          */}
          {isToolbarCompact && activeTab && (
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
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                data-testid="toolbar-overflow-menu"
                align="end"
                className="w-52"
              >
                {isVersionable && (
                  <DropdownMenuItem
                    data-testid="toolbar-overflow-history"
                    onClick={() => setShowVersionHistory(!showVersionHistory)}
                  >
                    <History className="h-3.5 w-3.5 mr-2" />
                    History ({versionService.getVersionCount(activeTab.path)})
                  </DropdownMenuItem>
                )}
                {isMarkdownLike && (
                  <>
                    <DropdownMenuItem
                      data-testid="toolbar-overflow-export-docx"
                      onClick={exportAsDocx}
                    >
                      <FileType className="h-3.5 w-3.5 mr-2 text-blue-600" />
                      {t('layout.main-panel.export.save-as-docx')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="toolbar-overflow-export-pptx"
                      onClick={exportAsPptx}
                    >
                      <FileType className="h-3.5 w-3.5 mr-2 text-orange-600" />
                      {t('layout.main-panel.export.save-as-pptx')}
                    </DropdownMenuItem>
                  </>
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
                <DropdownMenuItem
                  data-testid="toolbar-overflow-backlinks"
                  onClick={toggleBacklinks}
                >
                  <Link2 className="h-3.5 w-3.5 mr-2" />
                  Toggle backlinks
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

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
                {showOutline ? 'Outline' : showBacklinks ? 'Backlinks' : 'Version History'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => {
                  if (showOutline) toggleOutline();
                  if (showBacklinks) toggleBacklinks();
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
              {showBacklinks && activeTab && (
                <BacklinksPanel
                  backlinks={[]}
                  onNavigate={handleBacklinkClick}
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
            {(showOutline || showBacklinks || showVersionHistory) && (
              <div className="flex border-t">
                <button
                  onClick={() => {
                    if (!showOutline) {
                      if (showBacklinks) toggleBacklinks();
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
                <button
                  onClick={() => {
                    if (!showBacklinks) {
                      if (showOutline) toggleOutline();
                      if (showVersionHistory) setShowVersionHistory(false);
                      toggleBacklinks();
                    }
                  }}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-medium transition-colors border-l',
                    showBacklinks
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Link2 className="h-3 w-3 inline mr-1" />
                  Backlinks
                </button>
                {activeTab && shouldVersionFile(getFileExtension(activeTab.path)) && (
                  <button
                    onClick={() => {
                      if (!showVersionHistory) {
                        if (showOutline) toggleOutline();
                        if (showBacklinks) toggleBacklinks();
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
    </div>
  );
}

function DocLoadingFallback({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileType className="h-10 w-10 animate-pulse opacity-50" />
      <p className="text-sm">{t('layout.main-panel.opening-file', { fileName })}</p>
    </div>
  );
}

interface DocLegacyFallbackProps {
  tabName: string;
  tabPath: string;
  tabContent: string;
  onFileOpen?: ((path: string, name: string) => Promise<void>) | undefined;
}

/**
 * Fallback UI for legacy `.doc` (pre-2007 binary Word) files.
 *
 * Three branches:
 *   1. Browser (not Tauri): show the plain fallback + a Download button. No
 *      conversion is possible because LibreOffice subprocess calls need the
 *      native host.
 *   2. Tauri + LibreOffice detected: show a primary "Convert to .docx" button.
 *      On click, invoke the Rust command, then open the new .docx tab and
 *      close the current .doc tab (the editor store's openFile handles that
 *      naturally via onFileOpen + user closing the old tab).
 *   3. Tauri + LibreOffice NOT detected: show install instructions pointing
 *      at libreoffice.org, plus the Download button so users can take the
 *      file elsewhere.
 *
 * Detection is cached per-mount in local state. Re-detecting on every remount
 * is cheap (single `which` call) and avoids stale "not installed" results if
 * the user installs LibreOffice while the app is running.
 */
function DocLegacyFallback({
  tabName,
  tabPath,
  tabContent,
  onFileOpen,
}: DocLegacyFallbackProps) {
  const { t } = useTranslation();
  // Detection state: undefined = still checking, null = not found,
  // string = soffice path.
  const [libreOfficePath, setLibreOfficePath] = useState<string | null | undefined>(
    undefined
  );
  const [conversionState, setConversionState] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [conversionError, setConversionError] = useState<string | null>(null);

  const inTauri = isTauriEnvironment();

  useEffect(() => {
    let cancelled = false;
    // In the browser, don't even try — detectLibreOffice() already
    // short-circuits to null, but this skips the promise entirely.
    if (!inTauri) {
      setLibreOfficePath(null);
      return;
    }
    detectLibreOffice()
      .then((path) => {
        if (!cancelled) setLibreOfficePath(path);
      })
      .catch(() => {
        if (!cancelled) setLibreOfficePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inTauri]);

  const handleConvert = useCallback(async () => {
    setConversionState('loading');
    setConversionError(null);
    try {
      const outputPath = await convertDocToDocx(tabPath);
      // Derive a friendly display name from the path.
      const parts = outputPath.split(/[\\/]/);
      const newName = parts[parts.length - 1] || `${tabName}.docx`;
      // Open the new .docx in a new tab. The old .doc tab stays open (user
      // can close it manually); we don't force-close in case they want the
      // original for reference.
      if (onFileOpen) {
        await onFileOpen(outputPath, newName);
      }
      setConversionState('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConversionError(message);
      setConversionState('error');
    }
  }, [tabPath, tabName, onFileOpen]);

  const handleDownload = useCallback(async () => {
    try {
      const response = await fetch(tabContent);
      const blob = await response.blob();
      await downloadFileWithDialog(blob, tabName, blob.type || 'application/msword');
    } catch (err) {
      console.error('[DocLegacyFallback] Download failed:', err);
    }
  }, [tabContent, tabName]);

  // State 1: browser — no conversion possible.
  if (!inTauri) {
    return (
      <div
        data-testid="doc-legacy-fallback"
        className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
      >
        <FileType className="h-16 w-16 mb-4 opacity-50" />
        <p className="text-lg font-medium">{tabName}</p>
        <p className="mt-2 text-sm max-w-md">
          <Trans
            i18nKey="layout.main-panel.doc-legacy.browser-message"
            components={{ docCode: <code />, docxCode: <code /> }}
          />
        </p>
        <Button variant="outline" className="mt-4" onClick={handleDownload}>
          {t('layout.main-panel.doc-legacy.download-button')}
        </Button>
      </div>
    );
  }

  // Still detecting — avoid flashing the wrong branch.
  if (libreOfficePath === undefined) {
    return (
      <div
        data-testid="doc-legacy-fallback"
        className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
      >
        <Loader2
          data-testid="doc-convert-loading"
          className="h-10 w-10 mb-3 animate-spin opacity-70"
        />
        <p className="text-sm">{t('layout.main-panel.doc-legacy.checking-libreoffice')}</p>
      </div>
    );
  }

  // State 3: Tauri but LibreOffice not installed.
  if (libreOfficePath === null) {
    return (
      <div
        data-testid="doc-legacy-fallback"
        className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
      >
        <FileType className="h-16 w-16 mb-4 opacity-50" />
        <p className="text-lg font-medium">{tabName}</p>
        <p
          data-testid="doc-convert-install-libreoffice"
          className="mt-2 text-sm max-w-md"
        >
          <Trans
            i18nKey="layout.main-panel.doc-legacy.install-libreoffice"
            components={{
              docCode: <code />,
              libreLink: (
                <a
                  href="https://libreoffice.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                />
              ),
            }}
          />
        </p>
        <Button variant="outline" className="mt-4" onClick={handleDownload}>
          {t('layout.main-panel.doc-legacy.download-button')}
        </Button>
      </div>
    );
  }

  // State 2: Tauri + LibreOffice detected. Show Convert as primary action.
  // During loading, keep the container and swap the content to a spinner.
  return (
    <div
      data-testid="doc-legacy-fallback"
      className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
    >
      <FileType className="h-16 w-16 mb-4 opacity-50" />
      <p className="text-lg font-medium">{tabName}</p>
      <p className="mt-2 text-sm max-w-md">
        <Trans
          i18nKey="layout.main-panel.doc-legacy.convert-prompt"
          components={{ docCode: <code />, docxCode: <code /> }}
        />
      </p>
      {conversionState === 'loading' ? (
        <div
          data-testid="doc-convert-loading"
          className="mt-4 flex items-center gap-2 text-sm"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('layout.main-panel.doc-legacy.converting')}</span>
        </div>
      ) : conversionState === 'error' ? (
        <div
          data-testid="doc-convert-error"
          className="mt-4 flex flex-col items-center gap-2 max-w-md"
        >
          <p className="text-sm text-destructive">
            {t('layout.main-panel.doc-legacy.conversion-failed', { error: conversionError })}
          </p>
          <div className="flex gap-2">
            <Button onClick={handleConvert} data-testid="doc-convert-button">
              {t('layout.main-panel.doc-legacy.try-again')}
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              {t('layout.main-panel.doc-legacy.download-button')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <Button onClick={handleConvert} data-testid="doc-convert-button">
            {t('layout.main-panel.doc-legacy.convert-button')}
          </Button>
          <Button variant="outline" onClick={handleDownload}>
            {t('layout.main-panel.doc-legacy.download-button')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default MainPanel;
