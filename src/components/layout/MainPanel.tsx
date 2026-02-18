// Main Panel Component
// Contains the editor area with tabs, split panes, and side panels

import { useCallback, useRef, useState } from 'react';
import { TabBar } from '@/components/editor/TabBar';
import { MarkdownEditor, type MarkdownEditorRef } from '@/components/editor/MarkdownEditor';
import { MarkdownPreview } from '@/components/editor/MarkdownPreview';
import { PlainTextEditor } from '@/components/editor/PlainTextEditor';
import { FormattingToolbar } from '@/components/editor/FormattingToolbar';
import { SplitPane, SplitPaneControls } from '@/components/editor/SplitPane';
import { OutlinePanel } from '@/components/editor/OutlinePanel';
import { BacklinksPanel } from '@/components/editor/BacklinksPanel';
import { ImageViewer, VideoViewer, isImageFile, isVideoFile } from '@/components/media/MediaViewer';
import { PDFViewer, isPDFFile, isSpreadsheetFile, isPresentationFile, isWordFile } from '@/components/media/PDFViewer';
import { Whiteboard } from '@/components/whiteboard/Whiteboard';
import { SourceFileEditor } from '@/components/research/SourceFileEditor';
import { AIChatViewer } from '@/components/ai/AIChatViewer';
import { FileGridView } from '@/components/workspace/FileGridView';
import { WaveformEditor } from '@/components/audio/WaveformEditor';
import { VersionHistoryPanel } from '@/components/version/VersionHistoryPanel';
import { BrowserPanel } from '@/components/workflow/BrowserPanel';
import { getVersionService } from '@/modules/versioning/VersionService';
import { useEditorStore } from '@/stores/editorStore';
import { Button } from '@/components/ui/button';
import { FileText, List, Link2, PanelRightClose, FileSpreadsheet, FileType, Presentation, X, Save, History, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/utils/saveFile';

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
      if (isVideo) {
        return <VideoViewer src={tab.content} />;
      }
      if (isAudio) {
        return (
          <WaveformEditor
            audioSrc={tab.content}
            filename={tab.name}
            className="h-full"
          />
        );
      }
      if (isPDF) {
        return <PDFViewer src={tab.content} fileName={tab.name} />;
      }
      if (isSpreadsheet) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full">
            <FileSpreadsheet className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">Spreadsheet: {tab.name}</p>
            <p className="text-sm">Download to view in your spreadsheet application</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                // Convert data URL to blob
                const response = await fetch(tab.content);
                const blob = await response.blob();
                await downloadFileWithDialog(blob, tab.name, blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              }}
            >
              Download File
            </Button>
          </div>
        );
      }
      if (isPresentation) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full">
            <Presentation className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">Presentation: {tab.name}</p>
            <p className="text-sm">Download to view in your presentation application</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                // Convert data URL to blob
                const response = await fetch(tab.content);
                const blob = await response.blob();
                await downloadFileWithDialog(blob, tab.name, blob.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
              }}
            >
              Download File
            </Button>
          </div>
        );
      }
      if (isWord) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full">
            <FileType className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">Word Document: {tab.name}</p>
            <p className="text-sm">Download to view in your word processor</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                // Convert data URL to blob
                const response = await fetch(tab.content);
                const blob = await response.blob();
                await downloadFileWithDialog(blob, tab.name, blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
              }}
            >
              Download File
            </Button>
          </div>
        );
      }
      // Check if it's a markdown or text file for formatting support
      // .txt files now get full formatting toolbar (bold, italic, headers, etc.)
      const isMarkdown = extension === 'md' || extension === 'markdown' || extension === 'txt' || !extension;
      const isRichText = extension === 'rtf';

      if (isPreviewMode && isMarkdown && !isSecondary) {
        return (
          <MarkdownPreview
            content={tab.content}
            className="h-full"
          />
        );
      }

      // Use plain text editor only for rich text format files
      if (isRichText) {
        return (
          <PlainTextEditor
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
      <div className="flex items-center border-b">
        <div className="flex-1">
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

export default MainPanel;
