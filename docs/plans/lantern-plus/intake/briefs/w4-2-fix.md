# Wave 4 Lane 2 — ONE batched fix round (adversarial review findings)

**Branch:** `lp/intake-w4-doc-core` (your prior work committed at HEAD in this worktree).
**You are Codex.** Fix ALL FIVE findings in one round, add a test per fix, re-verify, commit. Do NOT push. TDD: failing test first where practical.

## [P0] Client-folder boundary is not actually enforced — `src/platform/intake/documentReader.ts:60` (`assertPathWithinMatterFolder`) + read at ~128
`assertPathWithinMatterFolder` is a LEXICAL string check only. `WorkspaceService.readFileBinary`'s symlink protection guards the WORKSPACE root, NOT the client-folder boundary. So a symlink inside client A's folder pointing at `/Clients/B/secret.pdf` (still inside the workspace) passes both checks, and the byte read follows the link — a cross-client data leak. This breaks per-client isolation (the core privacy promise). The comment at lines ~57-58 claiming WorkspaceService rejects such symlinks is FALSE for the client-folder boundary.
**Fix (robust, no shortcut):**
- Before reading, RESOLVE the real target path (follow symlinks) and re-assert the RESOLVED path is inside the matched client folder — not just lexically inside, and not merely inside the workspace. Reject if the resolved target escapes the client folder.
- Use WorkspaceService's symlink facilities (see `src/platform/fs/types.ts`: symlink check + resolve; `WorkspaceService` has `isSymlink`/`resolveSymlink`-style methods and lstat via the FS plugin). Widen the `DocumentReaderDependencies` Pick to include what you need (e.g. `readFileBinary` plus a realpath/symlink-resolve). If a fully-resolved realpath API isn't available, at minimum: detect if the path (or any path component) is a symlink, resolve it, and re-run the client-folder containment check on the resolved target; refuse to read a symlink whose target leaves the client folder.
- Keep the lexical check too (defense in depth), but the RESOLVED-path containment check is the real gate.
**Test:** a symlink inside client A's folder targeting a file in client B's folder (or outside the workspace) is REFUSED (returns unreadable / throws), and the bytes are never read. Use the test workspace/FS harness the other intake tests use; if you must, model the symlink via a fake workspaceService whose resolve returns an out-of-folder path and assert the guard rejects it.

## [P2] Source-ref string round-trip is ambiguous — `src/platform/intake/documentSourceRef.ts:6-17`
A path containing `#page=2` mis-parses: `document:report#page=2` with no page field parses to path `report`, page `2`, so a citation can point at the wrong file.
**Fix:** use an unambiguous encoding — `encodeURIComponent` the path (so `#` cannot appear literally), or a structured JSON encoding. `docSourceRefFromString` must reject malformed/ambiguous refs (return null). Keep `docSourceRefToString`/`FromString` a strict round-trip.
**Test:** a path literally containing `#page=` round-trips exactly (path preserved, page from the real field), and a malformed ref returns null.

## [P2] OCR confidence dropped in UI conversion — `src/platform/intake/documentSourceRef.ts:20-25`
`docSourceRefToUi` drops `confidence`/`extraction`, so a low-confidence OCR result can appear as a normal (trusted-looking) source with no low-confidence signal.
**Fix:** carry the extraction kind + confidence into the UI source model so low-confidence OCR is visibly marked, OR refuse to convert a low-confidence OCR ref into a normal verified-looking source (surface it as low-confidence). Do not silently present low-confidence OCR as a clean citation. (If `SourceRef` has no confidence field, encode it honestly in the locator/snippet, e.g. `p. N (low-confidence scan)`, or add an optional field — additive.)
**Test:** a low-confidence OCR source ref carries/── shows its low-confidence marker through `docSourceRefToUi`.

## [P2] Unbounded OCR pages — DoS — `src/platform/intake/documentReader.ts:103-105`
A hostile scanned PDF can claim a huge page count; the reader OCRs every claimed page with no cap, freezing the advisor app.
**Fix:** enforce a conservative cap on pages OCR'd (e.g. a MAX_OCR_PAGES constant, ~30-50) and a total byte cap; when exceeded return a "needs advisor view" unreadable result rather than grinding. Keep native-text PDFs (no OCR) working normally.
**Test:** a PDF claiming an excessive page count returns the needs-advisor-view/unreadable result and does not attempt OCR on all pages (assert `ocrPageImage` called at most the cap).

## [P2] `address`-alone promotes to drivers_license — `src/platform/intake/documentDetectiveRules.ts:141-147` (the observed-kind promotion)
When observed kind is `unknown` but a side hint exists, the code promotes to `drivers_license`. A single generic front signal like `address` (present on many financial docs) then mislabels e.g. a tax return as a driver's license.
**Fix:** require STRONG driver's-license evidence before treating a side hint as a `drivers_license` KIND. Promote unknown→drivers_license only when the side detection rests on license-specific signals (e.g. back-side AAMVA/barcode tokens like `pdf417`/`aamva`, or multiple/strong front signals that are license-specific — not a lone generic word such as `address`). A lone weak/generic front signal must NOT convert kind to drivers_license. This is a shared file (Lane 1 uses it for the client page too) — keep all existing `documentDetectiveRules.test.ts` and Lane 1 behavior green; the client-side license-side detection for a REAL license (strong signals) must still work.
**Test:** a tax return whose text includes `address` (and tax signals) is NOT classified `drivers_license`; a real license with strong front/back signals still classifies as `drivers_license` with the right side.

## Non-negotiables (unchanged)
Advisor-side local only; no network content read; no cloud OCR. Model/document text NEVER chooses matter_id/request_id/item_id/path/fact_kind. Lane 2 writes NO facts. Single source of truth: reuse `classifyObservedKind` (do not fork signal tables). `matter`/`matter_id` never renamed. Light theme/tokens, no em dashes, no time estimates.

## Verify (report exact pass/fail)
```
npx vitest run src/platform/intake/documentClassifier.test.ts src/platform/intake tests/unit/intake/documentDetectiveRules.test.ts
npx tsc --noEmit
node scripts/eslint-gate.mjs
```

## Finish
Commit on `lp/intake-w4-doc-core` with a message containing `W4-LANE2-FIX-PATHCONFINE-SOURCEREF-OCRCAP`. Do NOT push. Report exact check results and confirm the tree is clean. Do NOT run notify-jameson or any notification command. (The dispatcher detects completion by your process exiting.)
