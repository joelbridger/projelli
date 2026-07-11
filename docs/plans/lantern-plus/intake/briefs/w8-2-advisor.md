# Wave 8 Lane 2 — Advisor Template Library and Request Composer

**Branch:** `lp/intake-w8-advisor`, branched off `lp/intake-w8` at `6a9c9850` (Lane 1 merged). Confirm with `git log --oneline -3` before starting.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Goal (one paragraph)

An advisor needs to import a real PDF form (e.g. a downloaded Schwab form), review and map its fields (or, for a scanned/non-fillable form, place an overlay), approve an immutable version, and then attach that approved template to an existing-client request the same way they already attach `typed_field`/`doc_upload`/`guided_question` items. Lane 1 already built the immutable `PdfTemplateDescriptor` contract, its strict validator (`assertValidPdfTemplateDescriptor`), the `assertSendableRequest`/`assertValidRequestBlueprint` guards that only let an approved template out the door, and a keychain-backed store for keeping the descriptor's sensitive fields out of plaintext persistence. Your job is everything upstream of that: the advisor-only local template library (import, hash, inspect, map, preview, approve) and wiring `RequestFromClientDialog` to let an advisor pick an approved template and add it as a `pdf_fill` item to a request.

Read `/home/jameson/lantern-coordination/prep/W8-PREP.md` in full (§2 "Chosen PDF-fill approach", §6 Lane 2 section, §10 open questions) before starting. Jameson's recommendations from §10, already approved to proceed on: (1) build the mechanism plus one or two low-risk sample templates for the starter library (not account-transfer/wire/discretionary-authority forms) — he'll pick the real library later; (2) v8 ships with blank fields, no visible prefill; (3) long answers wrap where the form allows, otherwise the client is told to contact the advisor directly, never silently shrunk.

## Non-negotiables (a reviewer will check these)

- No custodian URL, external site, or remote address is ever saved as a template's rendering source. The advisor imports actual local file bytes; `sourceArtifactRef` (Lane 1's field) points at an encrypted local/sealed artifact only, never a URL — Lane 1's validator already enforces this shape-wise, but your import code must never construct one that violates it.
- Hash the imported PDF locally (Web Crypto `SHA-256`, matching Lane 1's `sha256Hex` helper in `src/platform/intake/pdfTemplates/receipt.ts` — reuse it, don't reimplement) before it's ever treated as a template source.
- PDF field inspection during import must not execute embedded JavaScript, launch actions, or any active content. Use a parsing approach that only reads structure (field names/types/AcroForm dictionary), never evaluates anything from the file.
- A signature field/widget in the source PDF is never offered as a mappable Wave 8 field — filter it out of the inspector's suggested field list entirely.
- An unsupported source (dynamic XFA, password-protected, certificate-signed, unparseable) is rejected at import time with a clear message — the advisor must be told to get a different file, not offered a broken mapping flow.
- A version, once approved, is immutable — editing an approved template's mapping creates a new version (new `sourceSha256` if the source changed, or at minimum a new `version` number even for a field-map-only correction), never a silent in-place mutation of an already-issued descriptor. A request that already went out keeps referencing its sealed snapshot regardless of later library edits (this is enforced by Lane 1's contract — you don't need to build anything new for it, just don't accidentally give the composer a live reference instead of a value copy).
- Blueprint/library records may never contain a client value, a real client name used as sample data beyond synthetic fixtures, or a prefill with a restricted-sensitivity fact in `visible_prefill` mode (Lane 1's `assertPrefillLegal`, already exists in `types.ts`, already enforced — call it, don't bypass it).
- Request-board-visible status text for a `pdf_fill` item may say only something like "Form ready" — never expose field names, template internals, or client values in any list/label.
- No em dash in any client-facing or advisor-facing copy you write.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `src/features/intake/RequestFromClientDialog.tsx` — currently: `unsupportedItem()` (around line 51) blocks any `pdf_fill` OR `signature` item from being sendable (`blockedItem` disables the Send button, lines 97/147/262/286). Change this so `pdf_fill` is blocked only when its template fails Lane 1's `assertValidPdfTemplateDescriptor` (a `signature` item is still always blocked — that flow is unchanged, Wave 9's job). Add a template-picker affordance to the dialog so an advisor can attach an approved template as a new `pdf_fill` item alongside the existing blueprint-item flow — study how `selectBlueprint`/`draftItems` already work (lines ~79-135) and follow the same local-state pattern, don't introduce a second parallel item-management mechanism.

**Create:**
- `src/platform/intake/pdfTemplateStore.ts` — the advisor-only local template library. A Zustand store (mirror `src/platform/intake/blueprintStore.ts`'s shape and persistence pattern — read it first) holding approved (and in-progress draft) template records **keyed by `templateId`**, each versioned. Template source bytes and the full field/overlay map are sensitive local advisor data (not client data, but still not for the relay or for any blueprint that could get shared) — do not put raw PDF bytes directly into Zustand's persisted JSON; store them via the existing local encrypted-workspace/keychain pattern this codebase already uses elsewhere for sensitive local blobs (look at how `intakeKeychain.ts` stores per-intake secrets, and check `WorkspaceService`/vault patterns used by other local-sensitive-artifact features in `src/platform/` for the established convention — use whichever this codebase already has, don't invent a third storage mechanism). The Zustand-persisted record itself should carry only non-sensitive structural metadata: `templateId`, label, version history, kind, approval status, timestamps.
- `src/features/intake/pdfTemplates/` — the advisor UI: an import flow (file picker, hash, parse, reject unsupported), a field-mapping/overlay-placement review flow (choose AcroForm field or overlay-position per field, set required/type/radio/select rules, set long-value wrap-or-stop behavior per W8-PREP §10.3), a page preview (render with `pdfjs-dist`, already a root dependency), a local dry-fill preview, and an approve action that calls Lane 1's `assertValidPdfTemplateDescriptor` before locking the version. Component/file naming your call, keep it discoverable (e.g. `TemplateImportDialog.tsx`, `TemplateFieldMapper.tsx`, `TemplateLibraryPanel.tsx`).
- Advisor-only import helpers (PDF structure inspection: enumerate AcroForm fields without executing anything, detect XFA/password/signature-widget/active-content and reject). Put these under `src/platform/intake/pdfTemplates/` alongside Lane 1's contract files if they're pure logic, or under your `src/features/intake/pdfTemplates/` if UI-coupled — your call, but pure PDF-inspection logic belongs in `platform`, not `features`, per this repo's layer rules (see `ARCHITECTURE.md` if you need the DAG rule).
- One or two starter sample PDF templates for the reviewed library, per W8-PREP §10.1: low-risk, common information forms (e.g. a "contact information update" or "beneficiary information" style form) — NOT account-transfer, wire, or discretionary-authority forms. Synthetic/sample PDFs for tests, plus (if you build a seeded starter library) a way to register them as pre-approved built-in templates, mirroring how `defaultBlueprints.ts` seeds built-in blueprints today (check that file for the pattern).

**Create (tests):**
- `src/platform/intake/pdfTemplateStore.test.ts`
- Tests under `src/features/intake/__tests__/pdfTemplates/`
- Golden fixtures: synthetic sample PDFs + values covering text, date, money, checkbox, radio, select, one long-value fit/wrap/stop case, and one approved overlay. Compare rendered output against a reviewed reference and detect a shifted or missing result (visual or structural comparison — your call on exact mechanism, but it must actually detect a regression, not just "it didn't throw").

Nothing else. Do not touch `intake-page/`, `useIntakeInboxSync.ts`, `intakeFiling.ts`, `intakeStore.ts`, or any receiver-side file — those are Lane 3 and Lane 4's territory. Do not touch Lane 1's files (`src/platform/intake/types.ts`, `blueprintValidation.ts`, `blueprintFactory.ts`, `createIntake.ts`, `intakeKeychain.ts`, `pdfTemplates/templateContract.ts`, `pdfTemplates/templateValidation.ts`, `pdfTemplates/receipt.ts`) — import from them, don't edit them. If you find a genuine bug in a Lane 1 file, stop and report it rather than patching it yourself.

## What Lane 1 already gives you (real exports, verified against the merged code)

From `src/platform/intake/types.ts` (re-exported from `src/platform/intake/pdfTemplates/templateContract.ts`):
- `PdfTemplateDescriptor` — `{ templateId, version, kind: 'acroform' | 'overlay', sourceSha256, sourceArtifactRef, outputFileStem, maxOutputBytes, fields: PdfFieldMap }`.
- `PdfFieldMap`, `PdfFieldMapEntry` (discriminated on `kind: 'acroform' | 'overlay'` — an acroform entry has `acroform_field`; an overlay entry has `rect`/`font`/`alignment`/`overflow`). Read `src/platform/intake/pdfTemplates/templateContract.ts` in full for the exact shape before building your mapper UI against it — do not guess the field names.
- `PdfFieldType` = `'text' | 'date' | 'checkbox' | 'number' | 'money' | 'radio' | 'select'` (no `'signature'` — that was removed, never offer it).
- `PdfCompletionReceipt`.
- `PdfFillRequestItem` — `{ t: 'pdf_fill', template: PdfTemplateDescriptor, prefill: PdfPrefill[], ...RequestItemBase }`.

From `src/platform/intake/pdfTemplates/templateValidation.ts`:
- `assertValidPdfTemplateDescriptor(value): asserts value is PdfTemplateDescriptor` — throws `PdfTemplateValidationError` on anything invalid (bad hash format, duplicate field IDs, duplicate `acroform_field` targets, signature field type, URL/path in any string field, unsafe fonts, out-of-bounds overlay coordinates, missing overflow behavior, unreasonable `maxOutputBytes`). Call this before locking any version as approved.
- `MAX_PDF_TEMPLATE_OUTPUT_BYTES` — the ceiling your import/approval flow must respect when setting `maxOutputBytes`.
- `isValidPdfTemplateDescriptor(value): boolean` — non-throwing form, useful for UI validity checks as the advisor edits a draft.

From `src/platform/intake/pdfTemplates/receipt.ts`:
- `sha256Hex(bytes: Uint8Array): Promise<string>` — Web Crypto based, use this for hashing the imported source PDF.
- `verifySourceBytesAgainstDescriptor(sourceBytes, descriptor): Promise<void>` — useful if you want to re-verify an already-approved template's stored bytes still match its pinned hash (e.g. a "verify library integrity" check), though this is optional polish, not required.

From `src/platform/intake/createIntake.ts`:
- `assertSendableRequest(items: RequestItem[]): void` — throws if any item is `signature`, or is `pdf_fill` with a template that fails `assertValidPdfTemplateDescriptor`. This already runs inside `createAdvisorIntake` before any key storage or relay call — you don't need to call it yourself in the dialog, but your dialog's own `unsupportedItem`/`blockedItem` UI guard should mirror its logic so the Send button is disabled *before* the advisor gets a thrown-error surprise.

From `src/platform/intake/blueprintValidation.ts`:
- `copyBlueprintItem`, `assertValidRequestBlueprint`, `copyRequestBlueprint` — already updated by Lane 1 to only accept an approved `pdf_fill` template in a saved blueprint and to always clear `prefill` to `[]` on copy. Use these exactly as you already use them for other item types; no new call pattern needed.

Lane 1's `intakeKeychain.ts` additions (`storePdfTemplateDescriptor`/`loadPdfTemplateDescriptor`/`clearPdfTemplateDescriptor`) are keyed by **issued intake `intakeId`+`item_id`** — that is the *sent-request* secret store, not your template library's storage. Do not reuse it for the pre-send library; your `pdfTemplateStore.ts` needs its own local storage for library records, keyed by `templateId`, independent of any specific request.

## Deliverables

1. **Import flow.** Local file input, compute `sourceSha256` via Lane 1's `sha256Hex`, parse structure (AcroForm field enumeration or, for a non-fillable/scanned PDF, page rendering only) without executing anything, reject unsupported sources (dynamic XFA, password-protected, certificate-signed, unparseable, or containing a signature widget where AcroForm fields were expected) with a clear advisor-facing message.
2. **Field-mapping / overlay review flow.** For AcroForm: list detected fields, let the advisor map each to a Lantern field type/fact kind/required rule/options (for radio/select), explicitly excluding any signature widget from the offered list. For overlay (scanned/non-fillable): manual placement of exact rectangles per page with font/alignment/long-value behavior (`wrap` or `stop`, no silent shrink) — no automatic OCR placement guessing, per W8-PREP's explicit prohibition.
3. **Preview and dry-fill.** Render every page with `pdfjs-dist`; run a local fill with synthetic sample values before approval is allowed.
4. **Approve and version.** Locking a version calls `assertValidPdfTemplateDescriptor` and, on success, marks that exact descriptor immutable; any further edit creates a new version rather than mutating the approved one.
5. **`pdfTemplateStore.ts`** — the local library store, structural metadata in Zustand-persisted state, sensitive source bytes/field map in the appropriate local encrypted storage (see the "Create" section above for which mechanism to reuse).
6. **Composer wiring** in `RequestFromClientDialog.tsx` — pick an approved template, add it as a `pdf_fill` item, keep `signature` blocked, keep the unsupported-item guard accurate to Lane 1's real validation (not the old "always block pdf_fill" logic).
7. **One or two starter sample templates**, per W8-PREP §10.1's recommendation (low-risk information forms).
8. **Golden fixtures** proving text/date/money/checkbox/radio/select/long-value-behavior/one-overlay render and dry-fill correctly, with a real regression check (not just "didn't throw").

## Acceptance tests (full list)

- `pdfTemplateStore.test.ts`: create/update/version-bump/approve-locks-immutability, hash change forces new version, rejected active/XFA/password-protected/signature-widget sources, no custodian URL or raw client value ever lands in a persisted library record.
- Composer tests: an approved template can be selected and added to a request and survives `assertSendableRequest`; an unapproved/invalid template is blocked with the Send button disabled and a clear message; `signature` items remain fully blocked (regression); a template snapshot added to a request is unaffected by a later library edit to the same `templateId` (prove this explicitly — mutate the library record after adding the item to a draft request, then assert the draft item's descriptor is unchanged); restricted-sensitivity prefill is refused (regression against `assertPrefillLegal`).
- Golden tests: the fixture list from Deliverable 8, each with a real comparison assertion.
- Regression: existing `RequestFromClientDialog.test.tsx` and `blueprintStore.test.ts` cases (the ones not specifically about `pdf_fill`) keep passing unchanged.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes. If you hit a design question not answered by this brief or `W8-PREP.md`, make the most conservative choice (never trust an unreviewed PDF's structure; never let an approved version become mutable; never offer a signature field as mappable) and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every test invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/platform/intake/pdfTemplateStore.test.ts src/features/intake/__tests__/pdfTemplates src/features/intake/__tests__/RequestFromClientDialog.test.tsx
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo — this lane makes no Rust changes, and cargo is a shared box-wide lock other lanes may be using concurrently.

## Finish

Commit on `lp/intake-w8-advisor` with a conventional message containing the phrase `W8-LANE2-ADVISOR`. Do NOT push. Do NOT merge. Report exact check results (pass/fail, counts), list every new export other lanes might reference (none are strictly required by Lanes 3/4 per the file territory split, but note anything you think Lane 4's Requests-board status work might want), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
