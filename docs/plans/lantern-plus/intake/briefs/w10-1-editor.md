# Wave 10 Lane 1 — Item Drafts + Form Builder Editor

**Branch:** `lp/intake-w10-editor`, branched off `origin/lp/intake` at `1e360b9b` (confirm with `git merge-base HEAD origin/lp/intake` before starting — do not assume a stale SHA from this document).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Lantern's advisor intake system (Wave 7, already merged) lets an advisor send a client a secure link built from a `RequestBlueprint` — a reusable, ordered list of `RequestItem`s (typed fields, document uploads, guided questions, plain text cards). Today the only way to get a blueprint is the one hardcoded built-in ("New household") or hand-editing store state in a test. Nothing lets an advisor build their own form. This lane builds the composer: a React UI where an advisor adds items in order, edits each one's label/help text/required flag/type-specific settings, arranges them into sections, and saves the result as a firm blueprint through the already-complete blueprint store. It does not touch the send path, the relay, or any shared contract file — those are fully built and this lane only produces new `RequestItem[]` arrays that flow through them unchanged.

## Non-negotiables

- Read `src/platform/intake/types.ts`, `src/platform/intake/blueprintTypes.ts`, `src/platform/intake/blueprintValidation.ts`, `src/platform/intake/blueprintStore.ts`, `src/platform/intake/defaultBlueprints.ts`, and `src/features/intake/RequestFromClientDialog.tsx` fully before writing any code. They are your contract; do not guess their shapes.
- **Do not edit any of those six files, or `blueprintFactory.ts`, or `createIntake.ts`.** They are owned by a concurrent, unrelated wave (PDF form-fill) working on the same base branch. If you find a genuine need to change one of them, stop, do not edit it, and write exactly why to `docs/plans/lantern-plus/intake/briefs/w10-1-blocker.md` instead — then continue with everything else in this brief that doesn't depend on it.
- Only create/edit files under `src/platform/intake/formBuilder/` and `src/features/intake/formBuilder/` (new directories — create them) plus this brief's own new test files. Touch no other production file.
- Never construct a `pdf_fill` or `signature` `RequestItem` anywhere in your code, including tests-as-fixtures. Those item types belong to a different wave and are structurally excluded from this feature.
- `guided_question` items you create or allow the UI to create must never use `response_format` other than `'money'` or `'range'` — `assertValidRequestBlueprint` (in `blueprintValidation.ts`, which you must not edit) already rejects anything else at save time. Match that constraint in the UI itself rather than relying on the save-time error.
- Copy shown to the advisor: plain language, no em dash character anywhere, light theme (use the existing `@/ui/*` components already used by `RequestFromClientDialog.tsx` — `Button`, `Input`, `Label`, `Dialog*`, etc. — do not add a new UI library).
- No Rust changes. This lane makes none.

## What Wave 7 already gives you (read, do not modify)

- `RequestItem` union and each variant's shape, in `src/platform/intake/types.ts`: `TypedFieldRequestItem` (`fact_kind: FactKind`, `input: TypedFieldInputFormat`), `DocUploadRequestItem` (`accepted_mime_types?`, `max_files?`, `max_bytes?`, `expected_doc_types?`, `expected_license_slots?`), `GuidedQuestionRequestItem` (`prompt`, `response_format`, `choices?`, `fact_kind?`), `ReadonlyCardRequestItem` (`body`, `acknowledgement_required?`). All four share `RequestItemBase`: `item_id`, `label`, `help_text`, `required`, `subject`.
- `FactKind` closed enum (nine values) and `FACT_KIND_SENSITIVITY` map, also in `types.ts`.
- `RequestBlueprint` shape and the complete, already-working CRUD store in `blueprintStore.ts`: `useBlueprintStore().createFirmBlueprint(input)`, `.updateFirmBlueprint(blueprintId, patch)`, `.archiveFirmBlueprint(blueprintId)`, `.getBlueprint(blueprintId)`, `.listBlueprints(includeArchived?)`. These already call `copyRequestBlueprint`/`assertValidRequestBlueprint` internally — you do not need to re-validate, just handle the `BlueprintValidationError` they can throw.
- `NEW_HOUSEHOLD_BLUEPRINT` in `defaultBlueprints.ts` is your reference for realistic item shapes and for how `readonly_card` is already used as a section-opening/closing block — copy that pattern for your "section header" convenience, do not invent a different one.
- `instantiateRequestBlueprint` in `blueprintFactory.ts` and `assertSendableRequest` in `createIntake.ts` — you call these read-only in your own contract test to prove a built form is actually sendable; you do not modify either.

## Deliverable 1 — `src/platform/intake/formBuilder/formItemDrafts.ts`

Pure TypeScript, no React import, no store import (it must not read or write `useBlueprintStore`).

- `newItemId(): string` — same `crypto.randomUUID()`-with-fallback pattern as `newStandingRequestId` in `RequestFromClientDialog.tsx` (read it for the exact fallback shape), but prefixed for this domain (e.g. `item_...`).
- `draftTypedField(): TypedFieldRequestItem` — a sensible blank default (empty label/help_text, `required: false`, `subject: 'primary'`, `fact_kind: 'dob'`, `input: 'date'` — first entry of the closed catalog, editable afterward).
- `draftDocUpload(): DocUploadRequestItem` — blank default with `accepted_mime_types: ['image/jpeg', 'image/png', 'application/pdf']`, `max_files: 1`, `max_bytes: 100 * 1024 * 1024`.
- `draftGuidedQuestion(): GuidedQuestionRequestItem` — blank default, `response_format: 'money'`.
- `draftReadonlyCard(): ReadonlyCardRequestItem` — blank default, empty `body`.
- `draftSectionHeader(): ReadonlyCardRequestItem` — same shape as `draftReadonlyCard`, but this is the function the editor UI calls for "Add section header" specifically (it is allowed to be identical in shape to `draftReadonlyCard` — the distinction is only which button in the UI called it and what placeholder label it starts with, e.g. `'Section'`). Document in a one-line comment that this is a UI convention, not a wire-level distinction — there is no `section` field anywhere in the contract.
- `moveItem(items: RequestItem[], index: number, direction: 'up' | 'down'): RequestItem[]` — returns a new array, no-op at the boundaries.
- `insertItem(items: RequestItem[], index: number, item: RequestItem): RequestItem[]` — returns a new array.
- `removeItem(items: RequestItem[], itemId: string): RequestItem[]` — returns a new array.

**Test file:** `src/platform/intake/formBuilder/__tests__/formItemDrafts.test.ts`. Cover: each draft function produces a structurally valid item of its declared type (spot-check required fields are present and non-throwing through `assertValidRequestBlueprint` when wrapped in a minimal blueprint — you may import `assertValidRequestBlueprint` read-only in the test even though production code under this lane doesn't); `newItemId()` produces unique values across many calls; `moveItem`/`insertItem`/`removeItem` behave correctly including boundary cases (move first item up is a no-op, move last item down is a no-op, remove a nonexistent id is a no-op); no draft function ever produces `t: 'pdf_fill'` or `t: 'signature'` (this is trivially true by construction, but assert it anyway as a regression guard).

## Deliverable 2 — `src/features/intake/formBuilder/FormBuilderEditor.tsx`

Fixed public contract — do not change this shape, Lane 2 (not yet dispatched) will import it exactly as written:

```ts
export interface FormBuilderEditorProps {
  blueprint: RequestBlueprint | null; // null = authoring a brand-new form
  onSaved: (blueprint: RequestBlueprint) => void;
  onCancel: () => void;
}
export function FormBuilderEditor(props: FormBuilderEditorProps): JSX.Element;
```

Behavior:

- `blueprint === null`: start with an empty item list and an editable form-name input bound to the eventual `RequestBlueprint.label`. Generate a `blueprintId` slug from the label (lowercase, spaces to dashes, strip non-alphanumeric-dash) at save time — do not pre-check uniqueness yourself, let `createFirmBlueprint` throw `BlueprintValidationError` if the id collides and show that message inline near the save button.
- `blueprint` set and `blueprint.source === 'firm_saved'`: seed the editor from `copyRequestBlueprint(blueprint)` (import that helper, it's exported and safe to call), save via `updateFirmBlueprint(blueprint.blueprintId, { label, items })`.
- `blueprint` set and `blueprint.source === 'built_in'`: render a read-only view (show the label and the ordered item list, no editing controls, no save button) — built-ins cannot be mutated (the store throws if you try; don't even offer the affordance).
- "Add item" control offers exactly four choices, each calling the matching `draft*` function from Deliverable 1 and inserting it at the end (or at a chosen position if you want drag-free precision — up/down move controls are sufficient, no drag-and-drop dependency needed): typed field, document upload, guided question, section header / text block.
- Each item in the list is edited inline: common fields (label, help text, required toggle, subject — offer `'primary'` and `'household'` as quick-pick buttons plus a free-text input, matching existing usage in `NEW_HOUSEHOLD_BLUEPRINT`) plus type-specific fields:
  - typed_field: `fact_kind` select over the nine closed values; `input` select — constrain the offered options to ones that make sense for the chosen `fact_kind` (mirror the pairings actually used in `NEW_HOUSEHOLD_BLUEPRINT`: `dob`→`date`, `ssn`→`ssn`, `income_annual`/`spending_monthly`→money-shaped, `drivers_license` is actually a `doc_upload` in the reference blueprint so don't pair it with typed_field's `input`, `address`/`citizenship`/`employer`→`text`, `beneficiary`→`text`; use judgment for any pairing not explicitly shown in the reference and keep it structurally valid).
  - doc_upload: accepted MIME types (checkboxes or multi-select for `image/jpeg`, `image/png`, `application/pdf`), max files (number input), max bytes (number input, show as MB in the label, store as raw bytes).
  - guided_question: `prompt` text input, `response_format` radio group with exactly two options (money, range) — never render a third option, `fact_kind` optional select (same nine-value catalog, or "none").
  - readonly_card / section header: `body` textarea, `acknowledgement_required` checkbox.
- Up/down reorder controls and a remove button per item, using Deliverable 1's helpers.
- A compact ordered preview (label + type badge, in order) rendered alongside or above the edit list so the advisor can see the form's shape without scrolling through every field's full editor.
- Save button: assembles the full `RequestItem[]`, calls `createFirmBlueprint`/`updateFirmBlueprint` as appropriate, catches `BlueprintValidationError` (and only that — let unexpected errors surface as a generic inline message, don't swallow silently), calls `props.onSaved(result)` on success.
- Cancel button calls `props.onCancel()` without saving.

**Test file:** `src/features/intake/formBuilder/__tests__/FormBuilderEditor.test.tsx`. Use the real `useBlueprintStore` (reset it between tests via its `resetForTests()` — check `blueprintStore.ts` for the exact method name and call it in `beforeEach`). Cover: authoring a brand-new form end to end (add one of each item type, fill required fields, save, assert `onSaved` received a well-formed `RequestBlueprint` and it is now in `listBlueprints()`); editing an existing firm-saved blueprint (seed with one, change a label, save, assert the update persisted via `getBlueprint`); a built-in blueprint (`NEW_HOUSEHOLD_BLUEPRINT`, importable from `defaultBlueprints.ts`) renders with no editing controls and no save action; the guided-question response-format control never offers anything but money/range; a blueprint-id collision on a new form surfaces the store's validation error inline instead of crashing; cancel does not call the store at all.

## Deliverable 3 — Cross-lane contract test: `src/features/intake/formBuilder/__tests__/formBuilderContract.test.tsx`

This is your gate deliverable — write and fully enable it now (it needs no exports from any other lane).

1. Using Deliverable 1's factories, assemble an ordered item list: one `draftSectionHeader`, one `draftTypedField` (filled to a valid, required item), one `draftDocUpload`, one `draftGuidedQuestion`, one `draftReadonlyCard`.
2. Render `FormBuilderEditor` with `blueprint={null}`, drive it through the equivalent UI flow (add each item type, fill in required fields, save), and assert `onSaved` fires with a `RequestBlueprint` whose `items` match the assembled shape.
3. Feed that returned blueprint into `createFirmBlueprint` if step 2 didn't already save it through the editor itself (it should have — this step is really just re-confirming via `getBlueprint(blueprintId)` and `listBlueprints()` that it round-tripped), then call `updateFirmBlueprint` with a small label change and `archiveFirmBlueprint`, asserting each call reflects correctly (archived blueprints excluded from `listBlueprints()` by default, included with `listBlueprints(true)`).
4. **Prove it is actually sendable end to end, reusing Wave 7 unmodified:** call `instantiateRequestBlueprint({ blueprint: <the saved blueprint, un-archived — build a fresh one for this step if step 3 archived it>, requestId: 'test_request', matterId: 'test_matter' })` from `blueprintFactory.ts`, then call `assertSendableRequest(request.items)` from `createIntake.ts` and assert it does not throw.
5. Assert the saved blueprint's `items` contain no item with `t === 'pdf_fill'` or `t === 'signature'` — the builder must be structurally incapable of producing either, not merely avoid offering them in its UI.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full checks list below, read every failure, fix it, and rerun until everything passes. If you hit a design question this brief doesn't answer, make the most conservative choice that keeps the send path and blueprint validation exactly as Wave 7 built them (never bypass `assertValidRequestBlueprint`, never widen what item types are offered, never touch a file outside your two new directories) and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/platform/intake/formBuilder src/features/intake/formBuilder
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo from this lane — this lane makes no Rust changes, and cargo is a shared box-wide lock other concurrent lanes may be using.

## Finish

Commit on `lp/intake-w10-editor` with a conventional message containing the phrase `W10-LANE1-EDITOR`. Do NOT push. Do NOT merge. Report the exact check results (pass/fail, counts) in your final message, confirm the branch is clean (`git status`), and restate the fixed `FormBuilderEditorProps` contract so the next lane (a form library/list screen that imports `FormBuilderEditor`) can be briefed without re-reading your diff.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
