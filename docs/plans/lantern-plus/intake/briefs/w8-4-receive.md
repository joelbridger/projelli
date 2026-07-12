# Wave 8 Lane 4 — Advisor Receive, Verify, File, and Requests Visibility

**Branch:** `lp/intake-w8-receive`, branched off `lp/intake-w8` at `6a9c9850` (Lane 1 merged). Confirm with `git log --oneline -3` before starting.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Goal (one paragraph)

When a client returns a completed PDF, the advisor app must decrypt it, independently verify it (not just trust the client's claimed receipt), file it in exactly the right local folder, and only then acknowledge the relay so nothing is lost or double-counted. `routeIntakeSubmission` (`src/platform/intake/useIntakeInboxSync.ts:408-430`) currently dispatches only `typed_field`/`guided_question` (JSON) and `doc_upload` (file) submissions; anything else, including `pdf_fill`, falls through to `failNeedsFollowup(..., 'This request item cannot receive submissions.', 'integrity_mismatch')`. Your job is to add a dedicated `pdf_fill` branch that mirrors the existing `routeFileSubmission` pattern but adds PDF-specific verification: recompute the completed hash, confirm it matches the sealed receipt and the locally-stored template descriptor (which Lane 1 already persists via the keychain, keyed by `intakeId`+`item_id`), confirm the bytes are actually a safe, flattened, non-interactive PDF, and file the result under `Requests/<request-slug>/forms/` — never trusting any of this from the decrypted client JSON, because there isn't any: the whole point of this route is that everything expected is derived from the local `RequestItem` descriptor, not the submission body.

Read `/home/jameson/lantern-coordination/prep/W8-PREP.md` in full (§6 Lane 4 section, §3 non-negotiables, §9 required synthetic bench) before starting.

## Non-negotiables (a reviewer will check these)

- The `pdf_fill` route derives every expected setting (template hash, field map, max size, output folder, request slug) from the **local** `RequestItem`/keychain-stored descriptor — it accepts no JSON facts, no multiple files, no field-level JSON, no client-supplied output path, no client-supplied `matter_id`, and no file addressed to another request's handle. This mirrors exactly how `routeFileSubmission` already trusts nothing from the client body for MIME/size limits — apply the same discipline here, one level stricter (PDF safety, not just MIME string matching).
- Recompute `completedSha256` locally after decrypting bytes; never trust a client-supplied hash. Verify it against the sealed `PdfCompletionReceipt` (which travels with the encrypted submission per Lane 3's work) using Lane 1's `verifyCompletedBytesAgainstReceipt`, and separately verify the receipt itself agrees with the template descriptor you load from the local keychain (Lane 1's `loadPdfTemplateDescriptor(intakeId, itemId)`) using `verifyReceiptAgainstDescriptor` — both checks, not just one; a receipt that internally agrees with itself but doesn't match the *actual* template on file for this intake must still be rejected.
- Parse the decrypted bytes safely: confirm a valid PDF header/structure, confirm the output is genuinely flattened (no remaining interactive `/AcroForm` fields), reject any PDF JavaScript/launch action/embedded attachment/signature widget, and enforce the descriptor's `maxOutputBytes` (Lane 1's verification helper already does the byte-length check — you still need the PDF-structure-safety check, which is new work for this lane).
- File the verified bytes under `Requests/<request-slug>/forms/` **only after every check passes**, using a code-generated safe output filename — never a client-supplied filename, never an advisor label, never anything derived from field values or the template's real title.
- A failed verification or filing leaves the submission **unacknowledged**, flags the request item `needs_followup` (mirror `failNeedsFollowup`'s existing pattern exactly), and preserves retry — never silently file a partial or wrong-client form. Follow the standard `IntakeSyncClient` order already established elsewhere in this file: decrypt and verify, route and durable-write, remember submission, **then** acknowledge — do not acknowledge before the local write succeeds.
- An active onboarding request and a standing `pdf_fill` request for the same `matterId` stay fully isolated — the PDF request must never be able to write beneath `Requests/onboarding/`, and vice versa.
- Request-board status for a `pdf_fill` item may say only "Form ready" / "Form returned" / "Needs follow-up" — **never** "Signed" (that's Wave 9 plus a compliance review, not this lane) — and never expose field names, values, document text, template hash, or the raw output filename in any UI list/label.
- No em dash in any advisor-facing copy you write.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `src/platform/intake/useIntakeInboxSync.ts` — add a `routePdfFillSubmission` function mirroring `routeFileSubmission` (read it in full first, lines ~323-364) and wire it into `routeIntakeSubmission`'s dispatch (lines ~408-430) as a new arm alongside the existing `typed_field`/`guided_question`/`doc_upload` arms, keyed on `item.t === 'pdf_fill'`. The existing dispatch structure is a nested ternary — match its style rather than restructuring it into something else, unless the ternary genuinely becomes unreadable with a fourth arm, in which case a small refactor to an explicit `switch`/lookup is fine, but keep the existing three arms' *behavior* byte-for-byte identical if you do that.
- `src/platform/intake/intakeFiling.ts` — add `intakePdfFormFolder(matterFolderPath: string, requestSlug: string): string` alongside the existing `intakeOnboardingFolder`/`intakeRequestFolder` (lines 26-32), built from `intakeRequestFolder` plus a fixed `/forms` segment. Mirror this file's existing delegation pattern exactly — it doesn't do its own path-traversal check today; `WorkspaceService`'s `pathValidator` handles that downstream, keep relying on that, don't add a second traversal check that could drift from it.
- `src/platform/intake/intakeStore.ts` — only if you need a new `IntakeFlag.kind` value for a PDF-specific integrity failure that the existing union doesn't already cover (check the existing `IntakeFlag.kind` union first — `integrity_mismatch`/`routing_failed` likely already cover everything you need; only add a new variant if you hit a case those two genuinely can't express, and say so explicitly in your report).
- `src/features/intake/RequestsBoard.tsx`, `src/features/intake/ClientRequestsTab.tsx` (or wherever the actual request-row status rendering lives — verify the real component name/path before editing, don't assume the prep doc's filenames are exactly right) — add the "Form ready" / "Form returned" / "Needs follow-up" status display for a `pdf_fill` item, without exposing any sensitive detail.

**Create:**
- `src/platform/intake/pdfFillReceipt.ts` — the receiver-side verification orchestration: load the local template descriptor via Lane 1's `loadPdfTemplateDescriptor`, recompute and verify the completed hash via Lane 1's `verifyCompletedBytesAgainstReceipt`/`verifyReceiptAgainstDescriptor`, parse and structurally verify PDF safety (flattened, no active content, no signature widget, no attachments — this structural check is new work owned by this file, Lane 1 only built the hash/byte-length side). Naming your call for internal helpers, but the file itself should exist at this path since the wave prep pack and Lane 1's cross-lane test reference `pdfFillReceipt.test.ts` at this location.

**Create (tests):**
- `src/platform/intake/pdfFillReceipt.test.ts`
- Extend `src/platform/intake/useIntakeInboxSync.test.ts` with the `pdf_fill` routing cases (see Acceptance tests below)
- A new Requests UI test for the status display (find and follow the existing test pattern for request-row status in whatever board/tab test file already covers `doc_upload`/`typed_field` status rows)

Nothing else. Do not touch Lane 1's files (`types.ts`, `createIntake.ts`, `intakeKeychain.ts` beyond calling its existing exports, `pdfTemplates/templateContract.ts`, `pdfTemplates/templateValidation.ts`, `pdfTemplates/receipt.ts`), Lane 2's files (`RequestFromClientDialog.tsx`, `pdfTemplateStore.ts`, anything under `src/features/intake/pdfTemplates/`), or Lane 3's files (anything under `intake-page/`). Import from Lane 1's exports, don't edit them. If you find a genuine bug in a Lane 1 file, stop and report it rather than patching it yourself.

## What Lane 1 already gives you (real exports, verified against the merged code)

From `src/platform/intake/types.ts`:
- `PdfTemplateDescriptor`, `PdfFieldMap`, `PdfFieldMapEntry`, `PdfFieldType`, `PdfCompletionReceipt`, `PdfFillRequestItem`.

From `src/platform/intake/pdfTemplates/receipt.ts`:
- `sha256Hex(bytes: Uint8Array): Promise<string>`
- `verifyCompletedBytesAgainstReceipt(completedBytes: Uint8Array, receipt: PdfCompletionReceipt, descriptor: PdfTemplateDescriptor): Promise<void>` — throws on hash mismatch **or** if `completedBytes.byteLength > descriptor.maxOutputBytes` (size checked before hash, so a failure message will tell you which). This is Node/Tauri-safe too (Web Crypto `globalThis.crypto.subtle`, no browser-only APIs), so it runs fine on the advisor desktop side.

From `src/platform/intake/pdfTemplates/templateValidation.ts`:
- `assertValidPdfCompletionReceipt(value): asserts value is PdfCompletionReceipt`
- `verifyReceiptAgainstDescriptor(receipt: PdfCompletionReceipt, descriptor: PdfTemplateDescriptor): void` — throws if the receipt's `templateId`/`templateVersion`/`sourceSha256` don't match the descriptor. **Call this in addition to** `verifyCompletedBytesAgainstReceipt` — one checks receipt-vs-bytes, the other checks receipt-vs-descriptor; you need both, since a receipt could internally match its own claimed bytes while lying about which template it belongs to.

From `src/platform/intake/intakeKeychain.ts` (Lane 1's fix-round addition):
- `loadPdfTemplateDescriptor(intakeId: string, itemId: string): Promise<PdfTemplateDescriptor | null>` — this is how you get the full descriptor back at routing time; the copy in `IntakeRecord.requestItems` is deliberately redacted to just `{ templateId, version, kind }` for local-storage-privacy reasons (Lane 1's P1 fix), so **you must call this**, not read `item.template` directly expecting the full shape — `item.template` on the in-memory `requestItems` array only has the redacted stub. Returns `null` if nothing is stored (treat this as an integrity failure — flag and leave unacknowledged, per the fail-closed non-negotiable, do not treat `null` as "no template needed").

From `src/platform/intake/useIntakeInboxSync.ts` (existing, unchanged by Lane 1 — read these before writing your new branch):
- `contractItemOrFail`, `currentChecklistItem`, `failNeedsFollowup`, `markSubmissionNeedsFollowup`, `concatBytes` — reuse these exactly as `routeFileSubmission` does.

## Deliverables

1. **`routePdfFillSubmission`** in `useIntakeInboxSync.ts`: reject a JSON body (mirror `routeFileSubmission`'s existing MIME check), reject more than one file, reject a MIME type other than `application/pdf` (there's no configurable `accepted_mime_types` for `pdf_fill` — it's always exactly `application/pdf`, unlike `doc_upload`), load the descriptor via `loadPdfTemplateDescriptor`, verify via `pdfFillReceipt.ts`'s orchestration (hash, receipt-vs-descriptor, PDF structural safety), enforce `maxOutputBytes`, require `options.intake.requestSlug`, file via the new `intakePdfFormFolder` + `fileIntakeDocument` (or a `pdf_fill`-specific filing call if the generic `fileIntakeDocument` signature doesn't fit — check its signature first, it currently takes `requestSlug` directly, so you likely just need to pass a `forms`-suffixed slug or extend the folder-only helper — your call, but don't fork `fileIntakeDocument` itself if a folder-path composition is enough).
2. **`pdfFillReceipt.ts`**: the verification orchestration described above, including the new PDF-structural-safety check (flattened, no active content, no signature widget, no attachments) — this is real new logic, not just calling Lane 1's helpers; use whatever PDF-parsing capability is already available in this codebase for `documentDetective`/OCR features (check `src/platform/intake/documentDetectiveTypes.ts` and nearby files for an existing PDF-parsing dependency before reaching for a new one) or `pdf-lib` if nothing existing fits (it's already going into `intake-page`'s dependencies via Lane 3; check if the root `package.json` needs it too for this to run on the advisor desktop side).
3. **`intakePdfFormFolder`** in `intakeFiling.ts`.
4. **Requests-board status** for `pdf_fill`: "Form ready" (issued, not yet returned), "Form returned" (filed successfully), "Needs follow-up" (any rejection case) — find the real status-rendering logic and item-kind switch already used for `doc_upload`/`typed_field` rows and extend it the same way, don't build a parallel status system.
5. **Isolation guarantee**: verify explicitly (with a test, not just by inspection) that a `pdf_fill` route can never resolve to `Requests/onboarding/` and an onboarding-kind request's `requestSlug` handling is completely unaffected by this lane's changes.

## Acceptance tests (full list)

- `pdfFillReceipt.test.ts`: accepts a valid completed PDF + matching receipt + matching descriptor; rejects hash mismatch, oversize, receipt/descriptor mismatch (right hash, wrong template), a PDF with remaining interactive AcroForm fields, a PDF with embedded JavaScript/launch action/attachment, a PDF with a signature widget, an unparseable/malformed PDF, `null` descriptor (nothing stored locally for this intake+item — treat as integrity failure, not as "skip verification").
- `useIntakeInboxSync.test.ts` additions: `pdf_fill` submission routes correctly end-to-end for a valid case and files under `Requests/<slug>/forms/`; rejects JSON body for a `pdf_fill` item; rejects a non-`application/pdf` MIME; rejects multiple files; rejects a submission whose `intakeId` doesn't match the item's owning record (cross-request, mirror the existing cross-request test pattern for other item types); rejects an unknown/wrong `item_id`; rejects a changed template hash; rejects a duplicate/replayed submission (idempotency — filing the same valid submission twice doesn't create two files or double-file); every rejection case leaves the item `needs_followup` and the relay submission unacknowledged (verify this the same way existing `doc_upload` rejection tests already verify it).
- Isolation test: an active onboarding request and a standing `pdf_fill` request for the same `matterId` produce distinct folders; a `pdf_fill` route attempt with a manipulated/mismatched request context cannot write beneath `Requests/onboarding/`.
- Requests UI test: `pdf_fill` status renders correctly, is scoped to the right request row, never shows "Signed", never leaks field names/values/template hash/raw filename; existing board filtering/status tests for other item types remain green.
- Regression: existing `useIntakeInboxSync.test.ts` cases for `typed_field`/`guided_question`/`doc_upload` unchanged in behavior and still passing.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes. If you hit a design question not answered by this brief or `W8-PREP.md`, make the most conservative choice (fail closed on any ambiguity, never acknowledge before a successful durable write, never trust anything from the decrypted client body beyond raw bytes) and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every test invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/platform/intake/pdfFillReceipt.test.ts src/platform/intake/useIntakeInboxSync.test.ts src/platform/intake/intakeFiling.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

(If `intakeFiling.test.ts` doesn't exist yet, check whether filing behavior is tested elsewhere — e.g. inline in `useIntakeInboxSync.test.ts` or `requestFiling.test.ts` from Wave 7 — and add your `intakePdfFormFolder` cases to whichever file already owns this, rather than assuming a new file is needed.)

Do not run `npm run gate` or anything touching Rust/cargo — this lane makes no Rust changes, and cargo is a shared box-wide lock other lanes may be using concurrently.

## Finish

Commit on `lp/intake-w8-receive` with a conventional message containing the phrase `W8-LANE4-RECEIVE`. Do NOT push. Do NOT merge. Report exact check results (pass/fail, counts), the exact export names/signatures for `intakePdfFormFolder` and your `pdfFillReceipt.ts` orchestration function (the wave-end cross-lane gate test needs these exact names), confirm the `IntakeFlag.kind` union either already covered your cases or list the new variant you added and why, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
