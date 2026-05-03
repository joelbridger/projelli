// Plugin runner — CodeMirror EditorView -> PluginEditorHandle adapter.
//
// `EditorHost` (Group VI) requires a tiny, framework-free `PluginEditorHandle`
// so the host stays decoupled from CodeMirror types. App.tsx owns the
// CodeMirror `EditorView` indirectly through the `MarkdownEditor` ref it
// passes into MainPanel; this adapter converts between the two.
//
// Used only on the main thread. Returns `null` when no view is available
// (no editor mounted, file type without a CodeMirror surface, etc.) so the
// EditorHost can surface the canonical `not-found` error to the plugin.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 8.5)

import type { EditorView } from '@codemirror/view';

import type { PluginEditorHandle } from './hosts/EditorHost';
import type { PluginEditorSelection } from '@/types/plugin';

/**
 * Build a `PluginEditorHandle` for a given CodeMirror view. Returns `null`
 * when `view` is null so callers can pipe a possibly-null ref directly into
 * the manager's `setActiveEditor(() => buildPluginEditorHandle(viewRef.current))`.
 */
export function buildPluginEditorHandle(
  view: EditorView | null | undefined,
): PluginEditorHandle | null {
  if (!view) return null;
  return {
    getContent(): string {
      return view.state.doc.toString();
    },
    getSelection(): PluginEditorSelection | null {
      const { from, to } = view.state.selection.main;
      if (from === to) return null;
      const doc = view.state.doc;
      const startLine = doc.lineAt(from);
      const endLine = doc.lineAt(to);
      return {
        text: doc.sliceString(from, to),
        range: {
          startLine: startLine.number,
          startColumn: from - startLine.from + 1,
          endLine: endLine.number,
          endColumn: to - endLine.from + 1,
        },
      };
    },
    replaceSelection(text: string): void {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
    insertAtCursor(text: string): void {
      const { from } = view.state.selection.main;
      view.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
  };
}
