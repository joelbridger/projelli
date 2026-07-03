# E2E flaky-test quarantine — tracked & owned

**Why this file exists.** `playwright.config.ts` has a `CI_QUARANTINE` list of E2E
specs excluded from the CI gate (`E2E_CI_QUARANTINE=1`) because they fail on
CI-environment quirks (state/onboarding/timing/visual), not real bugs. Excluding
them keeps the CI gate a trustworthy green — but a quarantine with no owner and no
deadline rots into a graveyard where real regressions hide. This file gives every
quarantined spec an **owner** and a **fix-or-delete-by date** so the list stays
small and honest.

**The rule (recommendation #6).** A spec doesn't get to sit in quarantine forever.
By its fix-or-delete-by date it must be either (a) **fixed** and removed from
`CI_QUARANTINE`, (b) **deleted** if it no longer earns its keep, or (c)
**consciously re-dated here with a one-line reason**. It must never silently stay
quarantined past its date. Quarantining a NEW spec means adding a row here in the
same change.

> Quarantined specs **still run locally** (`npx playwright test`) — they are only
> skipped in the `E2E_CI_QUARANTINE=1` CI gate. Source of truth for whole-file
> quarantines is the `CI_QUARANTINE` array in `playwright.config.ts`; a spec can
> also quarantine a single test in an otherwise-healthy file via an in-spec
> `test.skip(!!process.env.E2E_CI_QUARANTINE, '…')` instead, so the file's other
> passing tests aren't dropped from CI too. This file tracks ownership either way.

## Current state: F3.7b remainder resolved (2026-07-03)

The F3.7 burndown below (merged into `keepance-3.0` at `c0380e2d`) was verified
green with LOCAL runs only — branch pushes don't trigger CI, so the first real
signal came from the post-merge CI run (28559901825), which was red: 3 of 6
e2e shards, 11 tests. F3.7b (branch `fix/e2e-ci-remediation`) triaged each
failure against the exact CI-equivalent env (`vite build --config
vite.config.e2e.ts` + `vite preview`, `E2E_NO_LIVE=1`, `E2E_CI_QUARANTINE=1`)
and fixed the visual-snapshot pair same-day; the 3 remaining files were
re-quarantined with a 2026-07-09 fix-or-delete-by date. This entry (branch
`fix/e2e-quarantine-f37`, 2026-07-03) burns down all 3:

- **Visual snapshots (2 tests, FIXED same-day, 2026-07-02)** —
  `app-layout.spec.ts` and `status-bar.spec.ts`'s `*-chromium-linux.png`
  baselines were stale (the F3.7 burndown's un-quarantine commit only
  regenerated the `en` project's baselines, not the default `chromium`
  project's). Regenerated with `--update-snapshots`; verified green on 2
  consecutive local runs.
- **`templates-marketplace.spec.ts` (1 test, FIXED, removed from
  `CI_QUARANTINE`)** — the spec used to dynamic-`import()` the marketplace
  barrel straight from Vite's dev-server module graph
  (`/src/features/workflows/marketplace/svc/index.ts`), which 404s under a
  production `vite build` (CI's preview server serves hashed
  `dist/assets/*.js`, not raw source). Fix: a real product-code test seam,
  `src/features/workflows/marketplace/marketplaceTestKit.ts`, statically
  imports the real `MarketplaceService`/`TemplateMetadataReader` classes and
  installs `window.__marketplaceTestKit` as a side effect of being imported
  by `MarketplaceTab.tsx` (which self-registers the moment Settings →
  Advanced → Marketplace mounts) — mirroring the existing
  `window.__templatesMarketplaceStore` seam, but scoped inside the
  marketplace feature folder instead of `App.tsx` (kept out of the
  `src/app/**` lane another branch owned concurrently). The spec now seeds
  the synthetic catalog right after `marketplace-tab` becomes visible
  (TemplatesTab renders its `templates-tab-empty` state until a marketplace
  service is set, so seeding must happen before the `templates-tab` check,
  not before Settings opens). Verified green on 2 consecutive runs against
  the CI-equivalent build.
- **`web-demo.spec.ts` (4 tests, FIXED, removed from `CI_QUARANTINE`)** — the
  real defect was one layer earlier than originally suspected: the base
  `vite.config.ts` has no `rollupOptions.input` override, so a production
  `vite build` (including via `vite.config.e2e.ts`, which only merges the
  base config) only ever emits `dist/index.html` — `index.demo.html` was
  never in the CI job's build output AT ALL, a 404, not merely a missing
  `__KEEPANCE_DEMO__` define. Fix: the e2e CI job (`.github/workflows/ci.yml`)
  now also runs `vite build --config vite.config.web-demo.ts` (the same
  build the real keepance.com/try deploy uses, so `__KEEPANCE_DEMO__` is set
  correctly too) and merges its output into the already-built `dist/`:
  `dist-web-demo/index.demo.html` → `dist/index.demo.html`,
  `dist-web-demo/assets/` → `dist/try/assets/` (matching the demo bundle's
  `base: '/try/'`, so its asset URLs resolve unchanged). One preview server
  then serves both entries side by side. Verified locally by replicating the
  CI steps exactly (build, merge, `vite preview`) — 2 consecutive green runs.
- **`wedge-proof.spec.ts` (FIXED: 3 of 4 tests; 1 re-quarantined for a NEW,
  distinct reason)** — root cause pinned down (previously "not yet pinned
  down"): `OllamaProvider.detectOllama()` fetches `http://127.0.0.1:11434/
  api/tags` directly from the browser, unconditionally, from two places —
  `ChatModelPicker`'s mount effect and `askHelpers.ts`'s
  `resolveActiveAskProviderId`/`resolveAvailableLocalGenerationProvider`
  egress-badge fallback (used whenever no cloud key resolves). Both wrap the
  fetch in try/catch and degrade gracefully, but Chromium still logs the raw
  network failure (`Failed to load resource: net::ERR_CONNECTION_REFUSED`)
  to the DevTools console regardless, which Playwright surfaces as a
  `console` event even though app code never sees it. It didn't reproduce on
  this dev box because **this server runs a real local Ollama daemon on
  :11434** (confirmed live, `llama3.1:8b` loaded) — every GitHub Actions
  runner has no such daemon, so the exact same probe gets a genuine refusal
  there. The "2x" and "intermittent" framing both check out: 2 independent
  probe call-sites, and TCP-refusal timing inside the test's lifetime is
  racy enough that it isn't caught every run. Fix: scoped the existing
  `collectConsoleErrors` helper (`tests/campaign/helpers/campaign.ts`,
  shared by many specs) with a NEW `BENIGN_RESOURCE_LOAD_FAILURES` list keyed
  on the failing request's URL (via `ConsoleMessage.location().url`, not just
  message text), matching the exact `127.0.0.1:11434`/`localhost:11434`
  origin — so a real connection failure to any OTHER host still fails the
  assertion. Verified empirically, not just by re-running: reproduced the
  exact CI failure locally by `page.route()`-blocking port 11434
  (`route.abort('connectionrefused')`) inside the existing "cited answer"
  test, confirmed it fails on the console-errors assertion WITHOUT the
  allowlist fix and passes WITH it — a true positive/negative control pair,
  not just "tests are green now." 3 of the 4 previously-skipped tests are
  un-skipped and verified green on 3 consecutive runs (this file's 5th test
  was already unaffected). The 4th ("ask-workspace ON ... REFUSES instead of
  fabricating") surfaced a SEPARATE, unrelated, deterministic (not flaky)
  failure once un-skipped: the F2.5 file-access-consent gate
  (`src/platform/ai/fileAccessConsent.ts`) now treats this fixture's
  `provider: 'mock'` as a cloud provider (anything that isn't literally
  `'ollama'`/`'keepance-local'` counts — see `isLocalProviderId` in
  `src/platform/providers/providerFactory.ts`) and blocks ambient
  Ask-my-workspace retrieval pending consent that's never granted, so the
  send never reaches the retrieval-refusal path this test asserts —
  reproduces 100% of the time, confirmed NOT CI-only. `FileAccessConsentBanner`
  (`src/features/ask/chat/FileAccessConsentBanner.tsx`) doesn't recognize
  `'mock'` as a cloud provider either, so there's no UI affordance to grant
  consent for a mock-provider chat, and both files are under `src/features/
  ask/**` — outside this tests/e2e-only lane (owned by `fix/ask-list-hang`
  per the F3.7b lane walls). Re-quarantined (in-spec skip only, same test)
  with the new reason and a fresh 2026-07-16 fix-or-delete-by date.

| Spec | Suspected cause | Owner | Fix-or-delete-by |
|---|---|---|---|
| `wedge-proof.spec.ts` ("ask-workspace ON ... REFUSES", 1 test, in-spec skip) | F2.5 file-access-consent gate blocks ambient retrieval for the `mock` provider before it can reach the refusal path — real `src/features/ask/**` regression, not flakiness | `fix/ask-list-hang` (or its successor) | 2026-07-16 |

The F3.7 burndown history (still accurate for everything else it covered)
follows unchanged.

## F3.7 burndown history (2026-07-02, prior to the F3.7b re-quarantine above)

`CI_QUARANTINE` in `playwright.config.ts` reached `[]` at the end of this
burndown (it carries 2 entries again as of F3.7b above). The 25 whole-file
entries added 2026-07-01 (F1.3, from a real GitHub Actions CI run
post-sharding) plus 7 files with in-spec skips were burned down over two
follow-up changes:

- **F1.3 same-day fixes** (2026-07-01): `gotoDocuments`'s stale
  `hub-shortcut-documents` testid and `settings-gear`'s stale `settings-modal`
  testid (Jameson's 2026-06-27 decision moved Settings to a full-page
  `settings-page` surface) — 4 files fully fixed, several more partially.
- **F3.7 burndown** (2026-07-02, this entry): every remaining file, the
  confirmed WCAG AA contrast bug, and every in-spec skip. Full commit history
  on `fix/e2e-quarantine-burndown`. Root-cause classes found, most-common first:

1. **Standalone-editor-surface gate** (by far the largest class, ~20 files).
   MainPanel — the tab bar, toolbar, auto-save indicator, every document/
   spreadsheet/presentation/.doc/.workflow/.aichat viewer, and the status
   bar's file-context slot (breadcrumbs, project name) — only mounts when
   `sidebarActiveTab === 'files'` (App.tsx / StatusBar.tsx's
   `showFileContext`). In the current 3-tab IA (Client Map / Ask / Workflows)
   there's no direct spine-nav entry for that surface; a real user reaches it
   via Ctrl+Shift+A or by opening a cited document. Tests that poked
   `__openTestFile`/the editor store directly (bypassing the real
   surface-switch) left `sidebarActiveTab` wherever it was, so this UI never
   rendered. Fix: `switchToStandaloneEditorSurface` / `openStandaloneFile` /
   `switchToStandaloneFilesGrid` helpers added to `tests/e2e/helpers/test-utils.ts`.

2. **`settings-modal` → `settings-page`** (the remaining files from the F1.3
   list this pattern touched: `v1.5-integration-flows.spec.ts`,
   `templates-marketplace.spec.ts`, `v1.5-memory-stress.spec.ts`). Settings
   has no close button or Escape handler as a full page
   (`SettingsContent.tsx` only wires `onClose` for `variant="modal"`) —
   "closing" it now means navigating to a different spine tab.

3. **PIVOT-A5: legal template pack excluded for the default 'advisor'
   profession** (`workflows-panel.spec.ts`,
   `v1.5-integration-flows.spec.ts`'s founder-flow test,
   `v1.5-accessibility-full.spec.ts`'s workflow-picker test).
   `prioritizeByProfession.ts` deliberately excludes the whole `legal`
   category for advisors, floating `advisors` to the top instead. Default
   profession is `advisor` (`professionStore.ts`) since the 2026-06-23
   advisor re-aim.

4. **The 2026-07-01 rebrand** (`welcome-dialog.spec.ts`, `updater.spec.ts`).
   `brand/brand.config.json`'s `BRAND.name` changed from `"Keepance"` to
   `"Advisor Prep Hero"` ("flip identity to LANTERN + apply Advisor Prep
   Hero brand"). `AppLogo.tsx` also switched from an `aria-label`-wrapped
   element to a plain `<img alt={BRAND.name}>`.

5. **Stale `/docs/` seed-data assumption** (`file-tree.spec.ts`,
   `create-file-dialog.spec.ts`, `doc-creation.spec.ts`). `gotoDocuments()`
   lands in the embedded per-client Documents tab for the seeded demo
   client (`matter_demo_brennan`, folderPaths `['/test-workspace/Brennan
   Household']`) — new files land in the client's own mapped folder, not a
   generic top-level `/docs/` folder from before the advisor-demo redesign.

6. **Matter-isolation UI gates** (`tab-bar-scroll.spec.ts`,
   `undo-delete-ctrlz.spec.ts`, `empty-states.spec.ts`'s Trash test,
   `v1.5-memory-stress.spec.ts`). `DocumentsHome.tsx` deliberately hides
   global, cross-client UI (the full document tab strip, the Files/Trash
   toggle) in the embedded per-client Documents view, so it can never show a
   foreign client's files/trash. Reach the standalone surface instead of the
   embedded one for these.

7. **Genuinely stale copy/product-drift assertions**, one-off per file:
   `search-content.spec.ts` (Search unified into "Ask" — no separate
   "Search" verb/button anymore), `theme-system.spec.ts` (default theme is
   now `light`, not `system` — matches Jameson's stated no-dark-mode
   preference), `citation-persistence.spec.ts` (the sample-matter demo-chip
   UI it asserted on is now `IS_DEMO`-gated to the standalone web-demo
   build only), `api-keys-panel.spec.ts` (Remove goes through an in-app
   `ConfirmDialog`, not native `window.confirm()` — dead + returns a truthy
   object in the Tauri WebView2 build), `wedge-proof.spec.ts` (the refusal
   copy says "your client" now, not "your matter" — the user-facing rename;
   matter isolation is still the internal engine name).

8. **The confirmed WCAG AA contrast bug** (`accessibility.spec.ts`'s
   in-spec-skipped test) — a real product bug, fixed in
   `src/styles/globals.css`: `--kp-side-fg-dim`, `--kp-side-fg-faint`,
   `--kp-text-faint`, and `--kp-text-dim` were all under the 4.5:1 AA
   threshold. Bumped navy-alpha to 0.70 (dim tier) / 0.68 (faint tier).

9. **Stale visual-snapshot baselines** (`app-layout.spec.ts`,
   `status-bar.spec.ts`) — regenerated with `--update-snapshots` after
   visually confirming the new baseline reflects legitimate accumulated UI
   change (the rebrand, the 3-tab IA, the light sidebar redesign), not a bug.

No product bugs were found beyond the contrast issue above — everything else
was tests lagging real, deliberate product changes. Full suite (248 tests,
6-way shard) is green: `bash scripts/run-e2e-suite.sh en 6`.

## How to work the list

1. Reproduce locally with retries off to see the real failure:
   `npx playwright test tests/e2e/<spec> --retries=0`
2. If it's a real CI-only flake, fix the root (seed the state deterministically,
   wait on a stable `data-testid`, not a timeout) and remove it from
   `CI_QUARANTINE`.
3. If the spec no longer pulls its weight (superseded by a lower-layer test, or
   testing a removed surface), delete it.
4. If it genuinely can't be fixed yet, add a row to a table here (spec | suspected
   cause | owner | fix-or-delete-by date) and re-date it with a one-line reason
   as the date approaches.
