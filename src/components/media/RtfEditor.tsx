// RTF Editor
//
// WYSIWYG editor for `.rtf` files. Parses the incoming RTF bytes into HTML via
// `rtf-io::parseRtf`, feeds that into TipTap, and serializes back to RTF on
// change. Mirrors `DocxEditor`'s pattern (2-second debounced autosave,
// first-edit backup via `fileBackupStore`, dismissible fidelity banner).
//
// This replaces the pre-Phase-6 behavior where `.rtf` files were routed to
// Keepance's internal `.rt` handler (HTML-backed rich text editor), which
// showed users the raw `{\rtf1\ansi...}` markup because `.rt` expected its
// own HTML wire format.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import {
  AlertTriangle,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code,
  Link as LinkIcon,
  Undo,
  Redo,
  X,
  FileType,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { parseRtf, serializeRtf, rtfBytesToDataUrl } from '@/utils/rtf-io';

interface RtfEditorProps {
  src: string;
  fileName: string;
  className?: string;
  /**
   * Invoked with a new data URL whenever the user's edits have been
   * debounced + serialized. When absent, the editor renders read-only.
   */
  onContentChange?: (newDataUrl: string) => void;
  /** Called once per file/session before the first serialization push so the
   *  parent can write a backup of the original bytes. */
  onFirstEdit?: () => Promise<void> | void;
}

export function RtfEditor({
  src,
  fileName,
  className,
  onContentChange,
  onFirstEdit,
}: RtfEditorProps) {
  const { t } = useTranslation();
  const [initialHtml, setInitialHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);

  const onChangeRef = useRef(onContentChange);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstEditFiredRef = useRef(false);
  // Track the last URL we pushed upstream so an incoming `src` round-trip
  // doesn't cause us to re-parse our own serialization.
  const lastPushedUrlRef = useRef<string | null>(null);

  const readOnly = !onContentChange;

  useEffect(() => {
    onChangeRef.current = onContentChange;
  }, [onContentChange]);

  // Parse RTF -> HTML on mount / src change.
  useEffect(() => {
    if (src === lastPushedUrlRef.current) {
      return;
    }
    let cancelled = false;
    setError(null);
    setInitialHtml(null);
    parseRtf(src)
      .then((html) => {
        if (cancelled) return;
        setInitialHtml(html.length > 0 ? html : '<p></p>');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error.';
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
            autolink: true,
            HTMLAttributes: {
              class: 'text-blue-500 underline',
              rel: 'noopener noreferrer',
              target: '_blank',
            },
          },
        }),
        CharacterCount,
        Placeholder.configure({
          placeholder: 'Start writing...',
        }),
      ],
      content: initialHtml ?? '<p></p>',
      editorProps: {
        attributes: {
          class:
            'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-full',
          'data-testid': 'rtf-editor-content',
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (readOnly) return;
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        const html = currentEditor.getHTML();
        debounceTimerRef.current = setTimeout(async () => {
          try {
            if (!firstEditFiredRef.current) {
              firstEditFiredRef.current = true;
              try {
                await onFirstEdit?.();
              } catch (err) {
                console.warn('[RtfEditor] onFirstEdit failed:', err);
              }
            }
            const bytes = await serializeRtf(html);
            const dataUrl = rtfBytesToDataUrl(bytes);
            lastPushedUrlRef.current = dataUrl;
            onChangeRef.current?.(dataUrl);
          } catch (err) {
            console.error('[RtfEditor] serialize failed:', err);
          }
        }, 2000);
      },
    },
    [initialHtml !== null, readOnly]
  );

  // When parsing finishes, push the extracted HTML into the editor.
  useEffect(() => {
    if (!editor || initialHtml === null) return;
    const current = editor.getHTML();
    if (current !== initialHtml) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
  }, [editor, initialHtml]);

  // Cleanup debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleSetLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Enter URL (leave empty to remove link):', previousUrl ?? '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const safeUrl = /^(https?:\/\/|mailto:|\/)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run();
  };

  if (error) {
    return (
      <div
        data-testid="rtf-editor-error"
        className={cn(
          'flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground',
          className
        )}
      >
        <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('media.rtf-editor.could-not-open', { fileName })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!editor || initialHtml === null) {
    return (
      <div
        data-testid="rtf-editor-loading"
        className={cn(
          'flex h-full flex-col items-center justify-center gap-2 text-muted-foreground',
          className
        )}
      >
        <FileType className="h-10 w-10 animate-pulse opacity-50" />
        <p className="text-sm">Opening {fileName}...</p>
      </div>
    );
  }

  const toolbarButton = (opts: {
    icon: React.ElementType;
    label: string;
    isActive?: boolean;
    onClick: () => void;
    disabled?: boolean;
  }) => {
    const Icon = opts.icon;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-8 w-8 p-0',
          opts.isActive && 'bg-accent text-accent-foreground'
        )}
        title={opts.label}
        aria-label={opts.label}
        aria-pressed={opts.isActive}
        disabled={opts.disabled}
        onClick={opts.onClick}
      >
        <Icon className="h-4 w-4" />
      </Button>
    );
  };

  return (
    <div
      data-testid="rtf-editor"
      className={cn('h-full flex flex-col', className)}
    >
      {!readOnly && !isBannerDismissed && (
        <div
          data-testid="rtf-editor-banner"
          className="flex items-start gap-2 border-b bg-yellow-50 dark:bg-yellow-900/30 px-3 py-2 text-xs text-yellow-900 dark:text-yellow-100"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="flex-1">
            {t('media.rtf-editor.formatting-warning')}
          </p>
          <Button
            data-testid="rtf-editor-banner-dismiss"
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 -mr-1 -my-1"
            onClick={() => setIsBannerDismissed(true)}
            aria-label="Dismiss notice"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {!readOnly && (
        <div
          data-testid="rtf-editor-toolbar"
          className="flex items-center gap-0.5 flex-wrap border-b px-2 py-1 bg-background"
        >
          {toolbarButton({
            icon: Bold,
            label: 'Bold (Ctrl+B)',
            isActive: editor.isActive('bold'),
            onClick: () => editor.chain().focus().toggleBold().run(),
          })}
          {toolbarButton({
            icon: Italic,
            label: 'Italic (Ctrl+I)',
            isActive: editor.isActive('italic'),
            onClick: () => editor.chain().focus().toggleItalic().run(),
          })}
          {toolbarButton({
            icon: UnderlineIcon,
            label: 'Underline (Ctrl+U)',
            isActive: editor.isActive('underline'),
            onClick: () => editor.chain().focus().toggleUnderline().run(),
          })}
          {toolbarButton({
            icon: Strikethrough,
            label: 'Strikethrough',
            isActive: editor.isActive('strike'),
            onClick: () => editor.chain().focus().toggleStrike().run(),
          })}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {toolbarButton({
            icon: Heading1,
            label: 'Heading 1',
            isActive: editor.isActive('heading', { level: 1 }),
            onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          })}
          {toolbarButton({
            icon: Heading2,
            label: 'Heading 2',
            isActive: editor.isActive('heading', { level: 2 }),
            onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          })}
          {toolbarButton({
            icon: Heading3,
            label: 'Heading 3',
            isActive: editor.isActive('heading', { level: 3 }),
            onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          })}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {toolbarButton({
            icon: List,
            label: 'Bullet List',
            isActive: editor.isActive('bulletList'),
            onClick: () => editor.chain().focus().toggleBulletList().run(),
          })}
          {toolbarButton({
            icon: ListOrdered,
            label: 'Numbered List',
            isActive: editor.isActive('orderedList'),
            onClick: () => editor.chain().focus().toggleOrderedList().run(),
          })}
          {toolbarButton({
            icon: Code,
            label: 'Inline Code',
            isActive: editor.isActive('code'),
            onClick: () => editor.chain().focus().toggleCode().run(),
          })}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {toolbarButton({
            icon: LinkIcon,
            label: 'Link',
            isActive: editor.isActive('link'),
            onClick: handleSetLink,
          })}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {toolbarButton({
            icon: Undo,
            label: 'Undo',
            onClick: () => editor.chain().focus().undo().run(),
            disabled: !editor.can().undo(),
          })}
          {toolbarButton({
            icon: Redo,
            label: 'Redo',
            onClick: () => editor.chain().focus().redo().run(),
            disabled: !editor.can().redo(),
          })}
        </div>
      )}

      <div
        className="flex-1 overflow-auto px-6 py-4 cursor-text bg-background"
        onClick={() => {
          if (editor && !editor.isFocused && !readOnly) editor.chain().focus().run();
        }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>

      <WordCountFooter editor={editor} />

      {/* Matching styles to DocxEditor so the TipTap output renders visibly. */}
      <style>{`
        .ProseMirror { outline: none; min-height: 100%; }
        .ProseMirror h1 { font-size: 1.875rem; font-weight: bold; margin: 1rem 0 0.5rem; }
        .ProseMirror h2 { font-size: 1.5rem; font-weight: bold; margin: 1rem 0 0.5rem; }
        .ProseMirror h3 { font-size: 1.25rem; font-weight: bold; margin: 1rem 0 0.5rem; }
        .ProseMirror p { margin: 0.5rem 0; line-height: 1.6; }
        .ProseMirror ul { list-style-type: disc; padding-left: 1.5rem; margin: 0.5rem 0; }
        .ProseMirror ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
        .ProseMirror li { margin: 0.25rem 0; }
        .ProseMirror li > p { margin: 0; }
        .ProseMirror blockquote {
          border-left: 3px solid #94a3b8;
          padding-left: 1rem;
          color: #64748b;
          margin: 0.5rem 0;
          font-style: italic;
        }
        .ProseMirror code {
          background: #f1f5f9;
          padding: 2px 4px;
          border-radius: 3px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
          font-size: 0.875em;
        }
        .ProseMirror strong { font-weight: bold; }
        .ProseMirror em { font-style: italic; }
        .ProseMirror u { text-decoration: underline; }
        .ProseMirror s { text-decoration: line-through; }
        .ProseMirror a { color: #3b82f6; text-decoration: underline; cursor: pointer; }
        .ProseMirror p.is-editor-empty:first-child::before {
          color: #94a3b8;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

type TipTapEditor = NonNullable<ReturnType<typeof useEditor>>;

function WordCountFooter({ editor }: { editor: TipTapEditor }) {
  const [counts, setCounts] = useState(() => ({
    words: editor.storage['characterCount']?.words() ?? 0,
    characters: editor.storage['characterCount']?.characters() ?? 0,
  }));

  useEffect(() => {
    const update = () => {
      setCounts({
        words: editor.storage['characterCount']?.words() ?? 0,
        characters: editor.storage['characterCount']?.characters() ?? 0,
      });
    };
    editor.on('update', update);
    editor.on('create', update);
    return () => {
      editor.off('update', update);
      editor.off('create', update);
    };
  }, [editor]);

  return (
    <div
      data-testid="editor-word-count"
      className="flex items-center justify-end border-t bg-background px-3 py-1 text-[11px] text-muted-foreground"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {counts.words} words · {counts.characters.toLocaleString()} characters
    </div>
  );
}

export default RtfEditor;
