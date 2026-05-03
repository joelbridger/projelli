// Tests for EditorHost.
//
// Coverage:
//  - handle('editor.getContent') returns the active editor's content
//  - handle('editor.getSelection') returns selection or null
//  - handle('editor.replaceSelection') and 'editor.insertAtCursor' mutate
//  - handle throws not-found when no active editor
//  - handle throws invalid-args on non-string text args
//  - handle rejects unknown methods
//  - handlesMethod is true only for the 4 editor methods
//  - setActiveEditorAccessor swaps the accessor at runtime

import { describe, it, expect, beforeEach } from 'vitest';

import { EditorHost, EditorHostError, type PluginEditorHandle } from '@/modules/plugins/hosts/EditorHost';
import type { PluginEditorSelection } from '@/types/plugin';

class FakeEditor implements PluginEditorHandle {
  content = 'hello world';
  selection: PluginEditorSelection | null = {
    text: 'hello',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
  };
  inserted: string[] = [];
  replaced: string[] = [];
  getContent(): string {
    return this.content;
  }
  getSelection(): PluginEditorSelection | null {
    return this.selection;
  }
  replaceSelection(text: string): void {
    this.replaced.push(text);
  }
  insertAtCursor(text: string): void {
    this.inserted.push(text);
  }
}

let editor: FakeEditor;
let host: EditorHost;

beforeEach(() => {
  editor = new FakeEditor();
  host = new EditorHost({ getActiveEditor: () => editor });
});

describe('EditorHost.handle', () => {
  it('getContent returns the editor content', () => {
    const result = host.handle({ pluginId: 'p', method: 'editor.getContent', args: [] });
    expect(result).toBe('hello world');
  });

  it('getSelection returns the editor selection', () => {
    const result = host.handle({ pluginId: 'p', method: 'editor.getSelection', args: [] });
    expect(result).toEqual(editor.selection);
  });

  it('getSelection returns null when nothing is selected', () => {
    editor.selection = null;
    const result = host.handle({ pluginId: 'p', method: 'editor.getSelection', args: [] });
    expect(result).toBeNull();
  });

  it('replaceSelection mutates the editor', () => {
    host.handle({ pluginId: 'p', method: 'editor.replaceSelection', args: ['HELLO'] });
    expect(editor.replaced).toEqual(['HELLO']);
  });

  it('insertAtCursor mutates the editor', () => {
    host.handle({ pluginId: 'p', method: 'editor.insertAtCursor', args: ['---\n'] });
    expect(editor.inserted).toEqual(['---\n']);
  });

  it('throws invalid-args when text arg is missing or non-string', () => {
    expect(() =>
      host.handle({ pluginId: 'p', method: 'editor.replaceSelection', args: [42] }),
    ).toThrow(EditorHostError);
    expect(() =>
      host.handle({ pluginId: 'p', method: 'editor.insertAtCursor', args: [] }),
    ).toThrow(EditorHostError);
  });

  it('throws not-found when no active editor is available', () => {
    const noopHost = new EditorHost({ getActiveEditor: () => null });
    expect(() =>
      noopHost.handle({ pluginId: 'p', method: 'editor.getContent', args: [] }),
    ).toThrow(EditorHostError);
  });

  it('throws on unknown methods', () => {
    expect(() =>
      host.handle({ pluginId: 'p', method: 'editor.unknown', args: [] }),
    ).toThrow(EditorHostError);
  });
});

describe('EditorHost.handlesMethod', () => {
  it('returns true only for the 4 editor methods', () => {
    expect(host.handlesMethod('editor.getContent')).toBe(true);
    expect(host.handlesMethod('editor.getSelection')).toBe(true);
    expect(host.handlesMethod('editor.replaceSelection')).toBe(true);
    expect(host.handlesMethod('editor.insertAtCursor')).toBe(true);
    expect(host.handlesMethod('editor.unknown')).toBe(false);
    expect(host.handlesMethod('workspace.readFile')).toBe(false);
  });
});

describe('EditorHost.setActiveEditorAccessor', () => {
  it('swaps the accessor at runtime', () => {
    const editorB = new FakeEditor();
    editorB.content = 'replaced';
    host.setActiveEditorAccessor(() => editorB);
    expect(host.handle({ pluginId: 'p', method: 'editor.getContent', args: [] })).toBe('replaced');
  });
});

describe('EditorHost — default accessor', () => {
  it('returns null by default so the host is constructible without a wired accessor', () => {
    const bare = new EditorHost();
    expect(() =>
      bare.handle({ pluginId: 'p', method: 'editor.getContent', args: [] }),
    ).toThrow(EditorHostError);
  });
});
