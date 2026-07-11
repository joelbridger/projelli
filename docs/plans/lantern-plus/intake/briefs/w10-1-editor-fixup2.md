# Wave 10 Lane 1 fixup round 2 — real client-rendering bugs from adversarial review

You previously implemented Lane 1 (item drafts + form builder editor) on branch `lp/intake-w10-editor`, then fixed a round of typecheck failures (`da5f2f5c fix(intake): W10-LANE1-EDITOR-FIXUP strict checks`). An independent adversarial review (`codex-review --base lp/intake`) then read the diff against the real client-facing intake page and found two P1 and one P2 correctness bug: forms this editor can build will silently fail or mislead real clients. Fix all three now as a third commit on the same branch.

Worktree: `/home/jameson/lp-w10-editor`, branch `lp/intake-w10-editor`. Never switch branches. Never touch `src/platform/intake/types.ts`, `blueprintTypes.ts`, `blueprintValidation.ts`, `blueprintFactory.ts`, `blueprintStore.ts`, `createIntake.ts`, `RequestFromClientDialog.tsx`, or anything under `intake-page/` (that last one is new for this round — read it, do not edit it; it's owned by a concurrent wave building PDF-fill on the same base branch).

## Finding 1 (P1) — `readonly_card` items you can add mid-form are invisible to the client

Read `intake-page/src/App.tsx` yourself before changing anything — specifically `isActionable()` (around line 64), `chooseInitialItem()` (around line 244), and `actionItems` (around line 388). You will see:

- `isActionable(item)` returns true only for `typed_field`, `doc_upload`, `guided_question`. `readonly_card` is excluded.
- The client's forward/back navigation only ever walks `actionItems = checklist.items.filter(isActionable)`. A `readonly_card` sitting between two real fields is never in that list, so it is never shown, never advances the progress state, and never blocks anything — it simply does not exist from the client's point of view.
- `chooseInitialItem()` special-cases exactly one `readonly_card`: the one whose `item_id.toLowerCase().includes('welcome')`, shown once before the client starts anything. Every other `readonly_card`, including one with a different id, is dead content.
- `NEW_HOUSEHOLD_BLUEPRINT`'s `'next'` card (What happens next) looks like it works the same way but does not — `CompletionScreen` in `App.tsx` builds its content entirely from `firm.journey` (a separate structure, not `checklist.items`). That card is legacy/vestigial in the current renderer, not a working pattern to copy.

**Fix:** remove the general "Add section header / text block" mid-form affordance from `FormBuilderEditor.tsx` entirely — do not let an advisor insert a `readonly_card` anywhere except one fixed slot. Replace it with a single, optional "Welcome message" field at the top of the new-form authoring flow (next to the form-name input), which, if filled in, becomes exactly one `readonly_card` item placed first in the saved item list, with an `item_id` that contains the literal substring `'welcome'` (so the real client renderer's `chooseInitialItem()` check actually matches it — use a stable id like `'welcome'` itself, or `newItemId()` prefixed so it still contains `'welcome'`, e.g. `` `welcome_${newItemId()}` `` — either is fine as long as `.toLowerCase().includes('welcome')` is true). If the field is left empty, no `readonly_card` is added at all — don't save an empty welcome card.

Update `src/platform/intake/formBuilder/formItemDrafts.ts`:
- Remove `draftSectionHeader` (or repurpose it as the one welcome-card factory — your call, but there must be exactly one function whose job is "build the one allowed welcome `readonly_card`" and it must set an `item_id` containing `'welcome'`, not the current `newItemId()`-only id). Keep `draftReadonlyCard` if you still want a generic factory underneath, but nothing in the editor should call it to insert a card anywhere except that one welcome slot.
- Update `src/platform/intake/formBuilder/__tests__/formItemDrafts.test.ts` to match whatever the final factory shape is — assert the welcome-card factory produces an `item_id` containing `'welcome'` (case-insensitive) and nothing else changes about the other four factories.

Update `FormBuilderEditor.tsx`:
- Remove the "Add section header / text block" button from the mid-form "Add item" group.
- Add the "Welcome message" input near the form-name field, wired so it produces (or omits) the one welcome `readonly_card` at save time, always first in the saved `items` array.
- If editing an existing firm-saved blueprint that happens to already contain a `readonly_card` (from before this fix, or authored some other way), don't crash or silently drop it — load its `body` into the welcome-message field if its `item_id` contains `'welcome'` and it's the first item; if a blueprint has some other, non-welcome `readonly_card` shape you don't recognize, leave it in the saved item list unchanged when the advisor saves (don't destroy data you don't understand), but don't offer any UI to create more of them.

Update `src/features/intake/formBuilder/__tests__/FormBuilderEditor.test.tsx` and `src/features/intake/formBuilder/__tests__/formBuilderContract.test.tsx`:
- Replace any assertion/step that adds a "section header" mid-form with the new welcome-message flow.
- Add an assertion that a saved blueprint's `readonly_card` items (if any) each have an `item_id` containing `'welcome'` — i.e., the builder is now structurally incapable of producing an invisible mid-form text block, not merely avoiding it in the UI (same rigor as the existing pdf_fill/signature exclusion assertions).

## Finding 2 (P1) — a saved form can have `max_files: 0` or `max_bytes: 0`, which makes every upload impossible

In `FormBuilderEditor.tsx`'s `doc_upload` fields, `Number(event.target.value)` on an emptied or zeroed input persists `0` (or a negative number if someone types `-5`), and the `min="1"` attribute on the `<Input type="number">` is a browser hint only — it does not stop the value from being read and saved. A saved `max_files: 0` means the receiver rejects every upload for that item; `max_bytes: 0` means every real file is "too large." An advisor can save a form no client can ever complete for that item.

**Fix:** validate before writing to state, not just at render time. When either field's `onChange` fires, parse the value and only update state if it's a positive integer (`Number.isInteger(parsed) && parsed >= 1`); otherwise leave the previous valid value in place (don't let the input field silently accept and store an invalid number). Check whether another numeric `<Input type="number" min="1">` elsewhere in this codebase already has a small guard helper for this exact pattern (grep `min="1"` or similar across `src/features/intake/` and `src/features/`) and reuse it if one exists rather than inventing a second version; otherwise write a small local `parsePositiveInt(value: string, fallback: number): number` helper in `FormBuilderEditor.tsx` and use it for both `max_files` and the MB-to-bytes conversion.

Add a test: typing an empty string, `0`, or a negative number into either field does not change the saved item away from a valid positive `max_files`/`max_bytes`.

## Finding 3 (P2) — driver's license as a typed field renders as a plain text box

`intake-page/src/App.tsx`'s typed-field renderer (`ItemInputScreen`, read the `isSsn`/`isNumeric`/`inputType` logic around line 816-825) only special-cases `input: 'date' | 'ssn' | 'money' | 'number'`. Every other `TypedFieldInputFormat`, including `'file_ref'`, falls through to an ordinary text `<input>`. Your current `INPUTS_BY_FACT_KIND['drivers_license'] = ['file_ref']` (or whatever you renamed it to in the first fixup) lets an advisor build a form asking the client to type their driver's license as text — nonsensical, and inconsistent with `NEW_HOUSEHOLD_BLUEPRINT`, which only ever collects `drivers_license` via `doc_upload`.

**Fix:** remove `'drivers_license'` from the list of `FactKind` values offered in the `typed_field` editor's "Information to collect" select. It stays a legitimate `FactKind` in the type system generally (used elsewhere, e.g. by `doc_upload`-based collection) — this only removes it from the choices this specific `typed_field` UI offers. Also remove `'file_ref'` from every fact kind's offered input-format list (not just driver's license's) since no fact kind should route through an input format the client page cannot actually render as anything other than plain text — check your `firstInputFor`/`INPUTS_BY_FACT_KIND`-equivalent function from the first fixup and drop `'file_ref'` from it entirely, adjusting the exhaustive switch/record so it still compiles cleanly for the remaining eight `FactKind` values without `drivers_license`.

Update `formItemDrafts.test.ts`/`FormBuilderEditor.test.tsx` if either currently asserts anything about `drivers_license` or `file_ref` being offered — replace with an assertion that neither ever appears as a choice.

## Explicit non-goals for this fixup

- Do not attempt to fix `intake-page/src/App.tsx` so `readonly_card` renders inline — that is a real, larger change to a file owned by a concurrent wave this round, not a Lane 1 fixup.
- Do not add a generic i18n rewrite pass — the existing file-level `eslint-disable lantern-i18n/no-hardcoded-string` from the first fixup stays as-is for this round; it's a tracked follow-up, not something to fix here.
- Do not touch `RequestFromClientDialog.tsx` even though it's the eventual send surface — this fixup is scoped entirely to what `FormBuilderEditor.tsx` and `formItemDrafts.ts` can produce.

## Bar

Run these for real, fix until clean, then rerun once more to confirm:

```
timeout 180 npx tsc --noEmit
timeout 300 npx vitest run src/platform/intake/formBuilder src/features/intake/formBuilder
timeout 280 node scripts/eslint-gate.mjs
```

If `eslint-gate.mjs` times out from other concurrent work on this machine, retry once with a longer timeout before reporting a failure.

## Finish

Commit on `lp/intake-w10-editor` with a conventional message containing the phrase `W10-LANE1-EDITOR-FIXUP2`. Do NOT push, do NOT merge. In your final report: state exact pass/fail and counts for all three bar commands; confirm `git status` is clean; restate the `FormBuilderEditorProps` contract (it should be unchanged in shape, even though its rendered content changed); and explicitly confirm, with a one-line grep-style check you actually ran, that no code path in `formItemDrafts.ts` or `FormBuilderEditor.tsx` can produce a `readonly_card` whose `item_id` does not contain `'welcome'`, and that `'drivers_license'` and `'file_ref'` no longer appear as selectable options anywhere in the typed-field editor.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if all three checks pass and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print this line early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
