# Wave 8 — Review R1 Fix Round: Two P1 Findings

**Branch:** `lp/intake-w8-review-r1-fixes`, branched off `lp/intake-w8` at `01e95769` (fully merged, wave-end gate green except one documented pre-existing exception unrelated to this work).
**You are Codex, the builder.** Fix these two P1 findings from an independent coordinator review, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

Full review: `/home/jameson/lantern-coordination/prep/W8-REVIEW-R1.md`. This brief covers exactly its two P1 items — do not touch anything else (a separate, unrelated P2 reconcile item about Wave 10's form builder is being handled by someone else; do not touch W10 or `RequestsBoard.tsx`).

## P1a — Template artifacts are plaintext in browser-mode storage

`src/platform/intake/pdfTemplateArtifacts.ts` writes the complete PDF/template record (source PDF bytes, field map, everything) straight into `localStorage` in plaintext whenever `isTauri()` is false (the browser/dev fallback path). This directly violates the wave's non-negotiable that this data must never be plaintext in `localStorage`. `src/platform/intake/pdfTemplateStore.test.ts` (around line 77) currently asserts the plaintext key is `toBeTruthy()` in `localStorage` without checking it isn't readable content — meaning the test doesn't catch this.

**This codebase already has an established, accepted pattern for this exact tradeoff — use it, don't invent a new one.** `src/platform/providers/KeychainService.ts` (around line 293) documents the convention: "the OS keychain on desktop, base64-obfuscated localStorage in the browser." `src/platform/intake/intakeKeychain.ts` already implements this exact pattern for other sensitive per-intake data (`KC_FALLBACK_PREFIX`, `fallbackKey()`, `btoa()`/`atob()` helpers — read that file's `writeSecret`/`readSecret`-equivalent functions for the exact shape to mirror).

**Fix:** change `writePdfTemplateArtifact`/`readPdfTemplateArtifact`/`deletePdfTemplateArtifact`'s non-Tauri branches to base64-obfuscate the value before writing to `localStorage` (and decode on read), using the same key-prefix convention `intakeKeychain.ts` already uses (`KC_FALLBACK_PREFIX` from `@/config/identity`, or whatever exact constant that file imports — check it and reuse the same one, don't define a second prefix constant). Keep the Tauri branch exactly as-is (it's already real AES-GCM encryption via the Rust command, per Wave 8 Lane 2's fix round — not what's being flagged here).

Then fix `pdfTemplateStore.test.ts`'s assertion (around line 77) so it actually verifies the browser-mode fallback is not plaintext-readable — e.g. assert the stored `localStorage` value does NOT contain the raw source bytes / field names / template ID as a readable substring, the way other Wave 8 tests already assert absence-of-plaintext (see `pdfFillContract.test.ts`'s wire-inspection tests for the pattern: decode candidate byte strings and assert `.not.toContain(...)`). A test that only checks "a key exists" doesn't prove non-plaintext; make it prove the actual property this fix delivers.

## P1b — A completed PDF can be submitted under the wrong sibling item's handle when two items share the same approved template

`PdfCompletionReceipt` (`src/platform/intake/pdfTemplates/templateContract.ts`, around line 98) has `templateId`, `templateVersion`, `sourceSha256`, `completedSha256`, `completedAt`, `pageVersion` — but **no field binding it to the specific issued opaque item handle** (`item_id`) it was completed for. Receiver-side, `routePdfFillSubmission` (`src/platform/intake/useIntakeInboxSync.ts`, around line 397) loads the descriptor **for the submitted item's own handle** (`loadPdfTemplateDescriptor(submission.intakeId, submission.itemId)`) and verifies the receipt only against that descriptor's `templateId`/`version`/`sourceSha256` (via `verifyReceiptAgainstDescriptor`, in `templateValidation.ts`). If a standing request has **two different items referencing the exact same approved template** (same `templateId`/`version`/`sourceSha256` — a real, legitimate case: an advisor could send the same form type as two separate checklist items, or a client could receive the same template via two different standing requests under one intake), a completed PDF genuinely produced for item A's handle will also pass verification against item B's descriptor, because the receipt carries nothing that distinguishes which specific item it belongs to. A client (or a compromised/confused client-side bug) can submit item A's completed form under item B's `item_id` and it will be silently accepted and filed as if it were item B's completion.

The review found that the existing test meant to catch this (`pdfFillContract.test.ts`, around lines 499 and 524, in the "integrity-flags..." test) **uses a different `templateId` for its "wrong handle" case, so it actually only proves template-mismatch rejection works — it does not prove same-template sibling-item rejection, and currently cannot, because the receipt has no item-handle field to check.**

**Fix:**

1. Add a field to `PdfCompletionReceipt` binding it to the issued opaque item handle — e.g. `issuedItemId: string` (naming your call, but make it clearly distinct from `templateId` so it's obvious this is the *item* handle, not the *template* identity). Update `templateContract.ts`.
2. Update `templateValidation.ts`'s `assertValidPdfCompletionReceipt` to validate this new field's presence and format (it's the same opaque handle format Lane 1 already validates elsewhere for `item_id` — reuse that pattern/regex, don't invent a new one).
3. Update Lane 3's `preparePdfFillSubmission` (`intake-page/src/pdfFill/preparePdfFillSubmission.ts`) to populate this field with the actual `item.item_id` it's building the submission for when it constructs the receipt.
4. Update Lane 4's verification path — `pdfFillReceipt.ts`'s `verifyPdfFillReceipt` (or wherever the receipt-vs-descriptor check lives) needs to also receive the **expected** item handle (the one the submission actually arrived under, i.e. `submission.itemId`) and assert `receipt.issuedItemId === expectedItemId`, failing closed (same `integrity_mismatch` pattern as every other check in this function) if they don't match. Wire this through from `routePdfFillSubmission` in `useIntakeInboxSync.ts`, which already has `submission.itemId` in scope.
5. Fix the existing "integrity-flags..." test's wrong-handle case in `pdfFillContract.test.ts` so it actually tests same-template, different-item rejection: build two items in one standing request referencing the **identical** approved template (same `templateId`/`version`/`sourceSha256`), complete a submission genuinely for item A's handle (real `issuedItemId` from item A), then attempt to route it under item B's `item_id`/descriptor, and assert it's rejected with the item flagged `needs_followup` and left unacknowledged — not accepted. Keep the existing different-template case too (it's a legitimate, separate test case), just make sure the sibling-item case is now real and distinct from it.

## Non-negotiables (unchanged, restated because P1b touches the security-critical receipt contract)

- Fail closed: an ambiguous or mismatched item-handle binding is always `integrity_mismatch`, never silently accepted.
- The relay must still never see any of this — `issuedItemId` travels the same way the rest of the receipt already does (sealed inside the encrypted manifest, never relay-visible metadata). Verify this with the same wire-inspection discipline `pdfFillContract.test.ts`'s existing tests already use.
- No em dash in any comment or string you add.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 120 npx vitest run src/platform/intake/pdfTemplateStore.test.ts src/platform/intake/pdfTemplates src/platform/intake/__tests__/pdfFillContract.test.ts src/platform/intake/pdfFillReceipt.test.ts src/platform/intake/useIntakeInboxSync.test.ts
timeout 300 npx vitest run src/platform/intake src/features/intake --test-timeout=20000
timeout 300 npm --prefix intake-page test
timeout 120 npm --prefix intake-page run typecheck
timeout 120 npx tsc --noEmit
timeout 300 node scripts/eslint-gate.mjs
timeout 60 node scripts/ui-system/token-guard.mjs
```

`tsc --noEmit` must stay completely clean (it currently is). `eslint-gate` must report zero new findings (it currently does). Do not run `npm run gate` or anything touching Rust/cargo — this fix is TS-only, no Rust changes needed for either P1.

## Self-converge requirement

Do not stop and report partial progress as your finishing state. This is core-product security-relevant work — get both fixes fully correct and fully tested, not a quick patch. If you find the fix requires touching a file outside what's named above, that's fine as long as it's the minimal correct change — note exactly what and why in your final report.

## Finish

Commit on `lp/intake-w8-review-r1-fixes` with a conventional message containing the phrase `W8-REVIEW-R1-FIXES`. Do NOT push. Do NOT merge. In your final report: confirm both P1s are fixed, list the exact new/changed field name (`issuedItemId` or whatever you named it) and every file that now reads/writes it, confirm the new same-template sibling-item rejection test is real (not a placeholder) and passes, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
