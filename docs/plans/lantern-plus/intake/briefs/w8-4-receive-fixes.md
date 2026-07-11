# Wave 8 Lane 4 — Fix Round (from adversarial codex-review)

**Branch:** `lp/intake-w8-receive` (same branch, new commit on top of `013d7cef`).
**You are Codex, the builder.** Fix these three findings, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

An independent adversarial review (`codex-review --base lp/intake-w8`) of your Lane 4 diff found three real issues. Fix all three.

## Finding 1 [P1] — PDF name-escaping evades the active-content scan

`src/platform/intake/pdfFillReceipt.ts:82-84` (`containsActivePdfNames`, using `ACTIVE_PDF_NAME` regex): PDF name syntax allows any byte to be escaped as `#XX` hex (e.g. `/Launch` can be legally written as `/#4c#61#75#6e#63#68`). Your raw-byte regex scan doesn't decode PDF name escapes before matching, so an attacker can trivially bypass it. Your later PDF.js-based checks (`getAttachments`, `getJSActions`/`hasJSActions`, `getFieldObjects`, per-page annotations) don't cover catalog-level or page-level **launch actions** (`/Launch`, `/GoToR`, `/URI`, `/SubmitForm`, `/ImportData`) at all — they check JS, attachments, form fields, and annotation actions, but not the document's own action dictionaries. A completed PDF with an escaped launch action can pass every current check and get filed for the advisor to open.

**Fix:** don't rely on the raw-text regex as your primary defense — it's inherently evadable by design (PDF name escaping is standard, valid syntax, not an edge case). Use PDF.js's parsed structure to inspect action dictionaries properly: walk the document catalog's `/OpenAction` and any page/annotation `/AA` (additional actions) and `/A` (action) entries for `/Launch`, `/GoToR`, `/URI`, `/SubmitForm`, `/ImportData` action subtypes, after PDF.js has already decoded name escapes for you (check what API surface `pdfjs-dist` exposes for this — `PDFDocumentProxy`/`PDFPageProxy` have annotation and action accessors; you may need to go slightly deeper than the `getAnnotations({ intent: 'display' })` call you already use, since display-intent may not surface every action type — check `intent: 'any'` or the raw annotation objects' `action`/`resetForm`/`url` fields). Keep the raw-text regex as an additional defense-in-depth layer (it still catches unescaped occurrences cheaply), but it must not be the only check for this attack class.

**Test:** a fixture PDF with an escaped launch/URI/submit action (name-escaped so the raw regex alone would miss it) is rejected by `assertSafeFlattenedPdf`.

## Finding 2 [P1] — A `pdf_fill` item on an onboarding intake can file into `Requests/onboarding/forms`

`src/platform/intake/useIntakeInboxSync.ts:406-410` (`routePdfFillSubmission`): it uses `options.intake.requestSlug` directly to build the target folder via `intakePdfFormFolder`. For an **onboarding**-kind `IntakeRecord`, `requestSlug` is `'onboarding'` — so if an onboarding intake ever somehow carries a `pdf_fill` item (whether that should be possible by product design or not, the receiver must not trust that it can't happen), this resolves to `Requests/onboarding/forms`, directly violating the wave's explicit, repeated non-negotiable: **a PDF-fill request must never write beneath `Requests/onboarding/`.**

**Fix:** in `routePdfFillSubmission`, explicitly reject (via `failNeedsFollowup`, `integrity_mismatch`) any submission where `options.intake.kind !== 'standing'` (check the exact field name on `IntakeRecord` — `kind`, per Wave 7's contract — before assuming; read `intakeStore.ts` if you need to confirm), **before** attempting to compute a folder or file anything. A `pdf_fill` item has no legitimate reason to exist on an onboarding-kind request in the current design — treat its presence there as an integrity failure, not a routable case.

**Test:** construct (or reuse an existing test helper for) an onboarding-kind `IntakeRecord` with a `pdf_fill` item present in `requestItems` (simulating either a bug elsewhere or a manipulated/replayed state), route a valid-looking PDF submission against it, and assert it's rejected with no file written beneath `Requests/onboarding/` and the item flagged `needs_followup`.

## Finding 3 [P2] — Operational failures during PDF routing bypass `failNeedsFollowup`

`src/platform/intake/useIntakeInboxSync.ts:400-415`: if `loadPdfTemplateDescriptor` (keychain read), the `options.workspaceService` check, or `fileIntakeDocument`'s durable write throws for an operational reason (locked keychain, closed workspace, full disk, permission error — not a client-integrity problem), the error propagates raw instead of going through `failNeedsFollowup`. The brief's non-negotiable is explicit: "A failed verification or filing leaves the submission unacknowledged, flags the request item `needs_followup`... never silently file a partial or wrong-client form" — but as written, an operational failure leaves the checklist item stuck at `not_started` with no visible flag, which looks identical to "never received" rather than "something needs attention," even though `IntakeSyncClient` does still leave it unacknowledged.

**Fix:** wrap the keychain read, workspace/requestSlug checks, and the durable write in the same `failNeedsFollowup` pattern the rest of this function (and `routeFileSubmission`) already uses for client-integrity failures — the distinction between "client sent something wrong" and "our own local write failed" doesn't change the required outcome (unacknowledged + `needs_followup`), so route both through the same mechanism rather than letting operational errors take a different, silent path.

**Test:** simulate `options.fileDocument` (or `loadPdfTemplateDescriptor`, or a missing `workspaceService`) throwing an operational error for an otherwise-valid submission, and assert the item is flagged `needs_followup` and the submission is left unacknowledged, matching how an integrity failure is already tested.

## Checks to run (same suite as the original brief; report exact pass/fail)

```
timeout 300 npx vitest run src/platform/intake/pdfFillReceipt.test.ts src/platform/intake/useIntakeInboxSync.test.ts src/platform/intake/requestFiling.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo.

## Finish

Commit on `lp/intake-w8-receive` with a conventional message containing the phrase `W8-LANE4-RECEIVE-FIXES`. Do NOT push. Do NOT merge. In your final report: confirm all three findings are fixed, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
