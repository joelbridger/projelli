# Wave 8 Integration Fixes — Cross-Lane Type Errors Found After Full Merge

**Branch:** `lp/intake-w8-integration-fixes`, branched off `lp/intake-w8` at `a48ce9b3` (all four lanes merged: Lane 1 contract, Lane 2 advisor library, Lane 3 client page, Lane 4 receive).
**You are Codex, the builder.** Fix these, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Context

All four Wave 8 lanes are individually built, adversarially reviewed, and merged into the `lp/intake-w8` integration branch. Each lane self-reported "type check passed" when built in its own isolated worktree. But the wave lead ran a full project-wide `npx tsc --noEmit` on the fully-merged tip for the first time (a process gap on the lead's part — this should have run after every merge, not just at the end) and found real type errors that only surface with every lane's files present together. None of these are logic bugs in the underlying design — they're real but narrow type-correctness issues. Fix all of them. This is not a new feature or design change — every fix here should be the minimal correct change that makes the existing intent type-check.

Also: the wave lead ran the full `src/platform/intake src/features/intake` vitest suite twice and confirmed two apparent failures (`pdfTemplateStore.test.ts`'s "round-trips a large source through the encrypted artifact shelf" and `ClientRequestsTab.test.tsx`'s "pins onboarding first...") are **pure resource-contention timeouts** under full-suite parallel load, not real bugs — both pass cleanly with a longer timeout and in isolation. **Do not touch those two tests or investigate them further** — they are not part of this brief's scope, they were already confirmed flaky-by-load, not broken.

## Fixes required

### 1. `src/features/intake/pdfTemplates/TemplateLibraryPanel.tsx` — two type errors (lines ~38, ~251)

`defaultFields()` (around line 38) builds a `PdfFieldMap` from `inspection.fields` by spreading `pdf_field_type: field.type` (an `InspectedPdfFieldType`, which includes `text`/`date`/`checkbox`/`number`/`money`/`radio`/`select`) directly onto an object typed as an `acroform` `PdfFieldMapEntry`. But `PdfFieldMapEntry`'s acroform variant is a discriminated union: `PdfChoiceField` (only `pdf_field_type: 'select' | 'radio'`, requires `options`) vs `PdfNonChoiceField` (everything else, `options` forbidden — `options?: never`). Assigning a broader `pdf_field_type` without branching on whether it's a choice type doesn't satisfy either union member.

The second error (around line 251, the `onClick` for "Add overlay field" calling `setFields`) is the same root problem for the overlay variant.

**Fix:** construct each field entry with an explicit conditional so TypeScript can narrow correctly — e.g. build the entry as `field.type === 'radio' || field.type === 'select' ? { ...base, kind: 'acroform', pdf_field_type: field.type, options: field.options ?? [...] } : { ...base, kind: 'acroform', pdf_field_type: field.type }` (matching whatever this file's existing `options` construction logic already does functionally — you're not changing behavior, just restructuring the object literal so its type is inferred as the correct union member instead of the widened `PdfFieldMapEntry` shape that doesn't satisfy `exactOptionalPropertyTypes`). Apply the same pattern to the overlay `setFields` call site.

### 2. `src/features/intake/__tests__/pdfTemplates/pdfTemplates.test.ts` — fixture type errors (lines ~24, ~25, ~41, ~42, ~59)

- Lines 24-25, 41-42: `TS4111` errors — this file's fixture object literal has an index signature, so accessing a specific known key (`.full_name`, `.annual_income`, `.state`) must use bracket notation (`fields['full_name']`) instead of dot notation (`fields.full_name`), per this project's `noPropertyAccessFromIndexSignature` (or equivalent) tsconfig setting. Purely mechanical — switch dot access to bracket access at each flagged location.
- Line 24/41 `TS2322`: a test fixture spreads `{ rect: {...} }` alone as a full `PdfFieldMapEntry` update, but that's missing required base fields (`field_id`, `kind`, etc.) for the discriminated union. Fix the fixture to spread the full required shape (look at how the same test file's other, passing fixtures construct a complete `PdfFieldMapEntry` and match that shape) rather than a partial `{ rect }` object.
- Line 59 `TS2339`: `entry.rect` accessed on a `PdfFieldMapEntry` that TypeScript has inferred as the `acroform` (non-overlay) variant, which has no `rect` field. Check what the test actually intends at that line — if it's meant to be checking an overlay entry, ensure the value it's reading from is actually typed/constructed as an overlay entry (`kind: 'overlay'`) so `rect` is available; if it's a mistake (meant to check something else), read the surrounding test logic and fix the actual intent, not just silence the type error.

### 3. `src/platform/intake/pdfFillReceipt.ts` — two type errors (lines ~65, ~140)

- Line 65 (`containsEscapedActivePdfActionName`, added in Lane 4's fix round): `for (const [, encodedName] of names)` where `names` comes from `source.matchAll(...)` — TypeScript correctly flags that a regex capture group can be `undefined` even when your pattern makes it practically always present. Add a guard: `if (encodedName === undefined) continue;` (or equivalent) before using it, rather than asserting non-null — this keeps the fail-closed posture of this security-sensitive function honest about what TypeScript can't prove.
- Line 140 (`pdfCompletionReceiptFromManifest`): `const receipt = (manifest as Record<string, unknown>)['pdf_completion_receipt'];` — `manifest` is typed `unknown` at the point this cast happens (or the return of some upstream `unknown`-typed access), and something after this line passes an `unknown`-typed value where `Record<string, unknown> | null` is expected. Read the exact surrounding code and add a proper type guard/narrowing (`typeof manifest === 'object' && manifest !== null`) before the cast, rather than an unchecked `as` — this function already partially does this pattern (per its `if (!manifest || typeof manifest !== 'object') return null;` guard at the top per the original Lane 4 diff) — check whether that guard covers the actual failing call site or whether a second unguarded access elsewhere in the file is the real culprit.

### 4. `src/features/intake/__tests__/PdfFillRequestStatus.test.tsx` — two type errors (lines ~44, ~46)

Test fixture objects passed as `IntakeChecklistState` are missing the required `itemId` field (present as `itemId?:` in the object literal's inferred type, but `IntakeChecklistState` requires it under this project's `exactOptionalPropertyTypes`). Add `itemId: '<something>'` to both fixture objects — check what value the surrounding test actually needs (probably matching whatever item id the test's `IntakeRecord` fixture already uses) rather than an arbitrary placeholder.

### 5. `src/features/intake/__tests__/RequestFromClientDialog.test.tsx` — missing jest-dom type reference (line ~219, `toHaveTextContent`)

This project's convention (see `tests/unit/mail/BUG007-startup-sync.test.tsx`, `tests/unit/ask/AskComposer.test.tsx`, and about 7 other existing test files) is that any test file using a `@testing-library/jest-dom` matcher (like `toHaveTextContent`) needs `/// <reference types="@testing-library/jest-dom" />` as a comment near the top of the file, even though the runtime extension is globally imported in `tests/setup.ts`. This line was added by Lane 2 without that reference directive. Add it, matching the exact placement convention used in the existing examples (typically right after the last `import` or near the top before the first `describe`).

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout)

```
timeout 120 npx tsc --noEmit
timeout 300 npx vitest run src/platform/intake src/features/intake --test-timeout=20000
timeout 120 node scripts/eslint-gate.mjs
```

The `--test-timeout=20000` flag on the vitest run is intentional — it accounts for the resource-contention flakiness already diagnosed above, not a sign of a real problem. `npx tsc --noEmit` must come back completely clean (zero errors) — that's the actual bar for this brief.

Do not run `npm run gate` or anything touching Rust/cargo — none of these fixes touch Rust, and cargo is a shared box-wide resource other work may be using.

## Self-converge requirement

Do not stop and report failing checks as your finishing state. Run the full checks list, read every failure, fix it, and rerun until `tsc --noEmit` is completely clean and the vitest suite is fully green (330 passed, 5 skipped is the expected baseline — the 5 skips are Lane 1's intentionally-reserved cross-lane gate cases, not a regression). If you find you disagree with this brief's read of a specific error (e.g. you find the actual root cause is different from what's described above), fix the real root cause and explain the discrepancy in your final report — don't blindly pattern-match the brief's suggested fix if the actual code tells a different story.

## Finish

Commit on `lp/intake-w8-integration-fixes` with a conventional message containing the phrase `W8-INTEGRATION-FIXES`. Do NOT push. Do NOT merge. Report exact check results (pass/fail, counts) and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
