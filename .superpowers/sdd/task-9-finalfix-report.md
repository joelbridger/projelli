# Task 9 — Final Fix Report (Branch Review Remediation)

**Date:** 2026-06-21  
**Branch:** feat/onboarding-journey  
**Full suite result:** 317 test files, 3656 tests passing, 3 skipped

---

## IMPORTANT 1 — Ch8 sample toggle stale state

**What was wrong:** `handleContinue` in Ch8 called `ctx.setData({ addSamples })` and then `ctx.complete()` in the same synchronous handler. React batches state updates, so `complete()` read the *previous* render's closure and `data.addSamples` was undefined for users who never touched the toggle.

**How it was fixed:**
- `Ch8SeeItWork.tsx`: Removed the redundant `ctx.setData({ addSamples })` from `handleContinue`. The onChange handler already calls `ctx.setData({ addSamples: next })` on every toggle change, so the value is committed in a prior render by the time Continue is clicked.
- `App.tsx` line 1160: Changed `data.addSamples` to `(data.addSamples ?? true)` so an untouched toggle (still `undefined` in JourneyData) correctly defaults to ON.
- `tests/unit/first-run-journey-mount.test.tsx`: Updated `makeOnComplete` helper to use `?? true` (was `?? false`); added test "leaving the toggle at default (ON) calls writeSampleFiles"; added test that `chapter-continue` does NOT call setData (the toggle does).

**Verified:** Tests pass, including new toggle-default test.

---

## IMPORTANT 2 — Settings replay is non-destructive

**What was wrong:** `handleSettingsRestartOnboarding` just called `setShowFirstRun(true)`. When the user completed the replay, `onComplete` re-ran `persistProfessionModelDefault`, name/avatar writes, and `writeSampleFiles` — overwriting existing setup.

**How it was fixed:**
- `App.tsx`: Added `onboardingReplay` boolean state. `handleSettingsRestartOnboarding` now sets both `setOnboardingReplay(true)` and `setShowFirstRun(true)`.
- `onComplete` callback: if `onboardingReplay` is true, only dismiss the overlay and reset the flag — skip all persistence side-effects.
- `onExit` callback: same guard — replay just closes without any localStorage writes.
- `tests/unit/first-run-journey-mount.test.tsx`: Added mock for `persistProfessionModelDefault`; added "replay mode" describe block with tests confirming that a replay-flagged completion does not call persistence functions, while a first-run completion does.

**Verified:** Tests pass. The replay guard is unit-tested at the callback level.

---

## IMPORTANT 3 — JourneyHost is a real modal

**What was wrong:** JourneyHost rendered full-screen but the DOM behind it remained keyboard/screen-reader accessible.

**How it was fixed:**
- `JourneyHost.tsx`: Added `role="dialog"`, `aria-modal="true"`, and `aria-label="Set up Keepance"` to the root div.
- `App.tsx` — workspace-selector branch (around line 1207): Wrapped background content (ModelDownloadCard + WorkspaceSelector) in a div with `{...(showFirstRun ? { inert: '' } : {})}` so the background is inert when the overlay is open.
- `App.tsx` — main app return (around line 1271): Added `{...(showFirstRun ? { inert: '' } : {})}` to the `app-container` div, and moved `{firstRunOverlay}` outside it so the modal is rendered in the same DOM level but background content is inert.
- `JourneyHost.test.tsx`: Added "JourneyHost — modal accessibility" describe block with a test asserting `role="dialog"`, `aria-modal="true"`, and `aria-label="Set up Keepance"` on the host root.

**Note:** TypeScript `inert` attribute used via spread (`{ inert: '' }`) to avoid strict-mode type errors since `inert` on HTMLDivElement isn't in older lib.dom typings. Using empty string `''` as the value is valid HTML for boolean attributes in a spread context.

**Verified:** Test passes.

---

## IMPORTANT 4 — Desktop onboarding spec updated

**What was wrong:** `tests/desktop/specs/15-onboarding.mjs` referenced deleted test-ids: `guided-onboarding-frame`, `onboarding-next-welcome`, `onboarding-step-profession`, `profession-card-legal`, `onboarding-identity-name`, `onboarding-identity-file`, `onboarding-identity-next`, `onboarding-step-workspace`, `workspace-choice-documents`, `onboarding-workspace-next`, `onboarding-step-trust`, `onboarding-trust-open-data-map`, `onboarding-data-continue`, `onboarding-step-ai-key`, `ai-setup-step`, `ai-path-own-account`, `ai-path-local`, `ai-path-later`, `onboarding-step-email`, `email-tab-m365`, `email-connect-later`, `onboarding-email-continue`, `onboarding-step-firm`, `firm-option-create`, `firm-option-join`, `firm-option-solo`, `onboarding-firm-continue`, `firm-solo-skip`, `onboarding-step-done`, `onboarding-samples-toggle`, `onboarding-done-no-ai-note`, `onboarding-done-confirm`.

**How it was fixed:** Completely rewrote `15-onboarding.mjs` to use the new JourneyHost chapter test-ids:
- `ch1-root`, `chapter-continue` (Ch1 welcome)
- `ch2-root`, `ch2-profession-legal`, `ch2-display-name` (Ch2 about you)
- `ch3-root`, `ch3-choose-folder`, `ch3-chosen-path` (Ch3 files stay home)
- `ch4-root` (Ch4 meet the AI)
- `ch5-root`, `ch5-card-later`, `ch5-wrap-continue` (Ch5 choose brain)
- `ch6-root`, `ch6-connect-later` (Ch6 email)
- `ch7-root` (Ch7 solo/firm)
- `ch8-root`, `ch8-samples-toggle` (Ch8 done)

**Desktop-spec gap:** Ch3 opens a Tauri native folder picker (`open()` from `@tauri-apps/plugin-dialog`) which WebDriver cannot interact with. The spec clicks `ch3-choose-folder` and checks for `ch3-chosen-path`; if the native dialog isn't resolved (it won't be in headless CI), the spec falls through to the workspace-selector fallback path and throws the expected BLOCKED error. This matches the existing spec's design. A full end-to-end walk is not achievable without a headless way to satisfy Tauri's OS dialog.

**All test-ids verified to exist in source:** Confirmed via grep across all `*.tsx` files. Note `ch2-profession-legal` is rendered dynamically as `data-testid={\`ch2-profession-${p.id}\`}` where `id: 'legal'` — the selector `ch2-profession-legal` matches.

---

## MINOR — Campaign persona.spec.ts

Changed `page.getByTestId('first-run-samples-toggle')` to `page.getByTestId('ch8-samples-toggle')` at line 157.

---

## MINOR — Orphaned i18n keys removed

Removed the entire `"first-run"` subtree from `"onboarding"` in:
- `src/locales/en.json`
- `src/locales/de.json`
- `src/locales/es.json`

Confirmed via grep that no TypeScript source file references `onboarding.first-run.*` keys (the new journey uses `copy/strings.ts` directly, not i18n). The `disk-encryption` and remaining `onboarding.*` keys were preserved. Updated `tests/unit/i18n/en-json-snapshot.test.ts` and `tests/unit/onboarding-copy-3-0.test.ts` to account for the removed keys.

---

## MINOR — OnboardingStepFrame.tsx deleted

Deleted `src/features/onboarding/OnboardingStepFrame.tsx`. Confirmed no imports anywhere in source (was used only by the deleted GuidedOnboarding/FirstRunWizard). No associated test file existed.

---

## MINOR — Code comments added

- `useJourney.ts`: Added comment above `complete()` explaining that it reads `data` from closure and that calling `setData()` and `complete()` in the same synchronous handler will result in `complete()` seeing stale data.
- `Ch5ChooseYourBrain.tsx`: Added one-line comment noting it intentionally skips ChapterLayout (manages its own multi-subview layout).
- `Ch6Email.tsx`: Added one-line comment noting it intentionally skips ChapterLayout (full-width tabs layout).

---

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | Clean |
| `npm run test` | 317 files, 3656 passing, 3 skipped |
| `npm run lint` | 2103 problems (all pre-existing; no new errors introduced by this PR) |
| Desktop spec test-ids verified in source | All confirmed to exist |
| Old deleted test-ids removed from specs | Confirmed (grep finds none) |
| `cargo` not run | Per task constraints |
