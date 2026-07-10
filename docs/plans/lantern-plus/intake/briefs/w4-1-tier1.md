# Wave 4 Lane 1 — Tier 1 Client-Page Document Classifier

**Branch:** `lp/intake-w4-tier1` (already checked out for you in this worktree).
**You are Codex, the builder.** Build the whole lane, run the listed checks, commit. Do NOT push. Do NOT merge. End by printing the sentinel exactly.

## Goal (one paragraph)

Before a client uploads a document on the intake page, run a **deterministic, offline** check that warns when the selected file strongly looks wrong for the current item — wrong document type, wrong side of a driver's license, or the same license side twice. The warning **never blocks** the upload: the client can always "keep this file anyway". If they keep it past a warning, seal that fact into the encrypted submission manifest so the advisor can see it later. **No AI. No network. No OCR.** Camera photos that yield no readable text return `unknown` and never warn.

## Hard rules (non-negotiable — a reviewer will check these)

- **Deterministic only.** No model call, no `fetch`, no OCR, no import of any provider/network module. Pure functions over text + filename + mime + slot role.
- **Non-blocking.** The warning is advisory. Upload must still complete on "keep this file anyway". E2EE behavior is unchanged.
- **The code already knows the target item.** Never let filename or file content choose the item/slot — those come from `RequestItem` and slot index, which the caller already has.
- **Privacy.** Warning details (expected/observed/reason/side) must NOT enter: relay plaintext, resume/localStorage state, access logs, or any page-visible "finalized" flag. The only place the override is persisted is inside the **sealed (encrypted) manifest**. Resume state may hold at most a boolean "this slot was warned+kept" keyed by slot index — no filename, no extracted text.
- Light theme, design tokens, client/household user-facing copy, no em dashes, no time estimates. Warning copy must not shame the client.

## Files to create

1. `src/platform/intake/documentDetectiveTypes.ts` — the shared types below.
2. `src/platform/intake/documentDetectiveRules.ts` — the pure classifier `classifyTier1(input): Tier1Classification`.
3. `tests/unit/intake/documentDetectiveRules.test.ts` — unit tests for the rule tables.

## Files to edit (additive only — do not rewrite existing behavior)

4. `src/platform/intake/types.ts` — add optional field to `DocUploadRequestItem` (line ~99):
   ```ts
   expected_doc_types?: DocumentKind[];
   expected_license_slots?: Array<'front' | 'back'>;
   ```
   Import `DocumentKind` from `documentDetectiveTypes.ts`.
5. `src/platform/intake/intakeContract.ts` — add an **optional** additive field to `SealedManifest`:
   ```ts
   document_detective?: DocumentDetectiveManifestEntry[];
   ```
   Define `DocumentDetectiveManifestEntry` (shape below) in `intakeContract.ts` or import from `documentDetectiveTypes.ts` (keep contract types self-contained — prefer defining it in intakeContract.ts and re-exporting from documentDetectiveTypes if needed, to avoid a layer cycle).
6. `src/platform/intake/intakeCrypto.ts` — extend `isSealedManifest` (line ~395) to **accept and validate** the new optional `document_detective` field. Treat it as **attacker-controlled**: if present it must be an array; each entry's `slot_index` a safe non-negative integer, `kept_anyway` a boolean, and the string fields (`warning_reason`, `expected`, `observed`, `side`) either absent or one of the known literal values. Reject NaN/negative/oversized. A missing field is valid (older clients).
7. `intake-page/src/App.tsx` — mount the Tier-1 gate in `DocUploadScreen` (lines 703–810). See "Client-page wiring" below.
8. `intake-page/src/types.ts` — only if the page needs a local state type for the warning.
9. `intake-page/tests/intake-page.spec.ts` — add the Playwright/axe acceptance checks below.

## Types (`documentDetectiveTypes.ts`)

```ts
export type DocumentKind =
  | 'drivers_license' | 'tax_return' | 'pay_stub' | 'bank_statement'
  | 'brokerage_statement' | 'ira_statement' | 'credit_card_statement'
  | 'other_financial' | 'unknown';

export type LicenseSide = 'front' | 'back' | 'unknown';

export type Tier1WarningReason =
  | 'wrong_doc' | 'wrong_side_of_license' | 'duplicate_license_side' | 'unsupported_or_unreadable';

export type ExpectedDocument = { kind: DocumentKind; side?: 'front' | 'back' };

export interface Tier1ClassifyInput {
  item: { item_id: string; label: string; help_text?: string; expected_doc_types?: DocumentKind[]; expected_license_slots?: Array<'front' | 'back'> };
  slotIndex: number;
  slotRole: 'front' | 'back' | 'file';
  file: { name: string; mimeType: string; byteSize: number; textSample?: string };
  // For duplicate-side detection: the observed side of the OTHER already-selected license slot, if any.
  siblingLicenseSide?: LicenseSide;
}

export type Tier1Classification =
  | { verdict: 'ok'; observed: DocumentKind; side?: LicenseSide; evidence: string[] }
  | { verdict: 'warn'; reason: Tier1WarningReason; expected: ExpectedDocument; observed: DocumentKind; side?: LicenseSide; evidence: string[] }
  | { verdict: 'unknown'; evidence: string[] };

export interface DocumentDetectiveManifestEntry {
  tier: 'tier1';
  slot_index: number;
  warning_reason?: Tier1WarningReason;
  expected?: string;   // DocumentKind or "front"/"back", stringified
  observed?: string;   // DocumentKind
  side?: LicenseSide;
  kept_anyway: boolean;
}
```

## Deterministic rule tables (copy exactly)

### Expected document (inference when `expected_doc_types` absent)
- `item_id` or `label` contains `license` → expected `drivers_license`. For a 2-slot license item, slot 0 expects side `front`, slot 1 expects `back` (matches App.tsx:788–789).
- label mentions: `tax return`→`tax_return`, `pay stub`/`paystub`→`pay_stub`, `bank statement`→`bank_statement`, `brokerage statement`→`brokerage_statement`, `ira statement`→`ira_statement`, `credit card statement`→`credit_card_statement`.
- If `expected_doc_types` is set on the item, it wins over inference.
- **No strong expected type → never warn `wrong_doc`. Return based on observed only (ok/unknown).**

### Observed document kind (text wins over filename; lowercase-match)
- `drivers_license`: `driver license`, `driver's license`, `identification card`, `license no`, `dl no`, `class`, `restrictions`, `endorsements`, `date of birth`, `height`, `eyes`.
- `tax_return`: `form 1040`, `1040-sr`, `adjusted gross income`, `total income`, `wages salaries tips`, `schedule 1`, `taxable income`.
- `pay_stub`: `pay period`, `gross pay`, `net pay`, `ytd`, `earnings`, `deductions`, `employer`.
- `bank_statement`: `checking account`, `savings account`, `deposits`, `withdrawals`, `ending balance`, `statement period`.
- `brokerage_statement`: `portfolio value`, `holdings`, `asset allocation`, `brokerage`, `dividends`, `realized gain`, `unrealized gain`.
- `ira_statement`: `ira`, `traditional ira`, `roth ira`, `required minimum distribution`, `retirement account`.
- `credit_card_statement`: `minimum payment`, `payment due`, `purchases`, `transactions`, `credit limit`.
- **Conflict rule:** if two kinds both have strong signals, choose the MORE SPECIFIC: `ira_statement` beats `brokerage_statement`; `tax_return` beats generic finance. Otherwise return `unknown` (do not warn).
- **No/weak text (e.g. a JPEG with empty `textSample`) → `unknown`.** Filename alone is a weak signal: it may nudge but must NOT by itself produce a `warn` verdict.

### Wrong document — warn only when BOTH expected and observed are strong AND incompatible
- License item + tax_return signals → `warn wrong_doc`.
- License item + pay_stub signals → `warn wrong_doc`.
- Brokerage-statement item + ira_statement signals → `warn wrong_doc` unless the item's `expected_doc_types` explicitly allows `ira_statement`.
- Income-support item (`expected_doc_types` includes `pay_stub`/`tax_return`) + pay_stub/tax_return → `ok`.
- Spending-support item + bank_statement/credit_card_statement → `ok`.
- Observed `unknown` → no warning.

### Wrong side of license (only when observed kind is drivers_license or side signals are strong)
- Front signals: `driver license`, `class`, `restrictions`, `endorsements`, `dob`, `sex`, `height`, `eyes`, `expiration`, `address`.
- Back signals (barcode/AAMVA): `pdf417`, `aamva`, `ansi`, `daq`, `dcs`, `dct`, `dag`, `dai`, `daj`, `dbb`, `dba`, `dcg`, `zaz`, `barcode`.
- `warn wrong_side_of_license` when front slot shows strong BACK + weak FRONT, or back slot shows strong FRONT + weak BACK.
- `warn duplicate_license_side` when this slot and `siblingLicenseSide` classify to the SAME strong side.
- Both unknown → no warning (normal phone photos have no extractable text without OCR — that is expected in Wave 4).

## Client-page wiring (`DocUploadScreen`, App.tsx 703–810)

- After a file is chosen in `updateFile`, compute a `textSample` from the file **client-side, no network**: for `text/*` and `application/pdf`, read a bounded prefix (cap ~64 KB) of extractable text; for images, `textSample` is empty (→ unknown, no warn). Reuse `src/lib/pdf-extract.ts` only if it works in the intake-page bundle without pulling Node; otherwise for PDFs just read the raw bytes and skip text (unknown). **Do not add heavy deps.** Keep it simple: images → no text; text files → decode; PDF text is optional/best-effort.
- Call `classifyTier1` per selected slot (pass `siblingLicenseSide` from the other slot's last classification for duplicate detection).
- On `verdict==='warn'`, render an inline, tokenized, non-blocking warning region with: a plain sentence of what Lantern sees, and two buttons — **"Choose a different file"** (clears that slot, clears the warning) and **"Keep this file anyway"** (sets an override boolean for that slot index; warning collapses to a small "kept anyway" note).
- Track kept-anyway per slot in component state. When `submit()` runs, pass the collected `DocumentDetectiveManifestEntry[]` (only for slots that were warned) down through `onSubmit`'s files payload so `submission.ts` can seal them into the manifest. If threading through `AnswerPayload` is needed, add an optional `document_detective?: DocumentDetectiveManifestEntry[]` to the files variant — additive.
- In `src/platform/intake/submission.ts` seal path (~lines 90–144), include `document_detective` in the `SealedManifest` object when present. It rides inside the already-encrypted manifest; the relay sees only ciphertext.

## Acceptance tests (must pass)

`tests/unit/intake/documentDetectiveRules.test.ts`:
- tax-return textSample in a license item → `warn wrong_doc`, expected `drivers_license`.
- pay-stub in a license item → `warn wrong_doc`.
- back-side signals (`pdf417`/`aamva`) in the FRONT slot → `warn wrong_side_of_license`.
- both slots front-side signals → `warn duplicate_license_side`.
- income-support item + pay_stub → `ok`.
- empty textSample (image) in any item → `unknown`, never warn.
- filename-only signal (e.g. `tax.pdf` with empty text) in a license item → NOT a warn (unknown or ok).
- ira vs brokerage conflict → observed `ira_statement` (more specific).

`intake-page/tests/intake-page.spec.ts` (extend, keep axe clean):
- Wrong-document warning appears before upload for a tax-return fixture in the license item.
- Wrong-side warning appears when a back-side fixture is put in the front slot.
- Duplicate-side warning appears when both slots are front-side fixtures.
- "Choose a different file" clears the warning for that slot.
- "Keep this file anyway" lets the upload complete (E2EE unchanged).
- Assert warning text/expected/observed strings are NOT present in any relay request body, resume state, or a page-visible finalize flag.

## Checks to run before you finish (report exact pass/fail)

```
npx vitest run tests/unit/intake/documentDetectiveRules.test.ts src/platform/intake
cd intake-page && npm run test ; cd ..
npx tsc --noEmit
node scripts/eslint-gate.mjs
```

If `intake-page` Playwright needs a browser it lacks, run its Vitest/unit portion and note which spec needs the desktop harness — do not fake a pass.

## Finish

Commit on `lp/intake-w4-tier1` with a conventional message including the phrase `W4-LANE1-TIER1-DETERMINISTIC`. Do NOT push. Then print on its own line, nothing after it:

```
DONE-EXIT:0
```

If you cannot get a clean build, print `DONE-EXIT:1` and a short reason.
