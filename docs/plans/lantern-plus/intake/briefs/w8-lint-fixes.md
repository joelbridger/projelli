# Wave 8 — ESLint Baseline-Gate Fixes

**Branch:** `lp/intake-w8-lint-fixes`, branched off `lp/intake-w8` at `2e8fecca` (all four lanes merged, plus post-merge fixes).
**You are Codex, the builder.** Fix these, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Context

Each Wave 8 lane self-reported "style/lint check passed" when built in its own isolated worktree. The wave lead ran the real project-wide `node scripts/eslint-gate.mjs` (the baseline-comparison gate this repo uses) on the fully-merged tip for the first time and found **43 real new findings** versus baseline. None require a design change — every one is either a genuine i18n-compliance gap, a genuine silent-failure gap, or a style/type-safety rule violation. Fix all of them so `node scripts/eslint-gate.mjs` reports zero new findings.

**Do not touch `src/platform/intake/__tests__/pdfFillContract.test.ts`.** Two findings originally appeared in that file (`no-unnecessary-condition`, a tautological `'pdf_fill' !== 'pdf_fill'` check), but a separate, parallel task is currently rewriting that file's placeholder tests into real ones and will naturally resolve or restructure that code. Touching it here would create a merge conflict with that work. Skip it entirely — your fix count is the other 41 findings, not 43.

## Findings by file (run `node scripts/eslint-gate.mjs` yourself first to get exact line numbers — this list groups by file/rule, it doesn't repeat every line number since the tool will show you exactly where)

### `src/features/intake/pdfTemplates/TemplateLibraryPanel.tsx` (the largest cluster — 37 of the 41 findings)

- **10 `lantern-i18n/no-hardcoded-string`**: every listed user-facing string ("Approved PDF forms", "Add starter forms", "Import PDF form", "Import a local PDF, review it, then approve it before adding", "Add to request", "locally. No website address is saved or used.", "Fillable PDF fields", "Wrap inside this field", "Ask the client to contact the advisor", "Add overlay field", "Approve this version") needs to go through this codebase's `t()` translation function. Check how nearby existing intake components (e.g. `RequestFromClientDialog.tsx`, which already handles this correctly) import and call `useTranslation()`/`t()`, and follow that exact pattern — add real translation keys, don't just silence the rule. If this codebase's i18n system requires adding entries to a locale JSON file (check for one near existing `t()` usages in this feature area), do that too; don't leave a `t('some.key')` call pointing at a key that doesn't exist anywhere.
- **16 `@typescript-eslint/no-confusing-void-expression`**: an arrow function shorthand (`() => someVoidCall()`) that returns a void expression must use braces (`() => { someVoidCall(); }`) instead. Purely mechanical — find each flagged arrow function and add braces + semicolon, matching this codebase's existing style elsewhere in this file for the JSX event handlers that already do this correctly (there are working examples in the same file to copy the pattern from).
- **7 `lantern-async/no-silent-failure`**: a `void somePromise()` call (or unhandled/un-awaited promise in an event handler) has no `.catch()`. For each one, either add a real `.catch()` that surfaces the error the way this component's other error handling already does (check how `setError`/similar state is used elsewhere in this file for a consistent pattern), or — only if it's genuinely a fire-and-forget best-effort operation where a failure truly doesn't need surfacing — add `// eslint-disable-next-line lantern-async/no-silent-failure -- <specific reason>` with a real, specific justification. Default to the real `.catch()` fix; only use the disable comment if you can articulate exactly why silently dropping the failure is correct product behavior here.
- **4 `react-refresh/only-export-components`**: this file exports both React components and non-component values (functions/constants) from the same file, which breaks Vite's fast-refresh. Move the non-component exports (helper functions, constants — check what's actually being flagged) into a separate file (e.g. a sibling `.ts` utility file) and import them back into this component file. Keep the component file exporting only components.
- **4 `@typescript-eslint/no-unnecessary-condition`** (2 "always truthy", 1 "always falsy", 1 "unnecessary optional chain"): each flagged condition is provably always one value given the surrounding types — read the actual logic at each site, understand why TypeScript can prove it, and either remove the unnecessary check (if it's truly dead) or, if you believe the check is actually needed for a real runtime case TypeScript's static analysis can't see (e.g. a value that could differ from its type at a system boundary), narrow the type instead of just deleting the check — don't blindly delete a safety check without understanding it first.
- **2 `@typescript-eslint/restrict-template-expressions`** ("Invalid type 'number'"): a template literal (`` `${value}` ``) is interpolating a `number` where this project's lint config wants an explicit `String(value)` conversion (or the value re-typed). Wrap with `String(...)` at each flagged site.

### `src/features/intake/__tests__/PdfFillRequestStatus.test.tsx` — 2 findings

`@typescript-eslint/no-non-null-assertion` (2×): the wave lead added `items[0]!` non-null assertions directly to this file as a quick fix for a different, already-resolved type error — this project's lint rules forbid `!` non-null assertions. Replace each with a safe alternative that doesn't reintroduce the original type error: e.g. destructure with a runtime check (`const item = pdfRequest('received').items[0]; if (!item) throw new Error('...');` then use `item`), or find whatever pattern this test file's sibling tests already use for asserting a fixture array element is present. Keep the test's actual behavior identical — this is purely about satisfying the lint rule without an unsafe assertion.

### `src/features/intake/__tests__/RequestFromClientDialog.test.tsx` — 6 findings

- **4 `no-confusing-void-expression`**: same fix pattern as TemplateLibraryPanel.tsx above — add braces to arrow-function-shorthand void calls.
- **2 `no-unsafe-assignment`** ("Unsafe assignment of an `any` value"): find the flagged assignments and add proper typing (check what's producing the `any` — likely an untyped mock return or a loosely-typed test helper — and type it correctly, or use a type assertion to a specific known type rather than leaving it as `any`).

### `src/features/intake/__tests__/pdfTemplates/pdfTemplates.test.ts` — 5 findings

- **3 `no-confusing-void-expression`**: same brace-wrapping fix.
- **2 `unbound-method`**: a method reference (likely something like `expect(someObject.someMethod)` or passing a method as a callback) is used without binding, which could break `this` scoping if the method actually uses `this`. Check what's flagged — if it's a vitest matcher or a function that genuinely doesn't use `this`, wrap in an arrow function (`() => someObject.someMethod()`) rather than passing the bare reference, matching how this codebase's other test files already avoid this.

### `src/platform/intake/intakeKeychain.ts` — 1 finding

`no-unsafe-assignment`: find the flagged line (likely in the PDF template descriptor keychain helpers added during Wave 8) and add proper typing instead of an implicit `any` flow.

### `src/platform/intake/pdfFillReceipt.test.ts` — 1 finding

`restrict-template-expressions` ("Invalid type 'string"): same `String(...)` wrapping fix pattern as above.

### `src/platform/intake/pdfFillReceipt.ts` — 3 findings

- `no-unnecessary-type-assertion`: remove the flagged `as SomeType` cast, since TypeScript already infers that type without it.
- `no-extraneous-class`: a class with no real members/behavior is being used just as a namespace or error-marker. Check what it's for (likely a lightweight custom-error class pattern) — if this codebase has an established plain-function or plain-object pattern for this instead of an empty class, use that; if it's actually meant to be a custom `Error` subclass and the lint rule is just flagging that this particular usage looks empty, check whether it's missing a constructor body that should be there (a real bug) versus genuinely intentional (in which case a scoped disable comment with a reason is fine).
- `unbound-method`: same fix pattern as above (wrap in an arrow function rather than passing a bare method reference).

### `src/platform/intake/pdfTemplateStore.test.ts` — 1 finding

`no-confusing-void-expression`: same brace-wrapping fix.

### `src/platform/intake/pdfTemplateStore.ts` — 4 findings

`no-unnecessary-condition` (×4: "always truthy" ×2, "always falsy" ×1, an always-true string comparison ×1): same approach as the TemplateLibraryPanel.tsx conditionals above — understand each one before fixing; remove genuinely dead checks, narrow types if a real runtime case is being protected against that TypeScript can't see statically.

### `src/platform/intake/pdfTemplates/pdfInspector.ts` — 1 finding

`no-unnecessary-condition` ("unnecessary optional chain on a non-nullish value"): remove the unneeded `?.` at the flagged site, or narrow the type if there's a real reason the value could be nullish that TypeScript isn't seeing.

### `src/platform/intake/useIntakeInboxSync.test.ts` — 8 findings

`restrict-template-expressions` (1×), `no-unsafe-assignment` (1×), `no-unsafe-member-access` (3×, on `.requestSlug`/`.folder`/`.fileName`/`.bytes` — check exact count and properties via the tool output), `no-unsafe-argument` (1×), `no-unnecessary-condition` (1×, "`undefined !== undefined` is false"), `no-floating-promises` (1×). This cluster is almost certainly all in the new `pdf_fill` test cases added during Lane 4's fix rounds, working with a loosely-typed mock (probably a `fileDocument`/`options.fileDocument` mock whose return/call-args type isn't properly declared, causing everything read off it to be `any`). Find the mock in question, give it a proper type (matching `FileIntakeDocumentOptions`/`fileIntakeDocument`'s real signature from `intakeFiling.ts`), and the cascading `no-unsafe-*` findings should mostly resolve themselves once the mock itself is typed. Fix the floating-promise and unnecessary-condition findings individually at their flagged lines.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 180 node scripts/eslint-gate.mjs
timeout 120 npx tsc --noEmit
timeout 300 npx vitest run src/platform/intake src/features/intake --test-timeout=20000
```

`node scripts/eslint-gate.mjs` must report **zero new/increased findings** — that is the actual bar (not "fewer findings", zero). `tsc --noEmit` must stay completely clean (it currently is — do not regress it while fixing lint). `--test-timeout=20000` on the vitest run accounts for known CPU-contention flakiness on this box under load, already diagnosed as not a real issue by the wave lead.

Do not run `npm run gate` or anything touching Rust/cargo — none of these fixes touch Rust.

## Self-converge requirement

Do not stop and report partial progress ("32 of 41 fixed") as your finishing state. Every genuine bug you find while investigating a finding (e.g. an i18n string that reveals a missing translation infrastructure, or an "unnecessary condition" that turns out to hide a real edge case) should be fixed properly, not just silenced to make the linter quiet. If you disagree with a specific finding's suggested fix and believe a scoped disable comment is genuinely correct, use one with a real, specific reason — don't disable broadly or without justification.

## Finish

Commit on `lp/intake-w8-lint-fixes` with a conventional message containing the phrase `W8-LINT-FIXES`. Do NOT push. Do NOT merge. Report exact check results (the eslint-gate output showing zero new findings, tsc clean, vitest counts) and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if `node scripts/eslint-gate.mjs` reports zero new findings and every other check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
