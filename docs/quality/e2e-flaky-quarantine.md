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

## Update (2026-07-03, `fix/consent-mock-provider-refusal`)

`wedge-proof.spec.ts`'s `ask-workspace ON ... REFUSES instead of fabricating`
test was un-quarantined and root-caused — **not** the CI-only
`ERR_CONNECTION_REFUSED` flake the F3.7b entry below suspected for all 4 of
this file's in-spec-skipped tests. It failed **deterministically** (100% of
runs, local and CI) for an unrelated reason: the F2.5 file-access consent gate
(`src/platform/ai/fileAccessConsent.ts`) classifies any non-local provider id —
including this test's fixture `provider: 'mock'` — as cloud
(`isLocalProviderId` in `providerFactory.ts` only recognizes
`'ollama'`/`'keepance-local'`), so the ambient "Ask my workspace" toggle was
paused pending consent before retrieval ever ran. `FileAccessConsentBanner.tsx`
classified cloud providers with its OWN separate hardcoded
`Set(['anthropic','openai','google'])`, which didn't include `'mock'` — so the
banner never rendered the "Allow file access" affordance either, making the
gate's block unreachable-to-fix from the UI. Two bugs, not one:

1. **The test never granted consent** — a real gap in the fixture/test, not a
   product bug on its own (real users only ever have provider ids
   `anthropic`/`openai`/`google`/`ollama`/`keepance-local`, so `'mock'` never
   reaches production). Fixed by clicking the real `chat-file-access-allow`
   affordance in the test before sending, so the send reaches the actual
   RAG-unavailable path this test is meant to prove.
2. **A latent product bug (fixed regardless of the test):** the gate
   (`fileAccessConsent.ts` / `useChatSending.ts`'s `providerIsCloud =
   !isLocalProviderId(...)`) and the banner used two independent
   classifications of "cloud." Any provider id neither explicitly local NOR in
   the banner's small hardcoded list — a future provider added to
   `ChatProviderId` without also updating the banner, for example — would be
   gated OFF by the send path with **zero UI escape hatch**, a silent,
   unrecoverable dead end. Fixed by making `FileAccessConsentBanner.tsx` share
   the exact same `isLocalProviderId` predicate the gate uses, so "gated" and
   "has an Allow affordance" can never drift apart again.

Un-quarantined only this one test (`test.skip(!!process.env['E2E_CI_QUARANTINE'], ...)`
removed from it). The file's other 3 tests (`cited answer renders chips...`,
the xlsx round-trip, and the pptx fallback) remain quarantined below for the
separate, still-unresolved `ERR_CONNECTION_REFUSED` CI-only flake — if that
flake turns out to also hit the now-unquarantined test on a future CI run,
re-quarantine it under that same row rather than reopening the consent-gate
investigation, since that root cause is fixed and verified.

## Current state: 3 files re-quarantined post-merge (F3.7b, 2026-07-02)

The F3.7 burndown below (merged into `keepance-3.0` at `c0380e2d`) was verified
green with LOCAL runs only — branch pushes don't trigger CI, so the first real
signal came from the post-merge CI run (28559901825), which was red: 3 of 6
e2e shards, 11 tests. F3.7b (this entry, branch `fix/e2e-ci-remediation`)
triaged each failure against the exact CI-equivalent env (`vite build --config
vite.config.e2e.ts` + `vite preview`, `E2E_NO_LIVE=1`, `E2E_CI_QUARANTINE=1`):

- **Visual snapshots (2 tests, FIXED)** — `app-layout.spec.ts` and
  `status-bar.spec.ts`'s `*-chromium-linux.png` baselines. Root cause: the
  F3.7 burndown's `d87c96a9` un-quarantine commit only regenerated the `en`
  project's baselines (`status-bar-en-linux.png`,
  `main-app-test-mode-en-linux.png`) — the default `chromium` project's
  baselines (what the CI gate actually checks, `--project=chromium`) were
  left stale. `status-bar-chromium-linux.png` in particular was stale from
  well before the burndown (780px width, old fixture filename/trial-day
  content) — not just a color-pixel diff. Regenerated both with
  `--update-snapshots` against the CI-equivalent build; visually confirmed
  both now show the current rebrand/light-theme/faint-text UI. Verified
  green on 2 consecutive local runs.
- **`templates-marketplace.spec.ts` (1 test, RE-QUARANTINED — whole file)** —
  `exposeMarketplaceTestKit()` does `import('/src/features/workflows/
  marketplace/svc/index.ts')` from the page context, relying on Vite's
  dev-server module graph serving raw TS source over HTTP. That route
  doesn't exist under a production `vite build` (CI's preview server serves
  bundled/hashed `dist/assets/*.js`), so the dynamic import 404s. A real fix
  needs a product-code test seam (e.g. an `App.tsx`-exposed
  `window.__marketplaceTestKit` built at app-init time, like other specs'
  `__templatesMarketplaceStore`) — out of the tests/e2e-only remediation
  lane's scope.
- **`web-demo.spec.ts` (4 tests, RE-QUARANTINED — whole file)** — all 4 tests
  `goto('/index.demo.html')` and wait on `demo-mode-banner`, which is gated
  behind the `IS_DEMO` flag (`src/web-demo/demoModeFlag.ts`,
  `__KEEPANCE_DEMO__` global). That define is only set by the separate
  `vite.config.web-demo.ts` build (`npm run build:web-demo`, its own
  `index.demo.html` entry) — the e2e CI job builds only via
  `vite.config.e2e.ts`, which never sets it, so demo mode never activates
  under the preview server the gate tests against. A real fix needs a CI
  workflow change (build+serve the web-demo bundle for this job, or a
  request-time flag) — out of this lane's scope (no CI workflow edits).
- **`wedge-proof.spec.ts` (4 tests, RE-QUARANTINED — per-test in-spec skip,
  not whole-file — its 5th test passes clean)** — all 4 fail on real CI with
  2x `net::ERR_CONNECTION_REFUSED` console errors tripping the specs'
  zero-console-error assertions. Did not reproduce across 2 local runs
  (isolated file run, and a full `--shard=6/6` replay matching the exact CI
  shard) against the CI-equivalent preview build — genuinely CI-runner-
  timing-sensitive, likely an async connectivity probe (firm-backend or
  similar) racing page load. Root cause not pinned down within one bounded
  investigation attempt per the remediation brief.

| Spec | Suspected cause | Owner | Fix-or-delete-by |
|---|---|---|---|
| `templates-marketplace.spec.ts` | Dev-only Vite module-graph import; needs a product-code test seam | `fix-plan-F3.7-followup` | 2026-07-09 |
| `web-demo.spec.ts` | `__KEEPANCE_DEMO__` not set under the e2e job's build; needs a CI workflow change | `fix-plan-F3.7-followup` | 2026-07-09 |
| `wedge-proof.spec.ts` (3 tests remaining, in-spec skip — see 2026-07-03 update above for the 4th) | Intermittent CI-only `ERR_CONNECTION_REFUSED`; cause not yet pinned down | `fix-plan-F3.7-followup` | 2026-07-09 |

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
