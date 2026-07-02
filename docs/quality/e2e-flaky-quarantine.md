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

## Current state: quarantine is empty (F3.7, 2026-07-02)

`CI_QUARANTINE` in `playwright.config.ts` is `[]`. The 25 whole-file entries
added 2026-07-01 (F1.3, from a real GitHub Actions CI run post-sharding) plus
7 files with in-spec skips were burned down over two follow-up changes:

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
