# Word Counter

A Keepance plugin that shows live word and character counts for the active document in a sidebar panel.

## What it does

- Adds a "Word Counter" panel to the right sidebar.
- Polls the active editor every 500 ms and re-renders the panel with current word count, total characters, and characters excluding whitespace.
- Adds a toolbar button (icon: `hash`) that surfaces the current count as a notification.
- Registers the command `word-counter.count` for the command palette.

## Permissions

| Permission | Why |
|---|---|
| `editor:selection` | Required to read the active editor's content via `api.editor.getContent()`. v2.0 uses this permission as the gate for both selection access and full content reads. |

No other permissions requested. The plugin does not touch the workspace, the network, AI providers, or storage.

## Build

```bash
npm install
npm run build
```

Output: `dist/index.js` (single-file IIFE bundle).

## Sideload

Copy `manifest.json` and `dist/index.js` into your local Keepance plugins folder, then enable under Settings -> Plugins:

| OS | Path |
|---|---|
| Windows | `%APPDATA%/Keepance/plugins/word-counter/` |
| macOS | `~/Library/Application Support/Keepance/plugins/word-counter/` |
| Linux | `~/.local/share/Keepance/plugins/word-counter/` |

## Screenshot

> TODO: replace with a real screenshot of the Word Counter sidebar panel.

```
+---------------------------------+
|  WORD COUNTER                   |
|                                 |
|  1,247                          |
|  words                          |
|                                 |
|  7,823                          |
|  characters                     |
|                                 |
|  6,576                          |
|  characters (no spaces)         |
|                                 |
|  Updates every 500 ms.          |
+---------------------------------+
```

## License

MIT
