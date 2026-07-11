# Wave 10 Lane 1 fixup — typecheck failures

You previously implemented Lane 1 (item drafts + form builder editor) in this worktree, committed as `eac76a5a feat(intake): add W10-LANE1-EDITOR form builder` on branch `lp/intake-w10-editor`. Your own final report claimed "Type check: passed," but an independent rerun of the exact command from your brief (`npx tsc --noEmit`, which is also `npm run typecheck`) found 11 real errors across 5 of your files. Fix them now as a second commit on the same branch. Do not re-litigate scope — this is a pure bugfix pass on files you already own.

Worktree: `/home/jameson/lp-w10-editor`, branch `lp/intake-w10-editor`. Never switch branches. Never touch `src/platform/intake/types.ts`, `blueprintTypes.ts`, `blueprintValidation.ts`, `blueprintFactory.ts`, `blueprintStore.ts`, `createIntake.ts`, or `RequestFromClientDialog.tsx` (unchanged constraint from your original brief).

This project compiles with `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` (see `tsconfig.json`). Both are load-bearing here — most of your errors come from code that was written as if neither were on. Fix the root cause in each case; do not add `as any`, `// @ts-ignore`, or a broadened type to make the checker stop complaining.

## Exact errors to fix

```
src/features/intake/formBuilder/FormBuilderEditor.tsx(103,56): error TS2322: Type 'TypedFieldInputFormat | undefined' is not assignable to type 'TypedFieldInputFormat'.
src/features/intake/formBuilder/FormBuilderEditor.tsx(139,272): error TS2345: ... 'fact_kind: undefined' not assignable under exactOptionalPropertyTypes.
src/features/intake/formBuilder/__tests__/FormBuilderEditor.test.tsx(72,39): error TS2339: Property 'toHaveTextContent' does not exist on type 'Assertion<HTMLElement>'.
src/features/intake/formBuilder/__tests__/formBuilderContract.test.tsx(23,37): error TS2367: comparison '"typed_field" | "doc_upload" | "guided_question" | "readonly_card"' vs '"pdf_fill"' has no overlap.
src/features/intake/formBuilder/__tests__/formBuilderContract.test.tsx(23,62): error TS2367: same, vs '"signature"'.
src/features/intake/formBuilder/__tests__/formBuilderContract.test.tsx(35,22): error TS2345: 'HTMLElement | undefined' not assignable to fireEvent.change's element parameter.
src/features/intake/formBuilder/__tests__/formBuilderContract.test.tsx(36,22): error TS2345: same as above, next line.
src/platform/intake/formBuilder/__tests__/formItemDrafts.test.ts(40,34): error TS2367: comparison has no overlap, vs '"pdf_fill"'.
src/platform/intake/formBuilder/__tests__/formItemDrafts.test.ts(40,59): error TS2367: same, vs '"signature"'.
src/platform/intake/formBuilder/formItemDrafts.ts(52,4): error TS2322: 'RequestItem | undefined' not assignable to 'RequestItem' (destructuring swap under noUncheckedIndexedAccess).
src/platform/intake/formBuilder/formItemDrafts.ts(52,18): error TS2322: same, other side of the swap.
```

## What each one actually is, and the expected fix shape

1. **`FormBuilderEditor.tsx:103`** — `INPUTS_BY_FACT_KIND[factKind][0]` indexes an array under `noUncheckedIndexedAccess`, so it types as `T | undefined` even though every entry in `INPUTS_BY_FACT_KIND` is a non-empty array by construction. Don't silence this with `!` or a fallback default that could mask a real future bug if someone adds an empty array to the record. Instead replace the `Record<FactKind, TypedFieldInputFormat[]>` + array-index lookup with a small exhaustive function, e.g. `function firstInputFor(kind: FactKind): TypedFieldInputFormat { switch (kind) { case 'dob': return 'date'; ... } }` (a `switch` with all nine `FactKind` cases is exhaustive and the compiler proves every branch returns — no indexing, no possible `undefined`). Keep `INPUTS_BY_FACT_KIND` (or an equivalent) for the "list every valid input for this fact kind" use at line 111 if you still need it for the `<select>` options — that one has no error, `.map()` over an array doesn't trigger the indexed-access rule, only bracket indexing does.

2. **`FormBuilderEditor.tsx:139`** — `{ ...item, ...(value ? { fact_kind: value } : { fact_kind: undefined }) }` explicitly sets `fact_kind: undefined`, which `exactOptionalPropertyTypes` rejects (an optional property must be *absent*, not present-with-value-undefined). The codebase already has the correct pattern for this exact situation — `copyBlueprintItem` in `blueprintValidation.ts` (read-only reference, don't edit it) uses conditional spread to omit a key entirely rather than null it out, e.g. `...(item.placeholder ? { placeholder: item.placeholder } : {})`. Apply the same shape here: when clearing `fact_kind`, spread from an object that never had the key rather than assigning `undefined` to it. Concretely: build the item as `{ ...item, ...(value ? { fact_kind: value } : {}) }` and, since spreading from `item` when `item.fact_kind` was already set would leave the old value behind, destructure it out first: `const { fact_kind: _prev, ...withoutFactKind } = item; onChange({ ...withoutFactKind, ...(value ? { fact_kind: value } : {}) } as GuidedQuestionRequestItem);`. Use whatever exact structure compiles cleanly and keeps the omission real, not a renamed `undefined`.

3. **`FormBuilderEditor.test.tsx:72`** — `toHaveTextContent` needs the jest-dom matcher types. Check how existing tests in this codebase get this (grep another `.test.tsx` file that already uses `toHaveTextContent` or `toBeInTheDocument`, e.g. under `src/features/intake/__tests__/`, and check the project's vitest setup file / `tsconfig` `types` array for how jest-dom typings are wired in globally). If the existing pattern is a global setup file, your test not compiling means something about how you're importing testing-library differs from the working examples — match the working pattern exactly rather than adding a local `import '@testing-library/jest-dom'` that could diverge from the project convention. If jest-dom truly isn't globally typed anywhere in this repo yet, that would be surprising (other passing tests use `toHaveTextContent`-style matchers) — re-check your import order and the exact matcher call before assuming that.

4. **`formBuilderContract.test.tsx:23` and `formItemDrafts.test.ts:40`** — `assembled.some((item) => item.t === 'pdf_fill' || item.t === 'signature')` no longer type-checks as a meaningful comparison because the array literal (`[draftTypedField(), draftDocUpload(), ...]`) infers its element type as the union of only the four draft functions' return types, which structurally excludes `pdf_fill`/`signature` — so TS (correctly) flags the comparison as impossible given that inferred type, even though the intent is "assert this can never happen." Fix by explicitly typing the array as the full `RequestItem[]` union at its declaration (`const assembled: RequestItem[] = [...]`, importing `RequestItem` from `@/platform/intake/types` if not already imported) so the comparison is against the real domain the code is guarding, not an accidentally-narrowed local inference. This is a real correctness fix, not a suppression — with the narrow inferred type the assertion was checking nothing.

5. **`formBuilderContract.test.tsx:35-36`** — `screen.getAllByLabelText('Text')[0]` (and `[1]`) type as `HTMLElement | undefined` under `noUncheckedIndexedAccess` but `fireEvent.change` needs a real `Element`. Destructure with a runtime guard instead of asserting past the type: `const [firstText, secondText] = screen.getAllByLabelText('Text'); if (!firstText || !secondText) throw new Error('expected two Text fields'); fireEvent.change(firstText, ...); fireEvent.change(secondText, ...);` — this fails loudly and specifically if the DOM shape ever changes, which is more useful in a test than a silent non-null assertion.

6. **`formItemDrafts.ts:52`** — the swap `[moved[index], moved[target]] = [moved[target], moved[index]];` reads two array elements that type as `RequestItem | undefined` under `noUncheckedIndexedAccess`, even though the function's own bounds check two lines above guarantees both are in range. Replace the destructuring swap with explicit reads, a real (not asserted-past) type check, and explicit writes:
   ```ts
   const a = moved[index];
   const b = moved[target];
   if (a === undefined || b === undefined) return [...items]; // unreachable given the bounds check above; satisfies the checker honestly
   moved[index] = b;
   moved[target] = a;
   ```

## Bar

Run these for real, read every line of output, fix until clean, then run them again to confirm (don't trust a partial rerun of just the files you touched):

```
timeout 180 npx tsc --noEmit
timeout 300 npx vitest run src/platform/intake/formBuilder src/features/intake/formBuilder
timeout 280 node scripts/eslint-gate.mjs
```

If `eslint-gate.mjs` times out due to other concurrent work on this machine contending for CPU (there may be other unrelated Codex jobs running in parallel right now), rerun it once more with a longer timeout before reporting a failure — do not report a timeout as a lint failure without at least one retry.

## Finish

Commit on `lp/intake-w10-editor` with a conventional message containing the phrase `W10-LANE1-EDITOR-FIXUP`. Do NOT push, do NOT merge. In your final report, state the exact pass/fail and counts for all three commands above, confirm `git status` is clean, and restate whether the `FormBuilderEditorProps` contract from your original brief changed at all (it should not have — this is an internal bugfix pass).

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if all three checks pass and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print this line early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
