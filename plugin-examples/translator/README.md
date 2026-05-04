# Translator

A Projelli plugin that translates the selected text into a target language using your configured AI provider.

## What it does

- Adds a "Translate selection" toolbar button (icon: `languages`).
- Registers the command `translator.translate` for the command palette.
- Adds a "Translator" settings page where you pick the target language (default: Spanish).
- On invocation, reads the current selection, sends it to your configured AI provider with a translation prompt, and replaces the selection with the result.

## Permissions

| Permission | Why |
|---|---|
| `editor:selection` | Read the current selection via `api.editor.getSelection()`. |
| `editor:write` | Replace the selection in place via `api.editor.replaceSelection()`. |
| `ai:invoke` | Send the translation request to your configured AI provider (BYOK). The plugin never sees your API key; the host injects it. |

## Build

```bash
npm install
npm run build
```

Output: `dist/index.js` (single-file IIFE bundle).

## Sideload

Copy `manifest.json` and `dist/index.js` into your local Projelli plugins folder, then enable under Settings -> Plugins:

| OS | Path |
|---|---|
| Windows | `%APPDATA%/Projelli/plugins/translator/` |
| macOS | `~/Library/Application Support/Projelli/plugins/translator/` |
| Linux | `~/.local/share/Projelli/plugins/translator/` |

## Settings

Open Settings -> Plugins -> Translator to pick a target language. Choices include Spanish, French, German, Italian, Portuguese, Dutch, Japanese, Korean, Mandarin Chinese, Arabic, Hindi, Russian, and English.

## Screenshot

> TODO: replace with a real screenshot of the Translator toolbar button in action.

```
Before:                     After (target = French):

  Hello, how are you?         Bonjour, comment allez-vous ?
  ^^^^^^^^^^^^^^^^^^^         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  (selected)                  (replaces selection)
```

## License

MIT
