# projelli/community-plugins

The community catalog of plugins for [Projelli](https://projelli.com).

Anything in this repo's `entries/` folder shows up in the in-app marketplace under Plugins. Users browse, install with one click, and the plugin's worker spins up inside Projelli's sandboxed runtime.

## What's in here

- `entries/<id>/` — one folder per plugin, each with a manifest, the built JS bundle, and screenshots.
- `catalog.json` — the marketplace index. Auto-generated from `entries/` on every push to `main`. Never hand-edit.
- `scripts/build-catalog.mjs` — the script that regenerates `catalog.json` and per-entry tarballs. Runs in CI; you can also run it locally to validate your submission before opening a PR.
- `.github/workflows/build-catalog.yml` — the GitHub Action that runs the script on every merge.

## How to submit a plugin

### 1. Build your plugin

Follow the [Projelli plugin docs](https://projelli.com/docs/plugins/getting-started) to scaffold and build a plugin. The output is a `manifest.json` and a `dist/index.js` (the bundled worker entry).

### 2. Fork this repo

```
gh repo fork projelli/community-plugins
```

Or click Fork on github.com.

### 3. Add your entry

Create a folder under `entries/` whose name matches the `id` in your manifest:

```
entries/my-plugin/
├── manifest.json
├── index.js          (your built bundle, copied from dist/)
└── screenshots/
    └── main.png
```

The folder name MUST match `manifest.id` exactly. The build script enforces this.

### 4. Author the manifest

Your `manifest.json` follows the [PluginManifest schema](https://github.com/projelli/projelli/blob/master/src/types/plugin.ts). Required fields:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "author": { "name": "Your Name", "githubUser": "your-handle" },
  "description": "One-sentence pitch for what this plugin does.",
  "main": "index.js",
  "permissions": ["editor:selection"],
  "minProjelliVersion": "2.0.0",
  "category": "writing",
  "tags": ["editor", "stats"],
  "screenshots": ["screenshots/main.png"],
  "license": "MIT",
  "homepage": "https://github.com/your-handle/my-plugin"
}
```

`screenshots` paths are relative to your entry folder. They get rewritten to absolute `raw.githubusercontent.com/...` URLs when the catalog builds.

### 5. Validate locally

```
npm install --no-save zod@^4.3.6
PROJELLI_CATALOG_KIND=plugins node scripts/build-catalog.mjs
```

If your manifest validates, the script writes `catalog.json` plus `entries/my-plugin/tarball.tar.gz` and `entries/my-plugin/checksum.txt`. If it fails, you'll see a list of validation errors. Fix and re-run.

You can leave the generated tarball + checksum out of your PR; the Action regenerates them after merge.

### 6. Open a PR

```
git checkout -b add-my-plugin
git add entries/my-plugin/
git commit -m "Add my-plugin v1.0.0"
git push origin add-my-plugin
gh pr create --base main
```

PR title format: `Add <plugin-name> v<version>`.

In the description, include:

- One paragraph explaining what the plugin does.
- The list of permissions you declare and why each is needed.
- Any external services your plugin contacts (if you declare `network`).
- A link to your plugin's source repo if it's public.

## Permissions

Plugins run inside a sandboxed worker and can only do what they declare in `permissions`. The full set:

| Permission | Allows |
|---|---|
| `workspace:read` | List + read files in the user's workspace |
| `workspace:write` | Create, modify, and delete files |
| `editor:selection` | Read the current editor selection |
| `editor:write` | Replace the selection or insert text at the cursor |
| `ai:invoke` | Call the user's configured AI provider on their behalf |
| `network` | Make outbound HTTP requests to arbitrary URLs |

UI-only capabilities (commands, toolbar buttons, sidebar panels, settings pages, notifications, plugin-local storage) are unconditional and don't require a permission.

### Why minimal permissions matter

Every permission you declare is shown to the user in a consent dialog at install time. Users see exactly what your plugin can do before they accept. A plugin that asks for `workspace:write` and `network` together is asking for a lot of trust. A plugin that asks for `editor:selection` only is easy to trust.

Practical rules:

- **Don't ask for what you won't use.** If your plugin reads the selection but never writes back, declare `editor:selection` and not `editor:write`.
- **Pick the narrowest scope that works.** `editor:selection` is narrower than `workspace:read` for a plugin that only needs the current paragraph.
- **Justify `network` and `ai:invoke` in the README.** These are the two permissions users scrutinize hardest. Tell them which hosts you contact and what you send.
- **Don't use `workspace:write` to fake `editor:write`.** They look similar but the consent UX is very different.

The reviewer will push back on any permission that isn't justified by the plugin's actual behavior.

## Review criteria

A maintainer reviews every submission. We check for:

- **Schema validity.** The Action runs `build-catalog.mjs` on every PR. If it fails, the PR can't merge.
- **Permissions match behavior.** What you declare matches what the bundle actually does. We read the bundle. If it's obfuscated, we reject.
- **No secrets in the bundle.** No hardcoded API keys, tokens, or credentials.
- **Code is readable.** We need to be able to audit the bundle. Source maps or a linked source repo help.
- **Description matches behavior.** The plugin does what the README says it does, no more.
- **Reasonable scope.** Plugins that do one focused thing land faster than plugins that try to do everything.

Most reviews finish within a few days. Push another commit to the same branch if we ask for changes.

## License

By submitting a plugin, you agree to publish it under MIT or a compatible permissive license (Apache-2.0, BSD-3-Clause, ISC). Add a `LICENSE` file inside your entry folder if you want to be explicit. Closed-source plugins aren't accepted.

## Reporting a malicious plugin

If you find a plugin in the marketplace doing something it shouldn't (asking for permissions it doesn't need, exfiltrating data, hiding behavior in the bundle), open an issue with the plugin id and what you observed. We take takedowns seriously and will pull entries that violate the trust model.

## Updating an existing plugin

Bump `version` in your manifest, replace `index.js` with the new build, and open a PR with the changes. The catalog always serves the latest version.

## Removing a plugin

Open a PR that deletes the entry folder. Existing installs in user copies of Projelli keep working; the plugin just disappears from the marketplace.
