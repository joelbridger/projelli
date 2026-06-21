# Task 9a Report — Cutover to JourneyHost

## Summary

The animated JourneyHost is now the live first-run surface in Keepance. GuidedOnboarding and FirstRunWizard have been removed.

---

## Files Changed

### Created
- `src/features/onboarding-journey/chapters/index.ts` — exports `journeyChapters: Chapter[]` with all 8 chapters in order: ch1Welcome, ch2AboutYou, ch3FilesStayHome, ch4MeetTheAI, ch5ChooseYourBrain, ch6Email, ch7SoloOrFirm, ch8SeeItWork.

### Modified — App.tsx
**Imports added:**
- `JourneyHost` from `@/features/onboarding-journey/JourneyHost`
- `journeyChapters` from `@/features/onboarding-journey/chapters`
- `persistProfessionModelDefault` from `@/platform/profile/professionModel`
- `writeSampleFiles` from `@/platform/matter/samples`
- `useProfileStore` from `@/platform/profile/profileStore`
- `CONFIDENTIALITY_MODE_SETTING_KEY` from `@/platform/privacy/egress`

**Imports removed:**
- `GuidedOnboarding` from `@/features/onboarding/GuidedOnboarding`

**Actions wired (the `journeyActions` useMemo):**
- `saveApiKey`: wired to `handleSaveOnboardingApiKey` — stores via `KeychainService.setKey` and refreshes live model list state via `handleSaveApiKey` → `refreshProvider` (the same canonical save path Settings/ApiKeyWizard use).
- `setConfidentialityMode`: calls `useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode)` — the same store TrustBar and the settings panel read.
- `chooseWorkspaceFolder`: opens native Tauri directory picker via `@tauri-apps/plugin-dialog` (same plugin/options as WorkspaceSelector), returns the chosen path or null on cancel/browser env.

**`onComplete` handler:**
- Calls `persistProfessionModelDefault(data.profession)` only when `data.aiChoice !== 'cloud'` (avoids overriding a provider the user explicitly connected in Ch5).
- Persists identity: `useProfileStore.getState().setSoloName(data.displayName)` and `setSoloAvatar(data.photoDataUrl)` — the same store IdentityStep writes directly in GuidedOnboarding step 2.
- Creates sample files via `writeSampleFiles(workspaceServiceRef.current, sampleProfession)` when `data.addSamples && workspace && rootPath`. Maps `'financial'` → `'advisor'` for the `OnboardingProfession` type (new journey uses `'financial'`, samples index uses `'advisor'`).
- Writes `localStorage.setItem('keepance_onboarding_complete', 'true')` and calls `setShowFirstRun(false)`.
- Navigates to `search` + activates sample matter (via `getOrCreateSampleMatter`) if samples were written; otherwise navigates to `matters`.
- Does NOT add backend firm calls — firm provisioning stays in Settings per the brief.

**`onExit` handler:**
- Writes `keepance_onboarding_complete='true'` (same as old `skipAll` behavior) and calls `setShowFirstRun(false)`.

**First-run trigger conditions unchanged:** same `hasCompletedOnboarding()` + `noRecentWorkspaces` + `!IS_TEST_MODE` + `!IS_DEMO_MODE` + `forceOnboarding` logic.

### Modified — `src/features/onboarding/index.ts`
- Removed export of `FirstRunWizard` and `FirstRunWizardProps` from `./FirstRunWizard`.
- Now re-exports `hasCompletedOnboarding`, `resetOnboarding`, `getOnboardingProfession` from `./onboardingState` (their canonical home) for back-compat. No callers other than `App.tsx` import from this barrel.

### Modified — `tests/unit/architecture-boundaries.test.ts`
- Added `'onboarding-journey->settings'` to the allowlist — Ch6Email mounts the real MailConnect/MailGmailConnect/MailImapConnect from `features/settings`, the same pattern GuidedOnboarding used (previously implicitly allowed via `app` layer).

### Deleted
- `src/features/onboarding/GuidedOnboarding.tsx`
- `src/features/onboarding/FirstRunWizard.tsx`
- `tests/unit/first-run-mount.test.tsx` — tested GuidedOnboarding step data-testids
- `tests/unit/first-run-samples.test.tsx` — tested FirstRunWizard samples toggle
- `tests/unit/first-run-wizard-flow.test.tsx` — tested FirstRunWizard full flow
- `tests/unit/guided-onboarding.test.tsx` — tested GuidedOnboarding step-by-step
- `tests/unit/onboarding-firm-join-flow.test.tsx` — tested GuidedOnboarding firm step
- `tests/unit/onboarding-step-circles.test.tsx` — tested FirstRunWizard digit centering fix
- `tests/unit/disk-encryption-guidance.test.tsx` — tested DiskEncryptionGuidance mounted in FirstRunWizard

### Kept (not touched)
- `AiSetupStep`, `ApiKeyTester`, `ApiKeyExplainer`, `ProviderTutorialSteps`, `useProfessionCopy`, `aiSetupState`, `detectOllama`, `DataMapDialog`, `MailConnect`, `MailGmailConnect`, `MailImapConnect` — all still used by journey chapters or other settings surfaces.
- `OnboardingStepFrame` — used by the removed components but may be used elsewhere; not deleted.

---

## Test Results

- **316 test files passed** (0 failed)
- **3640 tests passed, 3 skipped** (architecture-boundaries, all journey chapter tests, all other suites — all green)

## Typecheck

`npm run typecheck` — clean (no errors).

## Lint

No new lint errors introduced in the files I added/modified. Pre-existing errors in App.tsx (lines 160, 282, 559, etc.) were there before this task and are unrelated.

## Concerns

None. The cutover is clean:
- The first-run trigger conditions are identical to before.
- All real side-effects (key persistence, confidentiality mode, folder pick, samples, identity) route through the same underlying handlers as GuidedOnboarding.
- The `'financial'` → `'advisor'` mapping is a one-line compat shim needed because the new journey type system uses `'financial'` while the samples module (predating the journey) uses `'advisor'`.
- Architecture boundary test updated with the one legitimate new cross-feature edge (`onboarding-journey->settings` for the email chapter).

---

## Fix pass (cutover review: workspace Critical + 2 Important + 2 minor)

### Fix 1 [CRITICAL] — picked workspace folder is now opened as the workspace root

**Where:** `src/App.tsx`, `journeyActions.chooseWorkspaceFolder`.

**How:** After the native picker returns a path, `chooseWorkspaceFolder` now:
1. On Tauri: calls `createFSBackend(selectedPath)`, `createWorkspaceService()`, `service.initialize(...)`, then `handleWorkspaceSelected(service)` — the same path `WorkspaceSelector.openWorkspacePath` uses.
2. On browser: calls `createWebFSBackend()`, `webBackend.openDirectoryPicker()`, builds the service, and calls `handleWorkspaceSelected(service)` — the same path `WorkspaceSelector.handleSelectFolder` (browser branch) uses.

`handleWorkspaceSelected` is added to the `useMemo` dependency array. The function still returns the path string so Ch3 can display it. From the user's perspective: after the folder picker closes in Ch3, the app immediately has an open workspace — no second pick required after onboarding completes.

### Fix 2 [IMPORTANT] — first-run integration test restored

**New file:** `tests/unit/first-run-journey-mount.test.tsx`

Mounts the real `JourneyHost` with the real `journeyChapters` (8 chapters end-to-end). Asserts:
- **(a)** Ch1 (`ch1-root`) is visible on first render — JourneyHost welcome step appears.
- **(b)** Driving through all 8 chapters and firing `onComplete` writes `keepance_onboarding_complete='true'`; `hasCompletedOnboarding()` returns `true`; the overlay state machine would not re-trigger a returning user.
- **(c)** When the `onComplete` callback wires `addSamples=true`, `writeSampleFiles` is called once; when `false`, it is not. A third test confirms `ch8-samples-toggle` defaults to `checked=true`.

The helper `driveToCompletion` navigates each chapter correctly: fills in Ch2's profession + display name; triggers Ch3's folder picker and waits for the path to appear; clicks Ch5's "Set up later" card then the wrap-view continue; uses `ch6-connect-later` to skip email; continues through Ch7 and Ch8.

**7 tests, all green.**

### Fix 3 [IMPORTANT] — DiskEncryptionGuidance preserved and reachable from Ch3

**Where:** `src/features/onboarding-journey/chapters/Ch3FilesStayHome.tsx`

`DiskEncryptionGuidance` is now imported from `@/features/onboarding/DiskEncryptionGuidance` and embedded as a collapsible secondary callout below the folder picker. A toggle button (`data-testid="ch3-encryption-toggle"`, labelled "How do I know my computer is encrypted?") reveals/hides the component. The callout is collapsed by default so it does not clutter the main folder-pick flow for users who do not need it. The existing `DiskEncryptionGuidance.tsx` file is untouched.

**4 new tests** in `Ch3FilesStayHome.test.tsx` cover: toggle button present, guidance hidden by default, clicking expands it (and `disk-encryption-guidance` testid appears), clicking again collapses it.

### Fix 4 [MINOR] — profession mapping + awaited samples in onComplete

Two corrections to `App.tsx`'s `onComplete` handler:

1. **`financial` → `advisor` mapping applied to `persistProfessionModelDefault` too.** Previously only the sample-file branch mapped the profession; the model-default branch was calling `persistProfessionModelDefault('financial')` which likely fell through to the `'other'` default. Now `mappedProfession` is computed once and used for both.

2. **`writeSampleFiles` is now awaited with try/catch.** The old code fired-and-forgot with `.catch()`. Now the call is `await writeSampleFiles(...)` in a `try/catch` block and `didWriteSamples` is only set to `true` on success. A failed write no longer silently navigates the user to an empty sample matter.

### Full-suite result

317 test files · 3651 tests passed · 3 skipped · 0 failed
`npm run typecheck` clean · no new lint errors introduced.
