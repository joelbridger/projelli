# Projelli v2.0 Stream C5: Plugin Developer Experience + Scaffolding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the developer surface for the Projelli plugin ecosystem. By end of this stream, a third-party developer can run `npx create-projelli-plugin my-plugin` to scaffold a TypeScript project with sample plugin + build script + manifest + README + MIT license, install `@projelli/plugin-api` for typed API access, read public docs at `docs.projelli.com/plugins`, and submit their built plugin to the marketplace via PR. Four real working example plugins (Word counter, Translator, Pomodoro, Mermaid preview) are authored as deliverables, exercising different parts of the API surface; they ship in C6's seed catalog.

**Branch:** `feature/stream-c5-dev-experience`. Branches off `master` (after #21 templates marketplace AND C3 plugin runner AND C4 marketplace UI all merge; if any of those is not yet merged, branch off whichever is the most-downstream and rebase later).

**Why C5 after C3 + C4 (not in parallel with them):** the `@projelli/plugin-api` package mirrors the `PluginAPI` types from C3. The example plugins are tested against the C3 runtime + C4 marketplace install flow. Authoring against an unstable surface burns time. Once C3 + C4 land, C5 can lock in the v1.0 plugin API contract.

**Architecture:**

- **`@projelli/plugin-api`**: a tiny published-from-monorepo TypeScript types package. Plugin authors `import type { PluginAPI } from '@projelli/plugin-api'` and get full IntelliSense. Released independently of Projelli app version; semver-versioned.
- **`create-projelli-plugin`**: npm package, run via `npx create-projelli-plugin <name>`. Scaffolds a TypeScript project with `manifest.json`, `index.ts`, `tsconfig.json`, `package.json`, `vite.config.ts` (single-file IIFE bundle output), `README.md`, `LICENSE` (MIT). Sample plugin registers a hello-world command.
- **Docs site**: static markdown content under `~/projelli/website/docs/plugins/`, built into the existing website. Same Caddy + tunnel pattern. Sections: Getting Started, Manifest Reference, Permissions, API Reference, Publishing, Examples.
- **Example plugins**: standalone TypeScript projects under `~/projelli/plugin-examples/<name>/`. Each is a real working plugin scaffolded from the template. C6 vendors their built artifacts into the seed catalog.

**Tech Stack:** TypeScript 5, Vite 5 (for plugin builds), Vitest, npm publish (for `@projelli/plugin-api` and `create-projelli-plugin`), shadcn/ui (none here, the plugin examples use the host-provided UI registry).

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` section 6.7.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `packages/plugin-api/package.json` | `@projelli/plugin-api` package manifest. `"type": "module"`, exports `./dist/index.d.ts` types only |
| `packages/plugin-api/src/index.ts` | Re-exports plugin types from app's `src/types/plugin.ts`: `PluginAPI`, `PluginManifest`, `PluginPermission`, all spec types |
| `packages/plugin-api/tsconfig.json` | Emit `.d.ts` only |
| `packages/plugin-api/README.md` | One-page summary + install + link to full docs |
| `packages/plugin-api/LICENSE` | MIT |
| `packages/create-projelli-plugin/package.json` | CLI package. `"bin": { "create-projelli-plugin": "./bin/create.js" }` |
| `packages/create-projelli-plugin/bin/create.js` | Node CLI: prompts for name + permissions, copies template, runs `npm install`, prints next-steps |
| `packages/create-projelli-plugin/template/` | Scaffolded project template |
| `packages/create-projelli-plugin/template/manifest.json` | Sample manifest with placeholders |
| `packages/create-projelli-plugin/template/index.ts` | Hello-world plugin: registers a command + a toolbar button |
| `packages/create-projelli-plugin/template/package.json` | Plugin's own package.json: depends on `@projelli/plugin-api`, has `"build"` script using Vite |
| `packages/create-projelli-plugin/template/tsconfig.json` | Strict TypeScript |
| `packages/create-projelli-plugin/template/vite.config.ts` | Bundles plugin to single-file IIFE for distribution |
| `packages/create-projelli-plugin/template/README.md` | Plugin author's README with build + publish instructions |
| `packages/create-projelli-plugin/template/.gitignore` | Standard |
| `packages/create-projelli-plugin/template/LICENSE` | MIT |
| `packages/create-projelli-plugin/README.md` | CLI README: usage + flags |
| `tests/unit/packages/plugin-api.test.ts` | Smoke test: imports work, types compile |
| `tests/unit/packages/create-projelli-plugin.test.ts` | Smoke test: CLI scaffolds template + installs deps + plugin builds |
| `website/docs/plugins/index.html` | Docs hub: links to all sections |
| `website/docs/plugins/getting-started.html` | Getting started: install + scaffold + build + sideload |
| `website/docs/plugins/manifest-reference.html` | Every manifest field documented |
| `website/docs/plugins/permissions.html` | Every permission documented with examples + risk notes |
| `website/docs/plugins/api-reference.html` | Every PluginAPI method documented |
| `website/docs/plugins/publishing.html` | How to submit to the marketplace |
| `website/docs/plugins/examples.html` | Annotated walkthrough of the 4 example plugins |
| `plugin-examples/word-counter/manifest.json` | Real plugin: live word count in a sidebar panel |
| `plugin-examples/word-counter/index.ts` | Implementation |
| `plugin-examples/word-counter/package.json` | Build setup |
| `plugin-examples/word-counter/README.md` | What it does + screenshot |
| `plugin-examples/translator/manifest.json` | Real plugin: translate selection via user's AI provider |
| `plugin-examples/translator/index.ts` | Implementation |
| `plugin-examples/translator/package.json` | Build setup |
| `plugin-examples/translator/README.md` | ... |
| `plugin-examples/pomodoro/manifest.json` | Real plugin: pomodoro timer in sidebar panel |
| `plugin-examples/pomodoro/index.ts` | Implementation |
| `plugin-examples/pomodoro/package.json` | Build setup |
| `plugin-examples/pomodoro/README.md` | ... |
| `plugin-examples/mermaid-preview/manifest.json` | Real plugin: rendered preview pane for mermaid diagrams in markdown |
| `plugin-examples/mermaid-preview/index.ts` | Implementation |
| `plugin-examples/mermaid-preview/package.json` | Build setup |
| `plugin-examples/mermaid-preview/README.md` | ... |

### Files to modify

| Path | Change |
|---|---|
| `package.json` (root) | Add `"workspaces": ["packages/*", "plugin-examples/*"]` if not already configured. Add a top-level `npm run build:plugins` script that builds all 4 examples |
| `~/projelli/website/index.html` (or wherever the nav is) | Add a "Plugins" link in docs / dev section pointing to `/docs/plugins/` |
| `tsconfig.json` (root) | Path mapping for `@projelli/plugin-api` to `packages/plugin-api/src/` for in-monorepo imports |
| `infra/deploy.sh` | Pick up the new `website/docs/plugins/` files automatically (no script change needed if rsync is already recursive — verify) |

### Files to NOT modify

- App runtime code (C3 owns)
- Marketplace UI (C4 owns)
- Other streams' files

---

## Task Decomposition

There are 6 task groups.

- Group I: `@projelli/plugin-api` package
- Group II: `create-projelli-plugin` CLI + template
- Group III: Word counter + Translator example plugins
- Group IV: Pomodoro + Mermaid preview example plugins
- Group V: Docs site content (6 pages)
- Group VI: Smoke tests + final PR

---

## Group I: `@projelli/plugin-api` package

- [ ] **Task 1.1** — Create `packages/plugin-api/` monorepo structure. Add to root `package.json` workspaces if not already configured.
- [ ] **Task 1.2** — `packages/plugin-api/src/index.ts` re-exports the relevant types from app's `src/types/plugin.ts`. Use `export type { PluginAPI, PluginManifest, PluginPermission, ToolbarButtonSpec, SidebarPanelSpec, SettingsPageSpec, CommandSpec } from '../../../src/types/plugin'` (or a script that copies them at build time if relative imports become awkward).
- [ ] **Task 1.3** — `tsconfig.json` for the package: `"declaration": true, "emitDeclarationOnly": true, "outDir": "./dist"`. Build script: `"build": "tsc"`.
- [ ] **Task 1.4** — Add a one-page `README.md`: install command, link to docs, code sample (5 lines).
- [ ] **Task 1.5** — Smoke test `tests/unit/packages/plugin-api.test.ts`: import the types, assert they exist (TypeScript-only test; vitest can do this with `tsc --noEmit` invoked from the package).

## Group II: `create-projelli-plugin` CLI + template

- [ ] **Task 2.1** — Create `packages/create-projelli-plugin/`. Bin entry `bin/create.js`: Node script that takes a project name from args, optionally prompts for permission selection (use `enquirer` or similar lightweight CLI lib; or no prompts and just scaffold defaults).
- [ ] **Task 2.2** — Build the template at `packages/create-projelli-plugin/template/`. Sample plugin: registers command `hello-world.greet` that calls `api.notify.info('Hello from your plugin!')`. Manifest declares `notify` permission (none required actually, since notify is unconditional, but illustrates the pattern).
- [ ] **Task 2.3** — Template `vite.config.ts`: bundles `index.ts` to single-file IIFE format `dist/index.js`. Externals: none (plugin is self-contained). Min config.
- [ ] **Task 2.4** — Template `package.json`: dependency `@projelli/plugin-api`, devDependencies `vite`, `typescript`. Scripts: `"build": "vite build"`, `"dev": "vite"`.
- [ ] **Task 2.5** — CLI bin/create.js: copies template, replaces `<plugin-id>` placeholders, runs `npm install`, prints "Scaffolded! Next steps: cd <name> && npm run build, then drop dist/index.js into your local Projelli plugins folder for sideloading."
- [ ] **Task 2.6** — Smoke test: spawn the CLI in a temp directory, scaffold a sample plugin, verify it builds.

## Group III: Word counter + Translator example plugins

- [ ] **Task 3.1** — `plugin-examples/word-counter/`. Real plugin. Polls `api.editor.getContent()` every 500ms, computes word count, updates a sidebar panel via `api.sidebar.addPanel`. Manifest: declares `editor:selection` permission (acts as proxy for content read in v2.0; spec doesn't have a separate `editor:read` permission, so this is the closest fit; flag in code comment).
- [ ] **Task 3.2** — Word counter: `index.ts` + `manifest.json` + `package.json` + `README.md` (with screenshot — use a placeholder image path for now; C6 wires real screenshots via the catalog).
- [ ] **Task 3.3** — `plugin-examples/translator/`. Real plugin. Registers command `translator.translate`. Reads selection via `api.editor.getSelection`, calls `api.ai.invoke({ prompt: \`Translate to Spanish: ${selection.text}\` })`, replaces selection via `api.editor.replaceSelection(translated)`. Adds toolbar button + settings page for target language.
- [ ] **Task 3.4** — Translator: `index.ts` + `manifest.json` + `package.json` + `README.md`. Manifest declares `editor:selection`, `editor:write`, `ai:invoke`.

## Group IV: Pomodoro + Mermaid preview example plugins

- [ ] **Task 4.1** — `plugin-examples/pomodoro/`. Real plugin. Sidebar panel with 25-minute work / 5-minute break timer. Start/pause/reset buttons. Notifies via `api.notify.info` on phase transitions. State persisted via `api.storage.set('pomodoro:state', ...)`. Manifest declares `storage` (auto-allowed) and that's it.
- [ ] **Task 4.2** — Pomodoro: `index.ts` + `manifest.json` + `package.json` + `README.md`.
- [ ] **Task 4.3** — `plugin-examples/mermaid-preview/`. Real plugin. Sidebar panel that watches the active editor for fenced ` ```mermaid ` blocks. Renders each via mermaid.js (loaded via dynamic import inside the plugin bundle — bundled via Vite). Updates on editor change.
- [ ] **Task 4.4** — Mermaid preview: `index.ts` + `manifest.json` + `package.json` + `README.md`. Manifest declares `editor:selection` (proxy for editor read).

## Group V: Docs site content (6 pages)

- [ ] **Task 5.1** — `website/docs/plugins/index.html`. Hub: short intro, links to all sections, prominent "Get started" CTA pointing at getting-started page.
- [ ] **Task 5.2** — `website/docs/plugins/getting-started.html`. Steps: install Node, run `npx create-projelli-plugin my-plugin`, edit `index.ts`, `npm run build`, sideload, see it work.
- [ ] **Task 5.3** — `website/docs/plugins/manifest-reference.html`. Every field documented with type + required/optional + example.
- [ ] **Task 5.4** — `website/docs/plugins/permissions.html`. Each of the 6 permissions documented: what it grants, when to declare it, risk notes, examples.
- [ ] **Task 5.5** — `website/docs/plugins/api-reference.html`. Every PluginAPI method documented with signature + example. Generate from the TypeScript source if possible (e.g., via TypeDoc); else hand-write but cross-link to `@projelli/plugin-api` types.
- [ ] **Task 5.6** — `website/docs/plugins/publishing.html`. How to submit to the marketplace: fork `projelli/community-plugins`, add entry under `entries/<id>/`, manifest + tarball + screenshots, submit PR. C6 owns the receiving side.
- [ ] **Task 5.7** — `website/docs/plugins/examples.html`. Annotated walkthrough of the 4 example plugins. Each: what it does + screenshot + key code excerpts + permission story + link to GitHub.
- [ ] **Task 5.8** — Modify `website/index.html` (or whatever the nav is) to add a "Plugins" link in the dev/docs section.
- [ ] **Task 5.9** — All HTML files: pass website-content-lint (no em dashes, no banned words, contains canonical link tag). Use the same patterns as existing docs files (`website/docs/getting-started.html`).

## Group VI: Smoke tests + final PR

- [ ] **Task 6.1** — Smoke test the CLI end-to-end: spawn `npx create-projelli-plugin demo` in `/tmp`, verify scaffolded files, run `npm install`, run `npm run build`, verify `dist/index.js` is non-empty.
- [ ] **Task 6.2** — Smoke test all 4 example plugins build: `cd plugin-examples/<name> && npm install && npm run build`. Each `dist/index.js` non-empty.
- [ ] **Task 6.3** — Verify website docs render correctly (lint pass + visual review of one page).
- [ ] **Task 6.4** — Update root `~/projelli-worktrees/stream-c5-dev-experience/CHANGELOG.md`.
- [ ] **Task 6.5** — Run `npm run typecheck`, `npm run test`, `npm run lint` clean.
- [ ] **Task 6.6** — Open the C5 PR via `gh`:
  ```
  gh pr create --repo projelli/projelli \
    --base master \
    --head feature/stream-c5-dev-experience \
    --title "feat(stream-c): plugin developer experience + scaffolding (v2.0)"
  ```
  PR body: spec reference §6.7, plan reference, smoke test instructions (run the CLI in /tmp, scaffold, build, sideload), notes on what's deferred (C6 seed catalog ships these examples).

---

## Acceptance criteria

- A developer can run `npx create-projelli-plugin my-plugin` and have a working buildable scaffold in 30 seconds (excluding npm install).
- Scaffolded plugin builds to a single-file IIFE bundle that the C3 runtime can load via blob URL.
- All 4 example plugins build cleanly and run end-to-end against the C3 runtime + C4 marketplace install flow (verified manually since automation requires C6's catalog).
- Docs site has 6 pages, all linted clean, all linked from the hub.
- `@projelli/plugin-api` types match what the runtime actually accepts (no drift).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Plugin API types drift between app source and `@projelli/plugin-api` package | Use re-exports from app source so the package is always a thin wrapper. CI verifies they match. |
| `create-projelli-plugin` template breaks when @projelli/plugin-api version bumps | Pin compatible version range in template's package.json. Document in plan. |
| Example plugins don't actually exercise the runtime correctly | Group III + IV tests build them; manual smoke against the running app validates execution. C6's seed catalog re-tests in production install flow. |
| Docs go stale as API changes | API reference generated from TypeScript types where possible. Manifest reference and permissions reference are stable per v2.0 freeze. |
| Mermaid preview plugin bundles a heavy dep | Mermaid is ~50KB gzipped; acceptable for an example. Document in the example's README. |

---

## Out of scope (deferred to C6 or v2.x)

- Seed catalog content (C6 wires example plugins into a published catalog)
- Automated TypeDoc generation pipeline (v2.x; manual API ref for v2.0)
- Plugin testing harness (a test SDK plugin authors could use; v2.x)
- Plugin debugging tools (devtools panel for inspecting plugin worker; v2.x)

---

## Definition of done

- All 6 task groups completed.
- `@projelli/plugin-api` and `create-projelli-plugin` packages exist + buildable.
- 4 example plugins exist + buildable + their built artifacts ready for C6 to vendor.
- Docs site has 6 pages live.
- One PR opened.

---

## Dispatch hints

- Worktree: `cd ~/projelli && git worktree add ~/projelli-worktrees/stream-c5-dev-experience -b feature/stream-c5-dev-experience master`. Then `npm install`.
- Pass plan path: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-c5-plugin-dev-experience.md`.
- This stream has the most "wide" scope (5 small packages + 4 example plugins + 6 docs pages). Group implementer dispatches by package, not by task. Each example plugin is one dispatch; each pair of docs pages is one dispatch.
- npm publish is OUT OF SCOPE; packages are built locally and verified, but the actual publish to npm registry happens manually by Jameson after v2.0 release (board action).
