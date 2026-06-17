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
import {
  createSmartPasteExtension,
  processImageFile,
  type FetchUrlTitle,
  type WriteImage,
  type ShowToast,
} from '@/features/documents/editor-core/smartPaste';
import {
  SCROLL_TO_PARAGRAPH_EVENT,
  consumePendingScroll,
  resolveScrollPosition,
  type ScrollToParagraphDetail,
} from '@/utils/scrollToParagraph';
import { InlineChatAnchor } from './InlineChatAnchor';
import { StreamingDiffOverlay } from './StreamingDiffOverlay';
import { codeMirrorAdapter, useInlineAiEdit } from './useInlineAiEdit';
import type { Provider } from '@/modules/models/Provider';

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
  /**
   * Q12 — provider for URL → title lookups. Defaults to the Tauri
   * `fetchUrlTitle` wrapper so production doesn't need to pass anything.
   * Tests inject a stub.
   */
  fetchUrlTitle?: FetchUrlTitle | undefined;
  /**
   * Q13 — image writer. When omitted, image paste is a no-op (browser /
   * no-workspace mode). Live app passes an adapter around
   * `WorkspaceService.writeFileBinary`.
   */
  writeImage?: WriteImage | undefined;
  /**
   * Q13 — "is a workspace open?" probe. Defaults to "yes" when omitted
   * (test convenience). Live app passes a check for the store's rootPath.
   */
  hasWorkspace?: (() => boolean) | undefined;
  /**
   * Q13 — surface "image too large" / "no workspace" / "save failed"
   * messages to the user. Defaults to a console-only warn in test mode.
   */
  showToast?: ShowToast | undefined;
  /**
   * M5 — provider factory for inline AI edits. Returning `null`
   * disables the feature (default). Tests inject a `MockProvider`.
   */
  getAiProvider?: (() => Provider | null) | undefined;
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
  smartPasteRefs: {
    fetchUrlTitle: React.MutableRefObject<FetchUrlTitle>;
    writeImage: React.MutableRefObject<WriteImage | undefined>;
    hasWorkspace: React.MutableRefObject<() => boolean>;
    showToast: React.MutableRefObject<ShowToast | undefined>;
    onImagePasted: React.MutableRefObject<() => void>;
  },
  // M5 — optional "bump" to inform the React side that the selection moved.
  selectionVersionBumpRef: React.MutableRefObject<(() => void) | undefined>,
  readOnly: boolean = false
) => {
  // Q12 + Q13 — smart paste extension. All callbacks are resolved via
  // refs so the extension never re-creates when a parent hands us a new
  // lambda (e.g. App.tsx passing a fresh `writeImage` closure each
  // render).
  const smartPasteExtension = createSmartPasteExtension({
    fetchUrlTitle: (url: string) => smartPasteRefs.fetchUrlTitle.current(url),
    writeImage: (args) => {
      const writer = smartPasteRefs.writeImage.current;
      if (!writer) return Promise.resolve();
      return writer(args);
    },
    hasWorkspace: () => smartPasteRefs.hasWorkspace.current(),
    showToast: (msg) => {
      const cb = smartPasteRefs.showToast.current;
      if (cb) cb(msg);
      else console.warn('[MarkdownEditor]', msg);
    },
    onImagePasteResolved: () => smartPasteRefs.onImagePasted.current(),
  });
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
    smartPasteExtension,
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
      // M5 — bump the selection-version counter whenever the user's
      // selection shifts, so `useInlineAiEdit` can recompute anchor
      // coordinates. Gated behind a ref so we can disable it if the
      // caller never wires up the AI edit feature.
      if (update.selectionSet || update.docChanged) {
        selectionVersionBumpRef.current?.();
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
      fetchUrlTitle,
      writeImage,
      hasWorkspace,
      showToast,
      getAiProvider,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);

    // Q12 + Q13 — smart paste callbacks behind refs so they stay fresh
    // without re-mounting the editor. Default `fetchUrlTitle` imports
    // lazily from `@/utils/tauri-commands` so tests that mock the Tauri
    // bindings don't have to wire a stub manually.
    const fetchUrlTitleRef = useRef<FetchUrlTitle>(
      fetchUrlTitle ??
        (async (url: string) => {
          try {
            const mod = await import('@/utils/tauri-commands');
            return await mod.fetchUrlTitle(url);
          } catch {
            return '';
          }
        })
    );
    const writeImageRef = useRef<WriteImage | undefined>(writeImage);
    const hasWorkspaceRef = useRef<() => boolean>(
      hasWorkspace ?? (() => true)
    );
    const showToastRef = useRef<ShowToast | undefined>(showToast);
    const onImagePastedRef = useRef<() => void>(() => {
      setImagePasteCount((n) => n + 1);
    });
    useEffect(() => {
      if (fetchUrlTitle) fetchUrlTitleRef.current = fetchUrlTitle;
    }, [fetchUrlTitle]);
    useEffect(() => {
      writeImageRef.current = writeImage;
    }, [writeImage]);
    useEffect(() => {
      hasWorkspaceRef.current = hasWorkspace ?? (() => true);
    }, [hasWorkspace]);
    useEffect(() => {
      showToastRef.current = showToast;
    }, [showToast]);
    // UX-30: reactive mirror of the current document content so the word
    // count footer updates on every keystroke. We keep a separate piece of
    // React state rather than reading from the CodeMirror view synchronously
    // so the footer re-renders without touching the editor mount effect.
    const [currentText, setCurrentText] = useState(initialContent);
    const onChangeMirrorRef = useRef<((content: string) => void) | undefined>(
      setCurrentText
    );

    // Q12 — visible marker for the inline "[Fetching title...](…)"
    // placeholder. Derived from `currentText` so tests can observe it
    // via `data-testid` without poking at CodeMirror internals.
    const hasUrlPastePlaceholder = currentText.includes('[Fetching title...](');

    // Q13 — increments every time an image paste succeeds so tests can
    // wait on a `data-paste-count` attribute without timing races.
    const [imagePasteCount, setImagePasteCount] = useState(0);

    // M5 — monotonic counter bumped on every selection change so the
    // inline-edit hook can recompute anchor coordinates. Separate from
    // currentText so plain "the user typed one key" doesn't force the
    // overlay to re-layout.
    const [selectionVersion, setSelectionVersion] = useState(0);
    const selectionVersionBumpRef = useRef<(() => void) | undefined>(undefined);
    useEffect(() => {
      selectionVersionBumpRef.current = () =>
        setSelectionVersion((n) => (n + 1) % 1_000_000);
    }, []);
    const getAiProviderRef = useRef<(() => Provider | null) | undefined>(
      getAiProvider
    );
    useEffect(() => {
      getAiProviderRef.current = getAiProvider;
    }, [getAiProvider]);

    // M5 inline edit orchestration. The adapter reads from the live
    // `viewRef` so the hook keeps pointing at the right editor even
    // after a filePath remount.
    const aiAdapter = useRef<ReturnType<typeof codeMirrorAdapter> | null>(null);
    aiAdapter.current = codeMirrorAdapter(viewRef.current, { filePath });
    const {
      state: aiState,
      handlers: aiHandlers,
    } = useInlineAiEdit({
      adapter: {
        getSelectedText: () => aiAdapter.current?.getSelectedText() ?? '',
        getSelectionRange: () => aiAdapter.current?.getSelectionRange() ?? null,
        replaceRange: (from, to, insert) =>
          aiAdapter.current?.replaceRange(from, to, insert),
        coordsAtPos: (pos) => aiAdapter.current?.coordsAtPos(pos) ?? null,
        getDocText: () => aiAdapter.current?.getDocText() ?? '',
        getDomNode: () => aiAdapter.current?.getDomNode() ?? null,
        filePath,
      },
      getProvider: () => {
        const fn = getAiProviderRef.current;
        return fn ? fn() : null;
      },
      formatHint: 'markdown',
      docVersion: selectionVersion,
    });

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
        extensions: createExtensions(
          onChangeRef,
          onChangeMirrorRef,
          {
            fetchUrlTitle: fetchUrlTitleRef,
            writeImage: writeImageRef,
            hasWorkspace: hasWorkspaceRef,
            showToast: showToastRef,
            onImagePasted: onImagePastedRef,
          },
          selectionVersionBumpRef,
          readOnly
        ),
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

    // F-504 — bring the cited passage on screen. Citation clicks in the AI
    // chat fire `keepance:scroll-to-paragraph` (App.tsx onOpenFileAtPath);
    // the request resolves to a position by exact search for the cited
    // chunk's first searchable line, falling back to an approximate chunk
    // offset (resolveScrollPosition). Selects the landing line so the user
    // sees WHERE the citation points, not just the right file. Declared
    // AFTER the view-creation effect so the mount-time pending consume
    // always finds a live view (effects run in declaration order); the
    // pending slot covers the dispatch-before-mount race for freshly
    // opened tabs, the event covers already-mounted editors.
    useEffect(() => {
      if (!filePath) return undefined;
      const apply = (detail: ScrollToParagraphDetail) => {
        const view = viewRef.current;
        if (!view || detail.path !== filePath) return;
        const pos = resolveScrollPosition(view.state.doc.toString(), detail);
        const line = view.state.doc.lineAt(pos);
        view.dispatch({
          selection: { anchor: line.from, head: line.to },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
      };
      const pendingDetail = consumePendingScroll(filePath);
      if (pendingDetail) apply(pendingDetail);
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<ScrollToParagraphDetail>).detail;
        // The live event reached this mounted editor — clear any matching
        // pending slot so a later remount doesn't replay the request.
        if (detail.path === filePath) consumePendingScroll(filePath);
        apply(detail);
      };
      window.addEventListener(SCROLL_TO_PARAGRAPH_EVENT, handler);
      return () => window.removeEventListener(SCROLL_TO_PARAGRAPH_EVENT, handler);
    }, [filePath]);

    // Q13 — editor-level image drop. Only consumes drops whose first file
    // has an `image/*` MIME type; everything else falls through to the
    // workspace-global drop handler (`GlobalDropOverlay`) so the existing
    // file-upload behaviour is preserved.
    const handleEditorDrop = useCallback(
      async (event: React.DragEvent<HTMLDivElement>) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter((f) =>
          f.type.startsWith('image/')
        );
        if (imageFiles.length === 0) return; // let global overlay handle it
        event.preventDefault();
        event.stopPropagation();
        const view = viewRef.current;
        if (!view) return;
        for (const file of imageFiles) {
          const toastFn: ShowToast = (msg: string) => {
            const cb = showToastRef.current;
            if (cb) cb(msg);
            else console.warn('[MarkdownEditor]', msg);
          };
          // eslint-disable-next-line no-await-in-loop
          await processImageFile({
            file,
            view,
            ...(writeImageRef.current ? { writeImage: writeImageRef.current } : {}),
            hasWorkspace: hasWorkspaceRef.current,
            showToast: toastFn,
            onImagePasteResolved: () => setImagePasteCount((n) => n + 1),
          });
        }
      },
      []
    );

    return (
      <div
        className={`h-full w-full flex flex-col bg-background ${className}`}
        data-testid="wiki-link-autocomplete"
      >
        {hasUrlPastePlaceholder && (
          // Q12 — zero-height marker so tests can wait for the inflight
          // URL-title fetch to resolve.
          <span
            aria-hidden="true"
            data-testid="markdown-editor-url-paste-placeholder"
            className="sr-only"
          />
        )}
        {imagePasteCount > 0 && (
          // Q13 — testable signal that at least one image paste has been
          // processed. `data-paste-count` counts every paste so tests can
          // await a specific count when pasting the same image twice.
          <span
            aria-hidden="true"
            data-testid="markdown-editor-image-paste"
            data-paste-count={imagePasteCount}
            className="sr-only"
          />
        )}
        <div
          ref={containerRef}
          className="flex-1 min-h-0"
          data-testid="markdown-editor-paste-target"
          onClick={() => {
            // Ensure editor gets focus when clicking the container
            viewRef.current?.focus();
          }}
          onDragOver={(event) => {
            // Only intercept when the drag carries files we want to
            // swallow. Otherwise let the event bubble to the global
            // overlay.
            const types = event.dataTransfer?.types;
            if (types && Array.from(types).includes('Files')) {
              // Don't preventDefault unconditionally here; the global
              // overlay does that. We only need to allow image drops to
              // proceed onto the editor surface.
            }
          }}
          onDrop={handleEditorDrop}
        />
        {/* UX-30: word count footer. Matches the TipTap editors' styling. */}
        {!readOnly && <WordCountFooter text={currentText} />}

        {/* M5 — inline AI edit surfaces. The anchor button is suppressed
            while a session is active so the overlay isn't visually noisy. */}
        {!readOnly && (
          <>
            <InlineChatAnchor
              coords={aiState.anchorCoords}
              sessionActive={aiState.sessionActive}
              externalOpenSignal={aiState.externalOpenSignal}
              onSubmit={(instruction) => {
                void aiHandlers.submitInstruction(instruction);
              }}
            />
            {aiState.sessionActive && (
              <div className="px-4 pb-2">
                <StreamingDiffOverlay
                  original={aiState.sessionOriginal}
                  proposed={aiState.sessionProposed}
                  streaming={aiState.sessionStreaming}
                  resolutions={aiState.resolutions}
                  onAcceptHunk={aiHandlers.acceptHunk}
                  onRejectHunk={aiHandlers.rejectHunk}
                  onAcceptAll={aiHandlers.acceptAll}
                  onRejectAll={aiHandlers.rejectAll}
                  onCancel={aiHandlers.cancelSession}
                />
              </div>
            )}
          </>
        )}
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
