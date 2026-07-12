# CODEX FIX BRIEF — Wave 2, Lane 1 (board) fix round

You are a Codex fix agent in worktree /home/jameson/lp-w2-1 (branch lp/intake-w2-1). Your board build (commit 377be8b4) typechecks and its scoped test passes, but an adversarial review found 4 real user-facing breakages. Fix ALL of them, TDD, then commit on this branch. Do NOT push. Scope is limited to `src/features/intake/OnboardingBoard.tsx`, `src/features/intake/OnboardingBoardRow.tsx`, and their test(s) — do NOT modify Lane-0 files, backend/, or intake-page/.

## Read first
- `src/app/lifecycle/useGlobalEventBus.ts` (~line 199-231): for `EV_MATTER_LAUNCH` with `surface:'matters'` it maps `hubTab='overview'` and calls `setClientMapHubTab('overview')` SYNCHRONOUSLY during `dispatchEvent`.
- `src/features/intake/OnboardingTab.tsx`: `copyLink` reconstructs the link via `reconstructAdvisorIntakeLink({ intakeId, publicKeyRawB64 })` when `intake.link` is absent — reuse this pattern.
- `src/platform/intake/advisorIntakeLink.ts`: `reconstructAdvisorIntakeLink`.

## Fixes (do ALL)

### [P2-1] Row click must open the ONBOARDING tab (not overview) in the real shell
`openRow` sets `setClientMapHubTab('onboarding')` and THEN dispatches `EV_MATTER_LAUNCH` with `surface:'matters'`. The global event bus handles that synchronously by setting `setClientMapHubTab('overview')`, overwriting onboarding — so in the running app, clicking a row (and the Review action) lands on the Client Map OVERVIEW, defeating the board's primary action. Fix so the row reliably lands on the client's **Onboarding** tab. Preferred: set `setClientMapHubTab('onboarding')` AFTER the dispatch returns (so it wins), OR pass an explicit target tab through the event detail that the bus honors. **Critically, add a test that reproduces the bus overwrite** — e.g. register a listener that calls `setClientMapHubTab('overview')` on `EV_MATTER_LAUNCH` (mimicking the real bus), then assert the final `clientMapHubTab === 'onboarding'`. (The current test set the tab directly and never exercised the bus, so it missed this.)

### [P2-2] Copy-link must not falsely report "Copied" after an app restart
The intake store strips `link` before persistence, so after restart active records have no `link`; `copyLink` returns without copying yet the row still flips to "Copied". Fix: when `intake.link` is absent, reconstruct it via `reconstructAdvisorIntakeLink({ intakeId, publicKeyRawB64 })` (as `OnboardingTab` does) and copy that; only show "Copied" on an ACTUAL successful copy. If no link can be rebuilt, do not show "Copied" (disable or surface a plain message). Test the no-`link` path.

### [P2-3] Row keydown must not steal Enter/Space from child action buttons
The button-like row handles bubbled Enter/Space keydowns and `preventDefault`s them, so a keyboard user who focuses an inner action button (Copy link, Nudge, etc.) and presses Enter/Space opens the ROW instead of activating the button. Fix: only handle the row key when `event.target === event.currentTarget` (ignore bubbled events from children). Add a keyboard test. (Older-client accessibility is a Wave gate — this matters.)

### [P2-4] Do not show enabled row actions with no handler
`OnboardingBoard` is mounted in `MattersHome` without `onOpenNudge`/`renderNudgeSlot` (Lane 3 not merged yet) and without `onOpenLinkSignals`/`renderLinkSignals` (Lane 2 not merged), so stalled rows show an enabled "Nudge" button (and link-signals action) that only stops the row click and then does nothing. Fix: hide or disable the nudge action unless `onOpenNudge` (or `renderNudgeSlot`) is provided, and likewise the link-signals action unless its handler/slot is provided. When Lanes 2/3 later wire the handlers, the actions light up automatically. Keep the existing `data-testid`s stable (tests assert them) — when disabled, still render the button (disabled) so testids resolve, OR update the test to match hidden behavior; pick one and keep the test green + meaningful.

## Done bar
- Light theme, design tokens (no hex). User copy client/household. No em dashes, no time estimates. Redaction unchanged (labels/ids only).
- TDD, real assertions. Strict TS, `@/` alias.
- GREEN before done: `npx vitest run src/features/intake`; `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`. Commit on this branch with a clear message. Do NOT push.
