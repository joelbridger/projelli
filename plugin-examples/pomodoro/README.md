# Pomodoro

A Keepance plugin that runs the classic 25-minute focus / 5-minute break cycle, with a sidebar readout, toolbar controls, and persistent state.

## What it does

- Adds a "Pomodoro" sidebar panel showing the current phase (Focus or Break), remaining time, and how many full cycles you've completed.
- Adds three toolbar buttons:
  - `play`, runs `pomodoro.start`
  - `pause`, runs `pomodoro.pause`
  - `rotate-ccw`, runs `pomodoro.reset`
- Sends a desktop-style notification at every phase transition (focus done -> break, break done -> ready).
- Persists timer state across reloads via `api.storage`. The timer pauses itself on reload; you resume manually so a forgotten session doesn't keep counting overnight.

## Permissions

This plugin declares **no permissions**.

`api.storage`, `api.notify`, `api.commands`, `api.toolbar`, and `api.sidebar` are unconditional capabilities in the v2.0 plugin API. Pomodoro doesn't touch the workspace, the editor, the network, or AI providers.

## A note on sidebar interactivity in v2.0

Sidebar panels render inside a sandboxed iframe. v2.0 doesn't ship a back-channel from the iframe to the plugin worker, so inline `onclick` handlers in the panel HTML can't trigger plugin code directly. Pomodoro works around this by exposing every action as both a registered command (so the command palette finds it) and a toolbar button (so it's one click away). v2.1 will likely add an iframe-to-worker message bridge; when it does, this plugin will gain in-panel buttons.

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
| Windows | `%APPDATA%/Keepance/plugins/pomodoro/` |
| macOS | `~/Library/Application Support/Keepance/plugins/pomodoro/` |
| Linux | `~/.local/share/Keepance/plugins/pomodoro/` |

## Screenshot

> TODO: replace with a real screenshot of the Pomodoro sidebar panel.

```
+---------------------------------+
|              FOCUS              |
|                                 |
|             24:13               |
|                                 |
|  Running . 0 cycles completed   |
|                                 |
|  Use the toolbar buttons or     |
|  the command palette:           |
|     pomodoro.start              |
|     pomodoro.pause              |
|     pomodoro.reset              |
+---------------------------------+
```

## License

MIT
