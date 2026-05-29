import type { PluginAPI, PluginModule } from '@keepance/plugin-api';

// Word Counter - example Keepance plugin.
//
// Demonstrates:
//   - api.commands.register / api.commands.invoke
//   - api.editor.getContent (gated by editor:selection in v2.0; see note below)
//   - api.toolbar.addButton
//   - api.sidebar.addPanel (re-rendered on every count to refresh the body)
//   - api.notify.info
//
// Permission note: the v2.0 manifest schema doesn't have a separate
// `editor:read` permission. `editor:selection` is the closest fit and the
// runner's permission map treats it as the gate for editor.getContent.

const POLL_MS = 500;

interface Stats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
}

function computeStats(text: string): Stats {
  if (!text) return { words: 0, characters: 0, charactersNoSpaces: 0 };
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s+/g, '').length;
  return { words, characters, charactersNoSpaces };
}

function renderPanelHtml(stats: Stats): string {
  return [
    '<div style="font-family: system-ui, -apple-system, sans-serif; padding: 16px; color: #1f2937;">',
    '<h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">Word Counter</h2>',
    '<div style="display: grid; gap: 10px;">',
    `<div><div style="font-size: 28px; font-weight: 600; line-height: 1;">${stats.words.toLocaleString()}</div><div style="font-size: 12px; color: #6b7280; margin-top: 4px;">words</div></div>`,
    `<div><div style="font-size: 18px; font-weight: 500;">${stats.characters.toLocaleString()}</div><div style="font-size: 12px; color: #6b7280; margin-top: 2px;">characters</div></div>`,
    `<div><div style="font-size: 18px; font-weight: 500;">${stats.charactersNoSpaces.toLocaleString()}</div><div style="font-size: 12px; color: #6b7280; margin-top: 2px;">characters (no spaces)</div></div>`,
    '</div>',
    '<p style="margin: 16px 0 0; font-size: 11px; color: #9ca3af;">Updates every 500 ms.</p>',
    '</div>',
  ].join('');
}

const plugin: PluginModule = {
  async activate(api: PluginAPI) {
    let lastSerialized = '';

    const refresh = async (): Promise<Stats> => {
      let content = '';
      try {
        content = await api.editor.getContent();
      } catch {
        // No active editor yet, or permission not granted. Render zeros.
      }
      const stats = computeStats(content);
      const serialized = `${stats.words}|${stats.characters}|${stats.charactersNoSpaces}`;
      if (serialized !== lastSerialized) {
        lastSerialized = serialized;
        api.sidebar.addPanel({
          id: 'word-counter-panel',
          title: 'Word Counter',
          html: renderPanelHtml(stats),
        });
      }
      return stats;
    };

    api.commands.register('word-counter.count', async () => {
      const stats = await refresh();
      api.notify.info(
        `${stats.words.toLocaleString()} words, ${stats.characters.toLocaleString()} characters`,
      );
      return stats;
    });

    api.toolbar.addButton({
      id: 'word-counter-button',
      icon: 'hash',
      tooltip: 'Count words in the active document',
      command: 'word-counter.count',
    });

    // Initial render so the panel appears even before the first poll.
    await refresh();

    setInterval(() => {
      void refresh();
    }, POLL_MS);
  },
};

export default plugin;
