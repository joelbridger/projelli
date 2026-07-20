# Parked defaults triage — 2026-07-20

Base: `origin/merge/combined` at `ded7f3b96`.

## Dispositions

### CSV formula escaping — fixed

Owner: Documents / spreadsheet export.

`serializeSpreadsheet(..., 'csv')` is the user-reachable CSV export/save path.
It now enables PapaParse formula escaping for text beginning with `=`, `+`,
`-`, `@`, tab, or carriage return. A plain negative numeric literal such as
`-42` is deliberately excluded from the `-` rule, so it remains exactly
`-42`; formula-like text such as `-2+3` is prefixed with an apostrophe.

Guard: `tests/unit/spreadsheet-io.test.ts` — “neutralizes formula-leading text
while preserving a negative number”. The test failed against the disabled
default and passes with the production option.

### General PDF.js extraction evaluation — fixed

Owner: Platform document extraction.

Disposition: attacker-reachable. The shared extractor is reached by arbitrary
files selected, pasted, or dropped into Ask
(`src/features/ask/AIChatViewer.tsx`), by imported workspace PDFs indexed in
`src/app/fileOps/useFileImport.ts` → `src/platform/rag/MemoryService.ts`, by
client intake (`src/platform/intake/documentReader.ts`), and by imported ACATS
statements (`src/features/acats/extraction.ts`). None of those sources is
provably advisor-authored.

Both general `pdfjsLib.getDocument` calls now share
`UNTRUSTED_PDFJS_OPTIONS`, with evaluation and XFA disabled. Text extraction
and OCR page rasterization do not need dynamic evaluation.

Guard: `tests/security/document-parser-safety.test.tsx` — “disables PDF.js
evaluation at every general extraction load site”. It counts every general
PDF.js document load and requires each one to use the fail-closed options.
The real simple-PDF extraction tests also pass with evaluation disabled.

### SheetJS generated cell HTML — documented residual

Owner: Documents / SpreadsheetViewer.

Untrusted source: yes. `useFileImport` accepts files from the OS picker and
global drop surface; `writeDroppedFiles` preserves arbitrary `.xlsx` bytes;
`MainPanel` then sends the content to `SpreadsheetViewer` and
`parseSpreadsheet`.

DOM-injected: no. SheetJS may populate its optional `cell.h` representation,
but `parseWorksheet` copies only `display`, `raw`, and `formula` into the app's
model. `SheetGrid.Cell` renders `display` as a React text child. It does not use
`dangerouslySetInnerHTML`, `innerHTML`, or SheetJS HTML generation.

Premise guard: `tests/security/document-parser-safety.test.tsx` — “renders an
attacker-controlled spreadsheet cell only as React text”. It builds a real
workbook containing `<img onerror>` and `<script>` payloads, confirms SheetJS
did generate a cell HTML field, passes the workbook through the production
parser and cell component, then requires zero `img` or `script` nodes. The
guard depends on the trusted application render path, not on an
attacker-controlled flag.

### Mammoth `extractRawText` — confirmed by execution

Owner: Platform document extraction.

The API still has no options object. A generated DOCX whose visible text was
`<script>window.__MAMMOTH_XSS__=1</script><img src=x onerror=alert(1)>` was run
through Mammoth 1.12.0. `extractRawText` returned those exact characters plus
paragraph newlines and no messages. It did not turn the text into DOM nodes or
generate additional HTML. In production, `plainText` goes to AI context or
React text children; the separate HTML/preview paths have their own render
safety controls. This is therefore a confirmation, not a parser-default
finding.

### ZIP slip — handled

Owner: Platform document extraction.

JSZip 3.10.1 sanitizes relative entry names while preserving the original in
`unsafeOriginalName`. A crafted `../../etc/passwd` entry loaded as
`etc/passwd`; lookup by the traversal name returned `null`. The app also never
extracts these archives to disk: DOCX code selects the fixed
`word/document.xml` entry, and PPTX code accepts only
`ppt/slides/slide<N>.xml` before parsing in memory.

Guard: `tests/security/document-parser-safety.test.tsx` — “sanitizes traversal
entry names before an office parser can select them”.

### ZIP bomb — open finding, not fixed in this lane

Owner: Platform document extraction / security.

An 8,480-byte crafted JSZip archive expanded one accepted slide entry to
8,388,608 bytes (989× amplification). `JSZip.loadAsync` and
`entry.async('string')` accepted and fully inflated it; there is no per-entry
size, total expanded-size, compression-ratio, time, or cancellation limit in
`extractPptxText`, `extractSlides`, or the Mammoth/JSZip DOCX extraction path.
Those paths process imported client files, so this is attacker-reachable.

Separate fix scope: introduce one bounded Office-archive loader for every
untrusted DOCX/PPTX extraction path; reject excessive entry count, declared
uncompressed bytes, compression ratio, and total expanded bytes before XML
parsing; add small valid-file controls plus high-ratio and many-entry attack
fixtures. JSZip does not expose a supported streaming decompression limit, so
the implementation may need central-directory preflight or a bounded archive
library. This crosses multiple parsers and is intentionally not attempted in
this focused lane.
