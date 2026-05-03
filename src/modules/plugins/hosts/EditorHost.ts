// Plugin runner — Editor host adapter (Wave 3).
//
// Plugins call `api.editor.getSelection / getContent / replaceSelection /
// insertAtCursor`. Those flow as `api-call` messages, so the bridge enforces
// the required permission (per Group I's permission map: `editor:selection`
// for read, `editor:write` for mutate) and dispatches into this host.
//
// The codebase has no `EditorService` singleton — the active editor is a
// CodeMirror 6 `EditorView` held by the `MarkdownEditor` component's ref.
// Instead of forcing the host to reach into React state, we accept a
// `getActiveEditor()` callback at construction. Group VII's PluginManager
// will wire that callback to whatever React-internal "active editor view"
// reference it tracks (the App-level container around `MarkdownEditor`).
//
// The callback returns a tiny `PluginEditorHandle` that exposes only the
// operations we need. This keeps the host decoupled from CodeMirror types
// and makes tests trivial — they pass a literal handle.
//
// All four methods rely on the bridge's permission gate; this host does
// NOT re-check permissions. If the bridge dispatches the call, the plugin
// has the permission already.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 6.1)

import type { PluginEditorSelection } from '@/types/plugin';

import type { PluginApiDispatchCall } from '../PluginAPIBridge';

/**
 * Minimal editor surface the host depends on. Real implementation wraps
 * a CodeMirror `EditorView` (via the `MarkdownEditor` ref); tests pass a
 * literal object.
 */
export interface PluginEditorHandle {
  getContent(): string;
  getSelection(): PluginEditorSelection | null;
  replaceSelection(text: string): void;
  insertAtCursor(text: string): void;
}

/**
 * Returns the currently-active editor handle, or `null` when no editor is
 * focused / no file is open. `null` results are surfaced to the plugin as
 * `not-found` errors.
 */
export type ActiveEditorAccessor = () => PluginEditorHandle | null;

export class EditorHostError extends Error {
  readonly code: 'invalid-args' | 'not-found';
  constructor(code: 'invalid-args' | 'not-found', message: string) {
    super(message);
    this.code = code;
    this.name = 'EditorHostError';
  }
}

export interface EditorHostOptions {
  /**
   * Required. The function the host calls on every dispatch to resolve the
   * currently-active editor. Defaults to a stub that always returns null
   * so the host stays constructible from tests / PluginManager bootstrap
   * before the real wiring is in place.
   */
  getActiveEditor?: ActiveEditorAccessor;
}

export class EditorHost {
  private getActiveEditor: ActiveEditorAccessor;

  constructor(options: EditorHostOptions = {}) {
    this.getActiveEditor = options.getActiveEditor ?? (() => null);
  }

  /** Replace the active-editor accessor at runtime. */
  setActiveEditorAccessor(accessor: ActiveEditorAccessor): void {
    this.getActiveEditor = accessor;
  }

  /** Predicate the dispatch coordinator uses to route methods. */
  handlesMethod(method: string): boolean {
    return (
      method === 'editor.getSelection' ||
      method === 'editor.getContent' ||
      method === 'editor.replaceSelection' ||
      method === 'editor.insertAtCursor'
    );
  }

  handle(call: PluginApiDispatchCall): unknown {
    const editor = this.getActiveEditor();
    if (!editor) {
      throw new EditorHostError('not-found', 'no active editor');
    }
    switch (call.method) {
      case 'editor.getSelection':
        return editor.getSelection();
      case 'editor.getContent':
        return editor.getContent();
      case 'editor.replaceSelection': {
        const text = requireText(call.args[0], 'editor.replaceSelection text');
        editor.replaceSelection(text);
        return undefined;
      }
      case 'editor.insertAtCursor': {
        const text = requireText(call.args[0], 'editor.insertAtCursor text');
        editor.insertAtCursor(text);
        return undefined;
      }
      default:
        throw new EditorHostError(
          'invalid-args',
          `EditorHost cannot handle method ${call.method}`,
        );
    }
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new EditorHostError('invalid-args', `${label} must be a string`);
  }
  return value;
}
