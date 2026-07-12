# Wave 8 — Complete Lane 1's Reserved Cross-Lane Contract Gate

**Branch:** `lp/intake-w8-crosslane-gate`, branched off `lp/intake-w8` at `2e8fecca` (all four lanes merged, plus post-merge type fixes).
**You are Codex, the builder.** Complete this gate, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Context

`src/platform/intake/__tests__/pdfFillContract.test.ts` is Wave 8's mandatory release-blocking cross-lane gate (per `W8-PREP.md` §9: "Its green run is a release blocker, not an optional integration check"). Lane 1 wrote it with 4 real, passing tests and 5 `it.skip` cases marked `TODO(w8-gate)`, each naming the exact Lane 3/4 export it was waiting on. All four lanes are now merged, so every one of those exports exists. Your job: unskip all 5 cases and make each one a **real** test.

**Important finding from the wave lead's own review before dispatching this:** four of the five skipped test bodies, as currently written, are **not real integration tests** — they're placeholders that manipulate local hand-built strings/arrays and assert trivial things about themselves (e.g. `expect(flags).toEqual(invalids)` where `flags` was just built by pushing `invalids` into it two lines earlier — that always passes regardless of whether the real code works). Only the first skipped case (`preparePdfFillSubmission`) does a real dynamic import and calls actual Lane 3 code. **Do not just remove `.skip` and declare victory** — for the four placeholder cases, you need to rewrite them into real tests that exercise the actual merged code, following the exact harness pattern in `src/platform/intake/__tests__/standingRequestContract.test.ts` and `src/platform/intake/__tests__/inboxSyncContract.test.ts` (real `intakeCrypto` sealing, a hand-built mock of `getCorsSafeFetch`, real `IntakeRelayClient`/`IntakeSyncClient`, real `routeIntakeSubmission` — read both of those files in full before starting, they are your pattern to mirror, and `pdfFillContract.test.ts`'s own first four (already-real, already-passing) tests in this same file already show you the exact mocking/harness style Lane 1 set up for this specific file).

## What's actually available now (verified by the wave lead against the merged code)

- **Lane 3:** `preparePdfFillSubmission(input: { sourceBytes: Uint8Array; template: PdfTemplateDescriptor; values: Record<string, string> }): Promise<PreparedPdfFillSubmission>`, exported from `intake-page/src/pdfFill/preparePdfFillSubmission.ts`. Returns `{ pdfBytes, receipt, contentType, fileName, ... }` (check the file for the exact `PreparedPdfFillSubmission` shape — it's exported too). It verifies source bytes against the template hash, checks PDF safety, fills (AcroForm or overlay), flattens, and builds a `PdfCompletionReceipt`.
- **Lane 4:** `routeIntakeSubmission` (already imported by `inboxSyncContract.test.ts` — same import path) now has a `pdf_fill` branch (private `routePdfFillSubmission`, called internally — you test through the public `routeIntakeSubmission`, same as every other item type in `inboxSyncContract.test.ts`). It rejects: JSON body, non-`application/pdf` MIME, more than one file, an onboarding-kind intake (added in Lane 4's fix round — `options.intake.kind !== 'standing'` is checked first), and any verification/filing failure via `pdfFillReceipt.ts`'s `verifyPdfFillReceipt` (hash mismatch, receipt/descriptor mismatch, unsafe PDF structure, oversize). On success it files via `intakePdfFormFolder(matterFolderPath, requestSlug)` (exported from `src/platform/intake/intakeFiling.ts`, returns `Requests/<slug>/forms`) + `fileIntakeDocument`.
- **Lane 1 (this file's own contract):** `loadPdfTemplateDescriptor(intakeId, itemId)` from `intakeKeychain.ts` is how the receiver recovers the full descriptor (the in-memory `IntakeRecord.requestItems` copy is deliberately redacted to `{templateId, version, kind}` only — you must call `loadPdfTemplateDescriptor` to get the full thing, exactly as `routePdfFillSubmission` itself does).

## The 5 cases to make real

### 1. `fills a sealed source locally, flattens it, and seals a receipt with the encrypted PDF submission` (currently the one real case, via dynamic import)

Already correct in spirit. Verify it still passes as-is now that the import path resolves for real (it was skipped before because the file may not have existed at Lane 1 dispatch time — it does now). If the dynamic-import approach (`await import(/* @vite-ignore */ modulePath)`) is awkward now that the module reliably exists, you may switch to a normal static `import { preparePdfFillSubmission } from '../../../../intake-page/src/pdfFill/preparePdfFillSubmission'` at the top of the file if that's cleaner and this test file's build setup allows importing across the `intake-page/` boundary (check whether `inboxSyncContract.test.ts` or any other existing test already imports something from `intake-page/` for precedent — if nothing does, the dynamic-import approach may be there specifically because static cross-package imports aren't set up; investigate before changing it, and keep the dynamic-import approach if a static import doesn't resolve cleanly).

### 2. `decrypts, verifies, files only beneath the matching request forms folder, then acknowledges`

Rewrite as a real end-to-end test: issue a standing PDF-fill request via `createAdvisorIntake` (mirror the file's own first two tests for this setup), build a real completed submission (call `preparePdfFillSubmission` with a real synthetic source PDF fixture — check `standingRequestContract.test.ts`/`inboxSyncContract.test.ts` for how they build synthetic file fixtures, or check if Lane 3's own Playwright tests have a reusable minimal-PDF fixture you can inline), route it through the real `routeIntakeSubmission` (mocking/driving whatever `IntakeSyncClient`/inbox-sync harness `inboxSyncContract.test.ts` already uses for `doc_upload` file submissions — mirror that exactly for this `pdf_fill` case), and assert: the returned `filePath` is under `Requests/<the-real-generated-slug>/forms/`, the submission ends up acknowledged (however this file's existing tests already assert acknowledgement — mirror that), and the local template descriptor loaded via `loadPdfTemplateDescriptor` matches what was used.

### 3. `integrity-flags changed hashes, wrong handles, non-PDF payloads, multiple files, active forms, and receipt mismatches`

Rewrite as a real parameterized (or sequential) test: for each of the 9 named cases (`changed-template-hash`, `wrong-opaque-handle`, `json-payload`, `non-pdf-mime`, `multiple-files`, `interactive-pdf`, `active-content`, `receipt-hash-mismatch`, `other-request`), construct a real malformed submission (start from a valid one built the same way as case 2, then corrupt exactly the one property each case name implies) and route it through the real `routeIntakeSubmission`. Assert each is rejected (throws, or however this file's existing tests already assert rejection — check the file's own patterns), the item ends up flagged `needs_followup` (check `inboxSyncContract.test.ts` for how it asserts flag state after a rejection), and the submission is never acknowledged. If constructing a genuinely "interactive PDF" or "active content" fixture is impractical with available tooling in this test environment, at minimum cover the cases you can construct directly (hash/handle/JSON/MIME/multiple-files/receipt-mismatch/cross-request) and clearly note in your final report which of the 9 you covered vs. couldn't construct and why — do not silently drop cases without saying so.

### 4. `keeps an onboarding request isolated from a same-matter PDF-fill request`

Rewrite as a real test: create both an onboarding intake and a standing `pdf_fill` intake for the *same* `matterId`, route a valid file submission to each, and assert their `filePath`s land in genuinely different folders — critically, also add the case Lane 4's own fix round specifically hardened against: attempt to route a `pdf_fill`-shaped submission against the **onboarding** intake record directly (an onboarding-kind `IntakeRecord` that somehow has a `pdf_fill` item in its `requestItems`, simulating manipulated/unexpected state) and assert `routeIntakeSubmission` rejects it before ever computing a folder path (this exercises the `options.intake.kind !== 'standing'` guard Lane 4 added — see `useIntakeInboxSync.ts`'s `routePdfFillSubmission`, the `kind !== 'standing'` check near the top).

### 5. `inspects create, chunk, manifest, and inbox wires for every prohibited PDF plaintext`

Rewrite as a real test: drive a full real round trip (issue → `preparePdfFillSubmission` → real chunk upload via the mocked relay fetch (mirror exactly how this file's own first test, `seals an approved immutable template...`, inspects `fetchMock.mock.calls` for the create call — extend the same inspection to the chunk-upload and manifest-seal calls) → `routeIntakeSubmission`), and after the full flow, grep every captured wire body (create, every chunk upload, the manifest, and the decrypted-side inbox handoff if that's separately inspectable) for every forbidden plaintext string this file's existing skipped placeholder already enumerates: the real source PDF bytes, the real completed PDF bytes, field values, the template's real name/label, both SHA-256 hashes, the template ID, the output filename, the logical item ID, and the clear `matter_id`. This is the most involved of the five — it's meant to be, per Lane 1's brief ("Full serialized-wire inspection... needs Lanes 3 and 4 to exist so there's a real round trip to inspect").

## Non-negotiables (unchanged from the rest of the wave, restated because this is the file that verifies them)

- `matter_id`, the real template hash/name/artifact-ref, field names/values, and the readable output filename must never appear in any relay-visible wire body — verify this by inspecting actual serialized strings, not TypeScript object shapes.
- A rejected/invalid submission must never be acknowledged and must always leave the item `needs_followup`.
- A `pdf_fill` submission must never be filed beneath `Requests/onboarding/`.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 300 npx vitest run src/platform/intake/__tests__/pdfFillContract.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake src/features/intake --test-timeout=20000
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

`tsc --noEmit` must come back completely clean (this integration branch is currently at zero errors — do not reintroduce any). The `--test-timeout=20000` on the broader suite run accounts for known CPU-contention flakiness on this box under load, already diagnosed by the wave lead as not a real issue — if your new tests themselves are slow (real crypto + real PDF fill/parse can be), it's fine, just make sure they're correct.

## Self-converge requirement

Do not stop and report a "5/5 unskipped, tests pass" state if any of them are still placeholder assertions that don't actually exercise the real merged code — that defeats the entire purpose of this gate, which exists specifically to catch cross-lane integration bugs before release. If you find a REAL bug in Lane 3's or Lane 4's merged code while writing these tests (this is exactly the kind of thing this gate is designed to surface), do not silently work around it in the test — fix the real bug if it's a small, clearly-scoped fix within `intake-page/src/pdfFill/` or `src/platform/intake/`'s already-merged files, or if it's a bigger design question, stop and report it clearly in your final message rather than guessing.

## Finish

Commit on `lp/intake-w8-crosslane-gate` with a conventional message containing the phrase `W8-CROSSLANE-GATE`. Do NOT push. Do NOT merge. In your final report: confirm each of the 5 cases is now a real test (not a placeholder), note any of the 9 integrity-flag sub-cases you couldn't construct and why, note any real bug you found and fixed (or flagged) in Lane 3/4's code, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed, all 5 cases are real (not placeholders), and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
