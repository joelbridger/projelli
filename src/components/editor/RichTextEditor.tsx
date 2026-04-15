// Rich Text Editor Component
// WYSIWYG editor for .rt and .rtf files using Tiptap
// Shows formatting immediately as the user types (like WordPad/Word)

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Undo,
  Redo,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  className?: string;
  placeholder?: string;
}

// Normalize initial content — ensure Tiptap always gets valid HTML
function normalizeContent(content: string): string {
  const trimmed = content?.trim() ?? '';
  if (!trimmed) return '<p></p>';
  // If it doesn't look like HTML, wrap it in a paragraph
  if (!trimmed.startsWith('<')) {
    // Convert newlines to separate paragraphs
    return trimmed
      .split(/\n\n+/)
      .map((para) => `<p>${para.replace(/\n/g, '<br />')}</p>`)
      .join('');
  }
  return trimmed;
}

export function RichTextEditor({
  initialContent,
  onChange,
  className,
  placeholder = 'Start writing...',
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep onChange ref fresh
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit v3 includes link + underline among the defaults. Configure
        // link inline here instead of stacking a standalone @tiptap/extension-link,
        // which triggers "Duplicate extension names" console warnings.
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
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: normalizeContent(initialContent),
    onUpdate: ({ editor }) => {
      // Debounce onChange by 300ms to avoid spamming disk writes
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      const html = editor.getHTML();
      debounceTimerRef.current = setTimeout(() => {
        onChangeRef.current(html);
      }, 300);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-full',
      },
    },
  });

  // Update content when file switch happens
  useEffect(() => {
    if (!editor) return;
    const normalized = normalizeContent(initialContent);
    const currentContent = editor.getHTML();
    // Only update if the incoming content is different — avoid overwriting user edits
    if (normalized !== currentContent) {
      editor.commands.setContent(normalized, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent, editor]);

  // Clean up debounce timer on unmount
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

    // User cancelled the prompt
    if (url === null) return;

    // Empty string removes the link
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    // Validate it's http(s) or mailto to avoid javascript: URLs
    const safeUrl = /^(https?:\/\/|mailto:|\/)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run();
  };

  if (!editor) {
    return (
      <div className={cn('h-full flex items-center justify-center text-muted-foreground', className)}>
        Loading editor...
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
    <div className={cn('h-full flex flex-col', className)}>
      {/* Toolbar */}
      <div
        data-testid="rich-text-toolbar"
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
          icon: Quote,
          label: 'Blockquote',
          isActive: editor.isActive('blockquote'),
          onClick: () => editor.chain().focus().toggleBlockquote().run(),
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
          label: 'Undo (Ctrl+Z)',
          onClick: () => editor.chain().focus().undo().run(),
          disabled: !editor.can().undo(),
        })}
        {toolbarButton({
          icon: Redo,
          label: 'Redo (Ctrl+Y)',
          onClick: () => editor.chain().focus().redo().run(),
          disabled: !editor.can().redo(),
        })}
      </div>

      {/* Editor surface */}
      <div
        className="flex-1 overflow-auto px-6 py-4 cursor-text"
        onClick={() => {
          // Clicking anywhere in the empty margin focuses the editor
          if (!editor.isFocused) editor.chain().focus().run();
        }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>

      {/* Scoped styles so Tiptap content renders visibly without @tailwindcss/typography */}
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
        .dark .ProseMirror code { background: #1e293b; color: #e2e8f0; }
        .ProseMirror pre {
          background: #1e293b;
          color: #e2e8f0;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
          font-size: 0.875em;
          overflow-x: auto;
          margin: 0.75rem 0;
        }
        .ProseMirror pre code { background: transparent; padding: 0; color: inherit; }
        .ProseMirror strong { font-weight: bold; }
        .ProseMirror em { font-style: italic; }
        .ProseMirror u { text-decoration: underline; }
        .ProseMirror s { text-decoration: line-through; }
        .ProseMirror hr {
          border: none;
          border-top: 1px solid #cbd5e1;
          margin: 1rem 0;
        }
        .ProseMirror a { color: #3b82f6; text-decoration: underline; cursor: pointer; }
        /* Placeholder styling */
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

export default RichTextEditor;
