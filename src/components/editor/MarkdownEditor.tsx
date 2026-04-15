// Markdown Editor Component
// CodeMirror 6 based editor with Markdown syntax highlighting

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { WordCountFooter } from './WordCountFooter';

export interface MarkdownEditorRef {
  getView: () => EditorView | null;
  insertText: (text: string) => void;
  wrapSelection: (before: string, after: string) => void;
  insertAtLineStart: (text: string) => void;
}

interface MarkdownEditorProps {
  initialContent: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
  className?: string;
  filePath?: string; // Used to determine when to reset the editor for a new file
}

// Custom theme for the editor
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    direction: 'ltr',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    padding: '10px 0',
    direction: 'ltr',
    unicodeBidi: 'plaintext',
  },
  '.cm-line': {
    padding: '0 16px',
    direction: 'ltr',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid hsl(var(--border))',
    color: 'hsl(var(--muted-foreground))',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'hsl(var(--accent))',
  },
  '.cm-activeLine': {
    backgroundColor: 'hsl(var(--accent) / 0.5)',
  },
  '.cm-cursor': {
    borderLeftColor: 'hsl(var(--foreground))',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'hsl(var(--accent))',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--accent))',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
});

// Create extensions array - using a ref callback for onChange to prevent recreating
const createExtensions = (
  onChangeRef: React.MutableRefObject<((content: string) => void) | undefined>,
  onChangeMirrorRef: React.MutableRefObject<((content: string) => void) | undefined>,
  readOnly: boolean = false
) => {
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    rectangularSelection(),
    history(),
    foldGutter(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle),
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    editorTheme,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...closeBracketsKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        onChangeRef.current?.(text);
        onChangeMirrorRef.current?.(text);
      }
    }),
  ];

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  return extensions;
};

export const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      initialContent,
      onChange,
      readOnly = false,
      className = '',
      filePath,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    // UX-30: reactive mirror of the current document content so the word
    // count footer updates on every keystroke. We keep a separate piece of
    // React state rather than reading from the CodeMirror view synchronously
    // so the footer re-renders without touching the editor mount effect.
    const [currentText, setCurrentText] = useState(initialContent);
    const onChangeMirrorRef = useRef<((content: string) => void) | undefined>(
      setCurrentText
    );

    // Keep onChange ref up to date (this doesn't cause re-renders)
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    // Reset the mirrored text when switching to a new file (filePath change
    // is what recreates the editor; doing it in the same effect keeps the
    // footer in sync with the freshly-loaded content).
    useEffect(() => {
      setCurrentText(initialContent);
    }, [initialContent]);

    // Expose editor methods via ref
    useImperativeHandle(ref, () => ({
      getView: () => viewRef.current,
      insertText: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from } = view.state.selection.main;
        view.dispatch({
          changes: { from, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      wrapSelection: (before: string, after: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selectedText = view.state.doc.sliceString(from, to);
        view.dispatch({
          changes: { from, to, insert: before + selectedText + after },
          selection: { anchor: from + before.length, head: from + before.length + selectedText.length },
        });
        view.focus();
      },
      insertAtLineStart: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        view.dispatch({
          changes: { from: line.from, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
    }), []);

    // Initialize editor on mount and when filePath changes
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Clear the container first to ensure no duplicate editors
      container.innerHTML = '';

      const state = EditorState.create({
        doc: initialContent,
        extensions: createExtensions(onChangeRef, onChangeMirrorRef, readOnly),
      });

      const view = new EditorView({
        state,
        parent: container,
      });

      viewRef.current = view;

      // Focus the editor after creation
      requestAnimationFrame(() => {
        view.focus();
      });

      // Cleanup function - always destroy when unmounting or filePath changes
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath, readOnly]); // Recreate when filePath or readOnly changes

    return (
      <div className={`h-full w-full flex flex-col bg-background ${className}`}>
        <div
          ref={containerRef}
          className="flex-1 min-h-0"
          onClick={() => {
            // Ensure editor gets focus when clicking the container
            viewRef.current?.focus();
          }}
        />
        {/* UX-30: word count footer. Matches the TipTap editors' styling. */}
        {!readOnly && <WordCountFooter text={currentText} />}
      </div>
    );
  }
);

// Hook to get editor content programmatically
export function useEditorContent() {
  const viewRef = useRef<EditorView | null>(null);

  const getContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() ?? '';
  }, []);

  const setContent = useCallback((content: string) => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: content,
        },
      });
    }
  }, []);

  return { viewRef, getContent, setContent };
}

export default MarkdownEditor;
