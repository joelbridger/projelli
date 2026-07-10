# Wave 7 Lane 2 — Blueprints and Existing-Client Composer

**Branch:** `lp/intake-w7-composer`, branched from the merged Lane 1 tip (`lp/intake-w7-core` after it merges). Confirm the exact base commit with the dispatcher before starting.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

An advisor picks a saved item set ("blueprint" — e.g. "New household" or a firm-created "Annual review update"), makes small per-client edits, and sends it to an existing client as a standing request. Before the advisor ever sees the review screen, the composer checks whether the client already has an active, matching fact on file (say, their income) and if so, quietly removes that question from what gets sent — the client is never asked twice, and the advisor never sees the actual answer, just "already on file." You're building the blueprint data model, the ask-once check, and the dialog UI that ties them together with Lane 1's request issuer. You are not building where this dialog gets mounted in the app (that's Lane 3) — you're building a standalone, reusable dialog component that Lane 3 will drop in.

## Non-negotiables (a reviewer will check these)

- The ask-once check must call **only** a value-free accessor (you're building it — `intakeFactMatchList`) that returns `{subject, kind, status}` and nothing else. It must never call `intakeFactList` (that function returns full plaintext `display_value` for every non-restricted fact kind — income, DOB, employer, address, beneficiary, citizenship — confirmed in the current code; only SSN and driver's license get masked). If the composer ever imports `intakeFactList`, that's a P1 finding, not a style nit.
- No fact value, masked or not, ever enters React state, component props, a persisted draft, or the clipboard from this lane's code. The advisor sees a status string like "Already on file" — never a value, never a fact ID, never provenance, never sensitivity.
- Blueprint data contains only request structure and wording (item list, labels, prompts). It never contains a client fact, a submitted file, a prefilled value, a relay key, a link, or any lifecycle state.
- Ask-once suppression fires only when an item has an explicit fact mapping (its own `subject` field plus, for `typed_field`, `fact_kind`, or for `guided_question`, the new additive `fact_kind` field Lane 1 added to `GuidedQuestionRequestItem`) and the client's active fact matches both fields exactly. Never guess from a filename, a label, or a document upload's expected type. A superseded fact (not currently active) does not suppress.
- Blueprint validation rejects guided items with `response_format` of `number`, `text`, or `choice`. The client page only implements `money` and `range` rendering today (confirmed: `GuidedQuestionScreen` in `intake-page/src/App.tsx` ignores `response_format` and hardcodes `amount | range | unknown` — a `text`/`choice` item would silently render as a numeric input, which is worse than rejecting it at save time). Only `money`/`range` are legal in a blueprint you can save or send.
- `pdf_fill`/`signature` items may exist in a blueprint (so a blueprint doesn't have to be rebuilt when Wave 8+ ships), but the dialog blocks *sending* one with plain advisor-facing copy — and you know this isn't the real security boundary, Lane 1's `assertSendableRequest` is. Don't skip building this UI-level check just because Lane 1 also enforces it; an advisor should get a clear in-context message, not a thrown error from the issuer.

## Files you own

**Edit:**
- `src/features/intake/newHouseholdTemplate.ts` — refactor so "New household" is the first built-in blueprint; `buildNewHouseholdRequest` stays as a compatibility entry point for the existing New Client flow with its exact current item ids (`welcome`, `dob`, `ssn`, `drivers_license`, `income`, `spending`, `next` — underscore in `drivers_license`, confirm you match the real code, not any hyphenated example you might see in older planning docs) and `kind: 'onboarding'` unchanged.
- `src/platform/intake/factsStore.ts` — add `intakeFactMatchList` (see below). Do not touch `intakeFactList`'s existing behavior.

**Create (new files, your naming choice, keep it consistent with existing conventions):**
- Blueprint contracts, built-in registry, firm-saved blueprint store, validation, instantiation helpers under `src/platform/intake/` — e.g. `blueprintTypes.ts`, `blueprintStore.ts`, `blueprintValidation.ts`.
- `src/platform/intake/requestAskOnce.ts` — the pure ask-once resolution function.
- `src/features/intake/RequestFromClientDialog.tsx` (and any sub-components you need — picker, item editor, review screen) under `src/features/intake/`.
- Tests: `src/platform/intake/blueprintStore.test.ts`, `src/platform/intake/requestAskOnce.test.ts`, `src/features/intake/__tests__/RequestFromClientDialog.test.tsx`.

Nothing else. In particular, do not edit `MatterHub.tsx`, `MattersHome.tsx`, or any Onboarding board/tab file — that's Lane 3's territory, and this dialog must work as a standalone component that receives client identity and open-state through props, not by reaching into app-level mount code.

## The blueprint contract (verbatim from `W7-PREP.md` §2)

```ts
interface RequestBlueprint {
  blueprintId: string;
  schemaVersion: number;
  label: string;
  source: 'built_in' | 'firm_saved';
  defaultKind: FormRequestKind;
  items: RequestItem[];
  archived?: boolean;
}
```

Built-ins are immutable (no edit/delete UI, no persisted mutation path). Firm-saved blueprints are editable and archivable (soft-delete via `archived: true`, never hard-delete — a sent request already carries a sealed snapshot of its items independent of the blueprint, so archiving a blueprint never affects a request that already used it). Store firm-saved blueprints workspace-local, encrypted with the existing app data (same persistence tier as everything else in `src/platform/intake/` that isn't relay-visible — do not invent a new storage mechanism).

## `intakeFactMatchList` (new function, `factsStore.ts`)

```ts
interface FactMatchEntry {
  subject: string;
  kind: FactKind;
  status: 'active' | 'superseded'; // or whatever your ClientFact status enum already calls these — match the existing type
}

function intakeFactMatchList(matterId: string): Promise<FactMatchEntry[]>;
```

Implement this as a genuinely separate accessor, not a thin re-export of `intakeFactList`. It's fine for it to internally call the same underlying data source `intakeFactList` uses (the Tauri `intake_fact_list` command / the browser-fallback `browserFacts` array) — the requirement is about the **shape that leaves this function**, not the data source. Strip `display_value`, `fact_id`, `provenance`, `sensitivity`, and everything else before returning. Filter to `status === 'active'` only unless the composer specifically needs to distinguish superseded (it does, for the "superseded facts don't suppress" rule — decide whether that's better handled by only returning `active` here and treating "not present" as "not suppressed," which is simpler and satisfies the rule without the composer needing to reason about status at all; that's the recommended approach).

## Ask-once resolution (`requestAskOnce.ts`)

```ts
function resolveAskOnce(
  items: RequestItem[],           // draft blueprint-derived items — real RequestItem objects, fact_kind/subject live directly on each one
  matches: FactMatchEntry[],      // from intakeFactMatchList(matterId)
): { visibleItems: RequestItem[]; suppressed: Array<{ itemId: string; reason: 'already_on_file' }> };
```

Pure function — no I/O, no store access, easy to test exhaustively. There's no separate "factMapping" object to look up — `RequestItemBase.subject` and, for `typed_field`, `item.fact_kind`, or for `guided_question`, the new additive `item.fact_kind` (Lane 1 added this field to `GuidedQuestionRequestItem`) are already on the item itself. For each item that has a resolvable fact kind (typed_field always does; guided_question does once it has `fact_kind` set; doc_upload/readonly_card/pdf_fill/signature never do), check whether `matches` contains an entry with the same `subject` and `kind`. If yes, move it to `suppressed` (it will not be sealed into the client's checklist) and surface the "Already on file" status to the advisor in the review UI. Items with no resolvable fact kind always pass through untouched — never infer one from a label or expected doc type.

## The dialog (`RequestFromClientDialog.tsx`)

Props-driven, no app-level store reaching: receives the client identity (`matterId`, display name — whatever `MatterHub`/`MattersHome` already has on hand for a client, ask Lane 1's exports or the existing `matterStore` types if you need the shape, but don't import from Lane 3's files) and `open`/`onOpenChange`. Flow: blueprint picker → item editor (per-item small edits — label/prompt tweaks, not structural changes to item type) → ask-once resolution (call `resolveAskOnce` with `intakeFactMatchList(matterId)`, show suppressed items as "Already on file, won't be asked") → review → send (calls Lane 1's generalized issuer with `kind: 'standing'`, the blueprint reference, and the final edited+filtered item list).

If the blueprint contains a `pdf_fill` or `signature` item, show a clear advisor-facing message before send ("This item type isn't supported yet — remove it to send this request" or similar, no invented vendor-flow language) and disable send until it's removed from the draft. Do not attempt to redirect to a vendor site, do not create a partial request, do not silently drop the item and send anyway.

## Acceptance tests

- `blueprintStore.test.ts`: built-in blueprints can't be mutated or deleted through any exposed function; a firm-saved blueprint can be created, edited, archived; archiving doesn't delete it or affect anything already sent; persisted blueprint JSON contains no fact values, no client identifiers, no relay keys — it's pure structure+wording.
- `requestAskOnce.test.ts`: a typed-field item with a matching active fact is suppressed; a guided-question item with a matching active fact (via its new `fact_kind` field) is suppressed; items with different `subject` (e.g. joint vs. individual) are not cross-suppressed; a superseded fact does not suppress; items with no resolvable fact kind (doc uploads, readonly cards) always pass through; the function never touches a value — assert by construction (the input/output types literally can't carry one) plus a test that a mock `FactMatchEntry` with an extra `value` field (if you're being extra careful) doesn't leak through to the output.
- `RequestFromClientDialog.test.tsx`: full flow — choose a blueprint, edit an item, see review with one item marked "Already on file" (mock `intakeFactMatchList`), send calls the issuer with the right `kind`/`blueprintRef`/filtered item list; a blueprint containing `pdf_fill` blocks send with the advisor-facing message and no issuer call.
- Extend `src/features/intake/OnboardingTab.test.tsx` **only if** your `newHouseholdTemplate.ts` refactor changed `buildNewHouseholdRequest`'s external contract (item ids, `kind`, item count/order). If the refactor is purely internal (e.g. wrapping it as `blueprintToRequest(NEW_HOUSEHOLD_BLUEPRINT, ...)` under the hood with identical output), leave that test file alone — it's Lane 3's to touch for anything else.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything above passes. If Lane 1 shipped an export under a different name than this brief assumes, adapt to what actually exists (check Lane 1's final report / the merged code) rather than blocking — note the deviation in your final report.

## Checks to run (report exact pass/fail; every test invocation wrapped in a timeout)

```
timeout 300 npx vitest run src/platform/intake/blueprintStore.test.ts src/platform/intake/requestAskOnce.test.ts src/features/intake/__tests__/RequestFromClientDialog.test.tsx
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

## Finish

Commit on `lp/intake-w7-composer` with a conventional message containing the phrase `W7-LANE2-COMPOSER`. Do NOT push. Do NOT merge. Report exact check results, the exact exported dialog component name/path and its prop signature (Lane 3 mounts it verbatim), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
