# create-keepance-plugin

Official scaffolder for new [Keepance](https://keepance.com) plugins.

## Usage

```bash
npx create-keepance-plugin my-plugin
```

That command creates a `my-plugin/` directory in your current working directory containing:

- `manifest.json` (plugin metadata + permissions)
- `src/index.ts` (your plugin's entry point with a working `hello-world.greet` command)
- `package.json` (pinned to `@keepance/plugin-api` and Vite)
- `tsconfig.json` (strict TypeScript)
- `vite.config.ts` (bundles your plugin to a single-file IIFE in `dist/index.js`)
- `README.md`, `LICENSE`, `.gitignore`

After scaffolding it runs `npm install`, then prints the next-step commands.

## Flags

| Flag | Description |
|---|---|
| `<name>` | Required. The directory name and default plugin id. |
| `--no-install` | Skip the automatic `npm install` step. Useful for offline scaffolding or test fixtures. |
| `--force` | Overwrite an existing non-empty directory. Off by default. |
| `--help` | Print usage. |

## After scaffolding

```bash
cd my-plugin
npm run build           # produces dist/index.js (single-file IIFE)
```

Then sideload `dist/index.js` plus `manifest.json` into your local Keepance plugins folder. See the [Getting Started guide](https://keepance.com/docs/plugins/getting-started) for the full path on each platform.

## Documentation

- Full plugin guide: [keepance.com/docs/plugins](https://keepance.com/docs/plugins)
- Manifest reference: [keepance.com/docs/plugins/manifest-reference](https://keepance.com/docs/plugins/manifest-reference)
- API reference: [keepance.com/docs/plugins/api-reference](https://keepance.com/docs/plugins/api-reference)

## License

MIT
