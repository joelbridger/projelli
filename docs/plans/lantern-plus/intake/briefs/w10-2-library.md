# Wave 10 Lane 2 — Form Library + Entry Point

**Branch:** `lp/intake-w10-library`, branched off `origin/lp/intake` at `0f15153b` (confirm with `git merge-base HEAD origin/lp/intake` before starting — do not assume a stale SHA from this document). That commit already includes Lane 1's merged form builder editor.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Lane 1 (already merged) built `FormBuilderEditor`, a component that authors one form (a `RequestBlueprint`) and saves it through the existing blueprint store. There is still no way for an advisor to reach it. This lane builds the list/library screen — "here are your saved forms, make a new one, edit one, archive one" — and wires a single entry point into the existing Requests board so an advisor can actually find this feature. It does not touch how forms are authored (that's Lane 1's file, read-only for you) or how requests are sent (`RequestFromClientDialog.tsx`, which you must not touch — it already reads saved blueprints automatically, so nothing here needs to change for a saved form to become sendable).

## Read first, in full

- `src/features/intake/formBuilder/FormBuilderEditor.tsx` (Lane 1, read-only) — its exact props are:
  ```ts
  export interface FormBuilderEditorProps {
    blueprint: RequestBlueprint | null; // null = authoring a brand-new form
    onSaved: (blueprint: RequestBlueprint) => void;
    onCancel: () => void;
  }
  export function FormBuilderEditor(props: FormBuilderEditorProps): JSX.Element;
  ```
- `src/platform/intake/blueprintStore.ts` (read-only) — `useBlueprintStore()`: `listBlueprints(includeArchived?)`, `getBlueprint(blueprintId)`, `archiveFirmBlueprint(blueprintId)`. `listBlueprints()` returns built-ins (`source: 'built_in'`) mixed with firm-saved ones (`source: 'firm_saved'`) — built-ins can never be edited or archived (the store throws `BlueprintValidationError` if you try; don't even offer the affordance for them).
- `src/platform/intake/defaultBlueprints.ts` (read-only) — `NEW_HOUSEHOLD_BLUEPRINT` is the one shipped built-in, useful for manually sanity-checking your list rendering.
- `src/features/intake/RequestsBoard.tsx` (you edit this one, additively only) — read its header block (the `<div style={{ display: 'flex', ... justifyContent: 'space-between' ...}}>` containing the title and the "New client" `Button`) and its `RequestsBoardProps` interface. This is where your one entry point goes.
- `src/features/intake/RequestFromClientDialog.tsx` (read-only, do not edit) — note how it already reads `useBlueprintStore` firm blueprints (`availableBlueprints` in that file) so you can see that nothing there needs to change once you save a new blueprint.

## Non-negotiables

- **Do not edit** `src/platform/intake/types.ts`, `blueprintTypes.ts`, `blueprintValidation.ts`, `blueprintFactory.ts`, `blueprintStore.ts`, `createIntake.ts`, `RequestFromClientDialog.tsx`, `src/features/intake/formBuilder/FormBuilderEditor.tsx`, or `src/platform/intake/formBuilder/formItemDrafts.ts`. Import from them, don't change them. If you find a genuine need to change one, stop, don't edit it, and write why to `docs/plans/lantern-plus/intake/briefs/w10-2-blocker.md` instead, then continue with everything else in this brief that doesn't depend on it.
- Only create files under `src/features/intake/formBuilder/` (new file: `FormBuilderLibrary.tsx`, plus its test) and make an **additive-only** edit to `src/features/intake/RequestsBoard.tsx` (a new button plus whatever local dialog-open state it needs — do not remove, rename, or change the behavior of anything already in that file, including its existing props, existing `data-testid`s, or the existing "New client" button).
- No Rust changes.
- Copy shown to the advisor: plain language, no em dash, light theme, keyboard-accessible. Use the existing `@/ui/*` component set — for a modal, follow the `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` pattern from `RequestFromClientDialog.tsx` rather than inventing a new modal primitive.
- **The hard lesson from Lane 1's own review round, which cost three fix passes: structural correctness (typecheck, tests, lint) is necessary but not sufficient.** Lane 1 initially shipped code that typechecked and passed its own tests but was still broken for a real client, because it never checked what the *actual client-facing intake page* does with the data it produces. This lane is lower-risk (it's a list/navigation screen, not new item-authoring logic), but the same discipline applies: don't assume a UI affordance works just because it compiles. If you're unsure whether something you're building actually reflects what `useBlueprintStore`/`FormBuilderEditor` will do with it, go read the source rather than guess.

## Deliverable 1 — `src/features/intake/formBuilder/FormBuilderLibrary.tsx`

A list/management screen for saved forms, plus the create/edit flow wired to `FormBuilderEditor`.

```ts
export interface FormBuilderLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function FormBuilderLibrary(props: FormBuilderLibraryProps): JSX.Element;
```

- Render inside a `Dialog` (`open={props.open}`, `onOpenChange={props.onOpenChange}`), matching the `RequestFromClientDialog.tsx` pattern for header/description/content structure.
- Internal state machine with (at least) two views: **list** and **editor**.
- **List view:** call `useBlueprintStore((state) => state.listBlueprints())` (active only, no need to show archived forms by default — but you may add a simple "Show archived" toggle using `listBlueprints(true)` filtered to `archived: true` if it's easy; not required). For each blueprint show its label, item count, and:
  - Built-in (`source === 'built_in'`): a "Built-in" badge/label, no Edit or Archive action (the store would reject both anyway — don't even show the buttons).
  - Firm-saved (`source === 'firm_saved'`): "Edit" and "Archive" actions.
  - A "New form" button at the top that opens the editor view with `blueprint={null}`.
  - Archive should ask for confirmation before calling `archiveFirmBlueprint` (a simple inline confirm state is fine — this codebase doesn't need a separate confirmation dialog component for this; check if one already exists and reuse it if trivial, otherwise a plain "Are you sure? Archive / Cancel" inline toggle is fine).
- **Editor view:** render `<FormBuilderEditor blueprint={selected} onSaved={handleSaved} onCancel={handleCancel} />` where `selected` is `null` for "New form" or the chosen blueprint for "Edit". `handleSaved` returns to the list view (refetch/re-render so the newly saved or updated form shows immediately — `useBlueprintStore` is a Zustand store, so subscribing via the hook the normal way should already re-render you on state change; verify this actually happens rather than assuming it). `handleCancel` also returns to the list view without saving.
- When `props.open` transitions from false to true, reset to the list view (don't reopen mid-edit from a stale previous session).

**Test file:** `src/features/intake/formBuilder/__tests__/FormBuilderLibrary.test.tsx`. Use the real `useBlueprintStore` (reset via its `resetForTests()` in `beforeEach`, same pattern Lane 1's tests use). Cover:
- The built-in blueprint (`NEW_HOUSEHOLD_BLUEPRINT`) appears in the list with no Edit/Archive controls.
- "New form" opens the editor, saving a form returns to the list and the new form is now visible in the list.
- "Edit" on a firm-saved blueprint opens the editor pre-filled, saving a change returns to the list with the updated label/item count visible.
- "Archive" on a firm-saved blueprint (after confirming) removes it from the default list view.
- Reopening the dialog (`open` false→true) after having navigated into the editor view resets back to the list view.

## Deliverable 2 — entry point in `src/features/intake/RequestsBoard.tsx`

Add a "Manage forms" button in the existing header block, next to the current "New client" `Button` (same row, same `Button` component from `@/ui/kp`, same `size="sm"` styling — pick a sensible icon from `lucide-react`, e.g. `FileText` or similar, matching the existing `Plus`/`ClipboardList` icon usage style). Give it a `data-testid` (e.g. `requests-board-manage-forms`) following the existing naming convention in this file (`onboarding-board-new-client`, `requests-filter-onboarding`, etc.).

Add local `useState` for whether the `FormBuilderLibrary` dialog is open, render `<FormBuilderLibrary open={...} onOpenChange={...} />` once in this component's output, and wire the new button's `onClick` to open it. Do not add a new prop to `RequestsBoardProps` for this — it's fully self-contained local state, matching how this component already manages other local dialogs/state.

**Test:** extend the existing `src/features/intake/__tests__/RequestsBoard.test.tsx` (read it first) with one focused test: clicking the new "Manage forms" button opens the library dialog (assert something from `FormBuilderLibrary`'s list view becomes visible, e.g. a "New form" button or the built-in blueprint's label). Do not modify or remove any existing test in that file — this must be a pure addition, and every existing test in it must still pass unchanged.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full checks list below, read every failure, fix it, and rerun until everything passes. If you hit a design question this brief doesn't answer, make the most conservative choice that doesn't touch a file outside your scope and doesn't change existing behavior in `RequestsBoard.tsx`, and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/features/intake/formBuilder src/features/intake/__tests__/RequestsBoard.test.tsx
timeout 180 npx tsc --noEmit
timeout 280 node scripts/eslint-gate.mjs
```

If `eslint-gate.mjs` times out from other concurrent work on this machine, retry once with a longer timeout before reporting a failure.

## Finish

Commit on `lp/intake-w10-library` with a conventional message containing the phrase `W10-LANE2-LIBRARY`. Do NOT push, do NOT merge. Report the exact check results (pass/fail, counts) in your final message, confirm the branch is clean (`git status`), and confirm explicitly that `RequestFromClientDialog.tsx`, `FormBuilderEditor.tsx`, and `formItemDrafts.ts` were not modified.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
