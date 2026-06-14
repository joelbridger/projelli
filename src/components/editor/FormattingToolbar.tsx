// Formatting Toolbar Component
// Provides formatting buttons for the Markdown editor

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link,
  Image,
  Minus,
  CheckSquare,
  Eye,
  Edit3,
  Download,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/utils/saveFile';
import { markdownToDocxBytes } from '@/utils/docx-io';
import { markdownToPptxBytes } from '@/utils/pptx-io';
import { exportMarkdownAsPdf } from '@/utils/pdf-export';
import { availableExportFormats, replaceExtension } from '@/utils/export-formats';
import type { ExportFormat } from '@/utils/export-formats';
import type { MarkdownEditorRef } from './MarkdownEditor';

/** File type inferred from the active tab's extension. */
export type ToolbarFileType = 'md' | 'txt' | 'docx' | 'other';

interface FormattingToolbarProps {
  editorRef: React.RefObject<MarkdownEditorRef>;
  className?: string;
  isPreviewMode?: boolean;
  onTogglePreview?: (() => void) | undefined;
  fileContent?: string;
  fileName?: string;
  /**
   * A5: context-sensitive toolbar. Derived from the active file extension by
   * MainPanel and forwarded here so the toolbar can hide controls that are
   * meaningless for plain-text or Word files. Defaults to 'other' (full set
   * visible) so nothing regresses for unrecognised extensions.
   */
  fileType?: ToolbarFileType;
}

interface ToolbarButton {
  icon: React.ElementType;
  label: string;
  action: (editor: MarkdownEditorRef) => void;
  shortcut?: string;
}

// Buttons shown directly in the toolbar row (common formatting)
const primaryToolbarButtons: ToolbarButton[] = [
  {
    icon: Bold,
    label: 'Bold',
    shortcut: 'Ctrl+B',
    action: (editor) => { editor.wrapSelection('**', '**'); },
  },
  {
    icon: Italic,
    label: 'Italic',
    shortcut: 'Ctrl+I',
    action: (editor) => { editor.wrapSelection('*', '*'); },
  },
  { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} },
  {
    icon: Heading1,
    label: 'Heading 1',
    action: (editor) => { editor.insertAtLineStart('# '); },
  },
  {
    icon: Heading2,
    label: 'Heading 2',
    action: (editor) => { editor.insertAtLineStart('## '); },
  },
  {
    icon: Heading3,
    label: 'Heading 3',
    action: (editor) => { editor.insertAtLineStart('### '); },
  },
  { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} },
  {
    icon: List,
    label: 'Bullet List',
    action: (editor) => { editor.insertAtLineStart('- '); },
  },
  {
    icon: ListOrdered,
    label: 'Numbered List',
    action: (editor) => { editor.insertAtLineStart('1. '); },
  },
  { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} },
  {
    icon: Link,
    label: 'Link',
    action: (editor) => { editor.wrapSelection('[', '](url)'); },
  },
];

// Buttons tucked into the "More" overflow menu (advanced / infrequent)
const advancedToolbarButtons: ToolbarButton[] = [
  {
    icon: Strikethrough,
    label: 'Strikethrough',
    action: (editor) => { editor.wrapSelection('~~', '~~'); },
  },
  {
    icon: Code,
    label: 'Inline Code',
    action: (editor) => { editor.wrapSelection('`', '`'); },
  },
  {
    icon: CheckSquare,
    label: 'Task List',
    action: (editor) => { editor.insertAtLineStart('- [ ] '); },
  },
  {
    icon: Quote,
    label: 'Blockquote',
    action: (editor) => { editor.insertAtLineStart('> '); },
  },
  {
    icon: Image,
    label: 'Image',
    action: (editor) => { editor.insertText('![alt text](image-url)'); },
  },
  {
    icon: Minus,
    label: 'Horizontal Rule',
    action: (editor) => { editor.insertText('\n---\n'); },
  },
];

export function FormattingToolbar({ editorRef, className, isPreviewMode, onTogglePreview, fileContent, fileName, fileType = 'other' }: FormattingToolbarProps) {
  // A5: derive visibility flags from file type.
  // .txt  → only Export (no headings, lists, bold/italic, Preview, or More menu;
  //          all controls are Markdown syntax that a plain-text editor ignores)
  // .md   → full set including Preview
  // .docx → rich controls (bold/italic/headings/lists/link/More + Export); no
  //          Preview (not meaningful for Word — the viewer handles rendering)
  // other → full set (safe default, no regression)
  //
  // showRichControls: bold/italic, headings, lists, link, More menu
  // showPreview:      Preview toggle (md and other only)
  const showRichControls = fileType !== 'txt';
  const showBoldItalic = showRichControls;
  const showMarkdownOnlyControls = showRichControls; // headings/lists/link/More — valid for docx too
  const showPreview = (fileType === 'md' || fileType === 'other') && Boolean(onTogglePreview);
  // Keyboard shortcut: Alt+Z to toggle preview
  useEffect(() => {
    if (!onTogglePreview) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+Z (or Option+Z on Mac) to toggle preview
      if (e.altKey && e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        onTogglePreview();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onTogglePreview]);

  const handleClick = (action: (editor: MarkdownEditorRef) => void, previewAction?: () => void) => {
    if (isPreviewMode && previewAction) {
      previewAction();
    } else if (editorRef.current) {
      action(editorRef.current);
    }
  };

  // Helper functions for preview mode formatting using document.execCommand
  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
  };

  const wrapSelectionWithMarkdown = (prefix: string, suffix: string = prefix) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();

    // Create a text node with the wrapped content
    const wrappedText = `${prefix}${selectedText}${suffix}`;
    range.deleteContents();
    range.insertNode(document.createTextNode(wrappedText));

    // Trigger input event to save changes
    const event = new Event('input', { bubbles: true });
    range.commonAncestorContainer.dispatchEvent(event);
  };

  // Fallback: save the file as-is (original single-button behavior).
  const handleDownloadRaw = async () => {
    if (!fileContent || !fileName) return;
    try {
      await saveFile(fileContent, {
        suggestedName: fileName,
        types: [
          {
            description: 'Text Files',
            accept: {
              'text/plain': ['.txt', '.md', '.markdown'],
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Failed to save file:', error);
      }
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!fileContent || !fileName) return;

    try {
      switch (format) {
        case 'markdown': {
          await saveFile(fileContent, {
            suggestedName: fileName,
            types: [
              {
                description: 'Markdown',
                accept: { 'text/markdown': ['.md', '.markdown'] },
              },
            ],
          });
          break;
        }

        case 'docx': {
          const bytes = await markdownToDocxBytes(fileContent, fileName);
          await saveFile(bytes, {
            suggestedName: replaceExtension(fileName, 'docx'),
            types: [
              {
                description: 'Word Document',
                accept: {
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
                },
              },
            ],
          });
          break;
        }

        case 'pdf': {
          // PDF uses the print-to-PDF path: no binary file is produced by
          // Keepance; the OS print dialog handles writing the file.
          await exportMarkdownAsPdf(fileContent, fileName);
          break;
        }

        case 'pptx': {
          const bytes = await markdownToPptxBytes(fileContent);
          await saveFile(bytes, {
            suggestedName: replaceExtension(fileName, 'pptx'),
            types: [
              {
                description: 'PowerPoint Presentation',
                accept: {
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
                },
              },
            ],
          });
          break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error(`Export as ${format} failed:`, error);
      }
    }
  };

  // Track whether the More overflow menu is open (controls button highlight)
  const [moreOpen, setMoreOpen] = useState(false);

  // Build the preview-mode action for a given button label
  const getPreviewAction = (label: string): (() => void) | undefined => {
    if (!isPreviewMode) return undefined;
    switch (label) {
      case 'Bold':
        return () => { execCommand('bold'); };
      case 'Italic':
        return () => { execCommand('italic'); };
      case 'Strikethrough':
        return () => { execCommand('strikeThrough'); };
      case 'Inline Code':
        return () => { wrapSelectionWithMarkdown('`'); };
      case 'Heading 1':
        return () => { execCommand('formatBlock', 'H1'); };
      case 'Heading 2':
        return () => { execCommand('formatBlock', 'H2'); };
      case 'Heading 3':
        return () => { execCommand('formatBlock', 'H3'); };
      case 'Bullet List':
        return () => { execCommand('insertUnorderedList'); };
      case 'Numbered List':
        return () => { execCommand('insertOrderedList'); };
      case 'Blockquote':
        return () => { execCommand('formatBlock', 'BLOCKQUOTE'); };
      case 'Link':
        return () => {
          const url = prompt('Enter URL:');
          if (url) execCommand('createLink', url);
        };
      case 'Horizontal Rule':
        return () => { execCommand('insertHorizontalRule'); };
      default:
        return undefined;
    }
  };

  // A5: build a filtered list of primary buttons based on fileType.
  // Each button is tagged with which file types should show it.
  // Dividers are inserted dynamically after non-empty groups.
  const filteredPrimaryButtons = (() => {
    // Group 0: Bold + Italic (hidden for .txt)
    const g0 = showBoldItalic
      ? primaryToolbarButtons.filter((b) => b.label === 'Bold' || b.label === 'Italic')
      : [];
    // Group 1: Heading 1/2/3 (hidden for .txt)
    const g1 = showMarkdownOnlyControls
      ? primaryToolbarButtons.filter((b) => b.label.startsWith('Heading'))
      : [];
    // Group 2: Lists (hidden for .txt)
    const g2 = showMarkdownOnlyControls
      ? primaryToolbarButtons.filter((b) => b.label === 'Bullet List' || b.label === 'Numbered List')
      : [];
    // Group 3: Link (hidden for .txt)
    const g3 = showMarkdownOnlyControls
      ? primaryToolbarButtons.filter((b) => b.label === 'Link')
      : [];

    // Assemble groups with dividers between non-empty groups
    const result: ToolbarButton[] = [];
    const divider: ToolbarButton = { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} };
    let addedAny = false;
    for (const group of [g0, g1, g2, g3]) {
      if (group.length === 0) continue;
      if (addedAny) result.push(divider);
      result.push(...group);
      addedAny = true;
    }
    return result;
  })();

  return (
    <div className={cn('flex flex-nowrap items-center gap-0.5 px-2 py-1 border-b bg-muted/30 overflow-x-auto', className)}>
      {/* Primary (common) buttons — filtered by fileType (A5) */}
      {filteredPrimaryButtons.map((button, index) => {
        if (button.label === 'divider') {
          return <div key={index} className="w-px h-5 bg-border mx-1" />;
        }

        const Icon = button.icon;
        const previewAction = getPreviewAction(button.label);

        return (
          <Button
            key={button.label}
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => { handleClick(button.action, previewAction); }}
            title={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
            disabled={isPreviewMode}
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}

      {/* More overflow — advanced / infrequent formatting; hidden for .txt */}
      {showMarkdownOnlyControls && (
        <>
          {filteredPrimaryButtons.length > 0 && <div className="w-px h-5 bg-border mx-1" />}
          <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="formatting-toolbar-more"
                variant={moreOpen ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0"
                title="More formatting"
                disabled={isPreviewMode}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {advancedToolbarButtons.map((button) => {
                const Icon = button.icon;
                const previewAction = getPreviewAction(button.label);
                return (
                  <DropdownMenuItem
                    key={button.label}
                    data-testid={`formatting-more-${button.label.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => { handleClick(button.action, previewAction); }}
                    className="gap-2"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {button.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Preview toggle button — only for Markdown files (A5) */}
      {showPreview && (
        <>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant={isPreviewMode ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 gap-1"
            onClick={onTogglePreview}
            title={isPreviewMode ? 'Switch to Edit mode (Alt+Z)' : 'Preview Markdown (Alt+Z)'}
          >
            {isPreviewMode ? (
              <>
                <Edit3 className="h-4 w-4" />
                <span className="text-xs">Edit</span>
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                <span className="text-xs">Preview</span>
              </>
            )}
          </Button>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Export menu — markdown files get format choices; other file types fall
          back to the original single-button save. */}
      {fileContent && fileName && (() => {
        const exportOptions = availableExportFormats(fileName);

        if (exportOptions.length === 0) {
          // Non-markdown file: preserve original behavior.
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={handleDownloadRaw}
              title="Download a copy of this file"
            >
              <Download className="h-4 w-4" />
              <span className="text-xs">Download</span>
            </Button>
          );
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1"
                title="Export this document"
              >
                <Download className="h-4 w-4" />
                <span className="text-xs">Export as</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {exportOptions.map((option) => (
                <DropdownMenuItem
                  key={option.format}
                  onClick={() => handleExport(option.format)}
                  className="gap-2"
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })()}
    </div>
  );
}

export default FormattingToolbar;
