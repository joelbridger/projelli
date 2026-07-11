# Wave 8 Lane 1 — Template Contract, Security Rules, and the Mandatory Cross-Lane Gate

**Branch:** `lp/intake-w8-contract`, branched off `origin/lp/intake-w7` at `1e360b9b` (confirm with `git merge-base HEAD origin/lp/intake-w7` before starting — do not assume a stale SHA from this document).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Wave 7 shipped a **placeholder** `PdfFillRequestItem` (`src/platform/intake/types.ts:138-143`) that just carries `pdf_ref: string` (an unvalidated string, potentially a URL), a `field_map`, and `prefill`. It was never wired to anything — `assertSendableRequest` in `createIntake.ts:43-46` currently rejects `pdf_fill` unconditionally, same as `signature`. Wave 8 lets a client fill an advisor-approved, existing PDF (e.g. a downloaded Schwab form) entirely in their browser and return it encrypted through the existing intake relay. Your job is to replace the placeholder with an **immutable, sealed template descriptor** (source PDF pinned by SHA-256, an exact field/overlay map, output rules), write the pure validation that makes an unreviewed or unsafe template impossible to send, and change the issuer so a *validated* `pdf_fill` item can go out while every `signature` item still cannot. You also own the mandatory cross-lane contract test that proves the whole encrypted round-trip works — that test is this lane's real deliverable, not an afterthought.

Read `/home/jameson/lantern-coordination/prep/W8-PREP.md` in full before starting. It has the full design rationale, the non-negotiables, and the six required cross-lane test cases. This brief narrows that document to exactly your lane's files and grounds it against the real current code (the prep doc's shared-contract sketch in §4 is directional — match its privacy semantics exactly, but you may adjust field names to fit the actual codebase, as long as the semantics don't move and you record any renames in your final report).

## Non-negotiables (a reviewer will check these)

- `matter_id` is never renamed, never sent to the relay in clear, and never appears in template metadata sent to the relay.
- The template PDF, field map, overlay coordinates, and completion receipt are **client data** (sealed inside the checklist / sealed local state), never relay-visible metadata, never a public URL, never a client-supplied filesystem path, and never a relay lookup key. `pdf_ref` as a raw string is retired.
- The descriptor is **immutable once issued**. A changed source PDF hash is a new template version needing fresh review. A request that already went out keeps its sealed snapshot even if the advisor edits the library template later — this lane's validation must make that structurally true (the descriptor is copied by value into the sealed checklist, never referenced live).
- `PdfPrefill` stays value-free in a saved blueprint (already true today — verify it, don't loosen it). Wave 8's default is **no visible prefill**: `copyBlueprintItem`'s `pdf_fill` case must keep clearing `prefill` to `[]`, same as it does today.
- No signature fields, no embedded URLs, no filesystem paths, no client values are legal inside a template descriptor or field map. Unsupported template classes (dynamic XFA, password-protected, certificate-signed PDF, unreviewed hash) must fail validation, not silently degrade.
- `assertSendableRequest` continues to reject **every** `signature` item unconditionally — you are not touching that half of the guard. It gains the ability to allow a `pdf_fill` item through, but only one that passes your validation contract.
- The receipt (`PdfCompletionReceipt`) is an integrity record only — no raw client values, no legal-signature claim.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `src/platform/intake/types.ts` — replace the placeholder `PdfFillRequestItem`/`PdfFieldMap`/`PdfFieldMapEntry` shape (lines ~127-143) with the immutable sealed template descriptor. `PdfPrefill` (lines 159-192) stays as-is unless the new descriptor shape requires a small adjustment — if so, keep its privacy semantics (restricted facts can never be `visible_prefill`) identical.
- `src/platform/intake/blueprintValidation.ts` — `copyBlueprintItem`'s `pdf_fill` case (lines 76-85, uses the now-obsolete `copyFieldMap` helper at lines 15-24) must copy only the approved structural descriptor, always clear `prefill` to `[]`, and `assertValidRequestBlueprint` must reject a `pdf_fill` item whose template hasn't passed your approval contract (in addition to its existing `prefill.length > 0` check at line 123).
- `src/platform/intake/blueprintFactory.ts` — `instantiateRequestBlueprint` (only if the new descriptor needs anything beyond what `copyRequestBlueprint`/`assertValidRequestBlueprint` already enforce; likely no change needed, confirm and note in your report either way).
- `src/platform/intake/createIntake.ts` — `assertSendableRequest` (lines 43-46) currently does `items.find(item => item.t === 'pdf_fill' || item.t === 'signature')` and throws for both. Change it to: `signature` always rejected (unchanged); `pdf_fill` rejected **unless** it passes your template validation (call your new pure validator here). Validate before `createInitialIntakeLinkBundle`/`storeIntakeSecrets`/relay creation — `assertSendableRequest` already runs first in `createAdvisorIntake` (line 56), so wiring your validator into it is sufficient; don't add a second call site.

**Create (all under `src/platform/intake/pdfTemplates/`, naming your call but keep it discoverable — e.g. `templateContract.ts`, `templateValidation.ts`, `receipt.ts`):**
- The `PdfTemplateDescriptor`/`PdfTemplateKind`/`PdfCompletionReceipt` types (informed by W8-PREP §4, adjusted to fit `types.ts`'s existing patterns — e.g. reuse `FactKind` where a field maps to a known fact, keep field IDs opaque strings).
- Pure, strict validation: exact SHA-256 format (64 lowercase hex chars), field ID uniqueness, supported AcroForm/overlay field types only (no `signature` field type — note the existing placeholder's `PdfFieldType` union at line 127 already includes `'signature'`; **remove it**, a signature is never a Wave 8 field), finite positive overlay coordinates, safe font settings (no external font URL), valid option lists for select/radio, no embedded URLs anywhere in the descriptor, no filesystem paths, no client values, a sensible positive `maxOutputBytes` cap.
- Receipt schema + byte/hash verification helpers as pure functions (no I/O) — `sourceSha256`/`completedSha256` presence and format checks, a `verifyReceiptAgainstDescriptor(receipt, descriptor)` style helper Lane 4 will call after it decrypts and reparses bytes. This is a local integrity check, not itself the decrypt/parse (Lane 4 owns the actual PDF-safety parsing).

**Create (tests):**
- `src/platform/intake/pdfTemplates/*.test.ts` — unit tests for every validator above, using synthetic fixture descriptors (no real PDF bytes needed for these — they test the descriptor/receipt shape, not PDF parsing).
- `src/platform/intake/__tests__/pdfFillContract.test.ts` — see §Cross-lane baseline below. This is your reserved gate file.

Nothing else. Do not touch `useIntakeInboxSync.ts`, `intakeFiling.ts`, `RequestFromClientDialog.tsx`, `intake-page/`, or any advisor UI — those belong to Lanes 2, 3, and 4.

## The shared contract (ground truth: real code, not the prep doc's sketch)

Current placeholder you're replacing (`types.ts:127-143`):

```ts
export type PdfFieldType = 'text' | 'date' | 'checkbox' | 'signature' | 'number' | 'money';

export interface PdfFieldMapEntry {
  field_id: string;
  item_id?: string;
  fact_kind?: FactKind;
  pdf_field_type?: PdfFieldType;
}

export type PdfFieldMap = Record<string, PdfFieldMapEntry>;

export interface PdfFillRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'pdf_fill';
  pdf_ref: string;
  field_map: PdfFieldMap;
  prefill: PdfPrefill[];
}
```

Target shape (W8-PREP §4, adapted — keep `RequestItemBase` fields `item_id`/`label`/`help_text`/`required`/`subject` as they are today, only the `pdf_fill`-specific payload changes):

```ts
export type PdfTemplateKind = 'acroform' | 'overlay';

export interface PdfTemplateDescriptor {
  templateId: string;        // local opaque id, never a relay handle
  version: number;
  kind: PdfTemplateKind;
  sourceSha256: string;      // sealed only — never relay-visible
  sourceArtifactRef: string; // encrypted local/sealed artifact reference only, never a URL or filesystem path
  outputFileStem: string;    // code-sanitized local display contract, not a client-suppliable filename
  maxOutputBytes: number;
  fields: PdfFieldMap;       // sealed only
}

export interface PdfFillRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'pdf_fill';
  template: PdfTemplateDescriptor;
  prefill: PdfPrefill[];
}

export interface PdfCompletionReceipt {
  templateId: string;
  templateVersion: number;
  sourceSha256: string;
  completedSha256: string;
  completedAt: string;
  pageVersion: string;
}
```

`PdfFieldMap`/`PdfFieldMapEntry` (the per-field map living inside `PdfTemplateDescriptor.fields`) keeps roughly its current per-entry shape (`field_id`, `fact_kind?`, a field-type enum) but: drop `'signature'` from the field type union, drop the now-unused `item_id?` (that was vestigial from the placeholder — confirm nothing else reads it before deleting; if something does, keep it and note why in your report), and add whatever an overlay entry needs per W8-PREP §2 (page, normalized-or-PDF-space rectangle, font, alignment, explicit long-value behavior: `wrap` or `stop` — no silent shrink-to-fit, per the prep doc's non-negotiable). Model this as a discriminated shape (`acroform` field entries vs `overlay` field entries) if that keeps validation simpler — your call, document the choice.

**Deserialization compatibility:** any unsent Wave 7 blueprint or draft that still has the old `pdf_ref`/plain `field_map` shape must fail closed (rejected by `assertValidRequestBlueprint`/`assertSendableRequest`, not silently coerced) until someone re-approves it as a real Wave 8 descriptor. Add a test proving this.

## Deliverables

1. **Replace the placeholder type** in `types.ts` per the target shape above. Keep `PdfPrefill` as-is unless a small adjustment is genuinely required.
2. **Pure template validation** under `src/platform/intake/pdfTemplates/`: reject bad SHA-256 format, duplicate field IDs, unsupported field/kind combinations, non-finite or non-positive overlay coordinates, unsafe font settings, invalid option lists, any URL or filesystem path anywhere in the descriptor, any client value anywhere in the descriptor, an unreasonable `maxOutputBytes` (define and document a sane ceiling — this is a client-device resource-exhaustion guard per W8-PREP §7, not an arbitrary number).
3. **`copyBlueprintItem` / `assertValidRequestBlueprint` update** — a saved blueprint can reference only an approved structural template descriptor; `prefill` is always cleared on copy; a template that fails your validator is rejected at blueprint-save time, not just at send time.
4. **`assertSendableRequest` update** — `pdf_fill` passes only if `template` passes your validator; `signature` still always rejected; validated before any key storage or relay creation (already guaranteed by the existing call order in `createAdvisorIntake`).
5. **Receipt schema + verification helpers**, pure and I/O-free, for Lane 4 to call after it independently decrypts and reparses the completed bytes.
6. **`pdfFillContract.test.ts`** — your reserved gate file, built now against a real encrypted harness (see below), with the cases that don't need Lanes 2-4 exports enabled and green today, and the cases that do need those exports written but explicitly `it.skip`'d with a `// TODO(w8-gate): enable once Lane <n> exports <X> land` comment naming exactly what's missing. You will not fully enable this file today — that happens after Lanes 2-4 merge, as a separate follow-up the wave lead will dispatch. Do not leave vague placeholders; every skipped case must be fully written (arrange/act/assert) against the real interfaces you expect Lanes 2-4 to export, so enabling it later is a mechanical unskip, not a rewrite.

## Cross-lane baseline test — what to build now vs. skip

Mirror the harness in `src/platform/intake/__tests__/standingRequestContract.test.ts` (987 lines — read it, this is your pattern) exactly: real `intakeCrypto` sealing, a hand-built mock of `getCorsSafeFetch` returning fixture HTTP responses, a real `IntakeRelayClient`/`IntakeSyncClient` driven through that mock, and (once available) a call into the real `routeIntakeSubmission`. Do not mock `IntakeRelayClient`/`IntakeSyncClient` themselves.

**Write and enable now** (needs only your own lane's exports):
- A reviewed template descriptor produces a standing request via `createAdvisorIntake` with a new request ID, an opaque Wave 7 item handle (`createOpaqueItemHandle`), unchanged local `matter_id`, and — critically — **grep the actual serialized HTTP body your mock fetch receives** and assert it contains no `sourceSha256`, no `templateId`, no field names, no `sourceArtifactRef` string, and no `matter_id` anywhere. This is the same wire-inspection discipline `standingRequestContract.test.ts` already uses — copy its pattern, don't invent a new one.
- An unapproved/invalid template descriptor (bad hash format, signature field type, a URL in `sourceArtifactRef`, a duplicate field ID) fails `assertSendableRequest` before any key storage or relay call — assert no local secret was persisted and no relay call was attempted (spy on the mock fetch and assert it was never called).
- A `signature` item still fails `assertSendableRequest` exactly as before (regression, not new behavior — one line is enough, don't rebuild that test surface).
- An old Wave 7-shaped `pdf_ref`/plain-`field_map` blueprint item fails `assertValidRequestBlueprint`/`assertSendableRequest` (the deserialization-compat case above).

**Write, fully implement the arrange/act/assert, but `it.skip`** (needs Lane 2/3/4 exports that don't exist yet — name the exact expected export in the skip comment so whoever unskips it knows what to import):
- Public-page path verifies source bytes against `sourceSha256`, fills and flattens a fixture PDF locally, encrypts only the completed PDF, creates a sealed receipt (needs Lane 3's `intake-page/src/pdfFill/` exports).
- Advisor path decrypts, verifies completed hash + PDF safety via your receipt helpers, files only under `Requests/<standing-slug>/forms/`, then acknowledges (needs Lane 4's `pdf_fill` branch in `routeIntakeSubmission` and its filing helper).
- Changed template hash, wrong opaque handle, JSON payload instead of a file, non-PDF MIME, multiple files, a PDF with remaining interactive fields or active content, receipt hash mismatch, and file-to-other-request attempt are all integrity-flagged and left unacknowledged (needs Lane 4).
- An active onboarding request and a standing `pdf_fill` request for the same `matterId` stay isolated — the PDF request cannot write beneath `Requests/onboarding/` (needs Lane 4's filing helper).
- Full serialized-wire inspection across create, chunk upload, manifest, and inbox sync confirms the absence of every one of: source PDF bytes, flattened PDF bytes, field names, input values, both SHA-256 values, template ID, template title, custodian name, readable output filename, logical item ID, clear `matter_id` (needs Lanes 3 and 4 to exist so there's a real round trip to inspect — you can and should still write the assertion body now against the exact fixture data you construct, so it only needs the missing imports once Lanes 3/4 land).

## Acceptance tests (full list)

- `pdfTemplates/*.test.ts`: every validator case from Deliverable 2, plus receipt schema/verification helper tests (accepts a matching receipt, rejects hash mismatch, rejects malformed fields).
- `blueprintValidation.test.ts` (extend if it exists, create if not — check first): `copyBlueprintItem` clears prefill and copies only the approved descriptor for `pdf_fill`; `assertValidRequestBlueprint` rejects an unapproved/invalid template and the old placeholder shape.
- `createIntake.test.ts` (extend if it exists, create if not — check first): `assertSendableRequest` allows a validated `pdf_fill`, still rejects every `signature`, rejects an invalid `pdf_fill` template, and rejects the old placeholder shape.
- `pdfFillContract.test.ts` per §Cross-lane baseline above — the "write now" cases green, the "skip for now" cases fully written and skipped with exact TODO comments naming the missing export.
- Regression: `standingRequestContract.test.ts`, `inboxSyncContract.test.ts`, and any existing blueprint/createIntake tests still pass unchanged.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes (including the skipped cases compiling cleanly — a skipped test that doesn't typecheck is not done). If you hit a design question not answered by this brief or `W8-PREP.md`, make the most conservative choice (never trust client input; fail closed on an unrecognized template shape; never widen what the relay can see) and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every test invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/platform/intake/pdfTemplates src/platform/intake/blueprintValidation.test.ts src/platform/intake/createIntake.test.ts src/platform/intake/__tests__/pdfFillContract.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo from this lane — this lane makes no Rust changes, and cargo is a shared box-wide lock other lanes may be using.

## Finish

Commit on `lp/intake-w8-contract` with a conventional message containing the phrase `W8-LANE1-CONTRACT`. Do NOT push. Do NOT merge. Report the exact check results (pass/fail, counts) in your final message, list every new/changed export Lanes 2/3/4 will need (exact names, exact file paths — `PdfTemplateDescriptor`, `PdfTemplateKind`, `PdfFieldMap`/entry shape, `PdfCompletionReceipt`, your receipt verification helper's exact signature, and confirm `assertSendableRequest`'s new behavior), list every skipped test case in `pdfFillContract.test.ts` with the exact export each one is waiting on, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed (skips are fine, failures are not) and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
