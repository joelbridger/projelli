# __PLUGIN_NAME__

A Keepance plugin scaffolded with [create-keepance-plugin](https://www.npmjs.com/package/create-keepance-plugin).

## Develop

```bash
npm install         # if the scaffolder skipped install
npm run dev         # rebuilds dist/index.js on every change
```

## Build

```bash
npm run build
```

The build emits a single-file IIFE bundle at `dist/index.js`. That file plus `manifest.json` is what the Keepance runtime loads.

## Sideload locally

Copy `manifest.json` and the built `dist/index.js` into your Keepance plugins folder:

| OS | Path |
|---|---|
| Windows | `%APPDATA%/Keepance/plugins/__PLUGIN_ID__/` |
| macOS | `~/Library/Application Support/Keepance/plugins/__PLUGIN_ID__/` |
| Linux | `~/.local/share/Keepance/plugins/__PLUGIN_ID__/` |

The plugin folder must contain `manifest.json` at the top and the bundled JS at the path declared by `manifest.main` (default `index.js`).

Restart Keepance, then enable your plugin under Settings → Plugins.

## Permissions

This starter declares no permissions. Commands, toolbar buttons, sidebar panels, settings pages, notifications, and storage all work without permission grants. To touch the workspace, editor selection, AI provider, or network, declare the relevant permission in `manifest.json`. See [keepance.com/docs/plugins/permissions](https://keepance.com/docs/plugins/permissions).

## Documentation

- Plugin guide: [keepance.com/docs/plugins](https://keepance.com/docs/plugins)
- API reference: [keepance.com/docs/plugins/api-reference](https://keepance.com/docs/plugins/api-reference)
- Manifest reference: [keepance.com/docs/plugins/manifest-reference](https://keepance.com/docs/plugins/manifest-reference)

## License

MIT
