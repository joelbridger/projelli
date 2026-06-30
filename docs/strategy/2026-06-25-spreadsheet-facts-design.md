# Spreadsheet facts path (Ticket 8) — design

> **Status:** DESIGN (not built), 2026-06-25. Authored by Codex (gpt-5.5) on a read-only investigation of the repo, reviewed by the lead. This is the plan for making the local model reliable on spreadsheet questions: compute the math deterministically in Rust and feed the model already-computed, citable facts (it never does the arithmetic itself). Implement as a focused follow-up (Rust + a cold build + a demo-sheet bench).

---

# Design Doc: Advisor Prep Hero Local-AI Spreadsheet Facts Path

## Goal

Advisor Prep Hero’s embedded local model is `Qwen3-4B-Instruct-2507`. It is good enough for cited writing over retrieved text, but small local models are not reliable at spreadsheet math. The fix is: **do spreadsheet math in Rust, then give the model already-computed, citable facts.**

That means the model should not read raw rows and decide “the total is probably X.” Rust should produce facts like:

```text
client-portfolio.xlsx Sheet1!B2:B40 total = $1,234,567.89 (39 numeric cells; blanks ignored).
```

Then the existing RAG citation system can retrieve and verify that exact fact.

## 1. Current State

### `.xlsx` in Rust RAG

There is already `.xlsx` extraction.

Key files:

- `src-tauri/src/commands/rag/extractor.rs`
- `src-tauri/src/commands/rag/office.rs`
- `src-tauri/src/commands/rag/mod.rs`
- `src-tauri/src/commands/rag/store.rs`

Current behavior:

- `.xlsx` is indexable.
- `extractor.rs` classifies `.xlsx` as `IndexKind::Xlsx`.
- `office.rs` parses workbook XML by hand using `zip` + `quick-xml`.
- It extracts each non-empty worksheet into plain row text.
- Rows are joined with `" | "`.
- Formula text is not indexed. Cached formula values may appear only if Excel stored them in `<v>`.
- No totals, balances, allocation math, date ranges, or named-range facts are computed.

Important current code facts:

- `TEXT_EXTENSIONS` includes `csv`, so CSV is treated as raw text.
- `OFFICE_EXTENSIONS` includes `xlsx`.
- `office.rs` explicitly says `calamine` was rejected in planning because the current path avoids a new dependency tree.
- `extract_xlsx_sections(bytes)` returns `Vec<OfficeSection>`.
- `build_section_chunks()` bands sheet chunks like PDF pages so citations can say “sheet N.”
- `SourceType::Xlsx { sheet_number }` stores `source_type = "xlsx"` and `page_number = sheet_number`.

So the answer to “is there any spreadsheet extraction now?” is:

**Yes, but only text extraction for RAG. There is no deterministic spreadsheet facts path yet.**

### `.csv` today

CSV has two paths:

- Rust RAG: `.csv` is plain UTF-8 text and goes through normal text chunking.
- Frontend open-file context: `src/platform/utils/ai-file-context.ts` uses `parseSpreadsheet()` from `src/platform/utils/spreadsheet-io.ts` and flattens rows into tab-separated text.

The frontend spreadsheet viewer uses SheetJS and a small TypeScript formula engine, but that is **not** the trusted RAG path. It is UI/open-file context, not encrypted LanceDB citation storage.

## 2. Existing RAG Pipeline

The current RAG path is:

```text
file path
  -> extractor::classify()
  -> extract text/sections
  -> chunker::chunk_text()
  -> embedder::embed_documents_batched()
  -> store::upsert_chunks_for_path() or store::upsert_grouped()
  -> LanceDB chunks table
  -> rag_retrieve()
  -> buildWorkspaceContextBlock()
  -> model answer
  -> verifyCitations()
  -> rag_verify_citation()
```

The key pieces:

- `rag_index_file()` and `rag_index_workspace()` call the Rust indexer.
- `extract_embed_one_file()` is the timed, no-database-write extraction path for full workspace indexing.
- `index_one_file()` is the single-file watcher path.
- `store::build_batch()` writes encrypted chunk text, vector, source type, matter id, privilege, locator, and encrypted path.
- `rag_retrieve()` embeds the query and returns `RagHit[]`.
- `buildWorkspaceContextBlock()` injects retrieved chunks into the model prompt.
- `rag_verify_citation()` point-lookups the chunk id and verifies the cited text exists in that stored chunk.

### Where spreadsheet facts plug in

The right insertion point is **after `.xlsx` extraction and before embedding**.

For `.xlsx`, the pipeline should become:

```text
read workbook bytes
  -> parse workbook into cells/sheets/named ranges
  -> produce existing worksheet text sections
  -> compute deterministic spreadsheet facts
  -> chunk/embed both:
       A. raw sheet text chunks
       B. computed fact chunks
  -> write all rows in one grouped upsert
```

This should plug into both:

- `extract_embed_one_file()` for workspace walks
- `index_one_file()` for watcher/single-file indexing

That keeps full indexing and file-change indexing identical.

## 3. Facts To Compute

Each fact should be one short line. The line is the citation text. It must include:

- file name/path through the RAG hit
- sheet name
- Excel locator/range
- computed value
- enough method detail to be honest

Recommended v1 facts for financial advisors:

### Column Totals

Detect numeric columns with headers like:

- Balance
- Market Value
- Current Value
- Amount
- Cost Basis
- Income
- Contribution
- Withdrawal
- Fee

Example fact:

```text
Holdings!D2:D41 total = $2,418,932.14 (40 numeric cells; blanks ignored).
```

Citation locator:

```text
Holdings!D2:D41
```

### Per-Account Balances

Detect account columns paired with balance/value columns:

- Account
- Account Name
- Registration
- Custodian
- Client
- Household

Example fact:

```text
Accounts!A2:D9 account balance for "Robert IRA" = $1,402,118.22, from Accounts!D3.
```

For holdings-style sheets with multiple rows per account:

```text
Holdings!A2:D41 account balance for "Joint Taxable" = $384,210.09, summed from Holdings!D12:D24.
```

### Allocation Percentages

Detect category/asset-class columns paired with market value columns:

- Asset Class
- Category
- Sector
- Sleeve
- Model Bucket

Example facts:

```text
Holdings!C2:D41 allocation for "Equities" = 62.4% ($1,509,730.82 of $2,418,932.14).
Holdings!C2:D41 allocation total check = 100.0% across 5 categories.
```

### Date Ranges

Detect date-like columns:

- Date
- Trade Date
- Statement Date
- As Of Date
- Effective Date
- Maturity Date

Example:

```text
Transactions!B2:B188 date range = 2025-01-02 to 2025-12-31 (187 date cells).
```

### Row Counts

Example:

```text
Transactions!A2:F188 row count = 187 data rows (header row excluded).
```

### Named Ranges

Parse `xl/workbook.xml` defined names.

Examples:

```text
Named range "PortfolioTotal" refers to Summary!B8 and value = $2,418,932.14.
Named range "RiskScore" refers to Summary!B12 and value = 73.
Named range "HoldingsTable" refers to Holdings!A1:D41 and contains 40 data rows.
```

## 4. Implementation Design

### Dependency Recommendation

Do **not** add `calamine` for v1.

Reason: the current Rust office extractor intentionally uses `zip` + `quick-xml`, and `src-tauri/Cargo.toml` documents that `calamine` was rejected to avoid a new dependency tree.

Use the existing OOXML approach and add one small math dependency:

```toml
rust_decimal = "1"
```

Reason: advisor money math should not rely on floating point. OOXML cell values are strings, so money-like numbers can be parsed into decimals before summing.

For CSV facts, either:

- v1 defer CSV computed facts and keep CSV as raw text, or
- add `csv = "1"` in a follow-up.

Smallest robust version: **`.xlsx` only first.**

### New Rust Module

Add:

```text
src-tauri/src/commands/rag/spreadsheet_facts.rs
```

Responsibilities:

- Parse workbook sheets into cells.
- Parse shared strings.
- Parse workbook-defined names.
- Preserve sheet order and sheet names.
- Convert cell coordinates to Excel locators.
- Infer tables and headers.
- Compute fact lines.
- Return fact chunks with locators.

Suggested shapes:

```rust
pub struct WorkbookFacts {
    pub facts: Vec<SpreadsheetFact>,
    pub warnings: Vec<String>,
}

pub struct SpreadsheetFact {
    pub kind: SpreadsheetFactKind,
    pub sheet_number: u32,
    pub sheet_name: String,
    pub locator: String,
    pub text: String,
    pub confidence: FactConfidence,
}

pub enum SpreadsheetFactKind {
    ColumnTotal,
    AccountBalance,
    AllocationPercent,
    DateRange,
    RowCount,
    NamedRange,
}

pub enum FactConfidence {
    Deterministic,
    Heuristic,
}
```

Important rule:

- `ColumnTotal`, `DateRange`, `RowCount`, and `NamedRange` can often be deterministic.
- `AccountBalance` and `AllocationPercent` are partly heuristic because they depend on header detection. Mark that internally, and phrase facts honestly.

### RAG Store Integration

Add a new source type:

```rust
SourceType::XlsxFact { sheet_number: u32 }
```

Map it in `store::build_batch()` to:

```text
source_type = "xlsx_fact"
page_number = sheet_number
locator = fact locator
```

No LanceDB schema change is needed because `source_type`, `page_number`, and `locator` already exist.

But bump:

```rust
INDEX_VERSION: 10 -> 11
```

Reason: old indexes do not contain computed spreadsheet facts. A re-index is needed even without a schema change.

### Chunk IDs

Current citation IDs are based on:

```text
chunk_id(path, paragraph_index)
```

Avoid collisions with normal sheet chunks by reserving a high paragraph band for facts:

```rust
const SPREADSHEET_FACT_PARAGRAPH_START: u32 = 50_000;
```

Then fact `i` gets:

```text
paragraph_index = 50_000 + i
```

Each fact should usually be one chunk. Do not run large fact blocks through generic paragraph chunking unless a fact exceeds the normal chunk size.

### Frontend Type Updates

Update:

```text
src/platform/utils/tauri-commands.ts
```

Add:

```ts
sourceType?: 'text' | 'pdf' | 'mail' | 'docx' | 'xlsx' | 'xlsx_fact' | 'pptx' | 'rtf' | 'transcript';
```

Update labels in:

```text
src/features/ask/askHelpers.ts
src/features/ask/renderingHelpers.tsx
src/platform/rag/workspaceCommand.ts
```

For `xlsx_fact`, prefer the fact locator:

```text
client-portfolio.xlsx · Holdings!D2:D41
```

### Prompt Context

Update `buildWorkspaceContextBlock()` so facts are visibly treated as computed facts, not raw document text.

Example context entry:

```text
[3] /path/client-portfolio.xlsx computed fact Holdings!D2:D41
Holdings!D2:D41 total = $2,418,932.14 (40 numeric cells; blanks ignored).
```

Keep the prompt-injection wrapper exactly as it is. Spreadsheet cell text is user-controlled data.

### Citation Verification

Reuse existing `rag_verify_citation()`.

Why this works:

- The fact text is stored as encrypted chunk text.
- Retrieval returns the chunk id and chunk text.
- The model cites the source.
- Verification checks the stored chunk contains the quoted fact text.

No separate verifier is needed for v1.

## 5. Tests And Demo Bench

### Rust Unit Tests

Add tests in `spreadsheet_facts.rs` using a new advisor fixture:

```text
tests/fixtures/matter-corpus/advisor-portfolio.xlsx
```

Assertions:

- Extracts workbook sheets and named ranges.
- Computes row count excluding header.
- Computes `Market Value` total exactly.
- Computes per-account balances.
- Computes allocation percentages whose total is 100.0% within 0.01.
- Computes date range from date column.
- Handles blanks and text cells without counting them as zero.
- Does not evaluate formulas without cached values.

### RAG Integration Test

Add or extend a `src-tauri/tests/rag_*.rs` test:

- Index `advisor-portfolio.xlsx`.
- Retrieve “What is the total portfolio value?”
- Assert top results include `source_type = "xlsx_fact"`.
- Assert `chunk_text` contains the exact total.
- Call `rag_verify_citation()` on the fact chunk and expect `Verified`.

### Windows Demo Bench

Use the existing local-AI Windows bench pattern.

Scenario:

1. Seed demo workspace with an advisor workbook.
2. Re-index.
3. Ask with Advisor Prep Hero Local AI:

```text
What is the client’s total portfolio value and allocation by asset class?
```

Expected:

- Answer includes the exact Rust-computed total.
- Answer includes exact allocation percentages.
- Citations point to computed spreadsheet facts.
- No uncited arithmetic claim appears.
- If the model adds unsupported math, citation verification fails or the answer renders as not cited.

## 6. Risks

### Formula Values

Rust should not try to become Excel in v1.

Use cached numeric values only. If a formula cell has no cached value, skip it and include a warning fact if needed:

```text
Summary!B8 formula cell has no cached value; Advisor Prep Hero did not compute it.
```

### Header Detection

Advisor spreadsheets vary. Header inference can be wrong.

Mitigation:

- Keep fact text honest.
- Prefer conservative headers.
- Require at least two numeric values before producing a total.
- Mark heuristic facts internally.

### Money Formatting

Use `rust_decimal`. Format money-like columns to cents only when the header or number format indicates currency. Otherwise preserve plain decimal formatting.

### Too Many Facts

Large workbooks can produce too many facts.

Set caps:

```text
max facts per workbook: 300
max facts per sheet: 75
max cells inspected per sheet: reuse/align with existing 50,000 cap
```

### Retrieval Ranking

Computed facts should be easy to retrieve.

Fact lines should include advisor words users ask for:

```text
total portfolio value
market value total
allocation
account balance
date range
```

Do not stuff keywords unnaturally, but include clear labels.

## 7. Smallest Robust Version

Implement v1 as:

- `.xlsx` only.
- Reuse current `zip` + `quick-xml` parser style.
- Add `spreadsheet_facts.rs`.
- Add `SourceType::XlsxFact`.
- Store fact chunks in the existing LanceDB `chunks` table.
- Reuse existing retrieval and citation verification.
- Add one advisor workbook fixture and one end-to-end RAG assertion.
- Bump `INDEX_VERSION` to force re-index.

Do **not** add full formula evaluation, `.xls`, pivot tables, charts, or cross-sheet formula solving in Ticket 8. Those are later work. The valuable user promise is narrower and stronger:

**Advisor Prep Hero does the arithmetic it can prove, cites the exact sheet/range, and refuses to make uncited spreadsheet claims.**
tokens used
246,767
# Design Doc: Advisor Prep Hero Local-AI Spreadsheet Facts Path

## Goal

Advisor Prep Hero’s embedded local model is `Qwen3-4B-Instruct-2507`. It is good enough for cited writing over retrieved text, but small local models are not reliable at spreadsheet math. The fix is: **do spreadsheet math in Rust, then give the model already-computed, citable facts.**

That means the model should not read raw rows and decide “the total is probably X.” Rust should produce facts like:

```text
client-portfolio.xlsx Sheet1!B2:B40 total = $1,234,567.89 (39 numeric cells; blanks ignored).
```

Then the existing RAG citation system can retrieve and verify that exact fact.

## 1. Current State

### `.xlsx` in Rust RAG

There is already `.xlsx` extraction.

Key files:

- `src-tauri/src/commands/rag/extractor.rs`
- `src-tauri/src/commands/rag/office.rs`
- `src-tauri/src/commands/rag/mod.rs`
- `src-tauri/src/commands/rag/store.rs`

Current behavior:

- `.xlsx` is indexable.
- `extractor.rs` classifies `.xlsx` as `IndexKind::Xlsx`.
- `office.rs` parses workbook XML by hand using `zip` + `quick-xml`.
- It extracts each non-empty worksheet into plain row text.
- Rows are joined with `" | "`.
- Formula text is not indexed. Cached formula values may appear only if Excel stored them in `<v>`.
- No totals, balances, allocation math, date ranges, or named-range facts are computed.

Important current code facts:

- `TEXT_EXTENSIONS` includes `csv`, so CSV is treated as raw text.
- `OFFICE_EXTENSIONS` includes `xlsx`.
- `office.rs` explicitly says `calamine` was rejected in planning because the current path avoids a new dependency tree.
- `extract_xlsx_sections(bytes)` returns `Vec<OfficeSection>`.
- `build_section_chunks()` bands sheet chunks like PDF pages so citations can say “sheet N.”
- `SourceType::Xlsx { sheet_number }` stores `source_type = "xlsx"` and `page_number = sheet_number`.

So the answer to “is there any spreadsheet extraction now?” is:

**Yes, but only text extraction for RAG. There is no deterministic spreadsheet facts path yet.**

### `.csv` today

CSV has two paths:

- Rust RAG: `.csv` is plain UTF-8 text and goes through normal text chunking.
- Frontend open-file context: `src/platform/utils/ai-file-context.ts` uses `parseSpreadsheet()` from `src/platform/utils/spreadsheet-io.ts` and flattens rows into tab-separated text.

The frontend spreadsheet viewer uses SheetJS and a small TypeScript formula engine, but that is **not** the trusted RAG path. It is UI/open-file context, not encrypted LanceDB citation storage.

## 2. Existing RAG Pipeline

The current RAG path is:

```text
file path
  -> extractor::classify()
  -> extract text/sections
  -> chunker::chunk_text()
  -> embedder::embed_documents_batched()
  -> store::upsert_chunks_for_path() or store::upsert_grouped()
  -> LanceDB chunks table
  -> rag_retrieve()
  -> buildWorkspaceContextBlock()
  -> model answer
  -> verifyCitations()
  -> rag_verify_citation()
```

The key pieces:

- `rag_index_file()` and `rag_index_workspace()` call the Rust indexer.
- `extract_embed_one_file()` is the timed, no-database-write extraction path for full workspace indexing.
- `index_one_file()` is the single-file watcher path.
- `store::build_batch()` writes encrypted chunk text, vector, source type, matter id, privilege, locator, and encrypted path.
- `rag_retrieve()` embeds the query and returns `RagHit[]`.
- `buildWorkspaceContextBlock()` injects retrieved chunks into the model prompt.
- `rag_verify_citation()` point-lookups the chunk id and verifies the cited text exists in that stored chunk.

### Where spreadsheet facts plug in

The right insertion point is **after `.xlsx` extraction and before embedding**.

For `.xlsx`, the pipeline should become:

```text
read workbook bytes
  -> parse workbook into cells/sheets/named ranges
  -> produce existing worksheet text sections
  -> compute deterministic spreadsheet facts
  -> chunk/embed both:
       A. raw sheet text chunks
       B. computed fact chunks
  -> write all rows in one grouped upsert
```

This should plug into both:

- `extract_embed_one_file()` for workspace walks
- `index_one_file()` for watcher/single-file indexing

That keeps full indexing and file-change indexing identical.

## 3. Facts To Compute

Each fact should be one short line. The line is the citation text. It must include:

- file name/path through the RAG hit
- sheet name
- Excel locator/range
- computed value
- enough method detail to be honest

Recommended v1 facts for financial advisors:

### Column Totals

Detect numeric columns with headers like:

- Balance
- Market Value
- Current Value
- Amount
- Cost Basis
- Income
- Contribution
- Withdrawal
- Fee

Example fact:

```text
Holdings!D2:D41 total = $2,418,932.14 (40 numeric cells; blanks ignored).
```

Citation locator:

```text
Holdings!D2:D41
```

### Per-Account Balances

Detect account columns paired with balance/value columns:

- Account
- Account Name
- Registration
- Custodian
- Client
- Household

Example fact:

```text
Accounts!A2:D9 account balance for "Robert IRA" = $1,402,118.22, from Accounts!D3.
```

For holdings-style sheets with multiple rows per account:

```text
Holdings!A2:D41 account balance for "Joint Taxable" = $384,210.09, summed from Holdings!D12:D24.
```

### Allocation Percentages

Detect category/asset-class columns paired with market value columns:

- Asset Class
- Category
- Sector
- Sleeve
- Model Bucket

Example facts:

```text
Holdings!C2:D41 allocation for "Equities" = 62.4% ($1,509,730.82 of $2,418,932.14).
Holdings!C2:D41 allocation total check = 100.0% across 5 categories.
```

### Date Ranges

Detect date-like columns:

- Date
- Trade Date
- Statement Date
- As Of Date
- Effective Date
- Maturity Date

Example:

```text
Transactions!B2:B188 date range = 2025-01-02 to 2025-12-31 (187 date cells).
```

### Row Counts

Example:

```text
Transactions!A2:F188 row count = 187 data rows (header row excluded).
```

### Named Ranges

Parse `xl/workbook.xml` defined names.

Examples:

```text
Named range "PortfolioTotal" refers to Summary!B8 and value = $2,418,932.14.
Named range "RiskScore" refers to Summary!B12 and value = 73.
Named range "HoldingsTable" refers to Holdings!A1:D41 and contains 40 data rows.
```

## 4. Implementation Design

### Dependency Recommendation

Do **not** add `calamine` for v1.

Reason: the current Rust office extractor intentionally uses `zip` + `quick-xml`, and `src-tauri/Cargo.toml` documents that `calamine` was rejected to avoid a new dependency tree.

Use the existing OOXML approach and add one small math dependency:

```toml
rust_decimal = "1"
```

Reason: advisor money math should not rely on floating point. OOXML cell values are strings, so money-like numbers can be parsed into decimals before summing.

For CSV facts, either:

- v1 defer CSV computed facts and keep CSV as raw text, or
- add `csv = "1"` in a follow-up.

Smallest robust version: **`.xlsx` only first.**

### New Rust Module

Add:

```text
src-tauri/src/commands/rag/spreadsheet_facts.rs
```

Responsibilities:

- Parse workbook sheets into cells.
- Parse shared strings.
- Parse workbook-defined names.
- Preserve sheet order and sheet names.
- Convert cell coordinates to Excel locators.
- Infer tables and headers.
- Compute fact lines.
- Return fact chunks with locators.

Suggested shapes:

```rust
pub struct WorkbookFacts {
    pub facts: Vec<SpreadsheetFact>,
    pub warnings: Vec<String>,
}

pub struct SpreadsheetFact {
    pub kind: SpreadsheetFactKind,
    pub sheet_number: u32,
    pub sheet_name: String,
    pub locator: String,
    pub text: String,
    pub confidence: FactConfidence,
}

pub enum SpreadsheetFactKind {
    ColumnTotal,
    AccountBalance,
    AllocationPercent,
    DateRange,
    RowCount,
    NamedRange,
}

pub enum FactConfidence {
    Deterministic,
    Heuristic,
}
```

Important rule:

- `ColumnTotal`, `DateRange`, `RowCount`, and `NamedRange` can often be deterministic.
- `AccountBalance` and `AllocationPercent` are partly heuristic because they depend on header detection. Mark that internally, and phrase facts honestly.

### RAG Store Integration

Add a new source type:

```rust
SourceType::XlsxFact { sheet_number: u32 }
```

Map it in `store::build_batch()` to:

```text
source_type = "xlsx_fact"
page_number = sheet_number
locator = fact locator
```

No LanceDB schema change is needed because `source_type`, `page_number`, and `locator` already exist.

But bump:

```rust
INDEX_VERSION: 10 -> 11
```

Reason: old indexes do not contain computed spreadsheet facts. A re-index is needed even without a schema change.

### Chunk IDs

Current citation IDs are based on:

```text
chunk_id(path, paragraph_index)
```

Avoid collisions with normal sheet chunks by reserving a high paragraph band for facts:

```rust
const SPREADSHEET_FACT_PARAGRAPH_START: u32 = 50_000;
```

Then fact `i` gets:

```text
paragraph_index = 50_000 + i
```

Each fact should usually be one chunk. Do not run large fact blocks through generic paragraph chunking unless a fact exceeds the normal chunk size.

### Frontend Type Updates

Update:

```text
src/platform/utils/tauri-commands.ts
```

Add:

```ts
sourceType?: 'text' | 'pdf' | 'mail' | 'docx' | 'xlsx' | 'xlsx_fact' | 'pptx' | 'rtf' | 'transcript';
```

Update labels in:

```text
src/features/ask/askHelpers.ts
src/features/ask/renderingHelpers.tsx
src/platform/rag/workspaceCommand.ts
```

For `xlsx_fact`, prefer the fact locator:

```text
client-portfolio.xlsx · Holdings!D2:D41
```

### Prompt Context

Update `buildWorkspaceContextBlock()` so facts are visibly treated as computed facts, not raw document text.

Example context entry:

```text
[3] /path/client-portfolio.xlsx computed fact Holdings!D2:D41
Holdings!D2:D41 total = $2,418,932.14 (40 numeric cells; blanks ignored).
```

Keep the prompt-injection wrapper exactly as it is. Spreadsheet cell text is user-controlled data.

### Citation Verification

Reuse existing `rag_verify_citation()`.

Why this works:

- The fact text is stored as encrypted chunk text.
- Retrieval returns the chunk id and chunk text.
- The model cites the source.
- Verification checks the stored chunk contains the quoted fact text.

No separate verifier is needed for v1.

## 5. Tests And Demo Bench

### Rust Unit Tests

Add tests in `spreadsheet_facts.rs` using a new advisor fixture:

```text
tests/fixtures/matter-corpus/advisor-portfolio.xlsx
```

Assertions:

- Extracts workbook sheets and named ranges.
- Computes row count excluding header.
- Computes `Market Value` total exactly.
- Computes per-account balances.
- Computes allocation percentages whose total is 100.0% within 0.01.
- Computes date range from date column.
- Handles blanks and text cells without counting them as zero.
- Does not evaluate formulas without cached values.

### RAG Integration Test

Add or extend a `src-tauri/tests/rag_*.rs` test:

- Index `advisor-portfolio.xlsx`.
- Retrieve “What is the total portfolio value?”
- Assert top results include `source_type = "xlsx_fact"`.
- Assert `chunk_text` contains the exact total.
- Call `rag_verify_citation()` on the fact chunk and expect `Verified`.

### Windows Demo Bench

Use the existing local-AI Windows bench pattern.

Scenario:

1. Seed demo workspace with an advisor workbook.
2. Re-index.
3. Ask with Advisor Prep Hero Local AI:

```text
What is the client’s total portfolio value and allocation by asset class?
```

Expected:

- Answer includes the exact Rust-computed total.
- Answer includes exact allocation percentages.
- Citations point to computed spreadsheet facts.
- No uncited arithmetic claim appears.
- If the model adds unsupported math, citation verification fails or the answer renders as not cited.

## 6. Risks

### Formula Values

Rust should not try to become Excel in v1.

Use cached numeric values only. If a formula cell has no cached value, skip it and include a warning fact if needed:

```text
Summary!B8 formula cell has no cached value; Advisor Prep Hero did not compute it.
```

### Header Detection

Advisor spreadsheets vary. Header inference can be wrong.

Mitigation:

- Keep fact text honest.
- Prefer conservative headers.
- Require at least two numeric values before producing a total.
- Mark heuristic facts internally.

### Money Formatting

Use `rust_decimal`. Format money-like columns to cents only when the header or number format indicates currency. Otherwise preserve plain decimal formatting.

### Too Many Facts

Large workbooks can produce too many facts.

Set caps:

```text
max facts per workbook: 300
max facts per sheet: 75
max cells inspected per sheet: reuse/align with existing 50,000 cap
```

### Retrieval Ranking

Computed facts should be easy to retrieve.

Fact lines should include advisor words users ask for:

```text
total portfolio value
market value total
allocation
account balance
date range
```

Do not stuff keywords unnaturally, but include clear labels.

## 7. Smallest Robust Version

Implement v1 as:

- `.xlsx` only.
- Reuse current `zip` + `quick-xml` parser style.
- Add `spreadsheet_facts.rs`.
- Add `SourceType::XlsxFact`.
- Store fact chunks in the existing LanceDB `chunks` table.
- Reuse existing retrieval and citation verification.
- Add one advisor workbook fixture and one end-to-end RAG assertion.
- Bump `INDEX_VERSION` to force re-index.

Do **not** add full formula evaluation, `.xls`, pivot tables, charts, or cross-sheet formula solving in Ticket 8. Those are later work. The valuable user promise is narrower and stronger:

**Advisor Prep Hero does the arithmetic it can prove, cites the exact sheet/range, and refuses to make uncited spreadsheet claims.**
