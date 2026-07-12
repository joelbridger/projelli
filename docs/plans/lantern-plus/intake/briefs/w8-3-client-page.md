# Wave 8 Lane 3 — Client PDF Renderer, Editor, and Encrypted Return

**Branch:** `lp/intake-w8-client-page`, branched off `lp/intake-w8` at `6a9c9850` (Lane 1 merged). Confirm with `git log --oneline -3` before starting.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Goal (one paragraph)

`intake-page` is the public, unauthenticated page a client opens from their secure link. Today it handles `typed_field`, `doc_upload`, and `guided_question` items (`isActionable()` in `App.tsx:64-66`); any other item type — including `pdf_fill` — falls through to a generic "not ready yet" screen with no way to complete it (`ItemInputScreen`, `App.tsx:772-796`). Your job is to make `pdf_fill` a real, actionable item type entirely in the browser: verify the sealed template's hash, render the source PDF with PDF.js, collect values through Lantern's own accessible inputs, flatten the completed PDF locally with `pdf-lib`, and submit it through the exact same encrypted upload path (`submitAnswer` in `submission.ts`) every other item already uses. The relay must never see plaintext PDF bytes, field values, or the template's hash/name — only ciphertext, exactly as it already works for `doc_upload`.

Read `/home/jameson/lantern-coordination/prep/W8-PREP.md` in full (§2 "Chosen PDF-fill approach", §6 Lane 3 section, §7 privacy checklist) before starting.

## Non-negotiables (a reviewer will check these)

- The public page makes **no network request beyond the existing Lantern intake relay traffic and bundled static assets from the same hosted page.** No custodian URL, no CDN, no remote PDF worker, no analytics, no external font, no DocuSign call, no AI provider call. `pdfjs-dist` is already a **root** dependency (not yet in `intake-page`) — you must bundle its worker and any fonts locally in the `intake-page` build, not load them from a CDN (this is the single most common way a PDF.js integration accidentally makes an external request — check this explicitly, don't assume the default config is safe).
- The sealed source PDF bytes arrive through the existing checklist mechanism (however the checklist reaches this page today for other item types — trace it, don't invent a new channel). Before rendering, verify the decrypted source bytes against `descriptor.sourceSha256` using Lane 1's `verifySourceBytesAgainstDescriptor` (`src/platform/intake/pdfTemplates/receipt.ts`) — do this again immediately before finalization, not only once at load. Render only this sealed snapshot; never fetch a "current" version of the template from anywhere.
- The PDF is filled and flattened **in the browser, before any upload.** No readable final PDF or field-value-only payload is ever sent to any server for writing.
- The completed PDF is submitted as **exactly one `application/pdf` file** through the existing `submitAnswer`/chunk-encryption/manifest-sealing path (`intake-page/src/submission.ts`) with a **generic, code-generated filename** — never the template's real name, never anything derived from field values.
- The sealed `PdfCompletionReceipt` (Lane 1's type, `src/platform/intake/pdfTemplates/templateContract.ts`) travels with the encrypted submission as sealed content, never as relay-visible manifest metadata.
- The editable in-progress draft (field values as the client types them) is never written to plain `localStorage`, plain resume state, or logged anywhere. If you persist draft progress across a reload, it must go through the same encrypted resume-state mechanism `App.tsx`'s existing `saveResume`/`resume` already uses for other item types — read that mechanism first, reuse it, don't build a second one.
- No cleartext browser download or print is the normal flow for v8 (W8-PREP §10.4 — Jameson's explicit recommendation: no, ship the "send to advisor" flow only). Don't add a download button.
- Treat the source PDF as hostile input: never execute embedded JavaScript, launch actions, or calculation scripts from it; enforce a page-count/size limit before rendering and before writing, so a malicious or malformed form can't exhaust the client's device.
- Before submit, validate: all required fields, allowed choices, number/date/money syntax, the overlay fit rule (wrap where the form allows, otherwise **stop and tell the client to contact the advisor** — per W8-PREP §10.3, never silently shrink text to fit), output MIME/size, PDF header/parseability, absence of remaining interactive AcroForm fields after flattening, absence of active content, absence of a signature widget, absence of attachments, and that the rendered source still matches the expected template hash. Fail visibly and keep the draft local if any check fails — never submit a form you can't verify.
- No em dash in any client-facing copy.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `intake-page/src/App.tsx` — add `'pdf_fill'` to `isActionable()` (line ~64-66) once your screen exists; add a `PdfFillScreen` branch to `ItemInputScreen` (line ~772-796) alongside the existing `doc_upload`/`typed_field`/`guided_question` branches, following the exact same prop-passing pattern (`item`, `firmName`, `busy`, `onSubmit`, `onSkip`, plus whatever your screen needs for resume state — check how `DocUploadScreen` receives `pendingUpload`/`relay` for its resumable-upload pattern and mirror it). Wire your screen into `handleSubmit` (line ~430-470) the same way `doc_upload`'s file payload already flows through — note `buildChunks` in `submission.ts` already has a generic `payload.kind === 'files'` branch that takes an arbitrary `File`/`Blob` array; a flattened PDF as a single `File` with `type: 'application/pdf'` can very likely go through that exact existing branch unchanged. Verify this by reading `buildChunks` (`submission.ts:50-88`) before assuming you need a new payload kind — if the generic files path truly fits, prefer reusing it over adding a new one.
- `intake-page/src/types.ts` — only if you need a `pdf_fill`-specific payload/state type addition (e.g. a `PdfFillPayload` variant of whatever `AnswerPayload` union already exists) — check the existing union first, extend it minimally, don't restructure it.
- `intake-page/src/submission.ts` — only if `buildChunks`'s existing `'files'` branch genuinely cannot carry your completed PDF (it very likely can, per the note above); if you do need a change, keep it additive and don't alter the `doc_upload` code path's existing behavior or tests.
- `intake-page/package.json` and its lockfile — add `pdf-lib` (new dependency) and `pdfjs-dist` (already approved at the root, add it here too since `intake-page` is a separate bundle). Pin compatible versions; ensure workers/fonts bundle locally, not from a CDN.
- Intake-page styles, only as needed for your new screen, following existing conventions in this directory — don't restyle anything else.

**Create:**
- `intake-page/src/pdfFill/` — your screen component (`PdfFillScreen.tsx`), the AcroForm writer, the overlay writer, the hash/safety verification calls (wrapping Lane 1's `verifySourceBytesAgainstDescriptor`/`verifyCompletedBytesAgainstReceipt`), and whatever submission-preparation helper builds the final `File`/payload for `submitAnswer`. Naming your call, keep it discoverable.

**Create (tests):**
- `intake-page/tests/pdf-fill.spec.ts` (Playwright, matching this directory's existing E2E pattern — check `intake-page/tests/` for the harness style already in use).
- Local synthetic fixtures under `intake-page/tests/fixtures/` (a small AcroForm PDF and a non-fillable/scanned-style PDF for the overlay path — synthetic, not a real custodian form).

Nothing else. Do not touch any file under `src/platform/intake/` or `src/features/intake/` (Lanes 1, 2, and 4's territory) — import Lane 1's exports, don't edit them. Do not touch any backend route.

## What Lane 1 already gives you (real exports, verified against the merged code — all importable via the `@/platform/intake/...` path alias, which `intake-page` already uses for `FormRequest`/`RequestItem`/`intakeCrypto`/`intakeContract`, confirmed in `intake-page/src/types.ts:1` and `intake-page/src/submission.ts:10-13`)

From `src/platform/intake/types.ts`:
- `PdfTemplateDescriptor`, `PdfTemplateKind`, `PdfFieldMap`, `PdfFieldMapEntry`, `PdfFieldType`, `PdfCompletionReceipt`, `PdfFillRequestItem` (`{ t: 'pdf_fill', template: PdfTemplateDescriptor, prefill: PdfPrefill[], ...RequestItemBase }`). Read `src/platform/intake/pdfTemplates/templateContract.ts` directly for the exact field-map entry shapes (acroform vs. overlay are discriminated by `kind`) before building your renderer against them.

From `src/platform/intake/pdfTemplates/receipt.ts` (all Web-Crypto based, browser-safe — verified, uses `globalThis.crypto.subtle`, no Node-only APIs):
- `sha256Hex(bytes: Uint8Array): Promise<string>`
- `verifySourceBytesAgainstDescriptor(sourceBytes: Uint8Array, descriptor: PdfTemplateDescriptor): Promise<void>` — throws `PdfTemplateValidationError` on mismatch. Call before first render and again before finalization.
- `verifyCompletedBytesAgainstReceipt(completedBytes: Uint8Array, receipt: PdfCompletionReceipt, descriptor: PdfTemplateDescriptor): Promise<void>` — also enforces `descriptor.maxOutputBytes` (checked before the hash comparison). Call this on your own flattened output before submitting, as a self-check that you built a valid receipt.

From `src/platform/intake/pdfTemplates/templateValidation.ts`:
- `assertValidPdfTemplateDescriptor`, `isValidPdfTemplateDescriptor`, `assertValidPdfCompletionReceipt`, `MAX_PDF_TEMPLATE_OUTPUT_BYTES`.

You will need to independently construct a `PdfCompletionReceipt` after flattening (fields: `templateId`, `templateVersion`, `sourceSha256`, `completedSha256`, `completedAt`, `pageVersion` — see `templateContract.ts` for exact field names) and verify it with the helpers above before handing your `File` to `submitAnswer`.

## Deliverables

1. **Dependencies:** add `pdf-lib` and `pdfjs-dist` to `intake-page/package.json`, pinned, worker+fonts bundled locally (verify this with a real network-request audit — see Acceptance tests).
2. **`PdfFillScreen`:** verifies template hash on load, renders every page with PDF.js, overlays Lantern's own accessible input controls (not a third-party PDF form widget UI) positioned per the field map (acroform fields render near their real widget position if you can derive it from the PDF, or per your own reasonable layout if not — an overlay-kind template already has exact reviewed coordinates to use directly), announces validation errors accessibly, preserves in-progress draft only through the existing encrypted resume mechanism, never logs field values.
3. **AcroForm writer:** writes only the approved mapped fields into the actual PDF form fields, generates appearances, flattens (removes interactivity), and verifies no interactive `/AcroForm` fields remain in the output.
4. **Overlay writer:** draws only the approved text/marks into page content streams at the exact reviewed coordinates; verifies output structurally (e.g. re-parse and confirm no unexpected interactive elements were introduced).
5. **Pre-submit validation:** the full checklist from the non-negotiables above, all enforced client-side before any upload begins.
6. **Submission:** produce a single `application/pdf` `File` with a generic generated filename, submit through the existing `submitAnswer` path (reusing its `'files'` payload branch if it fits, per the file-ownership note above), with the sealed `PdfCompletionReceipt` carried as part of the encrypted submission content (not relay-visible manifest metadata — check how manifest fields vs. sealed content are currently split for `doc_upload` and follow the same split).
7. **No download/print button** — v8 ships "send to advisor" only.

## Acceptance tests (full list)

- Playwright: fill a synthetic AcroForm fixture (text, date, money, checkbox, radio, select), submit, and inspect the resulting completed local PDF bytes before upload — confirm no editable Lantern-added fields remain interactive.
- Playwright: fill a synthetic non-fillable/overlay fixture, submit, confirm output structure matches the reviewed overlay map.
- Required-field and invalid-input cases block submission with an accessible error, no upload attempted.
- Long-value case: a value that doesn't fit per the field's reviewed rule either wraps (if the rule allows) or stops with a clear "contact your advisor" message — never silently truncated/shrunk.
- Reload/interrupt test: no field values appear anywhere in plain DOM-visible persistence (`localStorage`, unencrypted resume blob) at any point; the encrypted draft resumes correctly after a reload; an interrupted chunk upload resumes via the existing `fetchUploadedIndexes` mechanism (mirror however `doc_upload`'s existing resumable-upload tests already verify this).
- **Network audit test:** record every request the browser makes during the full PDF-fill flow (Playwright network interception) and assert the only hosts contacted are the existing intake relay endpoint and same-origin bundled static assets — explicitly assert zero requests to any custodian domain, any CDN, any PDF-worker CDN, any analytics endpoint, any AI provider, any DocuSign domain.
- **Relay-content audit test:** inspect what actually reaches the relay mock/fixture in this flow and assert the source PDF bytes, the completed PDF bytes, field values, the template's real name, and both SHA-256 hashes never appear in cleartext anywhere in the wire payload — only ciphertext and the existing non-sensitive manifest shape.
- Regression: existing `intake-page` Playwright suite (`typed_field`/`doc_upload`/`guided_question` flows) unaffected.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes. If you hit a design question not answered by this brief or `W8-PREP.md`, make the most conservative choice (fail closed on any hash mismatch or unparseable structure; never widen network egress; never persist a value in cleartext) and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npm --prefix intake-page test
timeout 120 npm --prefix intake-page run typecheck
timeout 300 npx playwright test intake-page/tests/pdf-fill.spec.ts --project=chromium
```

Adjust the Playwright invocation to match whatever command/project name this repo's existing `intake-page` E2E tests actually use — check `intake-page/package.json` scripts and any existing Playwright config before assuming the flags above are exact; report the real command you used if it differs.

Do not run `npm run gate` or anything touching Rust/cargo — this lane makes no Rust changes, and cargo is a shared box-wide lock other lanes may be using concurrently.

## Finish

Commit on `lp/intake-w8-client-page` with a conventional message containing the phrase `W8-LANE3-CLIENT-PAGE`. Do NOT push. Do NOT merge. Report exact check results (pass/fail, counts), list every new/changed export Lane 4 or the wave-end cross-lane test might need (especially the exact name/signature of your submission-preparation function — the wave prep pack expects something like `preparePdfFillSubmission` from `intake-page/src/pdfFill/preparePdfFillSubmission`, confirm your actual export name matches or note the difference explicitly), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
