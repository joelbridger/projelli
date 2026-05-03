// Unit test — buildPluginEditorHandle adapter (CodeMirror EditorView -> PluginEditorHandle).
//
// Coverage:
//  - returns null when given a null view
//  - getContent returns the doc as a string
//  - getSelection returns the selected range with 1-based line/column
//  - getSelection returns null for an empty selection
//  - replaceSelection dispatches a transaction that replaces the selection
//  - insertAtCursor inserts at the cursor and advances the anchor

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { buildPluginEditorHandle } from '@/modules/plugins/buildPluginEditorHandle';

function makeView(initial: string): EditorView {
  return new EditorView({
    state: EditorState.create({ doc: initial }),
  });
}

describe('buildPluginEditorHandle', () => {
  it('returns null when given null', () => {
    expect(buildPluginEditorHandle(null)).toBeNull();
  });

  it('returns null when given undefined', () => {
    expect(buildPluginEditorHandle(undefined)).toBeNull();
  });

  it('getContent returns the doc as a string', () => {
    const view = makeView('hello world');
    const handle = buildPluginEditorHandle(view);
    expect(handle?.getContent()).toBe('hello world');
  });

  it('getSelection returns null when the cursor has no range', () => {
    const view = makeView('hello world');
    const handle = buildPluginEditorHandle(view);
    expect(handle?.getSelection()).toBeNull();
  });

  it('getSelection returns the selected range with 1-based line/column', () => {
    const view = makeView('hello world');
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    const handle = buildPluginEditorHandle(view);
    const sel = handle?.getSelection();
    expect(sel).toEqual({
      text: 'hello',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
    });
  });

  it('replaceSelection swaps the highlighted text', () => {
    const view = makeView('hello world');
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    const handle = buildPluginEditorHandle(view);
    handle?.replaceSelection('GOODBYE');
    expect(view.state.doc.toString()).toBe('GOODBYE world');
  });

  it('insertAtCursor inserts at the cursor and advances the anchor', () => {
    const view = makeView('hello world');
    view.dispatch({ selection: { anchor: 5, head: 5 } });
    const handle = buildPluginEditorHandle(view);
    handle?.insertAtCursor(',');
    expect(view.state.doc.toString()).toBe('hello, world');
    expect(view.state.selection.main.from).toBe(6);
  });
});
