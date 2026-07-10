# Wave 7 Lane 3 — Requests Board and Client Requests Tab

**Branch:** `lp/intake-w7-requests-ui`, branched from the merged Lane 2 tip (`lp/intake-w7-composer` after it merges). Confirm the exact base commit with the dispatcher before starting.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Today the app has exactly one cross-client board (`OnboardingBoardContainer`, mounted once in `MattersHome.tsx`) and one per-client tab (`OnboardingTab`, mounted in `MatterHub.tsx`) that both assume a client has at most one active request, and that request is always onboarding. You're generalizing both surfaces into a **Requests** board and a **Requests** tab that show every request — onboarding and standing — while keeping "Onboarding" as the default, prominent filtered view (it's still the most important flow; it's just not the only one anymore). You're also mounting Lane 2's `RequestFromClientDialog` so an advisor can start a standing request from a client's page. You own every shared app-mount file this wave touches — Lane 1 and Lane 2 deliberately built standalone, so you're the one wiring them into the app shell.

## Non-negotiables (a reviewer will check these)

- Board rows and tab labels use **only** local non-sensitive request metadata (title, kind, status, counts, dates). They never call `intakeFactList`/`intakeFactMatchList` or read a document name — a board row has no business knowing what's inside a request, only its shape and state.
- Existing onboarding rows render **unchanged** — same fields, same sort position within the Onboarding filter, same link controls. The Onboarding filter is a real filter (`kind === 'onboarding'`) over the same generalized row set, not a separate code path that could drift from the full board.
- A standing request never aggregates its link, received items, nudge state, or lifecycle controls with another request just because `matterId` matches. Two requests for the same client are fully independent surfaces that happen to share a sidebar.
- Every existing internal navigation call that sets `setClientMapHubTab('onboarding')` (there's at least one, in the current `OnboardingBoard.tsx` row-click handler — you're rewriting that file, so update the call site directly rather than leaving a redirect shim) must still land the advisor on a populated, correct view — never an empty tab or a broken deep link.
- Completing or modifying a standing request must never mutate the onboarding checklist, its folder, or its link state for the same client, and vice versa.

## Files you own

**Edit:**
- `src/features/matters/MattersHome.tsx`
- `src/features/matters/MatterHub.tsx`
- `src/platform/matter/matterStore.ts`
- `src/features/intake/OnboardingBoard.tsx`
- `src/features/intake/OnboardingBoardContainer.tsx`
- `src/features/intake/OnboardingTab.tsx`

**Create:**
- New Requests UI files under `src/features/intake/` — board, board row, client-tab, whatever component split makes sense given what `OnboardingBoard`/`OnboardingTab` already do (you're generalizing them, not necessarily renaming every file — your call, but keep it navigable: don't scatter one feature across ten oddly-named files).
- `src/features/intake/__tests__/RequestsBoard.test.tsx`
- `src/features/intake/__tests__/ClientRequestsTab.test.tsx`

**Update (tests only, for the preserved filtered view):**
- `src/features/intake/__tests__/OnboardingBoard.test.tsx`
- `src/features/intake/__tests__/OnboardingBoardContainer.test.tsx`
- `src/features/intake/OnboardingTab.test.tsx`

Nothing else. You do not touch `src/platform/intake/factsStore.ts`, `createIntake.ts`, `useIntakeInboxSync.ts`, blueprint files, or the composer dialog's internals — those are Lane 1/2's, already merged, and you consume their exports as-is.

## What you're consuming from Lanes 1 and 2

You don't need to re-derive any of this — check the actual merged code for exact names (Lane 1/2's final reports list every export, but code is the source of truth if anything drifted):

- Lane 1's generic row selector (`onboardingModel.ts`, generalized `deriveRequestRow` or equivalent) + its shared signal helpers (`deriveLinkSignals`, `deriveNudgeEligibility`, `sortOnboardingRows` or their generalized equivalents). **Do not duplicate row derivation or nudge/link-signal logic** — if you find yourself reimplementing something that looks like what's already in `onboardingModel.ts`, stop and import it instead.
- Lane 1's `getIntakesForMatter(matterId)` multi-request selector.
- Lane 2's `RequestFromClientDialog` component and its prop contract.
- Lane 1's `IntakeRecord.kind`/`requestTitle`/`requestSlug` fields for board/tab display.

## Deliverables

1. **Generalize the board.** `MattersHome.tsx` currently mounts `OnboardingBoardContainer` once (`MattersHome.tsx:1092`). Replace it with a Requests board container built the same way (poll email-reply/quarantine signals, own the nudge-review-modal state — reuse `OnboardingBoardContainer`'s existing composition pattern, just feed it the generic row set instead of an onboarding-only one). Default saved filter: **Onboarding**, since that's still the primary flow. The full/unfiltered view shows both kinds, sorted by needs-review → stalled → link issue → quiet progress (reuse whatever sort priority `sortOnboardingRows` already encodes — don't invent a new ordering scheme).

2. **Onboarding as a true filter.** The Onboarding view is `kind === 'onboarding'` over the same row set the full board uses — not a separately maintained list. It must render onboarding rows identically to today (same fields, same link controls) and must not mutate onboarding records' local state or folder destination just by being a filtered view.

3. **Requests tab in `MatterHub.tsx`.** Replace the one-intake assumption (currently: `intake` is a single `IntakeRecord | null` prop path feeding `OnboardingTab`, gated by `HUB_TABS` filtering out the `'onboarding'` tab entirely when there's no intake — `MatterHub.tsx:196`) with a per-client Requests tab that lists **all** of that client's request rows via `getIntakesForMatter`, pins an active onboarding request first if one exists, and surfaces Lane 2's `RequestFromClientDialog` behind a "Request from client" action. Each request in the list gets its own lifecycle controls, received-items list, facts/provenance summary, email-reply signals, nudge state, and copy-link action — reuse the existing per-request UI pieces `OnboardingTab.tsx` already has (link lifecycle panel, email-reply proposal card, quarantine panel), just parameterized by request instead of hardcoded to "the" intake.

4. **Legacy tab routing.** `ClientMapHubTab` (`matterStore.ts:86`) is currently a fixed union including `'onboarding'`. Decide whether to widen it with a new tab id (e.g. `'requests'`) or repurpose `'onboarding'` as the tab id while its rendered content becomes the generalized Requests view — either is fine as long as: (a) `HUB_TABS` in `MatterHub.tsx` (`:103`) and its tab-label switch reflect the rename/addition, (b) `OnboardingBoard.tsx`'s row-click call site (the one at what's currently `OnboardingBoard.tsx:77`, which you're rewriting anyway as part of deliverable 1) navigates to whichever tab id you chose, and (c) any other `setClientMapHubTab('onboarding')` call site you find via a repo-wide grep still resolves to a populated view. The one-shot consumption effect in `MatterHub.tsx` (currently `:229-241`) needs no structural change, just needs to handle whatever tab id(s) you settled on.

5. **Tab visibility.** Today the tab is hidden entirely (`MatterHub.tsx:196`, `visibleHubTabs = intake ? HUB_TABS : HUB_TABS.filter(...)`) when there's no intake at all. Decide the right behavior for the generalized case: showing the Requests tab even for a client with zero requests (so "Request from client" is discoverable) is very likely the right call — a client-facing feature that's invisible until you already have data is a common UX bug. Recommend: always show the tab; render an empty state with the "Request from client" action when there are zero requests for that client.

## Acceptance tests

- `RequestsBoard.test.tsx`: full board renders both onboarding and standing rows with correct sort order (needs-review → stalled → link-issue → quiet); Onboarding filter shows only onboarding rows, byte-identical to what the current `OnboardingBoard.test.tsx` already asserts; row click navigates to the correct client AND the correct request (not just the client — with two active requests for one client, clicking a standing row must not open the onboarding one).
- `ClientRequestsTab.test.tsx`: a client with one active onboarding request and two standing requests shows all three, onboarding pinned first; each request's lifecycle controls/received-items/nudge state render independently (mutate one in the test, assert the others are untouched); the "Request from client" action mounts Lane 2's dialog.
- `OnboardingBoard.test.tsx` / `OnboardingBoardContainer.test.tsx` (updated): existing onboarding-only visual/behavioral assertions still pass against the new generalized components filtered to onboarding.
- `OnboardingTab.test.tsx` (updated): legacy tab-id navigation still lands on a populated Requests view with the onboarding request visible/pinned; per-request isolation (completing/editing one request's state doesn't touch a sibling request for the same client).
- A test asserting board row rendering never calls `intakeFactList`/`intakeFactMatchList` (spy/mock and assert zero calls from the board/row components) — enforces the "board never reads facts" non-negotiable structurally, not just by inspection.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything above passes. If Lane 1 or Lane 2 shipped an export under a different name or shape than this brief assumes, adapt to what actually exists in the merged code rather than blocking — note every deviation in your final report so the wave lead can reconcile it against the exec plan.

## Checks to run (report exact pass/fail; every test invocation wrapped in a timeout)

```
timeout 300 npx vitest run src/features/intake/__tests__/RequestsBoard.test.tsx src/features/intake/__tests__/ClientRequestsTab.test.tsx src/features/intake/__tests__/OnboardingBoard.test.tsx src/features/intake/__tests__/OnboardingBoardContainer.test.tsx src/features/intake/OnboardingTab.test.tsx
timeout 300 npx vitest run src/features/intake src/features/matters
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

## Finish

Commit on `lp/intake-w7-requests-ui` with a conventional message containing the phrase `W7-LANE3-REQUESTS-UI`. Do NOT push. Do NOT merge. Report exact check results, the final tab-id decision from deliverable 4 (so Lane 4's UI integration test and the wave lead's exec plan match reality), and state the branch is clean.
