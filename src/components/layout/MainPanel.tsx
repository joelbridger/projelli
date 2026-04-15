// Main Panel Component
// Contains the editor area with tabs, split panes, and side panels

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { TabBar } from '@/components/editor/TabBar';
import { MarkdownEditor, type MarkdownEditorRef } from '@/components/editor/MarkdownEditor';
import { MarkdownPreview } from '@/components/editor/MarkdownPreview';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { FormattingToolbar } from '@/components/editor/FormattingToolbar';
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
import { BrowserPanel } from '@/components/workflow/BrowserPanel';
import { getVersionService } from '@/modules/versioning/VersionService';
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
import { FileText, List, Link2, PanelRightClose, FileType, X, Save, History, Download, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/utils/saveFile';
import { markdownToDocxBytes } from '@/utils/docx-io';
import { markdownToPptxBytes } from '@/utils/pptx-io';
import { detectLibreOffice, convertDocToDocx } from '@/utils/tauri-commands';
import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';

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
  // Version text-based editable files
  return ext === 'md' || ext === 'txt' || ext === 'json' || ext === 'source' || ext === 'aichat' || ext === 'whiteboard';
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
}

export function MainPanel({ onFileOpen, onMove, onRename, onDownload, apiKeys = [], workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog }: MainPanelProps = {}) {
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

  // Preview mode state - default to false due to WYSIWYG usability issues
  // (cursor placement broken, Enter creates hashtags instead of line breaks)
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Version history state
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const versionService = getVersionService();

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
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full">
          <FileText className="h-16 w-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">No file open</p>
          <p className="text-sm">Select a file from the sidebar to start editing</p>
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
              className="h-full"
            />
          );
        } catch (error) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Failed to load chat file: {error instanceof Error ? error.message : 'Unknown error'}</p>
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
      // that can hold audio OR video, but in Projelli they're used for
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
        // `.docx` gets the new in-app preview. `.doc` (legacy binary format)
        // can't be parsed reliably in-browser, so we keep the friendly
        // fallback. Full `.doc` support comes in a later phase via a Tauri
        // LibreOffice subprocess fallback.
        if (extension?.toLowerCase() === 'docx') {
          return (
            <Suspense fallback={<DocLoadingFallback fileName={tab.name} />}>
              <DocxEditor
                src={tab.content}
                fileName={tab.name}
                onContentChange={onContentChange}
                onFirstEdit={() => writeBackupIfNeeded(tab.path)}
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

      // Projelli's internal `.rt` format (HTML-serialized TipTap state).
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
        />
      );
    };

    // Check if this is a markdown or text file for toolbar display
    const ext = getFileExtension(tab.path);
    const isMarkdown = ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext;

    return (
      <div className="h-full flex flex-col">
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
              title="Close split view"
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
        {/* File title display - useful when accessing files via tab groups */}
        {tab.path !== '__grid_view__' && (
          <div className="px-3 py-2 border-b bg-muted/20">
            <h2 className="text-sm font-medium text-foreground/80 truncate">
              {tab.name}
            </h2>
          </div>
        )}
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

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Tab bar with split controls */}
      <div className="flex items-center border-b min-w-0 w-full">
        <div className="flex-1 min-w-0 w-0 overflow-hidden">
          <TabBar {...(onRename ? { onRenameFile: onRename } : {})} />
        </div>
        <div className="flex items-center gap-1 px-2 border-l">
          {/* Auto-save indicator */}
          <span className="text-xs text-muted-foreground flex items-center gap-1 mr-2">
            <Save className="h-3 w-3" />
            Auto-save
          </span>
          {/* Version History button - only show for versionable files */}
          {activeTab && shouldVersionFile(getFileExtension(activeTab.path)) && (
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 text-xs', showVersionHistory && 'bg-accent')}
              onClick={() => setShowVersionHistory(!showVersionHistory)}
              title="View version history"
            >
              <History className="h-3.5 w-3.5 mr-1" />
              History ({versionService.getVersionCount(activeTab.path)})
            </Button>
          )}
          {/*
            "Export as" dropdown for markdown files. This is the surfacing
            point for workflow-generated artifacts: the 15 founder workflow
            templates emit `.md` files, and this menu lets users convert
            them to `.docx` (for text-heavy outputs like Investor Update)
            in one click. The menu is visible for any markdown file, not
            just workflow artifacts, since there's no meaningful difference
            between the two on disk.
          */}
          {activeTab && (() => {
            const ext = getFileExtension(activeTab.path)?.toLowerCase();
            const isMarkdownLike = ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext;
            if (!isMarkdownLike) return null;

            const exportAsDocx = async () => {
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
            };

            const exportAsPptx = async () => {
              try {
                const bytes = await markdownToPptxBytes(activeTab.content);
                const suggestedName =
                  activeTab.name.replace(/\.(md|markdown|txt)$/i, '') + '.pptx';
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
                console.error('Failed to export to .pptx:', error);
              }
            };

            return (
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
                    Save as Word (.docx)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="workflow-export-pptx"
                    onClick={exportAsPptx}
                  >
                    <FileType className="h-3.5 w-3.5 mr-2 text-orange-600" />
                    Save as PowerPoint (.pptx)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })()}
          {activeTab && (
            <Button
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
          <SplitPaneControls
            onSplitHorizontal={!isSplit ? handleSplitHorizontal : undefined}
            onSplitVertical={!isSplit ? handleSplitVertical : undefined}
            canSplit={!!activeTab && !isSplit}
          />
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 w-7 p-0', showOutline && 'bg-accent')}
            onClick={toggleOutline}
            title="Toggle outline panel (Ctrl+Shift+O)"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 w-7 p-0', showBacklinks && 'bg-accent')}
            onClick={toggleBacklinks}
            title="Toggle backlinks panel (Ctrl+Shift+B)"
          >
            <Link2 className="h-4 w-4" />
          </Button>
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
                <VersionHistoryPanel
                  filePath={activeTab.path}
                  fileName={activeTab.name}
                  currentContent={activeTab.content}
                  onRestore={handleRestoreVersion}
                  onClose={() => setShowVersionHistory(false)}
                  className="h-full"
                />
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
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileType className="h-10 w-10 animate-pulse opacity-50" />
      <p className="text-sm">Opening {fileName}...</p>
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
          This is the older <code>.doc</code> format. Open it in Word and save
          as <code>.docx</code> to preview it here.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleDownload}>
          Download File
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
        <p className="text-sm">Checking for LibreOffice…</p>
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
          <code>.doc</code> (legacy Word format) files need LibreOffice or
          Microsoft Word to preview. Install LibreOffice for free at{' '}
          <a
            href="https://libreoffice.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            libreoffice.org
          </a>
          , then reopen this file.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleDownload}>
          Download File
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
        Preview this legacy <code>.doc</code> file? We'll convert it to{' '}
        <code>.docx</code> using LibreOffice and save a copy next to the
        original.
      </p>
      {conversionState === 'loading' ? (
        <div
          data-testid="doc-convert-loading"
          className="mt-4 flex items-center gap-2 text-sm"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Converting to .docx…</span>
        </div>
      ) : conversionState === 'error' ? (
        <div
          data-testid="doc-convert-error"
          className="mt-4 flex flex-col items-center gap-2 max-w-md"
        >
          <p className="text-sm text-destructive">
            Conversion failed: {conversionError}
          </p>
          <div className="flex gap-2">
            <Button onClick={handleConvert} data-testid="doc-convert-button">
              Try again
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              Download File
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <Button onClick={handleConvert} data-testid="doc-convert-button">
            Convert to .docx
          </Button>
          <Button variant="outline" onClick={handleDownload}>
            Download File
          </Button>
        </div>
      )}
    </div>
  );
}

export default MainPanel;
