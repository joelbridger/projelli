# Wave 10 Reconcile — Make `pdf_fill` Items Read-Only in the Form Builder

**Branch:** `lp/intake-w10-pdf-reconcile`, branched off `origin/lp/intake` at `3639c363` (Wave 10 Lanes 1+2 merged: form builder editor + item drafts, form library + Requests entry point).
**You are Codex, the builder.** Fix this, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Context

Wave 8 (a separate, parallel effort, merging as `lp/intake-w8`) adds a real `pdf_fill` request item type — an advisor-approved PDF form a client fills and returns. Wave 10's form builder (this branch) was built without knowledge of that work. `src/features/intake/formBuilder/FormBuilderEditor.tsx`'s `friendlyType()` function (around line 73-77) falls through to the literal label `'Text block'` for any item type it doesn't explicitly recognize:

```ts
function friendlyType(item: RequestItem): string {
  return item.t === 'typed_field' ? 'Typed field'
    : item.t === 'doc_upload' ? 'Document upload'
      : item.t === 'guided_question' ? 'Guided question' : 'Text block';
}
```

And `ItemEditor` (around line 87-192) only special-cases `readonly_card` with an early return showing a "kept when you save, can't be edited here" message (lines 95-102); every other unrecognized type — including `pdf_fill` and `signature` — falls through to the general editing form, which shows the misleading `friendlyType()` label and lets the advisor edit `label`/`help_text`/`required`/`subject` on it (harmless in itself — those are common base fields on every item type — but the mislabeling as generic "Text block" actively hides from the advisor that they're looking at a live PDF-fill request, not inert text).

This builder has **no way to newly create** a `pdf_fill` item (its "Add item" buttons only offer typed field / document upload / guided question — confirmed by reading `formItemDrafts.ts` and the button row in `FormBuilderEditor.tsx`). The only way a `pdf_fill` item reaches this editor is if an advisor opens an **existing** blueprint that already has one (created via Wave 8's own composer, once that lands). So the fix is scoped entirely to *display and edit-safety* for an already-existing item, not to adding new support for building one here — that's out of scope for this reconcile.

## The fix

1. In `friendlyType()`, add a `pdf_fill` case returning an accurate label (e.g. `'PDF form'` — your exact copy call, keep it short and accurate, no em dash).
2. In `ItemEditor`, add a branch for `item.t === 'pdf_fill'` that mirrors the existing `readonly_card` early-return pattern (lines 95-102): render a similar read-only notice card instead of the general editing form, using accurate copy that says this is an approved PDF form and can't be edited in this builder (do not imply it's broken or an error — it's just not this tool's job). Preserve the item exactly as-is when the blueprint is saved (the existing `readonly_card` pattern already demonstrates the "kept when you save" behavior — confirm the same holds for `pdf_fill`: since `items` state only ever gets touched via `updateItem`/`add`/`removeItem`/`moveItem`, and a `pdf_fill` item never goes through `updateItem` if it has no editable form, it should already survive a save unchanged — verify this with a test, don't just assume it).
3. Also add `signature` to both the same way if you find it isn't already excluded some other way (Wave 9's signature work doesn't exist yet on this branch; treat any `signature`-typed item the same as `pdf_fill` here — read-only, accurate label, preserved on save — for the same reason: this builder has no business editing it).
4. Check `src/features/intake/RequestsBoard.tsx` for any item-type label/summary logic that might also mislabel a `pdf_fill` item (a quick grep found no `pdf_fill` or `friendlyType`-equivalent reference there today, but confirm directly — don't rely solely on this brief's own grep). If you find nothing needs changing there, say so in your report rather than making a speculative edit.

## Non-negotiables

- Do not attempt to add real `pdf_fill` creation/editing support to this builder — that's explicitly out of scope; Wave 8's own composer owns that UI.
- Do not touch `RequestItem`/`types.ts`, blueprint validation, or anything outside the form-builder display/edit-safety concern described above.
- No em dash in any copy you write.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 120 npx vitest run src/features/intake/formBuilder src/features/intake/__tests__/RequestFromClientDialog.test.tsx
timeout 300 npx vitest run src/features/intake --test-timeout=20000
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo.

## Self-converge requirement

Add a real test proving a blueprint containing a `pdf_fill` item, opened in this builder and saved without touching it, comes out byte-identical to how it went in (not just "doesn't crash") — and that its displayed label is accurate, not "Text block". Do not stop until this passes.

## Finish

Commit on `lp/intake-w10-pdf-reconcile` with a conventional message containing the phrase `W10-PDF-RECONCILE`. Do NOT push. Do NOT merge. Report exact check results and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
