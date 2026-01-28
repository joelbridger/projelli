// Plain Text Editor Component
// Simple CodeMirror-based editor for plain text files (.txt) without formatting toolbar
// Plain text files should not have Markdown formatting applied

import { useEffect, useRef } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, ViewUpdate, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { cn } from '@/lib/utils';

interface PlainTextEditorProps {
  initialContent: string;
  onChange?: (content: string) => void;
  className?: string;
}

export function PlainTextEditor({ initialContent, onChange, className }: PlainTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!editorRef.current) return;

    // Create editor state
    const startState = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        history(),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle),
        highlightSelectionMatches(),
        EditorView.editable.of(true), // Explicitly make editor editable
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged && onChangeRef.current) {
            const content = update.state.doc.toString();
            onChangeRef.current(content);
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            backgroundColor: 'transparent',
          },
          '.cm-content': {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '16px 0',
            caretColor: 'currentColor',
            minHeight: '100%',
          },
          '.cm-line': {
            padding: '0 16px',
            lineHeight: '1.6',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            minHeight: '100%',
          },
          '&.cm-focused': {
            outline: 'none',
          },
          '&.cm-focused .cm-scroller': {
            outline: 'none',
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            borderRight: 'none',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'currentColor',
          },
        }),
      ],
    });

    // Create editor view
    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount - initialContent handled by separate effect

  // Update content when initialContent changes (e.g., file switch)
  useEffect(() => {
    if (viewRef.current) {
      const currentContent = viewRef.current.state.doc.toString();
      if (currentContent !== initialContent) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: viewRef.current.state.doc.length,
            insert: initialContent,
          },
        });
      }
    }
  }, [initialContent]);

  return (
    <div className={cn('h-full flex flex-col', className)}>
      {/* Simple text editor - no formatting toolbar for plain text files */}
      <div
        ref={editorRef}
        className="flex-1 overflow-hidden"
        onClick={() => {
          // Ensure editor gets focus when container is clicked
          viewRef.current?.focus();
        }}
      />
    </div>
  );
}

export default PlainTextEditor;
