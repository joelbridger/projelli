# CODEX BUILD BRIEF — Lantern Intake Wave 2, Lane 1: Onboarding Board UI

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push.** **Do NOT touch `backend/`, `intake-page/`, `src/platform/intake/onboardingModel.ts`, `intakeStore.ts`, or `nudgeTypes.ts`** — Lane 0 owns those; you IMPORT them. Wrapper appends the DONE-EXIT sentinel.

## Context to read first
- `docs/plans/lantern-plus/intake/W2-EXEC-PLAN.md` §1 (non-negotiables), §3 (file table), §4 (V2).
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §4 (the board — read the ASCII mock + the sort/stall rules; tone is "give them a hand," warm amber not alarm red).
- **Consume the Lane-0 contract (already merged):** `src/platform/intake/onboardingModel.ts` — `deriveOnboardingRow`, `sortOnboardingRows`, `OnboardingRow`, `DEFAULT_ONBOARDING_CONFIG`. NEVER recompute row data from raw values — render the model.
- **Reuse the real UI system (read them):**
  - `src/features/matters/MattersHome.tsx` — the clients surface; owns the client table, `SurfaceToolbar`, `TodaysMeetingsStrip`, the `MatterHub` mount. Add a board view toggle here.
  - `src/features/matters/MatterHub.tsx` — per-client hub; the `onboarding` tab already exists. Row click must open a client's Onboarding tab (dispatch `EV_MATTER_LAUNCH` + `setClientMapHubTab('onboarding')`, the same pattern `NewClientDialog` uses on send).
  - `src/ui/kp/` + `src/ui/button` — `Button`, `IconButton`, `Badge`, `Card`, `SurfaceToolbar`. Light theme, design tokens only (no hard-coded hex — token-guard gate).
  - `src/features/intake/OnboardingTab.tsx` — match its visual language (navy headings, `--kp-*` tokens, provenance chips).

## Scope (build all)
- `src/features/intake/OnboardingBoard.tsx` — reads `useIntakeStore` → active intakes → `deriveOnboardingRow(intake, now, cfg)` → `sortOnboardingRows`. Renders one row per active onboarding. Header "Onboarding" + a `[New client]` action that reuses the EXISTING new-client path (do not create a second intake entry point).
- `src/features/intake/OnboardingBoardRow.tsx` — a row answering the four P5 questions: **who** (clientFirstName), **what's missing** (missingItemLabels — labels ONLY, never values/file names), **how long quiet** (lastActivityAt → "2 days ago" / "STALLED 9 days"), **what next** (next-action hint: "review N new items" / "nudge ready" / "nudge awaiting approval" / progress bar `N of M`). Stalled rows get warm amber accent (token, not red). Row actions (buttons with stable `data-testid`): open Onboarding tab, review new items, (nudge open — Lane 3 wires the handler; expose an `onOpenNudge?` prop + a placeholder slot), copy link again, show link signal details (Lane 2 provides the badge component; expose a slot/prop `renderLinkSignals?`).
- `src/features/intake/OnboardingBoardEmptyState.tsx` — "No active onboarding requests" + primary action = existing New client path.
- `src/features/matters/MattersHome.tsx` — add a **board view toggle** beside the client list (list ⇄ board). Persist the choice via the existing nav/app store pattern if one exists; otherwise local state is fine. Keep it INSIDE MattersHome (not a new top-level surface).
- Locale: add `intake.board.*` keys to `src/locales/en.json` (all visible strings; NO hard-coded user text in components). Add the SAME keys to `de.json` + `es.json` with real translations, and update `tests/unit/i18n/en-json-snapshot.test.ts` inventory/counts. (If unsure of the exact snapshot format, still add the keys to all three locales — the lead reconciles the snapshot at the gate-fix round.)

## Tests (Vitest + RTL)
- `src/features/intake/__tests__/OnboardingBoard.test.tsx`: renders 3-client fixture (one awaiting review, one stalled + nudge-eligible, one complete); asserts sort order (awaiting-review first, stalled second); missing-item LABELS render; stalled row shows the stalled treatment; clicking a row dispatches the matter-launch + sets the onboarding hub tab; **redaction**: fixture intake carries a planted SSN/file-name in fact-adjacent state → assert it NEVER appears in the rendered board.
- Row actions expose stable `data-testid`s asserted by the test.

## Constraints
- Never recompute from raw values — render the Lane-0 model. Never render a fact value, last-4, license number, amount, or file name — labels/ids/counts/timestamps only.
- Light theme, design tokens (no hex literals). User copy says client/household. No em dashes, no time estimates in copy.
- Strict TS, `@/` alias. TDD, real assertions. Match `OnboardingTab.tsx` idiom.
- Before done: `npx vitest run src/features/intake` green; `npx tsc --noEmit` clean; `npx eslint src/features/intake` clean. Commit on your branch. Do NOT push.
