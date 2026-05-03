# Projelli v2.0 Stream C1: Templates Marketplace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing Templates Marketplace on top of the `MarketplaceService` skeleton already shipped in foundations. Users can browse a catalog of community workflow templates from `projelli/community-templates`, install them with one click, see them appear in the existing `WorkflowPanel`, run them end-to-end, and receive update notifications when newer versions land.

**Branch:** `feature/stream-c`. Branches off `master` (after #18 foundations merges; if #18 is still on `feature/foundations` when this work starts, branch off `feature/foundations` and rebase later).

**Why C1 first within Stream C:** Templates marketplace is the simpler client of `MarketplaceService` (no sandbox, no permission model, no plugin runtime). Shipping it first proves the install pipeline (tarball fetch, checksum verify, extract, audit, uninstall, update) on a low-risk surface, so the plugin marketplace (C3/C4) reuses a proven path rather than debugging install + sandbox simultaneously.

**Architecture:** A single `TemplatesMarketplaceService` instance is constructed at app start with the templates repo URL. The new `TemplatesTab` component (under `Settings → Marketplace → Templates`) renders the catalog from `service.list()`. Clicking [Install] calls `service.install(id)`, which extends the foundations skeleton with download + SHA-256 verification + tarball extraction + manifest validation + audit. A new `TemplateMetadataReader` reads installed templates' `manifest.json` + `workflow.json` and converts them into the existing `WorkflowTemplate` shape consumed by `WorkflowEngine`. `WorkflowPanel` is extended to surface installed-from-marketplace templates next to built-in templates with a `TemplateProvenance` badge ("Community" / "Custom" / "Built-in"). On launch, `service.checkForUpdates()` compares installed manifests against the latest catalog and surfaces a per-template "Update available" affordance plus a count badge on Settings nav.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2 (Rust for tarball extraction + checksum), shadcn/ui + Tailwind CSS.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Sections 3.2 and 6.2.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/types/templateManifest.ts` | `TemplateManifest`, `TemplateFileEntry` types matching the spec format |
| `src/modules/marketplace/install.ts` | `downloadAndExtractTarball()`, `verifyChecksum()` shared install primitives (used by C1 + later C3/C4) |
| `src/modules/marketplace/manifestValidator.ts` | Zod schema + `validateTemplateManifest()` returning typed result |
| `src/modules/marketplace/TemplatesMarketplaceService.ts` | Concrete service: composes `MarketplaceService` skeleton with template-specific install flow |
| `src/modules/marketplace/TemplateMetadataReader.ts` | Reads installed template directory, returns `WorkflowTemplate` adapter for `WorkflowEngine` |
| `src/modules/marketplace/templateProvenance.ts` | `TemplateProvenance` enum + helpers: `'community' \| 'custom' \| 'built-in'` |
| `src-tauri/src/commands/tarball.rs` | Tauri command: extract `.tar.gz` to a path, returning extracted file list |
| `src-tauri/src/commands/checksum.rs` | Tauri command: SHA-256 of a file path |
| `src/components/marketplace/MarketplaceTab.tsx` | Container for Settings → Marketplace, hosts subtabs (Templates is the only subtab in C1; Plugins lands in C3) |
| `src/components/marketplace/TemplatesTab.tsx` | Grid of catalog entries, search bar, category filter, refresh button |
| `src/components/marketplace/TemplateCatalogCard.tsx` | One catalog tile: screenshot, name, description preview, [Install] button |
| `src/components/marketplace/TemplateDetailView.tsx` | Full template view: description, screenshot carousel, [Install] / [Update] / [Uninstall] |
| `src/components/marketplace/InstalledTemplatesList.tsx` | List of installed templates with status + actions |
| `src/components/marketplace/MarketplaceOfflineBanner.tsx` | Inline banner shown when catalog fetch failed and a cached copy is being served |
| `tests/unit/marketplace/manifestValidator.test.ts` | Schema validation: valid manifests pass, malformed reject with specific errors |
| `tests/unit/marketplace/TemplatesMarketplaceService.test.ts` | Install flow: download, checksum verify, extract, audit; rollback on partial failure |
| `tests/unit/marketplace/TemplateMetadataReader.test.ts` | Reading installed template + producing valid `WorkflowTemplate` |
| `tests/unit/marketplace/install.test.ts` | `downloadAndExtractTarball` and `verifyChecksum` unit tests with mocked Tauri commands |
| `tests/unit/components/marketplace/TemplatesTab.test.tsx` | Catalog renders, install click triggers service, offline banner appears on fetch fail |
| `tests/unit/components/marketplace/TemplateDetailView.test.tsx` | Install / Uninstall / Update affordances render based on installed state |
| `tests/integration/marketplace-install-end-to-end.test.ts` | Mocked-fetch + real-FS install, then `WorkflowEngine` runs the installed template |
| `tests/e2e/templates-marketplace.spec.ts` | Browse marketplace, install template, launch from WorkflowPanel, see correct interview questions |

### Files to modify

| Path | Change |
|---|---|
| `src/modules/marketplace/MarketplaceService.ts` | Implement `install`, `uninstall`, `listInstalled`, `checkForUpdates` (currently stubs in foundations); add `onProgress` plumbing |
| `src/modules/marketplace/index.ts` | Export new symbols (`TemplatesMarketplaceService`, `TemplateMetadataReader`, `TemplateProvenance`) |
| `src/types/marketplace.ts` | Extend `InstalledEntry` with `manifestVersion`, `provenance: TemplateProvenance` |
| `src/types/audit.ts` (or wherever `AuditEvent` lives) | Add audit event variants: `template_installed_from_marketplace`, `template_uninstalled`, `template_updated`, `template_install_failed` |
| `src/modules/audit/AuditService.ts` | Wire new audit event emitters if event union is enforced at the type level |
| `src/modules/workflow/WorkflowEngine.ts` | Accept marketplace-sourced templates: combine built-in + `TemplateMetadataReader.list()` into the `availableTemplates` set |
| `src/components/workflow/WorkflowPanel.tsx` | Render provenance badge on each template tile; group by provenance with collapsible sections |
| `src/components/settings/SettingsNav.tsx` (or equivalent placeholder added in foundations) | Replace Marketplace placeholder with `MarketplaceTab` import; show count badge when `checkForUpdates()` returns updates |
| `src/App.tsx` | Construct `TemplatesMarketplaceService` once at mount with workspace-derived `cachePath` + `installRoot`, pass via context or store |
| `src-tauri/src/main.rs` (or the commands registration file) | Register `tarball::extract` and `checksum::sha256` commands in the invoke handler |
| `src-tauri/Cargo.toml` | Add `flate2`, `tar`, `sha2`, `hex` crates (or equivalent) for extraction + hashing |

### Files to NOT modify (out of C1 scope)

- Anything in `src/modules/plugins/` (C2/C3 territory)
- Plugin manifest schemas
- Plugin sandbox / web worker code
- Stream A, B, D, E artifacts
- `community-templates` GitHub repo creation (separate ticket; for C1 unit/integration tests use mock fetch responses; for the live smoke test C6 lands the seed catalog)

---

## Task Decomposition

There are 9 task groups. Within each group, tasks run sequentially. Across groups, the dependency order is: types (Group I) before install primitives (Group II) before service implementation (Group III) before metadata reader + WorkflowEngine integration (Group IV) before UI shell (Group V) before catalog UI (Group VI) before installed-list UI (Group VII) before update flow (Group VIII) before integration + E2E (Group IX).

- Group I: Types and Tauri command surface
- Group II: Install primitives (download, checksum, extract, manifest validate)
- Group III: `MarketplaceService` install / uninstall / listInstalled implementation
- Group IV: `TemplateMetadataReader` + `WorkflowEngine` integration
- Group V: Marketplace settings shell + offline banner
- Group VI: Templates catalog tab + detail view + install action
- Group VII: Installed-templates list + uninstall action
- Group VIII: `checkForUpdates` + per-template update affordance + nav badge
- Group IX: Integration test + E2E + audit verification

---

## Group I: Types and Tauri command surface

- [ ] **Task 1.1** — Add `src/types/templateManifest.ts` with `TemplateManifest`, `TemplateFileEntry`, `TemplateFileType = 'markdown' | 'interview-questions' | 'workflow-definition'`. Match the JSON shape in spec §6.2.
- [ ] **Task 1.2** — Extend `src/types/marketplace.ts`: add `provenance: TemplateProvenance` to `InstalledEntry`, add `manifestVersion: string`. Re-export `TemplateProvenance` enum from `templateProvenance.ts`.
- [ ] **Task 1.3** — Extend audit event union (`src/types/audit.ts` or equivalent) with `template_installed_from_marketplace`, `template_uninstalled`, `template_updated`, `template_install_failed`. Each carries `templateId`, `version`, optional `error: string`.
- [ ] **Task 1.4** — Implement `src-tauri/src/commands/checksum.rs` exposing `sha256_file(path: String) -> Result<String, String>` returning hex. Add `sha2`, `hex` to `Cargo.toml`.
- [ ] **Task 1.5** — Implement `src-tauri/src/commands/tarball.rs` exposing `extract_tarball(tarballPath: String, destPath: String) -> Result<Vec<String>, String>` returning extracted file list. Use `flate2::GzDecoder` + `tar::Archive`. Reject paths that escape `destPath` (path traversal hardening).
- [ ] **Task 1.6** — Register both commands in `src-tauri/src/main.rs` (or `lib.rs`) `invoke_handler`. Run `cargo check` clean.
- [ ] **Task 1.7** — Add `src/modules/marketplace/manifestValidator.ts` with Zod schema for `TemplateManifest`. Export `validateTemplateManifest(raw: unknown): { ok: true; manifest: TemplateManifest } | { ok: false; errors: string[] }`.
- [ ] **Task 1.8** — Tests: `tests/unit/marketplace/manifestValidator.test.ts` covering valid manifest, missing required field, wrong type, invalid file type enum, version mismatch (manifest.minProjelliVersion in the future).

## Group II: Install primitives (download, checksum, extract)

- [ ] **Task 2.1** — Add `src/modules/marketplace/install.ts` with `downloadTarball(url, destPath, fs, onProgress?): Promise<void>`. Use `fetch` with streaming; write chunks to a temp file; rename on success.
- [ ] **Task 2.2** — Same module: `verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean>`. Calls Tauri `checksum::sha256_file`.
- [ ] **Task 2.3** — Same module: `extractTarball(tarballPath: string, destPath: string): Promise<string[]>`. Calls Tauri `tarball::extract_tarball`. Returns file list.
- [ ] **Task 2.4** — Same module: `cleanupOnError(tempPaths: string[]): Promise<void>` for rollback on partial failures.
- [ ] **Task 2.5** — Tests: `tests/unit/marketplace/install.test.ts` mocks Tauri invoke. Cases: clean download, checksum mismatch (rejected), extraction error (cleanup runs), partial download (rollback).

## Group III: MarketplaceService install / uninstall / listInstalled

- [ ] **Task 3.1** — Implement `MarketplaceService.install(id, opts?)`. Steps: `getById(id)` → `downloadTarball(installUrl, tmp)` → `verifyChecksum(tmp, entry.checksum)` (if present; warn if absent) → `extractTarball(tmp, installRoot/<id>)` → read extracted `manifest.json` → `validateTemplateManifest` → write `installed.json` index file under `installRoot/.installed.json` with `InstalledEntry` shape → emit audit `template_installed_from_marketplace` → cleanup tmp. Roll back on any step's failure with audit `template_install_failed`.
- [ ] **Task 3.2** — Implement `MarketplaceService.uninstall(id)`. Reads `installed.json`, deletes the install dir, removes from index, audits `template_uninstalled`.
- [ ] **Task 3.3** — Implement `MarketplaceService.listInstalled()`. Reads `installed.json`. Returns `InstalledEntry[]`. Returns `[]` if file missing.
- [ ] **Task 3.4** — Add `onProgress` plumbing. Service install accepts `{ onProgress?: (phase: 'download' | 'checksum' | 'extract' | 'validate' | 'audit', pct: number) => void }`. Wire to `downloadTarball`'s chunk callback for download phase; phase boundaries fire 0/100 ticks.
- [ ] **Task 3.5** — Add `src/modules/marketplace/TemplatesMarketplaceService.ts`. Thin subclass / factory that constructs `MarketplaceService` with `repoUrl: 'https://raw.githubusercontent.com/projelli/community-templates/main'`, `catalogPath: 'catalog.json'`, `cachePath: '<workspace>/.projelli/cache/templates.json'`, `installRoot: '<workspace>/.projelli/templates'`. Sets `provenance: 'community'` on installed entries.
- [ ] **Task 3.6** — Tests: `tests/unit/marketplace/TemplatesMarketplaceService.test.ts`. Mocked fetch + mocked Tauri. Cases: clean install end-to-end emits expected audit events; checksum-mismatch fails install + audits `template_install_failed`; uninstall removes files + audit; listInstalled empty + populated; concurrent installs serialize correctly.

## Group IV: TemplateMetadataReader + WorkflowEngine integration

- [ ] **Task 4.1** — Add `src/modules/marketplace/TemplateMetadataReader.ts` with `readInstalled(installedEntry): Promise<WorkflowTemplate>`. Reads `manifest.json`, `workflow.json`, `questions.json` (if present) from `installedPath`. Adapts to the existing `WorkflowTemplate` shape (whatever `WorkflowEngine` consumes today). Stamps `provenance: 'community'` and `sourceId: installedEntry.id` on the adapted template.
- [ ] **Task 4.2** — Same module: `list(service: MarketplaceService): Promise<WorkflowTemplate[]>`. Iterates `service.listInstalled()` + maps via `readInstalled`. Skips entries that fail to parse with a console warning + audit `template_install_failed` for visibility.
- [ ] **Task 4.3** — Modify `WorkflowEngine` to accept an injected `getCommunityTemplates: () => Promise<WorkflowTemplate[]>` callback. Default to `() => Promise.resolve([])` for tests. The available-templates surface becomes `[...builtIn, ...await getCommunityTemplates()]`. Wire the engine consumer (likely in `App.tsx`) to inject `() => TemplateMetadataReader.list(templatesService)`.
- [ ] **Task 4.4** — Tests: `tests/unit/marketplace/TemplateMetadataReader.test.ts`. Cases: successful read returns valid `WorkflowTemplate`; missing `workflow.json` skips with warning; corrupt manifest skips + audits.
- [ ] **Task 4.5** — Tests: `tests/unit/modules/workflow/WorkflowEngine.test.ts` extended for combined-template behavior. Use mock `getCommunityTemplates`.

## Group V: Marketplace settings shell + offline banner

- [ ] **Task 5.1** — Add `src/components/marketplace/MarketplaceTab.tsx`. Renders subtab strip `Templates` | `Plugins` (Plugins disabled with "Coming soon" tooltip in C1). Routes the selected subtab.
- [ ] **Task 5.2** — Add `src/components/marketplace/MarketplaceOfflineBanner.tsx`. Renders `"Showing cached catalog. Last updated <relative time>. [Retry]"` when service exposes `cacheStatus: 'fresh' | 'stale' | 'offline'`. Add a `cacheStatus` getter to `MarketplaceService`.
- [ ] **Task 5.3** — Modify `SettingsNav` (or whatever foundations placeholder is in place) to mount `MarketplaceTab` at the `/settings/marketplace` route. Remove the placeholder copy.
- [ ] **Task 5.4** — Wire the `TemplatesMarketplaceService` instance via the `useTemplatesMarketplace` hook (new). Hook reads from a Zustand store seeded once at app mount. Avoids prop-drilling through Settings.
- [ ] **Task 5.5** — Tests: `tests/unit/components/marketplace/MarketplaceTab.test.tsx` covers tab switching, plugins-disabled state. `MarketplaceOfflineBanner.test.tsx` covers each cache status branch.

## Group VI: Templates catalog tab + detail view + install action

- [ ] **Task 6.1** — Add `src/components/marketplace/TemplatesTab.tsx`. Layout: top toolbar (search input + category filter dropdown + [Refresh]), grid of `TemplateCatalogCard`. On mount: `service.refresh({ silent: true })` then `service.list()`. Search filters by name + tags + description (case-insensitive). Category filter narrows to a single category or "All".
- [ ] **Task 6.2** — Add `src/components/marketplace/TemplateCatalogCard.tsx`. Shows first screenshot (placeholder if absent), name, one-line description, version, author. Click opens detail view. Inline [Install] CTA also triggers detail view (with install pending) for consent.
- [ ] **Task 6.3** — Add `src/components/marketplace/TemplateDetailView.tsx`. Shows full description, screenshot carousel (Embla or shadcn equivalent — reuse what's already in the codebase), version, author + GitHub link, file list from manifest, [Install] / [Update] / [Uninstall] state-aware action button. Progress bar wired to `onProgress` from service install. Toast on success / failure.
- [ ] **Task 6.4** — Surface the [Install] outcome via toast + audit log inspection link ("View in Audit Log"). Failures show actionable error text ("Catalog unreachable", "Tarball corrupt", "Manifest invalid").
- [ ] **Task 6.5** — Tests: `tests/unit/components/marketplace/TemplatesTab.test.tsx` (catalog renders, search filters, refresh triggers service, offline banner shows on failure). `TemplateDetailView.test.tsx` (install button click triggers service, progress updates, success path, failure path).

## Group VII: Installed-templates list + uninstall action

- [ ] **Task 7.1** — Add `src/components/marketplace/InstalledTemplatesList.tsx`. Renders `service.listInstalled()` with name, version, installed-at, provenance badge, [Uninstall] button. Confirm dialog before uninstall. Toast on success.
- [ ] **Task 7.2** — Add an "Installed" subtab inside `TemplatesTab` toggling between Browse and Installed views. Default Browse.
- [ ] **Task 7.3** — Modify `WorkflowPanel` to render provenance badges next to each template name. Group templates with collapsible sections: Built-in, Community (installed), Custom. Order respects existing user preferences if any.
- [ ] **Task 7.4** — Tests: `tests/unit/components/marketplace/InstalledTemplatesList.test.tsx`. Cases: empty state, populated, uninstall confirm flow, refresh after uninstall.
- [ ] **Task 7.5** — Tests: `tests/unit/components/workflow/WorkflowPanel.test.tsx` extended for provenance badges + grouping.

## Group VIII: checkForUpdates + per-template update affordance + nav badge

- [ ] **Task 8.1** — Implement `MarketplaceService.checkForUpdates()`. Compares `listInstalled()` versions against the latest catalog (refreshed silently). Returns `UpdateInfo[]` shape `{ id, installedVersion, latestVersion }` for each entry where latest > installed (semver compare). Skip unknown ids.
- [ ] **Task 8.2** — Add app-launch hook: on mount, call `service.checkForUpdates()` after a 2-second deferred timer (avoids slowing cold start). Store the result in the same Zustand store; expose `useTemplateUpdateCount()`.
- [ ] **Task 8.3** — Render an unobtrusive count badge on the Settings nav `Marketplace` entry when `useTemplateUpdateCount() > 0`.
- [ ] **Task 8.4** — Add update affordance to `TemplateDetailView`: show `[Update to vX.Y.Z]` button when an update is available. Click runs install with a flag indicating update path (preserves any user-modified files: out of scope for v2.0; for now, full overwrite with explicit toast warning).
- [ ] **Task 8.5** — Audit `template_updated` carries `fromVersion` + `toVersion`.
- [ ] **Task 8.6** — Tests: `tests/unit/marketplace/TemplatesMarketplaceService.test.ts` extended with `checkForUpdates` cases (no updates, single update, multiple updates, downgrade ignored). Component tests for badge rendering + update button rendering.

## Group IX: Integration test + E2E + audit verification

- [ ] **Task 9.1** — Integration test `tests/integration/marketplace-install-end-to-end.test.ts`. Spin up an in-memory mocked GitHub HTTP server (msw or vitest's `vi.fn()` on global fetch) serving a synthetic catalog + tarball. Execute install via service. Assert FS state, `installed.json`, audit events, that `WorkflowEngine.availableTemplates()` includes the installed template, and that the engine can run it through to completion using `MockProvider`.
- [ ] **Task 9.2** — E2E test `tests/e2e/templates-marketplace.spec.ts` (Playwright). Steps: open Settings → Marketplace → Templates, see catalog, click [Install] on a fixture template, see toast, switch to Installed, see entry, open WorkflowPanel, see template under Community, launch it, complete first interview question, verify run record exists.
- [ ] **Task 9.3** — Audit log spot-check: `tests/integration/audit-marketplace.test.ts`. Run install + uninstall + failed install paths, assert audit log contains all expected event types in order.
- [ ] **Task 9.4** — Run `npm run typecheck` clean.
- [ ] **Task 9.5** — Run `npm run test` clean. All previous test counts plus C1 additions.
- [ ] **Task 9.6** — Run `npm run lint` clean (including i18n strict check; new component strings extracted to locale files in keys-only form for Stream E to translate later).

---

## Acceptance criteria

- A user can open Settings → Marketplace → Templates, browse a catalog, install a template, and run it from WorkflowPanel without restarting the app.
- Install verifies SHA-256 checksum when present in the catalog entry and refuses tampered tarballs.
- Failed installs roll back cleanly: no orphaned files in `<workspace>/.projelli/templates/`, no half-written `installed.json` entries, and an audit `template_install_failed` event with a useful error string.
- Uninstall removes both the directory and the index entry, audits the action, and the template disappears from `WorkflowPanel` immediately.
- App launch surfaces an update badge within 2 seconds when an installed template has a newer catalog version.
- Offline catalog (network failure) serves the cached version with a banner; install of a not-yet-cached entry produces a clear error.
- All existing tests still pass; new tests cover all new code paths; typecheck + lint clean.
- No changes outside C1 scope (no plugin code, no other streams' files).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tauri tarball extraction has path-traversal vulnerabilities | Reject any extracted entry whose canonicalized path falls outside `destPath` in Rust. Unit test with crafted malicious tarballs. |
| Install partial-failure leaves zombie files | Group III Task 3.1 explicitly rolls back on every step's failure; integration test 9.1 verifies. |
| Update flow overwrites user-modified template files | Out of scope: explicit toast warning + docs note. v2.x can add a diff-and-merge flow if users complain. |
| Catalog spec drift between repo Action and `manifestValidator` | manifestValidator schema is the source of truth; community-templates repo's Action consumes the same Zod schema (export from this PR). C6 wires it into the GitHub Action. |
| `WorkflowEngine` gets confused by community templates with same id as built-in | Adapter prefixes community ids with `community:` namespace. Existing built-in ids unaffected. |
| Tarball download stalls indefinitely | `downloadTarball` accepts `AbortSignal`; UI surfaces [Cancel] during install. (Punt to follow-up if scope grows; v2.0 can ship without if download timeouts are configured.) |

---

## Out of scope (deferred to later C streams or v2.x)

- Plugin marketplace (C3/C4)
- Plugin sandbox + runtime (C2/C-spike)
- Ratings + review UX (spec marks `ratings` as future)
- User template authorship UI (templates are authored by editing files; submission is GitHub PR per §6.2)
- Conflict resolution on update (overwrite-only for v2.0)
- Search beyond name/tags/description (no full-text index yet)
- Dependency declarations between templates

---

## Definition of done

- All 9 task groups completed with tests passing.
- Integration test and E2E test landed and green in CI.
- `tests/unit/website-content-lint.test.ts` and all other pre-existing tests still green.
- One PR opened against `master` titled `feat(stream-c): templates marketplace (v2.0)`. PR body summarizes user-visible changes, links to spec §3.2 + §6.2, and includes the smoke-test script Jameson should run.
- `~/projelli/CHANGELOG.md` updated under `[Unreleased]` with a `### Added` entry describing the marketplace.
- The `community-templates` GitHub repo creation + seed catalog land separately in C6; C1's tests use mocked fetch responses, not live GitHub.

---

## Dispatch hints (for the executing agent)

Per the prior-session lesson:
- Dispatch implementer agents in groups of 5 to 7 tasks. This plan's 9 groups range from 4 to 8 tasks each; combine smaller groups (V + VI together; VII + VIII together) into single dispatches if that lands closer to the 5-7 sweet spot.
- Pass the absolute path to this plan file: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-c1-templates-marketplace.md`. Implementer agents may read it directly rather than receiving full task text in the prompt; the file is on master, not on `feature/stream-c`.
- All work commits to a single branch `feature/stream-c`. Stream C PR opens after C6 lands; C1 commits go in but are not the PR boundary.
- Rust crate additions (`flate2`, `tar`, `sha2`, `hex`) require running `cargo build` in the worktree before the unit tests can pass. Implementer agent should run `cd src-tauri && cargo check` after Group I before continuing.
- Worktree creation: `cd ~/projelli && git worktree add ~/projelli-worktrees/stream-c -b feature/stream-c master` (or off `feature/foundations` if #18 has not yet merged at start of work). Then `npm install` and `cd src-tauri && cargo build`.
