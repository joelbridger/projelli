# Projelli v2.0 Stream C4: Plugin Marketplace UI + Install Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing Plugin Marketplace on top of `PluginManager` from C3 and the `MarketplaceService` skeleton from C1. Users can browse a catalog of community plugins from `projelli/community-plugins`, see required permissions before install, approve via a permission consent dialog, watch the plugin install + auto-enable, observe its toolbar buttons / sidebar panels / commands appear, see the installed plugin in a list with status indicators, disable / re-enable / uninstall / update.

**Branch:** `feature/stream-c4-marketplace-ui`. Branches off `master` (after #21 templates marketplace merge AND C3 PR merges; if C3 has not yet merged at the start, branch off `feature/stream-c3-runner` and rebase later).

**Why C4 after C3 (and not before/in-parallel):** the Plugin Marketplace UI's [Install] button calls `pluginManager.installFromTarball(tarballPath, { onConsent })`. That hook is the integration point. Without C3's `PluginManager`, the UI has nothing to call. The marketplace service install primitives (download, checksum, extract) are reused from C1 unchanged; only the consent + manager wiring is new in C4.

**Architecture mirrors C1.** A single `PluginsMarketplaceService` instance is constructed at app start with the plugins repo URL. The new `PluginsTab` component (under `Settings → Marketplace → Plugins`) renders the catalog from `service.list()`. Clicking [Install] downloads the tarball + verifies checksum + extracts via the existing primitives, then **opens `PluginConsentDialog`** showing the manifest's declared permissions in plain language. On approve, calls `pluginManager.installFromTarball(extractedPath)` to register + enable. `InstalledPluginsList` reads from `pluginManagerStore` for status indicators.

**Tech Stack:** TypeScript 5 (strict), React 18, Vite 5, Zustand, Vitest, shadcn/ui + Tailwind. No new Rust commands.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` sections 3.2 (MarketplaceService — same as C1) and 6.6 (Plugin Marketplace UI + Install Flow).

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/modules/marketplace/PluginsMarketplaceService.ts` | Concrete service: composes `MarketplaceService` skeleton with plugin-specific install flow (validates `PluginManifest` instead of `TemplateManifest`) |
| `src/components/marketplace/PluginsTab.tsx` | Subtab body: grid of plugin catalog entries, search, category filter, refresh, sub-toggle Browse / Installed |
| `src/components/marketplace/PluginCatalogCard.tsx` | One catalog tile: screenshot, name, description preview, version, author, [Install] CTA |
| `src/components/marketplace/PluginDetailView.tsx` | Full view: description, screenshots carousel, version, author + GitHub link, **permissions list** (plain language), [Install] / [Update] / [Uninstall] state-aware action |
| `src/components/marketplace/PluginConsentDialog.tsx` | Modal shown on install. Lists requested permissions with plain-language descriptions and icons. [Cancel] [Approve & Install]. Returns boolean to caller |
| `src/components/marketplace/InstalledPluginsList.tsx` | List of installed plugins. Status badge (running / disabled / errored / updating). Actions: [Disable] / [Enable] / [Uninstall] / [Update available] / [Restart] (if crashed) |
| `src/components/marketplace/PluginErrorPanel.tsx` | When a plugin errors, shows error message + last 50 lines of plugin log (from per-plugin audit excerpt). [Restart] + [Disable] actions |
| `src/components/marketplace/PluginPermissionsList.tsx` | Reusable component showing a permissions array as labeled icons + plain-language descriptions (used by both the detail view and the consent dialog) |
| `tests/unit/marketplace/PluginsMarketplaceService.test.ts` | Mirror of TemplatesMarketplaceService.test.ts |
| `tests/unit/components/marketplace/PluginsTab.test.tsx` | Catalog renders, search, install triggers consent → service flow |
| `tests/unit/components/marketplace/PluginConsentDialog.test.tsx` | Renders requested permissions, Cancel returns false, Approve returns true |
| `tests/unit/components/marketplace/PluginDetailView.test.tsx` | State-aware action button, permissions list visible |
| `tests/unit/components/marketplace/InstalledPluginsList.test.tsx` | Status indicators, action buttons trigger right manager methods |
| `tests/unit/components/marketplace/PluginErrorPanel.test.tsx` | Error rendering, restart + disable actions |
| `tests/unit/components/marketplace/PluginPermissionsList.test.tsx` | Each permission's plain-language description renders correctly |
| `tests/integration/plugins/install-from-marketplace-end-to-end.test.ts` | Mocked GitHub catalog → click Install → consent → manager installs + enables → verify worker spawns + UI registrations land |
| `tests/e2e/plugins-marketplace.spec.ts` | Playwright: browse plugins → click Install → see consent dialog → approve → see toolbar button appear → see in Installed tab → uninstall |

### Files to modify

| Path | Change |
|---|---|
| `src/modules/marketplace/index.ts` | Export `PluginsMarketplaceService`, `createPluginsMarketplaceService` factory |
| `src/components/marketplace/MarketplaceTab.tsx` | Enable the Plugins subtab (currently disabled per C1). Mount `<PluginsTab />` |
| `src/stores/pluginsMarketplaceStore.ts` (new file, but modifies the marketplace store family) | Mirror `templatesMarketplaceStore.ts`: `{ service, cacheStatus, updateCount }` plus actions |
| `src/hooks/usePluginsMarketplace.ts` (new file) | Mirror `useTemplatesMarketplace`. `usePluginUpdateCount()` thin selector |
| `src/components/settings/SettingsModal.tsx` | Add a second update count badge for plugin updates (or sum templates + plugins into one badge — UX choice; pick "single sum" for simplicity unless badge gets confusing) |
| `src/App.tsx` | Construct `PluginsMarketplaceService` at workspace select alongside the templates one. Seed `pluginsMarketplaceStore`. 2-second deferred `checkForUpdates` after launch |
| `src/types/audit.ts` | Add `plugin_install_consent_approved` and `plugin_install_consent_declined` if useful for security audits (otherwise reuse `plugin_installed`) |

### Files to NOT modify

- `PluginManager.ts` (C3 owns it)
- `PluginAPIBridge.ts`, `PluginRuntime.ts`, host adapters (C3 owns)
- C1 templates marketplace files
- Other streams' files

---

## Task Decomposition

There are 7 task groups. Within each group, tasks run sequentially. Across groups, the dependency order is: service (Group I) before consent dialog + permissions list (Group II) before catalog tab (Group III) before detail view (Group IV) before installed list + error panel (Group V) before badge / app wiring (Group VI) before integration + E2E + final PR (Group VII).

- Group I: PluginsMarketplaceService + store + hook
- Group II: PluginConsentDialog + PluginPermissionsList
- Group III: PluginsTab catalog + PluginCatalogCard
- Group IV: PluginDetailView with state-aware actions
- Group V: InstalledPluginsList + PluginErrorPanel
- Group VI: Update count badge + App.tsx wiring + nav badge integration
- Group VII: Integration test + E2E + audit verification + final PR open

---

## Group I: PluginsMarketplaceService + store + hook

- [ ] **Task 1.1** — Add `src/modules/marketplace/PluginsMarketplaceService.ts`. Factory `createPluginsMarketplaceService(fs, workspaceRoot, opts?)` constructs `MarketplaceService` with plugin repo URL `https://raw.githubusercontent.com/projelli/community-plugins/main`, catalog path `catalog.json`, cache path `<workspace>/.projelli/cache/plugins.json`, install root `<workspace>/.projelli/plugins`. Validates entries with `validatePluginManifest` from C3 (NOT `validateTemplateManifest`).
- [ ] **Task 1.2** — Add `src/stores/pluginsMarketplaceStore.ts`. Zustand mirror of `templatesMarketplaceStore`: `{ service, cacheStatus, updateCount }` + actions. Same shape so the hook is uniform.
- [ ] **Task 1.3** — Add `src/hooks/usePluginsMarketplace.ts` and `usePluginUpdateCount`. Thin selectors over the store.
- [ ] **Task 1.4** — Tests `tests/unit/marketplace/PluginsMarketplaceService.test.ts`. Mirror the existing `TemplatesMarketplaceService.test.ts` cases against plugin manifests + plugin install root.

## Group II: PluginConsentDialog + PluginPermissionsList

- [ ] **Task 2.1** — Add `src/components/marketplace/PluginPermissionsList.tsx`. Maps each `PluginPermission` to a plain-language label + icon + risk note:
  - `workspace:read` → "Read your files" (folder icon, low risk)
  - `workspace:write` → "Modify your files" (folder + edit icon, **medium risk**)
  - `editor:selection` → "Read your current text selection" (cursor icon, low risk)
  - `editor:write` → "Insert or replace text in your editor" (cursor + edit icon, low risk)
  - `ai:invoke` → "Send prompts to your AI provider (counts toward your AI bill)" (sparkle icon, **medium risk**, billing note)
  - `network` → "Make network requests" (globe icon, **medium risk**, exfiltration note)
- [ ] **Task 2.2** — Add `src/components/marketplace/PluginConsentDialog.tsx`. shadcn `AlertDialog` (or whatever modal pattern the codebase uses). Title: `Install "<plugin name>" by <author>?`. Body: `<PluginPermissionsList permissions={manifest.permissions} />` + plain-language explanation: "By approving, you trust this plugin with these permissions. You can revoke them by uninstalling." Source line: `Source: github.com/<author>/<repo>`. Buttons: [Cancel] (returns false), [Approve & Install] (returns true). Returns `Promise<boolean>` from a wrapper hook `usePluginConsentDialog()`.
- [ ] **Task 2.3** — Tests for both components. Permissions list: each permission renders correct label + icon + risk note. Consent dialog: open → render → cancel returns false / approve returns true. Snapshot a 3-permission and a 6-permission dialog.

## Group III: PluginsTab catalog + PluginCatalogCard

- [ ] **Task 3.1** — Add `src/components/marketplace/PluginsTab.tsx`. Mirror of `TemplatesTab` from C1. Sub-toggle Browse / Installed. Browse renders catalog grid (PluginCatalogCard). Installed defers to `<InstalledPluginsList />` (Group V). Mount this in `MarketplaceTab.tsx` by enabling the Plugins subtab (currently disabled).
- [ ] **Task 3.2** — Add `src/components/marketplace/PluginCatalogCard.tsx`. Same shape as `TemplateCatalogCard` from C1, but shows the permission count as a small badge ("3 permissions"). Click opens `<PluginDetailView />`.
- [ ] **Task 3.3** — Modify `src/components/marketplace/MarketplaceTab.tsx`: enable Plugins subtab (drop the disabled state and "Coming soon" tooltip), mount `<PluginsTab />`.
- [ ] **Task 3.4** — Tests `PluginsTab.test.tsx` and `PluginCatalogCard.test.tsx`. Catalog renders, search filters, refresh button triggers `service.refresh`, offline banner shows on offline.

## Group IV: PluginDetailView with state-aware actions

- [ ] **Task 4.1** — Add `src/components/marketplace/PluginDetailView.tsx`. Layout: full description, screenshot carousel (reuse C1's in-house carousel from `TemplateDetailView`), version + author + GitHub link, **permissions list** via `<PluginPermissionsList />`, file list from manifest, **state-aware action button**:
  - Not installed → [Install]
  - Installed and current → [Disable] (if enabled) or [Enable] (if disabled), plus [Uninstall]
  - Installed but update available → [Update] + [Uninstall]
  - Crashed → [Restart] + [Disable] + [Uninstall]
  - Updating → loading spinner, all actions disabled
- [ ] **Task 4.2** — Install flow: click [Install] → call `pluginsMarketplaceService.install(id)` → on extracted, fire `usePluginConsentDialog().confirm(manifest)` → if true, call `pluginManager.installFromTarball(extractedPath, { onConsent: () => Promise.resolve(true) })` (consent already happened) → audit `plugin_installed` → toast success + show install outcome panel. If consent declined, audit `plugin_install_consent_declined` and clean up the extracted files.
- [ ] **Task 4.3** — Update flow: click [Update] → run install flow with `isUpdate: true`, `fromVersion: installed.version`. Audit `plugin_updated` (uses C3's plugin_updated event if added; else log via existing audit + a "preserved storage" note in the toast).
- [ ] **Task 4.4** — Tests `PluginDetailView.test.tsx`. Each state branch renders correct CTA. Install click triggers consent + service. Cancel on consent does NOT call service.install.

## Group V: InstalledPluginsList + PluginErrorPanel

- [ ] **Task 5.1** — Add `src/components/marketplace/InstalledPluginsList.tsx`. Renders `pluginManagerStore.installedPlugins` as a list. Each row: icon + name + version + status badge + actions. Status badge color: green=enabled, gray=disabled, red=crashed, blue=updating. Actions per status:
  - Enabled → [Disable] + [Uninstall]
  - Disabled → [Enable] + [Uninstall]
  - Crashed → [Restart] + [Disable] + [Uninstall] + small `<PluginErrorPanel />` inline
  - Updating → spinner only
- [ ] **Task 5.2** — Add `src/components/marketplace/PluginErrorPanel.tsx`. Shows `pluginManagerStore.errorsByPluginId[id]` plus last 50 lines of plugin audit log (filter `auditService.read({ filter: { pluginId } }).slice(-50)`). [Restart] calls `pluginManager.restart(id)`. [Disable] calls `pluginManager.disable(id)`.
- [ ] **Task 5.3** — Wire the Installed subtab in `PluginsTab.tsx` to render `<InstalledPluginsList />`.
- [ ] **Task 5.4** — Tests for both components. Status indicators render correctly. Action buttons call right manager methods. Error panel shows error + log.

## Group VI: Update count badge + App.tsx wiring

- [ ] **Task 6.1** — Modify `src/App.tsx`: at workspace select, construct `PluginsMarketplaceService` alongside the templates one. Seed `pluginsMarketplaceStore`. After 2-second deferred timer, call `pluginsMarketplaceService.checkForUpdates()` and `setUpdateCount(updates.length)`.
- [ ] **Task 6.2** — Modify `src/components/settings/SettingsModal.tsx`: the existing nav badge currently shows templates update count only. Sum templates + plugins update counts into a single badge. (Per UX simplicity; plan note: if confusing in real use, split into two badges in v2.x.)
- [ ] **Task 6.3** — Tests for the badge sum behavior.

## Group VII: Integration test + E2E + audit verification + final PR

- [ ] **Task 7.1** — Integration test `tests/integration/plugins/install-from-marketplace-end-to-end.test.ts`. Spin up mocked GitHub catalog. Mock Tauri invoke for `extract_tarball` + `sha256_file`. Execute install via the marketplace service: catalog fetch → click install (simulated) → consent dialog opens → approve → manager install → manager enable → assert worker would have spawned (via PluginAPIBridge mock) → assert audit events fired in correct order.
- [ ] **Task 7.2** — E2E test `tests/e2e/plugins-marketplace.spec.ts` (Playwright). Steps: open Settings → Marketplace → Plugins → catalog renders (fixture-served) → click Install on a fixture plugin → see consent dialog with permissions → click Approve → see toolbar button appear in main UI → switch to Installed subtab → see entry → click Uninstall → confirm → verify removal.
- [ ] **Task 7.3** — Audit log spot-check `tests/integration/audit-plugins.test.ts`. Run install + uninstall + failed install + crash recovery paths. Assert audit log contains expected event types.
- [ ] **Task 7.4** — Update `~/projelli-worktrees/stream-c4-marketplace-ui/CHANGELOG.md`.
- [ ] **Task 7.5** — Run `npm run typecheck`, `npm run test`, `npm run lint` clean.
- [ ] **Task 7.6** — Open the C4 PR via `gh`:
  ```
  gh pr create --repo projelli/projelli \
    --base master \
    --head feature/stream-c4-marketplace-ui \
    --title "feat(stream-c): plugin marketplace UI + install flow (v2.0)"
  ```
  PR body: spec references (§3.2 + §6.6), plan reference, smoke test instructions (browse plugins, install one, see toolbar button appear, uninstall), notes on what's deferred (C5 dev experience, C6 seed catalog).

---

## Acceptance criteria

- A user can browse the plugin marketplace, see a plugin's permissions before install, approve via consent dialog, and watch the plugin auto-enable.
- Cancelling consent prevents install and cleans up extracted files.
- Installed plugins list shows correct status (enabled/disabled/crashed/updating) and action buttons.
- Disable removes UI contributions immediately. Enable re-adds them.
- Uninstall is reversible only by re-installing (storage preserved per C3 design).
- Crashed plugins surface an error panel with logs + Restart action; restart succeeds.
- Update flow preserves storage (verified by C3's tests, re-asserted here at the UI level).
- Existing tests pass, new tests cover all new paths, typecheck + lint clean.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Permission consent dialog doesn't communicate risk well | Explicit risk-labels (low / medium) on permissions list. Plain-language descriptions, not jargon. C5 docs page elaborates. |
| Plugin install partial-failure leaves orphaned files | Reuses C1's `cleanupOnError`. Same battle-tested rollback. |
| Sum-badge collapses templates + plugins update counts confusingly | Plan note: split into two badges in v2.x if user feedback requests. v2.0 ships with single sum for simplicity. |
| User installs malicious plugin despite consent dialog | Per spec: consent is the contract. Marketplace review (C6) is the second gate. v2.0 trusts the marketplace + the user; future automated scanning deferred. |
| C3 hasn't merged when C4 starts | Branch off `feature/stream-c3-runner` instead of master, rebase later. Plan dispatch hint covers this. |

---

## Out of scope (deferred to C5, C6, or v2.x)

- Plugin developer scaffolding (`create-projelli-plugin`) — C5
- Seed catalog of example plugins — C6
- Per-plugin token usage aggregation in Settings — v2.x
- Splitting templates / plugins update badges — v2.x
- Automated marketplace plugin scanning — v2.x
- Plugin ratings + reviews — v2.x

---

## Definition of done

- All 7 task groups completed.
- E2E test green.
- One PR opened titled `feat(stream-c): plugin marketplace UI + install flow (v2.0)`.
- CHANGELOG entry under `[Unreleased]`.

---

## Dispatch hints

- Worktree: `cd ~/projelli && git worktree add ~/projelli-worktrees/stream-c4-marketplace-ui -b feature/stream-c4-marketplace-ui master` (or off `feature/stream-c3-runner` if C3 not yet merged). Then `npm install`.
- Pass plan path to every implementer agent: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-c4-plugin-marketplace-ui.md`.
- This plan reuses many C1 patterns (TemplatesTab, TemplateDetailView, InstalledTemplatesList). Implementer agents should grep C1's components first and adapt rather than write from scratch.
