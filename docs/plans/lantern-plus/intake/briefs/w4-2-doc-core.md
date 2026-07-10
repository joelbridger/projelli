# Wave 4 Lane 2 — Advisor Document Reader + Classifier

**Branch:** `lp/intake-w4-doc-core` (checked out for you in this worktree, branched off the merged Lane 1 tip).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge.

## Goal (one paragraph)

After an intake document syncs to the advisor's machine and is decrypted and filed locally, the app can **read it locally** (PDF text first, local OCR only for scanned pages, images via local OCR or "needs advisor view"), **classify** what kind of document it is using the SAME deterministic signal tables the client page uses, and produce **source references** (document path + page + snippet) that later feed proposal cards and fact provenance. Everything runs on the advisor machine. No cloud OCR. No network read of document content. The model never chooses any identifier or path.

## Hard rules (a reviewer will check these)

- **Advisor-side, local only.** Runs in the desktop app renderer. Reuse `src/lib/pdf-extract.ts` (`extractPdfText`, page rasterizer) and `src/platform/rag/ocr/ocrEngine.ts` (`isOcrEngineAvailable`, `ocrPageImage`). No cloud OCR, no network fetch of content, no new heavy deps.
- **Path confinement.** NEVER read a path outside the matched matter folder. Every read validates the path is under `options.matterFolderPath` (the same folder `routeFileSubmission` filed into). Reject `..`, absolute escapes, and symlinks out.
- **The model chooses nothing.** Document text/filename must never choose `matter_id`, `request_id`, `item_id`, destination path, or `fact_kind`. Classification is deterministic. Lane 2 writes NO facts — it only produces read text + a classification + source refs.
- **Single source of truth for document-kind signals.** Import `classifyObservedKind` (and the `DocumentKind`/`LicenseSide` types) from Lane 1's `src/platform/intake/documentDetectiveRules.ts` / `documentDetectiveTypes.ts`. Do NOT redefine the signal tables — drift between the client-side and advisor-side classifier is a mis-filing vector. If Lane 1 exported the kind detection under a different name, adapt to it; if it is only embedded inside `classifyTier1`, refactor Lane 1's file minimally to export a reusable `classifyObservedKind(text: string, filename: string): { kind: DocumentKind; side?: LicenseSide; evidence: string[] }` and have `classifyTier1` call it (keep Lane 1's tests green).
- Light theme, tokens, client/household copy, no em dashes, no time estimates.

## Files to create

1. `src/platform/intake/documentSourceRef.ts` — the source-ref type + converters (below).
2. `src/platform/intake/documentReader.ts` — local read: PDF text / OCR / image / unreadable.
3. `src/platform/intake/documentClassifier.ts` — deterministic class from read text (wraps `classifyObservedKind`).
4. `src/platform/intake/documentExtractionTypes.ts` — the shared proposal/reader types Lane 3 will consume (define `IntakeDocumentSourceRef`, `DocumentReadResult`, `DocumentClassification`; leave the `DocumentExtractionProposal` shape here too per the exec plan cross-lane contract).
5. `src/platform/intake/documentClassifier.test.ts` — unit tests.

## Files to edit (additive only)

6. `src/platform/intake/useIntakeInboxSync.ts` — after decrypting a synced submission, capture any sealed Tier-1 `document_detective` manifest metadata onto the received-item record so Lane 3 / the Onboarding tab can surface "client kept a warned file". Treat it as **client-supplied context, not truth**. Additive only — do not change existing routing behavior.
7. `src/platform/intake/intakeStore.ts` — add a non-sensitive received-item flag (e.g. `keptWarnedFile?: boolean` + the warning reason string) if needed to surface the Tier-1 override. No extracted values, no document text.

## Types

`documentSourceRef.ts`:
```ts
export interface IntakeDocumentSourceRef {
  kind: 'document';
  path: string;      // workspace path under the matter folder
  page?: number;     // 1-based
  snippet: string;
  extraction?: 'text' | 'ocr';
  confidence?: number; // 0-100 when OCR
}

// Compact string for ClientFact.provenance.source_ref
export function docSourceRefToString(ref: IntakeDocumentSourceRef): string; // `document:<path>#page=<n>`
export function docSourceRefFromString(s: string): IntakeDocumentSourceRef | null;

// UI/Client Map SourceRef (src/platform/clientMap/types.ts)
export function docSourceRefToUi(ref: IntakeDocumentSourceRef): SourceRef; // { kind:'document', ref: path, locator: page?`p. ${page}`:undefined, snippet }
```

## Reader rules (`documentReader.ts`)

- Input: a workspace path (validated under the matter folder) + the workspace service to read bytes.
- **PDF:** `extractPdfText(bytes)`. If `encrypted` → return `{ status: 'unreadable', reason: 'encrypted' }` (a "needs advisor view" outcome, NOT a throw). If `scanned` AND `isOcrEngineAvailable()` → rasterize each page (the pdf-extract page renderer) and `ocrPageImage` **sequentially** (mirror `MemoryService.indexPdfFile` — one page at a time, release each canvas), collecting per-page text + confidence. Otherwise use the native page text.
- **Image (`image/*`):** if `isOcrEngineAvailable()`, OCR locally → text + confidence; else `{ status: 'unreadable', reason: 'no_ocr' }`. Never send an image anywhere.
- **Office docs:** out of scope for Wave 4. Return `{ status: 'unreadable', reason: 'unsupported_type' }`.
- Output `DocumentReadResult`: `{ status: 'read'; pages: Array<{ page: number; text: string; extraction: 'text'|'ocr'; confidence?: number }> } | { status: 'unreadable'; reason: string }`.
- Low-confidence OCR (mean word confidence < 60, the pipeline's `OCR_LOW_CONFIDENCE`) must be surfaced as low confidence and must NOT later become a high-trust fact proposal (Lane 3 respects this; Lane 2 just carries the confidence honestly).

## Classifier rules (`documentClassifier.ts`)

- Concatenate read page text, call `classifyObservedKind(text, filename)` from Lane 1.
- Produce `DocumentClassification`: `{ kind: DocumentKind; side?: LicenseSide; confidence: 'high'|'medium'|'low'; sourceRefs: IntakeDocumentSourceRef[]; evidence: string[] }`.
- Confidence: `high` when strong single-kind signals + readable text; `medium` when OCR mid-confidence or weaker signals; `low` when OCR < 60 or ambiguous. A wrong-doc / unknown classification is allowed and produces NO fact — it can feed a "needs advisor view" review card later.
- Build one `IntakeDocumentSourceRef` per page that contributed a signal (path + page + a short snippet around the strongest matched signal + extraction kind + confidence).

## Acceptance tests (`documentClassifier.test.ts`)

- A PDF fixture (native text) yields page-indexed text and source refs; classifier returns the right `kind` with page refs.
- A scanned PDF with OCR available yields OCR source refs carrying `confidence` and `extraction:'ocr'`.
- A low-confidence OCR result is surfaced `confidence:'low'` and is NOT marked high-trust.
- A wrong/unknown document classifies without producing any fact-bearing output.
- The reader REFUSES a path outside the matter folder (assert it throws / returns unreadable for `../` and absolute escapes).
- `docSourceRefToString` / `docSourceRefFromString` round-trip; `docSourceRefToUi` yields `{kind:'document', locator:'p. N'}`.

(You may need small synthetic fixtures. Create minimal ones under `tests/fixtures/intake-document-detective/` — Lane 4 will consolidate the full set later; keep yours minimal and labelled.)

## Checks to run (report exact pass/fail)

```
npx vitest run src/platform/intake/documentClassifier.test.ts src/platform/intake
npx tsc --noEmit
node scripts/eslint-gate.mjs
```

Confirm Lane 1's tests still pass if you refactored `documentDetectiveRules.ts`:
```
npx vitest run tests/unit/intake/documentDetectiveRules.test.ts
```

## Finish

Commit on `lp/intake-w4-doc-core` with a conventional message containing the phrase `W4-LANE2-DOC-CORE-LOCAL-READ`. Do NOT push. Report the exact check results in your final message and state the branch is clean. (The dispatcher detects completion by your process exiting — just finish normally after committing.)
