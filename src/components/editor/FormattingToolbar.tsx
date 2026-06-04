// Formatting Toolbar Component
// Provides formatting buttons for the Markdown editor

import { useEffect } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/utils/saveFile';
import { markdownToDocxBytes } from '@/utils/docx-io';
import { markdownToPptxBytes } from '@/utils/pptx-io';
import { exportMarkdownAsPdf } from '@/utils/pdf-export';
import { availableExportFormats, replaceExtension } from '@/utils/export-formats';
import type { ExportFormat } from '@/utils/export-formats';
import type { MarkdownEditorRef } from './MarkdownEditor';

interface FormattingToolbarProps {
  editorRef: React.RefObject<MarkdownEditorRef>;
  className?: string;
  isPreviewMode?: boolean;
  onTogglePreview?: (() => void) | undefined;
  fileContent?: string;
  fileName?: string;
}

interface ToolbarButton {
  icon: React.ElementType;
  label: string;
  action: (editor: MarkdownEditorRef) => void;
  shortcut?: string;
}

const toolbarButtons: ToolbarButton[] = [
  {
    icon: Bold,
    label: 'Bold',
    shortcut: 'Ctrl+B',
    action: (editor) => editor.wrapSelection('**', '**'),
  },
  {
    icon: Italic,
    label: 'Italic',
    shortcut: 'Ctrl+I',
    action: (editor) => editor.wrapSelection('*', '*'),
  },
  {
    icon: Strikethrough,
    label: 'Strikethrough',
    action: (editor) => editor.wrapSelection('~~', '~~'),
  },
  {
    icon: Code,
    label: 'Inline Code',
    action: (editor) => editor.wrapSelection('`', '`'),
  },
  { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} }, // Divider
  {
    icon: Heading1,
    label: 'Heading 1',
    action: (editor) => editor.insertAtLineStart('# '),
  },
  {
    icon: Heading2,
    label: 'Heading 2',
    action: (editor) => editor.insertAtLineStart('## '),
  },
  {
    icon: Heading3,
    label: 'Heading 3',
    action: (editor) => editor.insertAtLineStart('### '),
  },
  { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} }, // Divider
  {
    icon: List,
    label: 'Bullet List',
    action: (editor) => editor.insertAtLineStart('- '),
  },
  {
    icon: ListOrdered,
    label: 'Numbered List',
    action: (editor) => editor.insertAtLineStart('1. '),
  },
  {
    icon: CheckSquare,
    label: 'Task List',
    action: (editor) => editor.insertAtLineStart('- [ ] '),
  },
  {
    icon: Quote,
    label: 'Blockquote',
    action: (editor) => editor.insertAtLineStart('> '),
  },
  { icon: null as unknown as React.ElementType, label: 'divider', action: () => {} }, // Divider
  {
    icon: Link,
    label: 'Link',
    action: (editor) => editor.wrapSelection('[', '](url)'),
  },
  {
    icon: Image,
    label: 'Image',
    action: (editor) => editor.insertText('![alt text](image-url)'),
  },
  {
    icon: Minus,
    label: 'Horizontal Rule',
    action: (editor) => editor.insertText('\n---\n'),
  },
];

export function FormattingToolbar({ editorRef, className, isPreviewMode, onTogglePreview, fileContent, fileName }: FormattingToolbarProps) {
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
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  return (
    <div className={cn('flex flex-nowrap items-center gap-0.5 px-2 py-1 border-b bg-muted/30 overflow-x-auto', className)}>
      {toolbarButtons.map((button, index) => {
        if (button.label === 'divider') {
          return <div key={index} className="w-px h-5 bg-border mx-1" />;
        }

        const Icon = button.icon;

        // Define preview mode actions for each button
        let previewAction: (() => void) | undefined;
        if (isPreviewMode) {
          switch (button.label) {
            case 'Bold':
              previewAction = () => execCommand('bold');
              break;
            case 'Italic':
              previewAction = () => execCommand('italic');
              break;
            case 'Strikethrough':
              previewAction = () => execCommand('strikeThrough');
              break;
            case 'Inline Code':
              previewAction = () => wrapSelectionWithMarkdown('`');
              break;
            case 'Heading 1':
              previewAction = () => execCommand('formatBlock', 'H1');
              break;
            case 'Heading 2':
              previewAction = () => execCommand('formatBlock', 'H2');
              break;
            case 'Heading 3':
              previewAction = () => execCommand('formatBlock', 'H3');
              break;
            case 'Bullet List':
              previewAction = () => execCommand('insertUnorderedList');
              break;
            case 'Numbered List':
              previewAction = () => execCommand('insertOrderedList');
              break;
            case 'Blockquote':
              previewAction = () => execCommand('formatBlock', 'BLOCKQUOTE');
              break;
            case 'Link':
              previewAction = () => {
                const url = prompt('Enter URL:');
                if (url) execCommand('createLink', url);
              };
              break;
            case 'Horizontal Rule':
              previewAction = () => execCommand('insertHorizontalRule');
              break;
          }
        }

        return (
          <Button
            key={button.label}
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => handleClick(button.action, previewAction)}
            title={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
            disabled={isPreviewMode}
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}

      {/* Preview toggle button - placed after formatting buttons for easy access */}
      {onTogglePreview && (
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
