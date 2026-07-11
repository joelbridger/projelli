# Wave 9 Lane 1 — Fix Round (typecheck failures found in independent verification)

**Branch:** `lp/intake-w9-contract` (same branch, same worktree at `/home/jameson/lp-w9-contract`). Your prior commit `74292fdc feat(intake): add W9-LANE1-CONTRACT signing contract` is good work and mostly correct — this is a targeted fix round, not a rebuild.
**You are Codex, the builder.** Fix the issues below, re-run every check, commit. Do NOT push. Do NOT merge. Do not send notifications; never invoke `notify-jameson`.

## What happened

Your prior run reported `DONE-EXIT:0` with all checks passing, but an independent re-run of the exact same `npx tsc --noEmit` command you were told to run found 51 real compile errors. Your scoped `vitest` run was genuinely green (verified independently, also green), but the whole-project typecheck was not — it looks like your last edits (fixing the vitest failures) were made after your last successful `tsc` pass and never re-verified. Every issue below is real and reproducible; fix all of them in one pass, then re-run **all four** checks from your original brief (not just tsc) before finishing, since a fix for one category can regress another.

## Fixes required

### 1. `signatureRecord.ts` and `tabMap.ts` — TS4111 index-signature access (28 errors)

Both files define `type LooseRecord = Record<string, unknown>;` and then access named properties on it with dot notation (`event.eventId`, `anchor.page`, `map.signatureTab`, etc.), which the project's `noPropertyAccessFromIndexSignature` tsconfig setting rejects. `src/platform/intake/pdfTemplates/templateValidation.ts` already solves this correctly — copy its exact pattern: its `LooseRecord` is `Record<string, unknown> & { <every field name actually accessed>?: unknown; ... }`, an intersection that gives each named field a real (non-index-signature) type while keeping the general index signature for the "reject unknown key" check. Update `LooseRecord` in both `signatureRecord.ts` and `tabMap.ts` the same way, listing every property your validators actually dot-access (`signatureRecord.ts`: `requestId`, `signatureItemId`, `sourcePdfFillItemId`, `sourceTemplateVersion`, `sourceTemplateSha256`, `wave8CompletedSha256`, `envelopeId`, `status`, `finalSignedSha256`, `certificateSha256`, `events`, `eventId`, `source`, `at`; `tabMap.ts`: `page`, `rect`, `x`, `y`, `width`, `height`, `signatureTab`, `dateSignedTab`, `signerNameTab`). Do not switch to bracket notation everywhere instead — matching the existing codebase pattern is the more consistent fix and keeps the code as readable as `templateValidation.ts`.

### 2. `docusignSignature.test.ts` — circular type inference (TS7023/TS2502, 2 errors)

```ts
function completion(overrides: Partial<NonNullable<ReturnType<typeof eligibilityInput>['currentCompletion']>> = {}) { ... }
function eligibilityInput(overrides: Partial<Parameters<typeof assertSignatureEligible>[0]> = {}) {
  return { ..., currentCompletion: completion(), ... };
}
```

`completion`'s signature derives its type from `eligibilityInput`'s return type, while `eligibilityInput`'s body calls `completion()` — a circular inference TypeScript can't resolve without an explicit annotation breaking the cycle. Fix by giving `completion` an explicit return type instead of deriving it from `eligibilityInput`: use `SignatureEligibilityInput['currentCompletion']` (import that type, or the equivalent literal object type) directly, not `ReturnType<typeof eligibilityInput>[...]`. Add an explicit return type annotation to `completion` itself (e.g. `: NonNullable<SignatureEligibilityInput['currentCompletion']>`) so nothing needs to infer through `eligibilityInput` at all.

### 3. `docusignSignature.test.ts` lines ~159-160 — incomplete `SignatureEvent` literals (TS2345, 2 errors)

```ts
expect(isDuplicateSignatureEvent(existing, { ...existing[0], source: 'poll' })).toBe(true);
expect(isDuplicateSignatureEvent(existing, { ...existing[0], eventId: 'docusign-event-2' })).toBe(false);
```

`existing` is typed as `SignatureEvent[]`, so `existing[0]` should already be a full `SignatureEvent` — but TypeScript is apparently widening it (likely because `existing` was declared with an inline array literal and inferred loosely, or `existing[0]` is typed as possibly-undefined under `noUncheckedIndexedAccess` and the spread is picking up an incomplete shape). Fix by pulling the first element into its own explicitly-typed `const first: SignatureEvent = existing[0]!;` (or restructure so `existing[0]` isn't accessed via bracket indexing into an array-typed spread target) before spreading it, so both call sites spread a fully-typed `SignatureEvent`.

### 4. Two `delete` operator errors (TS2790) — `docusignSignatureContract.test.ts:57` and `blueprintValidation.test.ts:87`

```ts
const missingTab = signature() as ReturnType<typeof signature> & { tab_map: Partial<ReturnType<typeof signature>['tab_map']> };
delete missingTab.tab_map.dateSignedTab;
```

This intersection doesn't do what it looks like it does: `ReturnType<typeof signature>` already types `tab_map` as the full required `ReviewedDocusignTabMap`, and intersecting a type with `Partial<itself>` does not relax required fields (`X & Partial<X>` simplifies back to `X`) — so `dateSignedTab` stays required and `delete` is rejected. Fix by using `Omit` to actually remove the original field's type before re-adding the partial version:

```ts
const missingTab = signature() as Omit<ReturnType<typeof signature>, 'tab_map'> & { tab_map: Partial<ReturnType<typeof signature>['tab_map']> };
delete missingTab.tab_map.dateSignedTab;
```

Apply the identical fix to the equivalent line in `blueprintValidation.test.ts:87` (`delete item.tab_map.signerNameTab;`).

### 5. `types.ts:3` — unused `DocusignTabAnchor` import (TS6196, 1 error)

```ts
import type { DocusignTabAnchor, ReviewedDocusignTabMap } from './docusignSignature/tabMap';
...
export type { DocusignTabAnchor, ReviewedDocusignTabMap } from './docusignSignature/tabMap';
```

`ReviewedDocusignTabMap` is used elsewhere in this file (in `DocusignSignatureRequestItem`'s `tab_map` field), so its import on line 3 is load-bearing. `DocusignTabAnchor` is never referenced in the file body — only re-exported on line 14, which doesn't need the separate import at all. Remove `DocusignTabAnchor` from the line-3 import, keep it only in the line-14 re-export.

### 6. Three pre-existing test files broken by the new discriminated `SignatureRequestItem` type (TS2322/TS2353, 3 errors)

These files predate your change and construct the old flat placeholder shape (`{ t: 'signature', grade: 'docusign', ...common fields... }` with no `source_pdf_fill_item_id`/`tab_map`, or a stray `document_ref` on a `docusign`-grade item). This is a real, in-scope regression from your type change — fix these three call sites so they compile, using the smallest change that keeps each test's original intent:

- `src/features/intake/__tests__/RequestFromClientDialog.test.tsx:359` — the test object needs `source_pdf_fill_item_id` and a valid `tab_map`, or (if the test's actual point has nothing to do with Wave 9 signature content) change its fixture's `grade` to `'native_clicksign'` and drop the extra fields instead, whichever keeps that specific test's original intent clearest. Read the surrounding test to judge which.
- `src/features/intake/__tests__/pdfTemplates/pdfTemplates.test.ts:129` — same judgment call, same fix shape.
- `src/features/intake/formBuilder/__tests__/FormBuilderEditor.test.tsx:74` — remove the now-invalid `document_ref` from a `grade: 'docusign'` object (that field only exists on the `native_clicksign` variant now); if the test needs a `document_ref`-bearing fixture at all, switch that fixture's `grade` to `'native_clicksign'` instead of adding the Wave 9 fields, unless the test is specifically about the `docusign` grade, in which case add `source_pdf_fill_item_id`/`tab_map` instead.

Do not weaken any of these three tests' actual assertions — only fix their fixture's shape so it type-checks against the new (correct) discriminated union.

## After fixing: re-run every check from the original brief, not just tsc

```
timeout 300 npx vitest run src/platform/intake/docusignSignature src/platform/intake/blueprintValidation.test.ts src/platform/intake/createIntake.test.ts src/platform/intake/__tests__/docusignSignatureContract.test.ts src/platform/intake/__tests__/pdfFillContract.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake
timeout 300 npx vitest run src/features/intake
timeout 180 npx tsc --noEmit
timeout 240 node scripts/eslint-gate.mjs
```

The added `src/features/intake` vitest run is new relative to your original brief — it's the only way to confirm your fixes to the three pre-existing test files (deliverable 6 above) didn't break anything else in that directory. Report the exact pass/fail and counts for every one of these five commands. If `eslint-gate.mjs` needs more than 240s, say so plainly rather than letting it time out silently — do not report a check as passing if it didn't actually finish.

Also `git add` the brief document at `docs/plans/lantern-plus/intake/briefs/w9-1-contract.md` if it isn't already tracked (it should have been committed alongside your original work; commit it now if it's still untracked) — commit it as part of this fix round if needed.

## Finish

Commit on `lp/intake-w9-contract` (a new commit, do not amend the prior one) with a conventional message containing `W9-LANE1-CONTRACT-FIXES`. Do NOT push. Do NOT merge. Report exact check results for all five commands above, confirm the branch is clean, and confirm the brief doc is tracked.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every one of the five checks above genuinely passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
