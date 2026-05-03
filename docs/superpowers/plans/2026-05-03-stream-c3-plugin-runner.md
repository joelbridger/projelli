# Projelli v2.0 Stream C3: Sandboxed Plugin Runner (Production)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the Stream C2 plugin spike harness into a production sandboxed plugin runner. Implement the full Plugin API surface from spec §6.4, the full permission model with consent, the plugin manifest schema, the `PluginManager` lifecycle (install / enable / disable / update / uninstall / crash recovery), audit events for every plugin action, and a complete test suite. By end of this stream, Projelli can load a signed plugin manifest from disk, spawn a sandboxed worker, enforce permissions on every API call, render plugin-emitted UI elements (toolbar buttons, sidebar panels, settings pages, command palette entries), and survive plugin crashes without affecting the main app.

**Branch:** `feature/stream-c3-runner`. Branches off `master` (after #21 Stream C1 templates marketplace merges). Plugin runner production code lives in `src/modules/plugins/` (NOT `src/modules/pluginSpike/` which stays as the spike reference until C3 lands).

**Why C3 is the engineering long pole of v2.0:** the spike validated the foundation (web-worker isolation, permission denial, crash recovery, sub-millisecond round-trip). Production work is broader (10x the API surface), more rigorous (full audit trail, every error path), more user-facing (consent dialogs, UI registration, error toasts), and the security review surface is largest in the entire v2.0 release. The spike's discipline carries forward: small, real test fixtures; mock-bridge factory for jsdom; honest performance numbers; explicit permission deny by default.

**Architecture:**

```
┌──────────────────── Main thread (Projelli UI) ───────────────────┐
│                                                                   │
│  PluginManager   (singleton)                                      │
│  ├── Lists installed plugins, manages lifecycle                   │
│  ├── For each enabled plugin: spawns dedicated PluginWorkerHost   │
│  ├── Holds plugin manifests + per-plugin permission state         │
│  └── Routes API calls between workers and main                    │
│                                                                   │
│  PluginPermissions   (per plugin)                                 │
│  └── Every API call from worker checks declared permissions       │
│                                                                   │
│  PluginAPIBridge   (per plugin worker)                            │
│  ├── Posts messages to worker                                     │
│  ├── Receives api-call requests, routes to host adapters          │
│  └── Translates results back to worker                            │
│                                                                   │
│  Host Adapters   (one per API surface)                            │
│  ├── CommandsHost, ToolbarHost, SidebarHost, EditorHost,          │
│  │   WorkspaceHost, AIHost, StorageHost, NetworkHost,             │
│  │   SettingsHost, NotifyHost                                     │
│  └── Each translates a plugin API call to existing Projelli       │
│      services (WorkspaceService, EditorService, etc.)             │
│                                                                   │
│  UI Registry   (global, store-backed)                             │
│  ├── ToolbarRegistry: buttons contributed by plugins              │
│  ├── SidebarRegistry: panels contributed by plugins               │
│  ├── CommandRegistry: commands contributed by plugins             │
│  └── SettingsPageRegistry: pages contributed by plugins           │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                ↕ postMessage (structured clone)
┌──────────── Web Worker (per plugin, isolated) ────────────────────┐
│                                                                    │
│  PluginRuntime                                                     │
│  ├── Loads plugin's index.js from blob URL                         │
│  ├── Provides PluginAPI proxy that posts api-call messages         │
│  └── Calls plugin.activate(api) on init                            │
│                                                                    │
│  Plugin Code   (3rd-party, untrusted, sandboxed)                   │
│  └── Uses PluginAPI; never sees main thread, DOM, or other plugins │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` sections 6.4 (Plugin manifest + API), 6.5 (Sandboxed runner), 6.6 (Marketplace UI/install — but C4 implements that, this plan only sets up the install hook surface).

**Spike memo reference:** `docs/superpowers/spikes/2026-05-03-plugin-runner-spike-memo.md`. Final outcome: row 1, proceed with web-worker plugin runner. All 8 criteria passed in live browser. Spike's BridgeFactory `(manifest, hooks) => bridge` signature, blob-URL plugin distribution, JSON message protocol, per-call permission check, and structured error variant are all validated and inherited.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2 (no new Rust commands needed for the runner itself; future plugin-package install adds one), shadcn/ui + Tailwind. Web Worker spawned via Vite's `?worker` import.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/types/plugin.ts` | `PluginManifest`, `PluginPermission`, `PluginAPI`, `ToolbarButtonSpec`, `SidebarPanelSpec`, `SettingsPageSpec`, `CommandSpec`, `PluginInstance`, `PluginStatus` types |
| `src/modules/plugins/PluginAPIBridge.ts` | Production bridge (evolved from `SpikeAPIBridge`). Routes worker messages to host adapters, enforces permissions, owns worker lifecycle |
| `src/modules/plugins/PluginRuntime.ts` | Worker-side runtime (evolved from `SpikePluginRuntime`). Initializes per-plugin, exposes API proxy |
| `src/modules/plugins/PluginMessageProtocol.ts` | Production message protocol (evolved from `SpikeMessageProtocol`). Adds new message variants for full API surface |
| `src/modules/plugins/PluginPermissions.ts` | Permission enforcement: parses manifest perms, checks each API call against declared list, audit on every check |
| `src/modules/plugins/PluginManifestSchema.ts` | Zod v4 schema for `PluginManifest`. Validates on install + load |
| `src/modules/plugins/PluginManager.ts` | Singleton lifecycle controller: `installFromTarball`, `enable`, `disable`, `uninstall`, `update`, `listInstalled`, `getStatus` |
| `src/modules/plugins/PluginWorkerHost.ts` | Per-plugin host: owns the Worker, routes incoming/outgoing messages, terminates on uninstall, handles crashes |
| `src/modules/plugins/plugin-worker.ts` | Worker entry. Imports `PluginRuntime` and starts it. Loaded via `import PluginWorker from './plugin-worker.ts?worker'` |
| `src/modules/plugins/hosts/CommandsHost.ts` | Adapter: plugin `commands.register` / `invoke` ↔ `CommandRegistry` store |
| `src/modules/plugins/hosts/ToolbarHost.ts` | Adapter: plugin `toolbar.addButton` / `removeButton` ↔ `ToolbarRegistry` store |
| `src/modules/plugins/hosts/SidebarHost.ts` | Adapter: plugin `sidebar.addPanel` / `removePanel` ↔ `SidebarRegistry` store |
| `src/modules/plugins/hosts/EditorHost.ts` | Adapter: plugin `editor.getSelection` / `getContent` / `replaceSelection` / `insertAtCursor` ↔ `EditorService` |
| `src/modules/plugins/hosts/WorkspaceHost.ts` | Adapter: plugin `workspace.listFiles` / `readFile` / `writeFile` ↔ `WorkspaceService` |
| `src/modules/plugins/hosts/AIHost.ts` | Adapter: plugin `ai.invoke` ↔ user's currently-configured Provider (Claude/OpenAI/Gemini/Ollama) |
| `src/modules/plugins/hosts/StorageHost.ts` | Adapter: plugin `storage.get` / `set` / `remove` → per-plugin localStorage namespace |
| `src/modules/plugins/hosts/NetworkHost.ts` | Adapter: plugin `network.fetch` ↔ `globalThis.fetch` (with permission gate) |
| `src/modules/plugins/hosts/SettingsHost.ts` | Adapter: plugin `settings.addPage` / `get` / `set` ↔ `SettingsPageRegistry` + per-plugin storage |
| `src/modules/plugins/hosts/NotifyHost.ts` | Adapter: plugin `notify.info` / `warn` / `error` ↔ existing toast/outcome system |
| `src/modules/plugins/index.ts` | Barrel: exports `PluginManager`, `PluginAPI` types, etc. |
| `src/stores/pluginRegistryStore.ts` | Zustand store: `{ commands, toolbar, sidebar, settingsPages }` per-plugin contributions, plus selectors for the UI to read |
| `src/stores/pluginManagerStore.ts` | Zustand store: `{ installedPlugins, status, errors }` |
| `src/types/audit.ts` (extend) | Add audit event variants: `plugin_installed`, `plugin_enabled`, `plugin_disabled`, `plugin_uninstalled`, `plugin_executed`, `plugin_crashed`, `plugin_permission_denied`, `plugin_install_failed` |
| `tests/unit/plugins/PluginAPIBridge.test.ts` | Bridge unit tests (build on spike test patterns) |
| `tests/unit/plugins/PluginRuntime.test.ts` | Runtime unit tests |
| `tests/unit/plugins/PluginPermissions.test.ts` | Permission enforcement: each permission allows/denies the right API calls |
| `tests/unit/plugins/PluginManifestSchema.test.ts` | Schema validation: valid manifest passes, malformed fails with specific errors |
| `tests/unit/plugins/PluginManager.test.ts` | Manager lifecycle: install/enable/disable/uninstall/update/crash-recovery |
| `tests/unit/plugins/hosts/CommandsHost.test.ts` | Per-host adapter tests (one file per host adapter) |
| `tests/unit/plugins/hosts/ToolbarHost.test.ts` | ... |
| `tests/unit/plugins/hosts/SidebarHost.test.ts` | ... |
| `tests/unit/plugins/hosts/EditorHost.test.ts` | ... |
| `tests/unit/plugins/hosts/WorkspaceHost.test.ts` | ... |
| `tests/unit/plugins/hosts/AIHost.test.ts` | ... |
| `tests/unit/plugins/hosts/StorageHost.test.ts` | ... |
| `tests/unit/plugins/hosts/NetworkHost.test.ts` | ... |
| `tests/unit/plugins/hosts/SettingsHost.test.ts` | ... |
| `tests/unit/plugins/hosts/NotifyHost.test.ts` | ... |
| `tests/integration/plugins/end-to-end-lifecycle.test.ts` | Install → enable → invoke command → crash → recover → uninstall full flow |
| `tests/helpers/pluginMockFactory.ts` | Shared paired-bridge mock factory (evolved from `tests/helpers/spikeMockFactory.ts`) |
| `tests/fixtures/plugins/word-counter/` | Real test plugin: word counter with status bar item (used by Cypress + integration tests) |
| `tests/fixtures/plugins/word-counter/manifest.json` | Manifest fixture |
| `tests/fixtures/plugins/word-counter/index.js` | Plugin source fixture |

### Files to modify

| Path | Change |
|---|---|
| `src/types/audit.ts` | Add 8 new plugin audit event variants |
| `src/modules/audit/AuditService.ts` | Wire any required audit emit helpers; respect `new AuditService('plugins')` per memory rule |
| `src/App.tsx` | On workspace select, instantiate `PluginManager` singleton (per-workspace), enumerate installed plugins, enable each |
| `src/components/layout/Toolbar.tsx` (or equivalent) | Render plugin-contributed toolbar buttons from `pluginRegistryStore` next to built-in buttons |
| `src/components/layout/Sidebar.tsx` (or equivalent) | Render plugin-contributed sidebar panels from `pluginRegistryStore` |
| `src/components/common/CommandPalette.tsx` | Surface plugin-contributed commands |
| `src/components/settings/SettingsModal.tsx` | Render plugin-contributed settings pages from `pluginRegistryStore` |
| `tsconfig.json` | Add `"WebWorker"` to `lib` if not already present (spike may have already done this) |

### Files to NOT modify

- Anything in `src/modules/pluginSpike/` or `src/components/pluginSpike/` (spike stays for reference until C3 lands)
- C1 templates marketplace files
- Other streams' files

---

## Task Decomposition

There are 9 task groups. Within each group, tasks run sequentially. Across groups, the dependency order is: types + protocol (Group I) before bridge + runtime (Group II) before manifest + permissions (Group III) before host adapters in waves (Groups IV-VI) before manager + worker host (Group VII) before UI registry + integration (Group VIII) before integration test + E2E (Group IX).

- Group I: Types, protocol, manifest schema
- Group II: Bridge + runtime + worker entry
- Group III: Permission enforcement
- Group IV: Host adapters wave 1 (Commands, Notify, Storage, Settings — simplest, no external deps)
- Group V: Host adapters wave 2 (Toolbar, Sidebar — UI registry adapters)
- Group VI: Host adapters wave 3 (Editor, Workspace, AI, Network — touch existing services)
- Group VII: PluginManager + PluginWorkerHost lifecycle
- Group VIII: UI registry stores + Toolbar/Sidebar/CommandPalette/Settings rendering
- Group IX: End-to-end integration test + word-counter fixture + final PR open

---

## Group I: Types, protocol, manifest schema

- [ ] **Task 1.1** — Add `src/types/plugin.ts`. Define every type from spec §6.4: `PluginManifest`, `PluginPermission` union (`workspace:read | workspace:write | editor:selection | editor:write | ai:invoke | network`), `PluginAPI` (full surface), `ToolbarButtonSpec`, `SidebarPanelSpec`, `SettingsPageSpec`, `CommandSpec`, plus runtime types: `PluginInstance` (manifest + status + worker reference), `PluginStatus = 'installed' | 'enabled' | 'disabled' | 'crashed' | 'updating'`.
- [ ] **Task 1.2** — Implement `src/modules/plugins/PluginManifestSchema.ts`. Zod v4 schema for `PluginManifest`. Use `z.url()` (not deprecated `.string().url()`). Validate every field per spec §6.4. Export `validatePluginManifest(raw): { ok: true; manifest } | { ok: false; errors: string[] }`. Ensure `permissions` array contains only known `PluginPermission` literals.
- [ ] **Task 1.3** — Implement `src/modules/plugins/PluginMessageProtocol.ts`. Evolve from `SpikeMessageProtocol`. Discriminated union variants: `init`, `register-command`, `invoke-command`, `command-result`, `api-call` (carries permission, method name, args), `api-result`, `error`, `panel-render`, `toolbar-add`, `toolbar-remove`, `sidebar-add-panel`, `sidebar-remove-panel`, `settings-add-page`, `notify`. Each carries correlation `id`. Export `encode`, `decode`, `isPluginMessage` type guard.
- [ ] **Task 1.4** — Extend `src/types/audit.ts` audit event union with 8 new plugin events: `plugin_installed`, `plugin_enabled`, `plugin_disabled`, `plugin_uninstalled`, `plugin_executed` (carries `pluginId`, `commandId`, `durationMs`), `plugin_crashed` (carries error message), `plugin_permission_denied` (carries `pluginId`, `permission`, `apiCall`), `plugin_install_failed`.
- [ ] **Task 1.5** — Tests `tests/unit/plugins/PluginManifestSchema.test.ts`. Valid manifest passes; missing required field rejected; unknown permission rejected; bad apiVersion rejected; missing main entry rejected.
- [ ] **Task 1.6** — Tests `tests/unit/plugins/PluginMessageProtocol.test.ts`. Encode round-trip for every variant; invalid raw rejected; type guard correctly discriminates.

## Group II: Bridge + runtime + worker entry

- [ ] **Task 2.1** — Implement `src/modules/plugins/PluginAPIBridge.ts`. Constructor signature `(manifest: PluginManifest, hooks: BridgeHooks) => PluginAPIBridge` (matches spike's BridgeFactory contract). Holds `pendingCalls: Map<id, { resolve, reject }>`. Spawns worker via Vite `?worker` import. Posts `init` with plugin code as string.
- [ ] **Task 2.2** — Bridge `invokeCommand(commandId: string, payload?: unknown): Promise<unknown>` posts `invoke-command`, awaits `command-result`.
- [ ] **Task 2.3** — Bridge `handleApiCall(msg: ApiCallMessage)` checks the manifest's permissions for the requested permission, then dispatches to the registered host adapter (Group IV-VI), awaits result, posts `api-result` back to worker. On permission denial: posts `error` with `code: 'permission-denied'`, audits `plugin_permission_denied`.
- [ ] **Task 2.4** — Bridge `terminate()`: idempotent. `worker.terminate()`, cancels all pending calls with `unloaded` rejection, revokes blob object URL, fires `hooks.onUnload`. Same idempotent pattern as spike.
- [ ] **Task 2.5** — Implement `src/modules/plugins/PluginRuntime.ts`. Worker-side. Listens for `init`, dynamic-imports plugin code via blob URL (per spike), calls `plugin.activate(api)` where `api` is a proxy that posts `api-call` for every method.
- [ ] **Task 2.6** — Add `src/modules/plugins/plugin-worker.ts`. Worker entry. Mounts `PluginRuntime`. Installs `self.onerror` + `onunhandledrejection` handlers that post structured `error` messages.
- [ ] **Task 2.7** — Add `tests/helpers/pluginMockFactory.ts`. Evolved from `tests/helpers/spikeMockFactory.ts`. Pairs a `PluginAPIBridge` with an in-process `PluginRuntime` over in-memory message queues. Used by all unit tests below to avoid real-Worker flake in jsdom.
- [ ] **Task 2.8** — Tests `tests/unit/plugins/PluginAPIBridge.test.ts` covering invoke round-trip, permission denial, terminate cleanup, hot-reload via terminate + recreate. (Reuse spike test patterns.)
- [ ] **Task 2.9** — Tests `tests/unit/plugins/PluginRuntime.test.ts` covering register-command + api-call flow with mock worker scope.

## Group III: Permission enforcement

- [ ] **Task 3.1** — Implement `src/modules/plugins/PluginPermissions.ts`. Class `PluginPermissions(manifest: PluginManifest)` with method `check(permission: PluginPermission): boolean`. Audits `plugin_permission_denied` on false return.
- [ ] **Task 3.2** — Map every API method to its required permission in a single source-of-truth table (e.g., `workspace.readFile` → `workspace:read`; `workspace.writeFile` → `workspace:write`; `editor.replaceSelection` → `editor:write`; `ai.invoke` → `ai:invoke`; `network.fetch` → `network`). Bridge consults this table.
- [ ] **Task 3.3** — `commands.*`, `toolbar.*`, `sidebar.*`, `settings.*`, `notify.*`, `storage.*` are unconditionally allowed (no permission required per spec §6.4 minimum). Document in code comment.
- [ ] **Task 3.4** — Tests `tests/unit/plugins/PluginPermissions.test.ts`. Each permission allows the right API calls and denies the others. Manifest with no permissions denies all gated calls. Manifest with all permissions allows all gated calls.

## Group IV: Host adapters wave 1 (Commands, Notify, Storage, Settings)

These are simplest — no external service touch beyond stores.

- [ ] **Task 4.1** — Implement `src/stores/pluginRegistryStore.ts`. Zustand store holding `{ commands: Map<commandId, { pluginId, handler }>, toolbar: ToolbarButton[], sidebar: SidebarPanel[], settingsPages: SettingsPage[] }`. Actions: `registerCommand`, `unregisterCommand`, `addToolbarButton`, `removeToolbarButton`, `addSidebarPanel`, `removeSidebarPanel`, `addSettingsPage`, `removeSettingsPage`, `clearForPlugin(pluginId)` (used on disable/uninstall).
- [ ] **Task 4.2** — Implement `src/modules/plugins/hosts/CommandsHost.ts`. Bridge-side handler for `commands.register` (calls `pluginRegistryStore.registerCommand` with the plugin id). `commands.invoke` looks up the registered handler and posts an `invoke-command` to the owning plugin's bridge.
- [ ] **Task 4.3** — Implement `src/modules/plugins/hosts/NotifyHost.ts`. `notify.info/warn/error` translates to existing toast / outcome system (whatever the codebase uses — grep first).
- [ ] **Task 4.4** — Implement `src/modules/plugins/hosts/StorageHost.ts`. `storage.get/set/remove` reads/writes from `localStorage` namespaced as `projelli:plugin:<pluginId>:<key>`. JSON-encode values.
- [ ] **Task 4.5** — Implement `src/modules/plugins/hosts/SettingsHost.ts`. `settings.addPage` calls `pluginRegistryStore.addSettingsPage`. `settings.get/set` proxy to `StorageHost` with `:settings:` prefix.
- [ ] **Task 4.6** — Tests for each host (4 test files). Each asserts: API call hits the right store / service; second call for same id is idempotent; `clearForPlugin(pluginId)` removes only that plugin's registrations.

## Group V: Host adapters wave 2 (Toolbar, Sidebar)

UI registry adapters.

- [ ] **Task 5.1** — Implement `src/modules/plugins/hosts/ToolbarHost.ts`. `toolbar.addButton` validates `ToolbarButtonSpec` (id, icon name, tooltip, command), calls `pluginRegistryStore.addToolbarButton({ pluginId, ...spec })`. `removeButton` removes by id.
- [ ] **Task 5.2** — Implement `src/modules/plugins/hosts/SidebarHost.ts`. `sidebar.addPanel` validates `SidebarPanelSpec` (id, title, html OR componentTree), calls `pluginRegistryStore.addSidebarPanel`. Reuses spike's sandboxed-iframe pattern for HTML rendering (per spike memo).
- [ ] **Task 5.3** — Tests for each host (2 test files). Cover: add+remove round-trip, validation rejects malformed specs, clearForPlugin removes only owned items.

## Group VI: Host adapters wave 3 (Editor, Workspace, AI, Network)

Touch existing services. Permission-gated.

- [ ] **Task 6.1** — Implement `src/modules/plugins/hosts/EditorHost.ts`. `getSelection` and `getContent` call `EditorService` getters. `replaceSelection` and `insertAtCursor` call `EditorService` mutators. Bridge enforces `editor:selection` for getSelection, `editor:write` for the mutators.
- [ ] **Task 6.2** — Implement `src/modules/plugins/hosts/WorkspaceHost.ts`. `listFiles(path?)` calls `WorkspaceService.list(path ?? '/')`. `readFile(path)` calls `WorkspaceService.read(path)` (always path-validated). `writeFile(path, content)` calls `WorkspaceService.write(path, content)`. Bridge enforces `workspace:read` for list/read, `workspace:write` for write. **Path validation MUST go through PathValidator** so plugins can't traverse outside the workspace.
- [ ] **Task 6.3** — Implement `src/modules/plugins/hosts/AIHost.ts`. `ai.invoke({ prompt, system? })` reads the user's currently-configured Provider from the existing settings store, calls `provider.sendMessage(prompt, { system })`. Returns the text response. Plugin never sees the API key. Audit `plugin_executed` with prompt length + response length + model.
- [ ] **Task 6.4** — Implement `src/modules/plugins/hosts/NetworkHost.ts`. `network.fetch(url, opts)` calls `globalThis.fetch(url, opts)`. Bridge enforces `network` permission. Returns serialized response (status, headers, text body). For binary, base64-encode (spec §6.4 doesn't require streaming).
- [ ] **Task 6.5** — Tests for each host (4 test files). Cover happy path, permission denial, edge cases (empty selection, missing file, AI provider not configured, network error). Use mocked services.

## Group VII: PluginManager + PluginWorkerHost lifecycle

- [ ] **Task 7.1** — Implement `src/stores/pluginManagerStore.ts`. Zustand: `{ installedPlugins: PluginInstance[], statusByPluginId: Record<id, PluginStatus>, errorsByPluginId: Record<id, string | null> }`. Actions: `setInstalled`, `setStatus`, `setError`, `clearError`.
- [ ] **Task 7.2** — Implement `src/modules/plugins/PluginWorkerHost.ts`. Per-plugin host: owns one Worker via PluginAPIBridge. Tracks status. On worker error/exit: marks status `crashed`, audits `plugin_crashed`, surfaces error via `pluginManagerStore.setError`.
- [ ] **Task 7.3** — Implement `src/modules/plugins/PluginManager.ts` singleton. Methods:
  - `installFromTarball(tarballPath: string): Promise<PluginInstance>` — extracts, validates manifest, writes to `<workspace>/.projelli/plugins/<id>/`, audits `plugin_installed`. Reuses `extractTarball` + `validatePluginManifest`.
  - `enable(pluginId): Promise<void>` — spawns `PluginWorkerHost`, sends init with plugin code, awaits activate. Audits `plugin_enabled`.
  - `disable(pluginId): Promise<void>` — calls `worker.deactivate()` with timeout, terminates host, calls `pluginRegistryStore.clearForPlugin`. Audits `plugin_disabled`.
  - `uninstall(pluginId): Promise<void>` — disable + delete plugin folder + remove from store. Audits `plugin_uninstalled`.
  - `update(pluginId, newTarballPath): Promise<void>` — disable old, install new (overwrite), enable. Preserves storage in `<workspace>/.projelli/plugins/<id>/data/`.
  - `listInstalled(): PluginInstance[]`
  - `getStatus(pluginId): PluginStatus`
  - `restart(pluginId): Promise<void>` — disable + enable. Used by error UI's "Restart plugin" button.
- [ ] **Task 7.4** — Manager handles the install consent flow as a callback hook: `installFromTarball(tarballPath, { onConsent: (manifest) => Promise<boolean> })`. C4 wires the actual `PluginConsentDialog` UI; this group leaves the hook surface clean.
- [ ] **Task 7.5** — Tests `tests/unit/plugins/PluginManager.test.ts`. Cover full lifecycle, crash recovery (worker throws, status flips to crashed, restart succeeds), update preserves storage, uninstall clears all registrations.

## Group VIII: UI registry rendering + App.tsx wiring

- [ ] **Task 8.1** — Modify `src/components/layout/Toolbar.tsx` (or equivalent — grep for the toolbar component first) to render plugin-contributed buttons from `pluginRegistryStore.toolbar`. Plugin buttons appear in a separate "Plugins" section after built-in buttons. Click invokes the registered command via `pluginRegistryStore.commands`.
- [ ] **Task 8.2** — Modify `src/components/layout/Sidebar.tsx` to render plugin-contributed panels. Each panel renders inside a sandboxed iframe (per spike memo, security upgrade). Tabs for switching between built-in and plugin panels.
- [ ] **Task 8.3** — Modify `src/components/common/CommandPalette.tsx` to surface plugin commands alongside built-in commands. Each plugin command displays its plugin name as context.
- [ ] **Task 8.4** — Modify `src/components/settings/SettingsModal.tsx` to render plugin-contributed settings pages from `pluginRegistryStore.settingsPages`. Each plugin page lives in its own row in the Settings nav.
- [ ] **Task 8.5** — Modify `src/App.tsx`: on workspace select, instantiate `PluginManager` singleton scoped to that workspace, call `manager.listInstalled()`, enable each. On workspace teardown, disable all and dispose. Surface critical errors via toast.
- [ ] **Task 8.6** — Component tests for each modified surface (toolbar plugin button, sidebar plugin panel, command palette plugin command, settings plugin page).

## Group IX: End-to-end integration test + word-counter fixture + final PR

- [ ] **Task 9.1** — Add `tests/fixtures/plugins/word-counter/manifest.json` and `tests/fixtures/plugins/word-counter/index.js`. Real working plugin: registers a command `word-counter.count`, registers a toolbar button, registers a sidebar panel showing live word count via `editor.getContent` polling. Manifest declares `editor:selection` (or `editor` reading) permission only.
- [ ] **Task 9.2** — Integration test `tests/integration/plugins/end-to-end-lifecycle.test.ts`. Steps:
  1. Install word-counter from a synthetic tarball
  2. Enable
  3. Assert toolbar button appears in `pluginRegistryStore.toolbar`
  4. Assert sidebar panel appears
  5. Invoke command via `pluginRegistryStore.commands.get('word-counter.count').handler`
  6. Verify it succeeded
  7. Trigger a deliberate plugin crash (separate fixture plugin that throws)
  8. Assert status flips to `crashed`, audit event fires, restart works
  9. Uninstall
  10. Assert all registrations cleared
- [ ] **Task 9.3** — Update `~/projelli-worktrees/stream-c3-runner/CHANGELOG.md` under `[Unreleased]` with a `### Added` entry for plugin runner.
- [ ] **Task 9.4** — Run `npm run typecheck` clean.
- [ ] **Task 9.5** — Run `npm run test` clean (no regressions).
- [ ] **Task 9.6** — Run `npm run lint` (don't introduce new errors).
- [ ] **Task 9.7** — Open the C3 PR via `gh`:
  ```
  gh pr create --repo projelli/projelli \
    --base master \
    --head feature/stream-c3-runner \
    --title "feat(stream-c): sandboxed plugin runner (v2.0)"
  ```
  PR body includes spec references, plan reference, smoke test instructions (load the word-counter fixture as an installed plugin, verify toolbar button + sidebar panel + command invocation + crash recovery), and notes on what's deferred (marketplace UI = C4, dev experience = C5, seed catalog = C6).

---

## Acceptance criteria

- A user can install a plugin tarball, enable it, see its toolbar buttons + sidebar panels + commands appear in the UI, invoke them, observe they work.
- A plugin that throws inside its activate or any command does NOT crash Projelli; status flips to `crashed`; a Restart button surfaces; restart restores the plugin to enabled state.
- A plugin without a permission cannot perform the corresponding API call. The denial is silent on the surface and audited in the log.
- Disabling a plugin removes ALL its UI contributions (toolbar buttons, sidebar panels, settings pages, commands). Enabling re-adds them.
- Uninstalling deletes both the install dir and the registry entries. Plugin's storage at `<workspace>/.projelli/plugins/<id>/data/` is preserved per spec for potential reinstall.
- Update flow preserves plugin storage across versions.
- All audit events fire on the right transitions with the right payloads.
- All existing tests still pass; new tests cover all new code paths; typecheck + lint clean.
- Word-counter fixture plugin works end-to-end as the integration test asserts.
- No changes outside C3 scope (no marketplace UI changes — that's C4).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tauri webview blocks blob URL imports under production CSP | Test under Tauri's CSP early in Group II. If blocked, fall back to static-URL approach (plugins served from `<workspace>/.projelli/plugins/<id>/index.js` via Tauri's asset protocol). |
| Plugin can spam `setInterval` and slow down its worker | Accept for v2.0. Per-plugin worker = browser-scheduled. Future: monitor per-worker CPU and auto-disable on persistent high usage. Document. |
| Permission consent UX lives in C4 but the manager needs the hook | Manager exposes `installFromTarball(tarball, { onConsent })`. C3 stubs an always-true onConsent for tests; C4 wires the real dialog. |
| AI invoke from plugin counts toward user's BYOK budget without UI feedback | AIHost emits a notify event ("Plugin X used Y tokens") on every invoke. User can monitor in audit log. Future: aggregate per-plugin token usage in a Settings section. |
| Path traversal from plugin via workspace.writeFile | All paths route through existing `PathValidator`. Test with `../../../etc/passwd`. |
| Network host enables plugin exfiltration | Permission consent gate is the contract. Document the limitation in the consent dialog text (C4 wires this). Audit `plugin_executed` includes the URL. |
| Plugin storage leaks across workspaces | Per-workspace localStorage namespacing: `projelli:plugin:<pluginId>:<key>` is rooted in browser localStorage which is per-origin. For Tauri, every workspace shares the same localStorage origin. **Open question for V2.x:** namespace by workspace too. v2.0 ships with the simpler model. |
| Worker termination races with in-flight API calls | Bridge cancels all pending calls on terminate with structured rejection (`unloaded`). Same pattern as spike. |

---

## Out of scope (deferred to C4-C6 or v2.x)

- Plugin marketplace browse / install UI (C4)
- Plugin consent dialog UI (C4 wires the hook from this plan)
- Developer scaffolding (`create-projelli-plugin`) and `@projelli/plugin-api` package (C5)
- Seed catalog of 4 example plugins beyond word-counter fixture (C6 ships Translator, Pomodoro, Mermaid preview)
- Custom file-type renderers
- Event subscriptions (file-changed, chat-message-sent)
- AI tool registration (where AI can call plugin functions)
- Multi-window plugins
- Native code execution (plugins are JS-only)
- Plugin-to-plugin communication
- Auto-disable on persistent CPU usage
- Per-workspace plugin storage isolation (v2.x)

---

## Definition of done

- All 9 task groups completed with tests passing.
- Word-counter fixture works end-to-end.
- Integration test covers install → enable → invoke → crash → restart → uninstall.
- One PR opened against `master` titled `feat(stream-c): sandboxed plugin runner (v2.0)`. PR body summarizes user-visible changes, links to spec §6.4 + §6.5 + spike memo, includes smoke-test instructions.
- `~/projelli/CHANGELOG.md` updated under `[Unreleased]` with `### Added` entry for the plugin runner.
- Master branch will get the spike worktree archived after C3 merges; that's a separate small follow-up PR.

---

## Dispatch hints (for the executing agent)

- Worktree creation:
  ```
  cd ~/projelli && git worktree add ~/projelli-worktrees/stream-c3-runner -b feature/stream-c3-runner master
  cd ~/projelli-worktrees/stream-c3-runner && npm install
  ```
- Plan dispatch hint per the prior-session lesson: "Group sizes 5-7 tasks." This plan's groups range from 4 to 9 tasks; combine I+III (small) into one dispatch if cleaner; split IV (6 tasks) if any one is non-trivial.
- **Pass the absolute path** to this plan to every implementer agent: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md`. Implementer agents may read it directly; the file lives on master.
- All work commits to a single branch `feature/stream-c3-runner`. PR opens after Group IX.
- **The spike is the source of evolution, not a copy-paste.** Implementer agents should READ `src/modules/pluginSpike/*.ts` from a separate worktree (`~/projelli-worktrees/stream-c-spike`) to understand patterns, then write production files into `src/modules/plugins/` from scratch. The `pluginSpike` files are NOT in the C3 worktree (they only live on the `feature/stream-c-spike` branch).
- Resource awareness: cargo crates from C1 (`flate2`, `tar`, `sha2`, `hex`) are already on master, so cargo build is incremental. No new Rust commands in this stream. The Worker bundling is Vite-only.
