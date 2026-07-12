# Wave 9 Lane 1 — DocuSign Signature Contract, Eligibility Guard, and the Mandatory Cross-Lane Gate

**Branch:** `lp/intake-w9-contract`, branched off `lp/intake` at `23104005` (confirm with `git merge-base HEAD origin/lp/intake` before starting — do not assume a stale SHA from this document; `origin/lp/intake` should equal `23104005` at dispatch time).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Read first

1. `/home/jameson/lantern-coordination/prep/W9-PREP.md` in full — the design rationale, non-negotiables, and required test cases for all four Wave 9 lanes. This brief narrows it to exactly your lane's files.
2. `/home/jameson/lantern-coordination/prep/W8-W9-GROUNDWORK.md` Part 2 — background on DocuSign embedded signing and why the boundary is shaped this way.
3. The landed Wave 8 code you are extending (read, do not modify unless listed under "Files you own" below):
   - `src/platform/intake/types.ts` — current `SignatureRequestItem` (lines ~146-150) is an unused placeholder: `{ t: 'signature'; grade: 'docusign' | 'native_clicksign'; document_ref?: string }`. Nothing has ever populated it. `PdfFillRequestItem`, `PdfPrefill`, `assertPrefillLegal` show the sealed-descriptor pattern you are extending to signatures.
   - `src/platform/intake/pdfTemplates/templateContract.ts` — `PdfTemplateDescriptor`, `PdfOverlayRect`, `PdfCompletionReceipt`. Reuse `PdfOverlayRect`'s shape/semantics for your tab coordinates instead of inventing a new one.
   - `src/platform/intake/pdfTemplates/templateValidation.ts` — the validation style you should match (a `LooseRecord` cast, `requireExactKeys`, explicit regexes, an `assertValid*(value): asserts value is X` + a boolean `isValid*` wrapper, a dedicated `*ValidationError` class). Its internal helpers (`requireFinitePositive`, `validateOverlayEntry`, etc.) are not exported — do not reach into them; write your own small pure helpers in your new module instead. You may import already-exported symbols (`OPAQUE_ITEM_HANDLE_RE` via `../requestIdentity`, `PdfTemplateDescriptor`, `assertValidPdfTemplateDescriptor`).
   - `src/platform/intake/createIntake.ts` — `assertSendableRequest` (lines ~49-61) **already unconditionally rejects every `signature` item** (`if (signature) throw new Error(...)`). This must NOT change in Wave 9 — a signature item is never sendable through the ordinary intake link, in any grade, ever. The client reaches the signing ceremony through a wholly separate sealed launch record that Lanes 3/4 build later. Your job here is narrow: keep this guard working against your new discriminated `SignatureRequestItem` type (it will, since it only checks `item.t === 'signature'`), and add a regression test proving it still rejects a fully-valid Wave 9 `grade: 'docusign'` item exactly as it rejects everything else.
   - `src/platform/intake/blueprintValidation.ts` — `copyBlueprintItem`'s `signature` case (lines ~117-123) and `assertValidRequestBlueprint` (lines ~127-166). This is where you add real structural validation.
   - `src/platform/intake/blueprintFactory.ts` — `instantiateRequestBlueprint`. Almost certainly needs no change (it composes `copyRequestBlueprint` + `assertValidRequestBlueprint`, both of which you're updating) — confirm this and say so in your report; do not touch it if unnecessary.
   - `src/platform/intake/intakeStore.ts` — **read-only for context, you do not own this file.** `IntakeChecklistState`/`IntakeReceivedItem` currently store only a `filePath` for a filed `pdf_fill` completion, not the `PdfCompletionReceipt` hashes. Lane 2 (a later lane, not you) will decide how to carry that receipt data forward into the eligibility check at send time. Your `assertSignatureEligible` (below) must therefore take the Wave 8 completion evidence as an explicit input parameter — never assume a particular store shape.
   - `src/platform/intake/__tests__/pdfFillContract.test.ts` and `src/platform/intake/__tests__/standingRequestContract.test.ts` — the cross-lane contract harness pattern you will mirror for your own reserved gate file (real `intakeCrypto` sealing, a hand-built mock of `getCorsSafeFetch`, real `IntakeRelayClient`/`IntakeSyncClient`, grep the actual serialized HTTP body for forbidden strings — do not mock the relay client itself).

## Goal (one paragraph)

Turn the unused `SignatureRequestItem` placeholder into a real, immutable, structurally-validated Wave 9 DocuSign signature descriptor: a `grade: 'docusign'` item names exactly one same-request `pdf_fill` item by its `item_id` and carries a reviewed, sealed tab map (signature/date/signer-name anchors) for DocuSign's embedded-signing tabs. `native_clicksign` stays a rejected placeholder — Wave 9 does not implement it. You also define the pure `LocalSignatureRecord`/`SignatureStatus`/`SignatureEvent` contract (encrypted-local-only, never relay data), the eligibility guard that decides whether an advisor may create a DocuSign envelope for a given signature item right now, launch-record expiry/reuse rules, envelope-event idempotency, and safe code-generated output filenames. Finally, you own the **reserved cross-lane contract test** — write it now against real crypto/relay plumbing, with the cases that need Lanes 2-4's not-yet-existing exports fully written but `it.skip`'d.

## Non-negotiables (a reviewer will check these)

- `matter_id` is never referenced by, stored in, or derivable from anything in this lane's new types. It is not a field on `DocusignSignatureRequestItem`, `LocalSignatureRecord`, `SignatureEvent`, or `SignatureLaunchRecord`.
- A `grade: 'docusign'` signature item is structural in a reusable blueprint: `source_pdf_fill_item_id` (an `item_id` reference, not a value) and `tab_map` (reviewed page geometry, not a value) are the only two Wave 9-specific fields. No client value, signer name, signer email, envelope ID, ceremony/recipient-view URL, document bytes, `matter_id`, or output path is ever legal on this type — enforce this by the type shape itself (do not add optional fields "just in case").
- `assertSendableRequest` continues to reject **every** `signature` item unconditionally, `docusign` included. The client never receives a signature item through the ordinary intake checklist link. You are proving this stays true, not changing it.
- `native_clicksign` fails closed everywhere: blueprint validation rejects it outright (not merely "unimplemented" — actively invalid), and your eligibility guard also rejects it as a defense-in-depth second gate.
- The source PDF is immutable: a signature item's eligibility is void the moment the source `pdf_fill` item's completed hash, template hash, or template version differs from what was true when the signature item's source was last reviewed. Your `assertSignatureEligible` recomputes this from the *current* `FormRequest` + freshly-supplied completion evidence every time — it never trusts a cached "already eligible" flag.
- The tab map supports only `signatureTab`, `dateSignedTab`, and `signerNameTab` in Wave 9 — no arbitrary client-provided coordinates, no extra tab kinds. Coordinates are reviewed, structural, normalized-positive numbers (reuse `PdfOverlayRect`'s semantics).
- A `LocalSignatureRecord` can never be constructed (validly) with `status: 'signed'` unless it also carries both `finalSignedSha256` and `certificateSha256`. This is the mechanical, pure-function version of "a browser return or webhook alone cannot mark an item signed" — later lanes are responsible for only setting `status: 'signed'` after a real verified durable write, but your validator is what makes any violation of that fail closed and loud.
- Deserialization compatibility: an old, unreviewed, or structurally incomplete signature item (missing `source_pdf_fill_item_id`, missing/incomplete `tab_map`, or the pre-Wave-9 flat placeholder shape) must fail validation, never silently coerce or drop fields.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `src/platform/intake/types.ts` — replace the placeholder `SignatureRequestItem` (lines ~146-150) with the Wave 9 discriminated shape (see target shape below). Re-export the new `ReviewedDocusignTabMap`/`DocusignTabAnchor` types the same way `PdfCompletionReceipt` etc. are re-exported from `pdfTemplates/templateContract` today (lines 4-11).
- `src/platform/intake/blueprintValidation.ts` — `copyBlueprintItem`'s `signature` case and `assertValidRequestBlueprint`: reject `native_clicksign` outright; for `docusign`, require a `source_pdf_fill_item_id` that resolves to a `pdf_fill` item present elsewhere in the *same* blueprint's `items` array, reject a second signature item targeting the same `source_pdf_fill_item_id` (duplicate), and validate `tab_map` via your new pure validator.
- `src/platform/intake/blueprintFactory.ts` — confirm no change is needed; document that confirmation in your report.
- `src/platform/intake/createIntake.ts` — no functional change expected; add the regression test described above. If you find `assertSendableRequest` genuinely needs a line changed to keep compiling against the new type, keep the change minimal and explain why.

**Create (all under `src/platform/intake/docusignSignature/`, exact filenames your call, but keep the module boundaries below so Lanes 2-4 can import predictably):**
- Tab map contract + pure validation: `ReviewedDocusignTabMap` (`signatureTab`, `dateSignedTab`, `signerNameTab`, each a `DocusignTabAnchor` = `{ page: number; rect: PdfOverlayRect }`), `assertValidDocusignTabMap(value): asserts value is ReviewedDocusignTabMap`. `page` is a positive integer. If the referenced source template's `kind === 'overlay'`, additionally reject a tab `page` greater than the maximum page number used by that template's own overlay fields (the best structural proxy available without opening the PDF — document this limitation plainly: Lane 2 must independently re-verify tab pages against the real rendered page count of the flattened PDF before calling DocuSign, because an `acroform`-kind template carries no page count in its descriptor at all and this validator cannot see actual PDF bytes).
- Signature eligibility guard: `SignatureEligibilityError` (its own error class, matching `BlueprintValidationError`'s style), `SignatureEligibilityInput`, `assertSignatureEligible(input): DocusignSignatureRequestItem` — see exact shape below. Returns the validated, narrowed signature item (with its tab map) on success so callers get a typed value to build an envelope from.
- Local signature record contract: `SignatureStatus` (the nine-state union from W9-PREP §5, reproduced exactly), `SignatureEvent`, `LocalSignatureRecord`, `assertValidLocalSignatureRecord(value): asserts value is LocalSignatureRecord` (enforces the signed-requires-both-hashes rule above, plus basic shape/hash-format checks), `isDuplicateSignatureEvent(events: SignatureEvent[], candidate: SignatureEvent): boolean` for envelope-event idempotency (give `SignatureEvent` a stable opaque `eventId: string` field for this — document that Lane 4 is responsible for deriving it from DocuSign's own event identity, not inventing one).
- Signature launch record contract: `SignatureLaunchRecord` (`requestId`, `signatureItemId`, `recipientViewUrl`, `issuedAt`, `expiresAt`, `consumed`), a documented max-TTL constant (pick a conservative ceiling — 30 minutes is a reasonable default matching typical DocuSign recipient-view URL lifetimes; state your reasoning in a comment), `assertSignatureLaunchUsable(launch, nowIso): void` — throws if expired or already `consumed`.
- Safe output naming: `signatureOutputFileNames(input: { requestId: string; signatureItemId: string; envelopeId: string }): { signedPdfFileName: string; certificateFileName: string }` — pure, code-generated bare filenames (no path separators, no client-suppliable component), following the existing `completed-form-${submissionId}.pdf` pattern in `useIntakeInboxSync.ts`. Return bare filenames only; Lane 2 (which owns `intakeFiling.ts`) decides the folder.

**Create (tests):**
- `src/platform/intake/docusignSignature/*.test.ts` — unit tests for every validator above.
- `src/platform/intake/__tests__/docusignSignatureContract.test.ts` — your reserved gate file, see below.
- Extend `src/platform/intake/blueprintValidation.test.ts` and `src/platform/intake/createIntake.test.ts` if they exist (check first — `blueprintValidation.test.ts` does per Wave 8's listing; `createIntake.test.ts` exists too), else create.

Nothing else. Do not touch `intakeStore.ts`, `intakeFiling.ts`, `RequestsBoard.tsx`, `ClientRequestsTab.tsx`, `intake-page/`, or any backend file — those belong to Lanes 2, 3, and 4.

## Target shape

Current placeholder (`types.ts:146-150`):

```ts
export interface SignatureRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'signature';
  grade: 'docusign' | 'native_clicksign';
  document_ref?: string;
}
```

Target (discriminated on `grade` so the type system itself forbids a `docusign` item without its required fields):

```ts
export interface DocusignTabAnchor {
  page: number; // positive integer, 1-indexed
  rect: PdfOverlayRect; // reuse the existing normalized-positive-coordinate type
}

export interface ReviewedDocusignTabMap {
  signatureTab: DocusignTabAnchor;
  dateSignedTab: DocusignTabAnchor;
  signerNameTab: DocusignTabAnchor;
}

export interface DocusignSignatureRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'signature';
  grade: 'docusign';
  /** Must resolve to a pdf_fill item's item_id in the same request/blueprint. */
  source_pdf_fill_item_id: string;
  /** Reviewed, sealed-only. Never relay-visible (signature items can never be sent through an intake link at all). */
  tab_map: ReviewedDocusignTabMap;
}

export interface NativeClicksignPlaceholderItem extends Omit<RequestItemBase, 't'> {
  t: 'signature';
  grade: 'native_clicksign';
  document_ref?: string;
}

export type SignatureRequestItem = DocusignSignatureRequestItem | NativeClicksignPlaceholderItem;
```

`RequestItem` (line ~152-158) already includes `SignatureRequestItem` in its union — no change needed there beyond the type it now points to.

**Eligibility guard shape** (new module, informed by W9-PREP §4.3 and §7 Lane 1):

```ts
export interface SignatureEligibilityInput {
  request: FormRequest; // must contain both the signature item and its source pdf_fill item
  signatureItemId: string;
  /** Freshly recomputed evidence for the exact bytes on disk right now — never a cached claim passed through unchecked. */
  currentCompletion: {
    sourceItemId: string;   // must equal the pdf_fill item's item_id
    templateId: string;
    templateVersion: number;
    sourceSha256: string;
    completedSha256: string;
  } | null; // null = Wave 8 form not yet completed
  requestActive: boolean;
  existingActiveSignatureRecord: boolean; // true if any non-terminal LocalSignatureRecord already exists for this item
}

export class SignatureEligibilityError extends Error {}

export function assertSignatureEligible(input: SignatureEligibilityInput): DocusignSignatureRequestItem;
```

Rejects (each with a distinct, specific message) when: the named signature item doesn't exist in `request.items`, it isn't `grade: 'docusign'`, its `source_pdf_fill_item_id` doesn't resolve to a `pdf_fill` item in the same request, `currentCompletion` is `null`, `currentCompletion.sourceItemId` doesn't match `source_pdf_fill_item_id` (foreign/wrong source), `currentCompletion.templateId`/`templateVersion`/`sourceSha256` don't match the source `pdf_fill` item's sealed `template` descriptor, `tab_map` fails `assertValidDocusignTabMap`, `requestActive` is `false`, or `existingActiveSignatureRecord` is `true`.

**`LocalSignatureRecord`** (W9-PREP §5, reproduced with one addition — `signatureItemId`, needed to bind the record to the exact item since a request can eventually have more than one signature item):

```ts
export type SignatureStatus =
  | 'not_ready' | 'ready_to_send' | 'envelope_created' | 'signing_opened'
  | 'completion_pending' | 'signed' | 'declined' | 'voided' | 'needs_followup';

export interface SignatureEvent {
  eventId: string; // opaque, dedup key — Lane 4 derives this from DocuSign's own event identity
  status: SignatureStatus;
  source: 'browser_return' | 'connect_webhook' | 'poll' | 'direct_retrieval';
  at: string;
}

export interface LocalSignatureRecord {
  requestId: string;
  signatureItemId: string;
  sourcePdfFillItemId: string;
  sourceTemplateVersion: number;
  sourceTemplateSha256: string;
  wave8CompletedSha256: string;
  envelopeId: string;
  status: SignatureStatus;
  finalSignedSha256?: string;
  certificateSha256?: string;
  events: SignatureEvent[];
}
```

## Deliverables

1. Replace the placeholder type in `types.ts` per the target shape; re-export the new tab-map types.
2. `docusignSignature/tabMap.ts` (or your chosen name) — `ReviewedDocusignTabMap`/`DocusignTabAnchor` + `assertValidDocusignTabMap`.
3. `docusignSignature/signatureEligibility.ts` — `SignatureEligibilityError`, `SignatureEligibilityInput`, `assertSignatureEligible`.
4. `docusignSignature/signatureRecord.ts` — `SignatureStatus`, `SignatureEvent`, `LocalSignatureRecord`, `assertValidLocalSignatureRecord`, `isDuplicateSignatureEvent`.
5. `docusignSignature/signatureLaunch.ts` — `SignatureLaunchRecord`, TTL constant, `assertSignatureLaunchUsable`.
6. `docusignSignature/signatureOutputNaming.ts` — `signatureOutputFileNames`.
7. `copyBlueprintItem`/`assertValidRequestBlueprint` updates in `blueprintValidation.ts` per the non-negotiables above.
8. Regression test in `createIntake.test.ts` proving a valid Wave 9 `docusign` signature item still cannot be sent through an intake link.
9. `docusignSignatureContract.test.ts` — see below.

## Cross-lane baseline test — what to build now vs. skip

Mirror `pdfFillContract.test.ts`'s harness exactly where a case needs the real relay round trip (real `intakeCrypto`, mocked `getCorsSafeFetch`, real `IntakeRelayClient`/`IntakeSyncClient`, grep the actual serialized HTTP body). Most of your "write now" cases below are pure-function tests against your own exports and do not need that harness at all — use it only where the case is genuinely about relay-wire content.

**Write and enable now** (needs only your own lane's exports, plus already-landed W7/W8 exports):
- Reject a `native_clicksign` item at blueprint validation (specific message, not a generic catch-all).
- Reject a `docusign` item whose `source_pdf_fill_item_id` doesn't match any item in the blueprint, matches a non-`pdf_fill` item, or is a duplicate target of two different signature items.
- Reject a missing/incomplete `tab_map` (missing tab, non-finite/zero/negative coordinate, non-integer or non-positive page, an overlay-kind source template where a tab's page exceeds that template's own max overlay-field page).
- Reject the pre-Wave-9 placeholder shape (`grade` present but no `source_pdf_fill_item_id`/`tab_map`) — deserialization-compat case.
- `assertSignatureEligible`: accepts a well-formed request where the signature item's source matches an exact, unchanged, active `pdf_fill` completion; rejects (one test each, exact message) — uncompleted Wave 8 form (`currentCompletion: null`), changed `completedSha256`, changed `sourceSha256`/template hash, changed `templateVersion`, wrong `currentCompletion.sourceItemId` (foreign source), inactive request, an existing active signature record (reuse attempt), invalid tab map, `native_clicksign` grade.
- `assertValidLocalSignatureRecord`: accepts a well-formed record at every status; rejects `status: 'signed'` missing `finalSignedSha256`, missing `certificateSha256`, or both; rejects malformed hash formats.
- `isDuplicateSignatureEvent`: true for a repeated `eventId`, false for a genuinely new one.
- `assertSignatureLaunchUsable`: accepts a fresh unconsumed launch within TTL; rejects an expired launch and an already-`consumed` launch (two separate cases, two separate messages).
- `signatureOutputFileNames`: never contains `/`, `\`, `..`, or any input string verbatim from a hypothetical "client-supplied" field (it takes none — this is really just proving it's derived from your own inputs, not accepting extra unlisted parameters).
- `createIntake.test.ts` regression: a `FormRequest` containing a fully valid `grade: 'docusign'` signature item plus its valid source `pdf_fill` item still throws from `assertSendableRequest`, and no relay call is attempted (spy the mock fetch, assert never called) — mirrors the existing `pdf_fill`-rejection-before-network-call discipline already tested for other cases in this file.
- Wire-inspection case using the real crypto/relay harness (mirror `pdfFillContract.test.ts`'s pattern): build a `FormRequest`/blueprint containing a valid `docusign` signature item and its source `pdf_fill` item, confirm `assertSendableRequest` throws before `createAdvisorIntake` reaches `createInitialIntakeLinkBundle`/the relay mock at all — i.e. prove structurally that a signature item can never produce relay traffic, not just that the function throws in isolation.

**Write, fully implement the arrange/act/assert, but `it.skip`** (needs Lane 2/3/4 exports that don't exist yet — name the exact expected export in the skip comment so whoever unskips it knows what to import):
- Real envelope creation captures the exact flattened PDF bytes + reviewed tabs sent to a mocked DocuSign adapter, keyed off a validated `assertSignatureEligible` result (needs Lane 2's `src/platform/docusignSigning/` envelope adapter export).
- A sealed `SignatureLaunchRecord` round-trips through the relay as ciphertext only — grep the serialized wire body and prove it contains no `recipientViewUrl`, `envelopeId`, `matter_id`, signer name, or signer email in clear text (needs Lane 3/4's relay-carried launch record exports).
- The broker endpoint contract rejects a request containing document bytes, recipient name/email, or `matter_id` before any DocuSign call (needs Lane 4's endpoint schema export).
- Advisor-side retrieval + local filing lands the signed PDF and certificate together under `Requests/<slug>/signatures/`, and the original Wave 8 completed PDF remains untouched under `Requests/<slug>/forms/` (needs Lane 2's filing helper extension to `intakeFiling.ts`).
- A browser-return-only event and a webhook-only event each fail to advance a `LocalSignatureRecord` to `signed` without a verified direct-retrieval durable write (needs Lane 2's store wiring + Lane 4's webhook handler).
- Duplicate DocuSign Connect completion events (same `eventId` delivered twice) are idempotent and never double-file (needs Lane 4's webhook handler using your `isDuplicateSignatureEvent`).

## Acceptance tests (full list)

- `docusignSignature/*.test.ts`: every validator case from Deliverables 2-6.
- `blueprintValidation.test.ts`: `copyBlueprintItem`/`assertValidRequestBlueprint` cases above.
- `createIntake.test.ts`: the regression case above.
- `docusignSignatureContract.test.ts` per §Cross-lane baseline — write-now cases green, skip-for-now cases fully written and skipped with exact TODO comments naming the missing export.
- Regression: `pdfFillContract.test.ts`, `standingRequestContract.test.ts`, `inboxSyncContract.test.ts`, and every existing `blueprintValidation`/`createIntake` test still pass unchanged.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes (including that skipped cases compile cleanly — a skipped test that doesn't typecheck is not done). If you hit a design question not answered by this brief or `W9-PREP.md`, make the most conservative choice (never trust client input; fail closed on an unrecognized shape; never widen what the relay can see; never let a pure validator accept a `signed` record without both final hashes) and document the choice in your final report.

## Checks to run (report exact pass/fail for each; wrap every test invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/platform/intake/docusignSignature src/platform/intake/blueprintValidation.test.ts src/platform/intake/createIntake.test.ts src/platform/intake/__tests__/docusignSignatureContract.test.ts src/platform/intake/__tests__/pdfFillContract.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo from this lane — this lane makes no Rust changes, and cargo is a shared box-wide lock other lanes may be using.

## Finish

Commit on `lp/intake-w9-contract` with a conventional message containing the phrase `W9-LANE1-CONTRACT`. Do NOT push. Do NOT merge. Report the exact check results (pass/fail, counts) in your final message, list every new/changed export Lanes 2/3/4 will need (exact names, exact file paths — `DocusignSignatureRequestItem`, `ReviewedDocusignTabMap`/`DocusignTabAnchor`, `SignatureEligibilityInput`/`assertSignatureEligible`'s exact signature, `LocalSignatureRecord`/`SignatureStatus`/`SignatureEvent`/`assertValidLocalSignatureRecord`/`isDuplicateSignatureEvent`, `SignatureLaunchRecord`/`assertSignatureLaunchUsable`, `signatureOutputFileNames`'s exact signature), list every skipped test case in `docusignSignatureContract.test.ts` with the exact export each one is waiting on, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check in this brief passed (skips are fine, failures are not) and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
