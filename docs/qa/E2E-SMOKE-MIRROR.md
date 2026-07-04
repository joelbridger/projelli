# E2E Smoke Mirror

A Linux/Playwright mirror of the Windows bench smoke checklist
(`scripts/bench-smoke/checklist.mjs`, driven against the real Tauri desktop
app on the Legion bench — see `docs/qa/BENCH-SMOKE-HARNESS.md`). Goal: catch
UI/flow regressions in the same areas in minutes on this Linux dev server, so
the physical/cloud Windows bench pass does **confirmation**, not discovery.

**Status:** 5 new spec files, 11 tests, all green. Runtime ~15s (well under
the 5-minute budget). No product source was modified — additive spec files
only, using test seams (`__setTestFileTree`, `__mockWorkspaceFs`, the
existing `?seedDemo=1`/`?mailFixture=1` dev fixtures, and the same
localStorage-seed-and-reload technique `tests/e2e/citation-persistence.spec.ts`
and `tests/e2e/theme-system.spec.ts` already use) that already existed before
this lane.

## How to run

```bash
npx playwright test tests/e2e/bench-mirror-*.spec.ts --project=chromium
```

## Why some checks can't run in the browser at all

The single biggest structural finding of this lane: **the in-house OOXML
`.docx` editor (the toolbar with "Draft follow-up" and "Send to Wealthbox")
only renders when a Tauri runtime is present.** In the Vite dev server
(`npm run dev`, no `tauri dev`), `DocxEditor.tsx` always falls back to its
read-only `DocxViewer` (confirmed by the existing
`tests/e2e/doc-viewers.spec.ts` test literally named "renders a .docx file in
the browser read-only preview", and by `DocxEditor.tsx`'s own "Browser / test
/ no-path: read-only fallback" comment). Neither toolbar button — and neither
of the two checks built around them (Wave 0, Wave 2's queue/review half) —
can exist in this Playwright setup, full stop, independent of any connector
or AI-key question.

Separately, the Calendar and Wealthbox/CRM connectors
(`CalendarConnect.tsx`, `WealthboxConnect.tsx`) call Tauri commands directly
(`calendarConnectOutlook`, `crmConnect`, …), each guarded with
`if (!isTauri()) throw ...` / `return false`, and — unlike Email
(`mailFixtureEnabled()`, gated by `?mailFixture=1`) — **have no dev-fixture
equivalent today.** Per the brief, building one is out of scope for this
lane ("do not build new mock infrastructure").

Both of these are real, already-covered gaps: `docs/qa/BENCH-SMOKE-HARNESS.md`
records that Wave 0 and Wave 2 (queue/review) already PASSed live against the
real Tauri app on the Legion bench (2026-07-03) — the browser mirror simply
cannot reach that code path, by design of the product (Rust OOXML engine +
native connectors), not by a gap in this test lane.

## Mapping table

| Bench check id | Spec file | Classification | Notes |
|---|---|---|---|
| `workspace-binding` | `bench-mirror-setup.spec.ts` | **MIRRORED** | Clients list renders the seeded book of business (`?seedDemo=1`). |
| `per-client-files-visible` | `bench-mirror-setup.spec.ts` | **MIRRORED** | Strengthened beyond the bench check: seeds one distinctly-named file per client via `__setTestFileTree` and asserts it shows for its own client's Documents tab and NOT for the other client — the actual cross-client-isolation property the bench check's title names, not just "some file is visible". |
| `index-health` | `bench-mirror-setup.spec.ts` | **MIRRORED** | Asserts real `clientmap-source-link` citation chips (from the seeded Brennan Client Map's document/email `SourceRef`s) instead of the bench's literal `'cited'` text search — that exact substring does not appear anywhere in current app copy (see caveat below); the chip testid is the honest, current signal for "a cited fact rendered". Also asserts none of the three real build/update error strings are present. |
| `wave0-draft-followup` | — | **NOT-MIRRORABLE** | Needs the Tauri-only docx editor toolbar (see above) AND a connected mail account (Tauri-only outside `?mailFixture=1`) AND a real AI provider call to generate the draft. Already live-verified on the real bench per `BENCH-SMOKE-HARNESS.md`. |
| `wave1-calendar-brief-export` | — | **NOT-MIRRORABLE** | `CalendarConnect.tsx`'s `calendarConnectOutlook`/`calendarConnectGoogle` throw `"Calendar sync is only available in the desktop app."` outside Tauri; no dev-fixture equivalent to Email's `mailFixtureEnabled()` exists to fake a connected calendar. |
| `wave2-wealthbox-queue-review` | — | **NOT-MIRRORABLE** | Same docx-toolbar root cause as Wave 0 — `docx-send-to-wealthbox` lives only in the Tauri-backed editable editor. Independently, the button is `disabled={!wealthboxConnected}` and `crmIsConnected()` always resolves `false` outside Tauri with no dev fixture. Already live-verified on the real bench. |
| `wave2-wealthbox-approve-live` | — | **NOT-MIRRORABLE** | `liveOnly` on the bench itself (sandbox CRM only) — same Tauri-only root cause as above, doubly out of scope here. |
| `wave4-whole-book-view` | `bench-mirror-book-view.spec.ts` | **MIRRORED** | `BookView.tsx` is pure derived client state (`useActiveMatters` + `useClientMapStore`, no Tauri/network) — fully drivable. Uses `seedDemoClients.ts`'s Tran/Whitman matters, which (unlike Brennan/Okafor) are **not** `isSample`-flagged and so are the only seeded matters `buildBookRows` includes (it skips `isSample`/`archived` matters). |
| `wave4-estate-beneficiary-gap` | `bench-mirror-book-view.spec.ts` | **MIRRORED** | Seeds one non-sample matter + a Client Map whose `completeness.ask` carries a `"Beneficiary check:"`-prefixed gap, via `localStorage['lantern:matters']` / `localStorage['lantern:client-maps']` — the same reload-to-rehydrate technique `citation-persistence.spec.ts` already uses for the sibling `lantern:matters` store. Confirms the gap chip renders on its book row AND that the same client's Client Map "What I'm missing" tab shows the resolvable `clientmap-ask-flag` row. |
| `wave4-estate-beneficiary-gap-dismiss-live` | `bench-mirror-book-view.spec.ts` | **MIRRORED (upgraded from the bench's `--live` gate)** | The bench gates this because dismissing a gap permanently mutates the **shared physical-bench demo data** other runs depend on. Here the fixture is seeded fresh per test in a throwaway browser context, so there's no shared state to protect — the real resolve-and-clear flow runs unconditionally and is asserted both on the Client Map row and on the book view's gap chip disappearing. |
| `wave4-whole-practice-ask` | `bench-mirror-ask-whole-practice.spec.ts` | **MIRRORED** | `ScopeToggle`/`FileAccessConsentBanner` are pure client-side UI — no AI call needed. One real precondition found: the consent gate only renders for a resolved **cloud** provider (`isLocalProviderId` check); with no key configured, `resolveActiveAskProviderId()` correctly falls back to a local engine ("no cloud key → the local engine") and the gate has nothing to show. Fixed by seeding a fake Anthropic key via the same obfuscated-localStorage fallback `tests/e2e/api-keys-panel.spec.ts` already uses (never sent anywhere). |
| `cross-cutting-light-theme` | `bench-mirror-cross-cutting.spec.ts` | **MIRRORED** | Deep toggle-cycle coverage already lives in `tests/e2e/theme-system.spec.ts`; this test instead mirrors the bench check's own shape (no dark marker while navigating Client Map → Documents → Settings). |
| `cross-cutting-console-errors` | `bench-mirror-cross-cutting.spec.ts` | **MIRRORED** | Same `page.on('console')` pattern already used in `tests/e2e/command-palette.spec.ts`, over the same three-surface navigation. |
| `cross-cutting-egress-indicator` | `bench-mirror-cross-cutting.spec.ts` | **MIRRORED (with a corrected string)** | The bench's literal wait text, `"outside connections are blocked"`, does not exist anywhere in current app copy — it belongs to a different feature (the per-client network-lockdown badge in `ConfidentialityModeSettings.tsx`'s locale strings), not the global Local-only toggle. The real, current confirmation is `EgressIndicator`'s `egress-indicator-label` ("Using local AI" / "Using cloud AI") — asserted here instead, both directions (flip to local-only, then revert). Needed a seeded fake cloud key for the same "no cloud key → local fallback" reason as the Ask test above. |
| `wave3-capture-*` (3 stubs) | — | **NOT-MIRRORABLE** | Local meeting capture is Rust/WASAPI-loopback only; no browser UI exists yet (stub in the bench harness itself, not merged). |
| `wave4-diarization` (stub) | — | **NOT-MIRRORABLE** | Depends on Wave 3 capture existing first; no UI. |
| `wave4-retention-attestation` (stub) | `bench-mirror-retention.spec.ts` | **PARTIAL — stub is stale, feature has since merged** | The bench harness still lists this as TODO, but the feature actually merged since that stub was written: `RetentionSettings.tsx`, `DataMapDialog.tsx`'s "Wave 4 Track D" block, and `platform/privacy/attestation.ts` (see `CHANGELOG.md`'s "Retention policy engine + local redaction + attestation export" entry) are all real, current code — my first grep for "Meeting recordings" (the stub's own paraphrase) missed them because the actual UI copy differs. MIRRORED: the retention-mode control (keep-everything / delete-audio-after-days / summary-only) renders and its live state reflects on the Data Map dialog's retention row. NOT-MIRRORABLE: the ".docx export" action itself, which calls `@tauri-apps/plugin-fs` directly and the native OOXML engine — no browser path exists. Flagging this stub as stale is itself a useful finding for whoever owns `scripts/bench-smoke/checks/wave-stubs.mjs` next. |

**Score: 11 of 19 total checklist entries (14 live checks + 5 stubs)
MIRRORED or PARTIAL in the browser** (including one upgraded past the
bench's own `--live` gate, and one stub found to have already shipped),
**8 NOT-MIRRORABLE** (4 for a hard architectural reason — Tauri-only docx
editor / connectors — and 4 stubs whose product UI doesn't exist yet on any
platform).

## `data-testid` additions

None. Every selector used already existed in `src/` before this lane;
confirmed each one against the current `lantern-plus` source before writing
the spec that depends on it (a few, e.g. `scope-option-whole-practice` and
`clientmap-tab-__missing`, needed tracing through source since the bench
script's own comments didn't name them precisely).

## Fixture/seeding techniques used (all pre-existing patterns, nothing new)

- `?testMode=true&seedDemo=1` — the existing dev fixture (`seedDemoClients.ts`) for the Brennan/Okafor demo book of business.
- `window.__setTestFileTree` / `window.__mockWorkspaceFs` — existing test hooks from `useTestModeWorkspace.ts`, also used by `tests/e2e/wedge-proof.spec.ts`.
- `localStorage['lantern:matters']` + `localStorage['lantern:client-maps']` seed-then-reload — the same technique `tests/e2e/citation-persistence.spec.ts` uses for `lantern:matters`; `lantern:client-maps` is `useClientMapStore`'s sibling persisted store (`src/config/identity.ts`'s `SK_MATTERS`/`SK_CLIENT_MAPS`, persist version 3, `partialize: { maps, clientQuestions }`).
- `localStorage['bos_key_<provider>']` + `bos_key_metadata` — the same obfuscated-localStorage-key browser fallback `tests/e2e/api-keys-panel.spec.ts` uses to make a fake (never-sent) API key visible to `KeychainService.hasKey()`.

## Known drift between the bench script and current `lantern-plus` copy

Two bench-check assumptions no longer match current source (both harmless —
the underlying feature still works, just under different, current copy):

1. `checkIndexHealth`'s `textPresent(driver, 'cited')` — no literal "cited" string exists in `src/locales/en.json` or the Client Map panel; the real per-fact citation affordance is `clientmap-source-link`.
2. `checkEgressIndicator`'s `waitFor('outside connections are blocked', 10)` — that exact phrase belongs to the per-client network-lockdown badge, not the global Local-only mode; the real confirmation is `egress-indicator-label` reading "Using local AI".

Neither blocks the bench harness's own PASS/FAIL logic today (both checks
have fallback paths), but worth a follow-up ticket to refresh those two
strings in `scripts/bench-smoke/checks/`.
