TASK: Lantern Intake Wave 5 Lane W5a — phone-walkthrough mode.

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-phone-mode` off `lp/intake-w56`. Pure TS/React (no Rust, no backend). Follow TDD.

## Read first
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §8 "Phone mode (P6)" (your exact spec), §5 (per-client Onboarding tab — item 5 "Start phone walkthrough"), §6 (the client item flow you mirror in-app), §2 catalog (item types + states).
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §9 (ClientFact schema + provenance channel `phone_walkthrough` already in the registry), §5 (where decrypted data lands — facts store masking).
- `docs/plans/lantern-plus/intake/W56-EXEC-PLAN.md` (non-negotiables).
- Existing code you extend/reuse:
  - `src/features/intake/OnboardingTab.tsx` — TODAY has W1 "minimal manual fact entry" (manualKind/manualSubject/manualRawValue form, `channel:'manual'`). Phone mode SUPERSEDES this minimal entry with a fuller guided walkthrough. Keep the manual path working or fold it into phone mode cleanly; do not regress fact-writing.
  - `src/platform/intake/factsStore.ts` (writeFact accessor — masking/audit by sensitivity), `src/platform/intake/intakeStore.ts` (checklist item states), `src/platform/intake/onboardingModel.ts`, `src/platform/intake/types.ts` (`FactKind`, `FactValue`, `FACT_KIND_SENSITIVITY`).
  - `src/features/intake/newHouseholdTemplate.ts` (the item set — DOB, SSN, license front/back, income, spending, welcome/what-happens-next cards).
  - The client-page item rendering for reference: `intake-page/src/App.tsx` (one item per screen, typed/upload/guided types) — mirror the ONE-ITEM-AT-A-TIME shape in-app, but this runs inside Lantern (no relay/E2EE round trip; the advisor is entering values directly with the client on a call).

## Goal (plain)
From a client's Onboarding tab, the advisor presses "Start phone walkthrough" and gets the same checklist rendered inside Lantern, one item at a time, and fills it in while on the phone with the client. Two differences from the client page: every value is chipped `entered by [advisor] on a call, [date]` (provenance `phone_walkthrough`), and the advisor can skip freely without the client-side gentleness. Items land IDENTICALLY to the link path — same ClientFact writes, same folder for uploads, same checklist state. Phone mode and the link interleave freely (grandma does license photos via the link Saturday; advisor fills income on Monday's call) — one source of truth; the checklist does not care which door an item came through.

## Deliverables
1. `src/features/intake/PhoneWalkthrough.tsx` (new) — the in-app one-item-at-a-time walkthrough panel/modal. Renders each open (or any) checklist item with the right input for its type (typed field w/ SSN masking + format help, doc upload from a local file, guided question number/range/"I don't know"), a visible progress indicator, and free Skip/Back/Next. On submit-per-item: write a ClientFact with `provenance.channel:'phone_walkthrough'`, `provenance.entered_by:<advisor user id>`, `provenance.at`, correct `sensitivity` (restricted→SQLCipher+masked+audited via factsStore, never plaintext in ordinary state), tick the checklist item state, and for uploads file the document to the client folder via the existing WorkspaceService/intakeFiling path under `Requests/onboarding/`.
2. `src/platform/intake/phoneWalkthrough.ts` (new, pure) — the model: given a checklist + current facts, produce the ordered walkthrough item list, per-item completion, and the fact-write payload builder (keeps the component thin + testable). Reuse types from `types.ts`; do NOT duplicate FactValue construction logic already in OnboardingTab — extract/share it.
3. `OnboardingTab.tsx` — wire a "Start phone walkthrough" entry that opens the panel for this intake; supersede the minimal manual-entry form (either replace it with the walkthrough or clearly demote it). Provenance chips must show "entered by you on a call" for phone-walkthrough facts (extend the existing provenance-chip rendering).
4. Light theme, design tokens, no em dashes. Reuse `@/ui/*` primitives (Button, etc.).

## TDD — write first (vitest)
`src/platform/intake/phoneWalkthrough.test.ts`:
1. Walkthrough item ordering + completion derives correctly from a checklist with mixed item types and some already-provided-via-link items (interleave: an item already Provided via the link is shown as done; advisor can still Replace it).
2. Fact-write payload builder produces `channel:'phone_walkthrough'`, correct `entered_by`, correct `sensitivity` per kind, correct FactValue typing for date/ssn/money/range.
3. Restricted (SSN) fact routes to the restricted path (assert it is written with restricted sensitivity so factsStore keeps it in SQLCipher/masked — never returned in plain state).
`src/features/intake/__tests__/PhoneWalkthrough.test.tsx`:
4. Rendering one item at a time; Next/Back/Skip; submitting a typed field calls the fact-write with phone_walkthrough provenance (mock factsStore).
5. An SSN item masks input and writes via the restricted path; the tab shows an "entered by you on a call" provenance chip afterward.
6. Interleave: complete income in phone mode → the same intake's checklist state updates so the board/tab reflect it (no separate source of truth).

## Non-negotiables
- One source of truth: phone-mode facts + files use the SAME stores/paths as the link path (factsStore, intakeStore, intakeFiling/WorkspaceService). No parallel store.
- Restricted values never enter ordinary Zustand/localStorage state or audit rows in plaintext — go through factsStore's masking accessor; reveal writes an audit row (reuse existing).
- AI never involved here (pure data entry). Provenance is the compliance story — every phone-mode fact MUST carry `phone_walkthrough` + advisor id + timestamp.
- `matter`/`matter_id` never renamed.

## Out of scope
- Welcome journey / what-happens-next page (W5b), KPI strip (W6a), key sharing (W5c), anything in `intake-page/` (that is the client page; phone mode runs INSIDE Lantern), backend, Rust.

## Verify
`npx vitest run src/platform/intake/phoneWalkthrough.test.ts src/features/intake/__tests__/PhoneWalkthrough.test.tsx`, `npx tsc --noEmit`, `npm run lint:gate`. Report exact counts. When done + committed, print `W56-PHONEMODE-ONE-SOURCE-DONE` then `DONE-EXIT:0`.
