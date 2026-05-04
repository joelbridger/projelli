# __PLUGIN_NAME__

A Projelli plugin scaffolded with [create-projelli-plugin](https://www.npmjs.com/package/create-projelli-plugin).

## Develop

```bash
npm install         # if the scaffolder skipped install
npm run dev         # rebuilds dist/index.js on every change
```

## Build

```bash
npm run build
```

The build emits a single-file IIFE bundle at `dist/index.js`. That file plus `manifest.json` is what the Projelli runtime loads.

## Sideload locally

Copy `manifest.json` and the built `dist/index.js` into your Projelli plugins folder:

| OS | Path |
|---|---|
| Windows | `%APPDATA%/Projelli/plugins/__PLUGIN_ID__/` |
| macOS | `~/Library/Application Support/Projelli/plugins/__PLUGIN_ID__/` |
| Linux | `~/.local/share/Projelli/plugins/__PLUGIN_ID__/` |

The plugin folder must contain `manifest.json` at the top and the bundled JS at the path declared by `manifest.main` (default `index.js`).

Restart Projelli, then enable your plugin under Settings → Plugins.

## Permissions

This starter declares no permissions. Commands, toolbar buttons, sidebar panels, settings pages, notifications, and storage all work without permission grants. To touch the workspace, editor selection, AI provider, or network, declare the relevant permission in `manifest.json`. See [projelli.com/docs/plugins/permissions](https://projelli.com/docs/plugins/permissions).

## Documentation

- Plugin guide: [projelli.com/docs/plugins](https://projelli.com/docs/plugins)
- API reference: [projelli.com/docs/plugins/api-reference](https://projelli.com/docs/plugins/api-reference)
- Manifest reference: [projelli.com/docs/plugins/manifest-reference](https://projelli.com/docs/plugins/manifest-reference)

## License

MIT
