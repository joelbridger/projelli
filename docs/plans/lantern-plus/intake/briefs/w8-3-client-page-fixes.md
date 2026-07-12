# Wave 8 Lane 3 — Fix Round (from adversarial codex-review)

**Branch:** `lp/intake-w8-client-page` (same branch, new commit on top of `69747dce`).
**You are Codex, the builder.** Fix these findings, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

An independent adversarial review (`codex-review --base lp/intake-w8`) of your Lane 3 diff found four issues. **Fix three of them** — the fourth (missing sealed source bytes on the issued item) is a cross-lane gap the wave lead is already fixing on the `lp/intake-w8-advisor` branch (Lane 1's `PdfFillRequestItem` type gains a `sealed_source_pdf_b64` field, Lane 2's composer populates it) — **do not duplicate that fix here**, your `sealedPdfSourceBytes()` reader in `App.tsx` is already correct and will start working once that lands; leave it as-is.

## Finding 1 [P1] — Overlay radio selection isn't drawn for real option values

`intake-page/src/pdfFill/preparePdfFillSubmission.ts:148-151`: for an overlay radio field, only the literal strings `true`/`yes`/`on` produce a drawn mark. A valid selected option from the field's actual reviewed `options` list (e.g. `single`, `married`, `no`) passes validation but nothing gets drawn — the completed PDF can be submitted with a required radio answer that looks blank to the advisor.

**Fix:** for an overlay radio (and check the select-kind overlay path too, if it has the same issue), draw a mark for whichever option the client actually selected, matched against the field's own `options` list (each option has a reviewed `value`), not against a hardcoded truthy-string check. If the overlay map doesn't currently carry per-option draw positions (only one `rect` per field), that's a real gap in what Lane 1's `PdfOverlayFieldMapEntry` shape can express for a multi-option field — check `src/platform/intake/pdfTemplates/templateContract.ts`'s overlay entry shape before assuming you need to change it; if a single `rect` genuinely can't represent "which option was marked" for a radio group with more than one physical mark position on the page, report this as a design gap in your final report rather than guessing at a schema change outside your file ownership. If the existing shape can already represent this correctly (e.g. one rect is one physical checkbox-style mark and "selected" vs "not selected" is what should be drawn, with only one radio field mapped per actual answer state), fix the drawing logic to match the real selected value instead of the truthy-string check.

**Test:** add a case with a selected radio value that isn't `true`/`yes`/`on` (e.g. the existing golden fixture's `delivery` field with value `email` rather than `mail`) and assert the mark is actually drawn for the selected option.

## Finding 2 [P2] — External PDF actions aren't rejected before finalizing

`intake-page/src/pdfFill/preparePdfFillSubmission.ts:24-26`: the safety scan doesn't check for external action tokens (`/URI`, `/GoToR`, `/SubmitForm`). A reviewed source PDF containing one of these can pass both the source-safety check and the output-safety check, and `pdf-lib` can preserve the action through to the returned completed PDF — violating the "treat the source PDF as hostile input, reject active/external content" non-negotiable from the brief.

**Fix:** extend whatever structural safety scan you already run (on the source before render and/or on the output before submit — check both, but this must be caught on the *source* early enough that a hostile template never even gets rendered/filled, and re-checked on the *output* as defense in depth) to reject these action types. Deny at minimum `/URI`, `/GoToR`, `/SubmitForm`, and anything else in the same PDF action-dictionary family your existing scan already partially covers (check what it currently denies and extend the same list/pattern rather than building a second parallel check).

**Test:** a fixture PDF with an embedded `/URI` (or `/GoToR`/`/SubmitForm`) action is rejected at the appropriate stage (source-load rejection if you catch it there, or pre-submit rejection if that's where your scan runs) with a clear message, and no submission is attempted.

## Finding 3 [P2] — Base64 size guard runs after full decode, not before

`intake-page/src/App.tsx:75-80` (`sealedPdfSourceBytes`): the size cap (50 MiB) is checked only after `atob()` has already expanded the entire base64 string and after a byte-by-byte copy loop has run. A malformed or hostile sealed checklist with a very large encoded value can exhaust the browser's memory/CPU before your size check ever runs — defeating the point of having a size guard at all.

**Fix:** check the **encoded string's length** against a size threshold derived from the raw-byte limit (base64 expands by roughly 4/3, so compute or conservatively over-estimate the equivalent encoded-length ceiling) **before** calling `atob()` or doing the decode loop. Reject immediately if the encoded value is already too large, without ever attempting the expensive decode.

**Test:** a `sealed_source_pdf_b64` value whose encoded length alone already exceeds the size ceiling is rejected without the decode loop running (you can assert this behaviorally — the function returns `undefined`/rejects promptly — a timing-based test isn't required, just prove the size check actually gates before use).

## Checks to run (same suite as the original brief; report exact pass/fail)

```
timeout 300 npm --prefix intake-page test
timeout 120 npm --prefix intake-page run typecheck
timeout 300 npx playwright test intake-page/tests/pdf-fill.spec.ts --project=chromium
```

(Use whichever exact Playwright invocation your original lane run actually used, if it differed from this.)

Do not run `npm run gate` or anything touching Rust/cargo.

## Finish

Commit on `lp/intake-w8-client-page` with a conventional message containing the phrase `W8-LANE3-CLIENT-PAGE-FIXES`. Do NOT push. Do NOT merge. In your final report: confirm all three findings are fixed (or explain the design-gap report for Finding 1 if the overlay schema genuinely can't express it), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
