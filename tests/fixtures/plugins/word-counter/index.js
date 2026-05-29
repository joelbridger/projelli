// Word Counter — example plugin for the Keepance sandboxed plugin runner.
//
// Three contributions:
//   - command   `word-counter.count`  returns { words, characters } for the
//                                     current editor buffer.
//   - toolbar   button "wc-button"    invokes `word-counter.count`.
//   - sidebar   panel  "wc-panel"     renders a static HTML scaffold; the
//                                     command refreshes the count via the
//                                     surrounding host (notify hook in v2.0).
//
// Permissions declared in manifest.json: ["editor:selection"]. That permission
// covers `editor.getContent` per the runner's permission map.
//
// Plain JS (no build step). Loaded by `PluginRuntime` via dynamic import of a
// blob URL in production, and via the inline loader in tests.

function countWords(text) {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function countCharacters(text) {
  return text ? text.length : 0;
}

function summarize(text) {
  return {
    words: countWords(text),
    characters: countCharacters(text),
  };
}

export default {
  async activate(api) {
    api.commands.register('word-counter.count', async () => {
      const content = await api.editor.getContent();
      const summary = summarize(content);
      api.notify.info(
        `Word Counter: ${String(summary.words)} words, ${String(summary.characters)} characters`,
      );
      return summary;
    });

    api.toolbar.addButton({
      id: 'wc-button',
      icon: 'hash',
      tooltip: 'Count words in the active document',
      command: 'word-counter.count',
    });

    api.sidebar.addPanel({
      id: 'wc-panel',
      title: 'Word Counter',
      html: [
        '<div style="font-family: system-ui, sans-serif; padding: 12px;">',
        '<h3 style="margin-top: 0;">Word Counter</h3>',
        '<p>Click the toolbar button or run <code>word-counter.count</code> from the command palette to see live stats for the current document.</p>',
        '<p style="color: #888;">Live updates land in v2.1 (sidebar two-way messaging).</p>',
        '</div>',
      ].join(''),
    });
  },
};
