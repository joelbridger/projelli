# Projelli v2.0 Stream A3: PDF to RAG Indexing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing M1 RAG indexer to extract, chunk, embed, and store text from `.pdf` files found in the workspace. Add a `Settings → Memory → Include PDFs in workspace index` opt-in toggle (default OFF). Preserve the existing query API shape, extending `RagHit` with a `sourceType` discriminator and `pageNumber` so the UI can label PDF results and open the PDF viewer at the right page on click.

**Branch:** `feature/stream-a`. Continues from Plan A2 (already committed on this branch). All A2 foundations are in place: `src/lib/pdf-extract.ts` exports `extractPdfText(bytes): Promise<PdfExtractionResult>` returning `{ pages: string[], pageCount: number, encrypted: boolean, scanned: boolean }`. The `pdf_extracted` audit event type was verified or added in A2. The PDF viewer component exists at `src/components/media/PDFViewer.tsx`.

**Architecture:** Plan A3 is primarily a Rust-side extension to the existing indexer. The file walker in `src-tauri/src/commands/rag/mod.rs` gains a PDF branch inside `rag_index_workspace` and `rag_index_file`. A new `src-tauri/src/commands/rag/pdf_indexer.rs` module handles the PDF-specific flow: read bytes, call a small Rust-side wrapper that invokes the JavaScript-side `extractPdfText` via Tauri's invoke bridge, chunk by page with `chunker::chunk_text` fallback for long pages, and upsert using the existing `store::upsert_chunks_for_path`. The LanceDB schema gains one new column (`source_type: Utf8`) so PDF chunks are labeled and can be filtered. The `RagHit` wire type gains `sourceType` and `pageNumber` fields. A settings toggle gates the feature. The query path requires no changes, only query-result rendering does.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 4.4 (A4 in spec numbering; A3 in plan sequence).

**Tech Stack:** TypeScript 5 strict, React 18, Vite 5, Zustand, Vitest, Tauri 2, Rust (tokio + lancedb + fastembed-rs), shadcn/ui + Tailwind CSS.

---

## Discovery Summary (Task 1 findings embedded here)

This section records what was found by reading the existing M1 RAG code. The implementation tasks below depend on these exact paths and types.

### File walker

`src-tauri/src/commands/rag/mod.rs` function `rag_index_workspace()` (line 169). It calls `walkdir::WalkDir::new(&workspace)`, filters directories with `extractor::is_skipped_dir_name`, and filters files with `extractor::is_indexable`. Both `rag_index_workspace` and `rag_index_file` delegate to `index_one_file(table, path)`.

### Indexable extensions

`src-tauri/src/commands/rag/extractor.rs` constant `TEXT_EXTENSIONS` lists: `md, markdown, txt, text, aichat, workflow, json, csv, log, yml, yaml, toml`. PDF is explicitly excluded (line 102 test `assert!(!is_indexable(...".pdf")))`). A comment marks `.xlsx/.docx/.pptx/.rtf` as "M1-followup". `.pdf` needs the same treatment.

### Chunk type

`src-tauri/src/commands/rag/chunker.rs` struct `Chunk { path: String, paragraph_index: u32, text: String, start_offset: usize, end_offset: usize }`. The `chunk_text(path, text)` function splits on double-newlines with `~384-token` windows and `64-token` overlap.

### Embedder

`src-tauri/src/commands/rag/embedder.rs`. `embed_documents(docs: &[String]) -> Result<Vec<Vec<f32>>>` and `embed_query(query: &str) -> Result<Vec<f32>>`. Singleton `fastembed-rs MultilingualE5Small`, 384 dims. No changes needed to this module.

### Store schema

`src-tauri/src/commands/rag/store.rs`. LanceDB table `chunks`, schema: `id (Utf8), path (Utf8), paragraph_index (UInt32), text (Utf8), vector (FixedSizeList<Float32, 384>), indexed_at (Int64)`. No `source_type` or `page_number` column exists yet. The store needs a schema migration/extension.

### Wire type (Rust)

`src-tauri/src/commands/rag/mod.rs` struct `Hit { path, chunk_text, score, paragraph_index }`. Serialized as camelCase for the frontend.

### Wire type (TypeScript)

`src/utils/tauri-commands.ts` interface `RagHit { path: string, chunkText: string, score: number, paragraphIndex: number }`. Extended here with `sourceType?: 'text' | 'pdf'` and `pageNumber?: number`.

### `MemoryService` frontend wrapper

`src/modules/memory/MemoryService.ts`. Thin wrapper around Tauri commands. The `indexWorkspace()` call is gated by `isMemoryEnabled()`. Plan A3 adds a second gate: `isPdfIndexingEnabled()` (a reader over the new setting), which is checked inside the Rust command rather than the TS wrapper so the walker behavior is self-contained on the Rust side.

### Settings schema

`src/settings/schema.ts`, category `memory`. Currently three entries: `memoryEnabled`, `factsInjection`, `factsAutoAccept`. Plan A3 adds `includePdfsInWorkspaceIndex` (toggle, default `false`).

### Citation click path

`src/components/ai/AIChatViewer.tsx` `onCitationClick(path, paragraphIndex)` delegates to `onOpenFileAtPath(path, paragraphIndex)`. For PDF hits the click should open the PDF viewer and pass the page number. `paragraphIndex` on PDF chunks maps to page index (0-based), so callers can derive `page = paragraphIndex + 1`.

### `extractPdfText` (from A2)

`src/lib/pdf-extract.ts` (TypeScript, browser-side). Returns `{ pages: string[], pageCount: number, encrypted: boolean, scanned: boolean }`. Each element of `pages` is the extracted text of one page.

**Key constraint:** `extractPdfText` is a TypeScript/PDF.js function that runs in the renderer process. The Rust-side RAG indexer cannot call it directly. The integration point is a new Tauri command `rag_extract_pdf_pages(path)` that the Rust-side indexer invokes via `app.emit` + JS-side handler, OR the Rust side reads the file bytes and the JS side calls both `extractPdfText` and then `rag_index_pdf_chunks(path, pages)` to hand the extracted text back to Rust for embedding and storage. The JS-bridge pattern is simpler and avoids a Rust PDF library dependency.

**Chosen pattern:** JS-driven PDF indexing. A new TypeScript function `indexPdfFile(path)` in `src/modules/memory/MemoryService.ts` reads the PDF bytes via `WorkspaceService.readBinary`, calls `extractPdfText`, then calls a new Tauri command `rag_index_pdf_chunks(path, pages, pageCount)` that does embedding and storage entirely on the Rust side. This keeps PDF.js on the JS side and the embedding model on the Rust side, matching where they already live.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src-tauri/src/commands/rag/pdf_indexer.rs` | `index_pdf_chunks(table, path, pages, page_count)` - per-page chunking, embedding, upsert |
| `tests/unit/rag/pdf-indexer.test.ts` | Unit tests for JS-side PDF indexing coordination |
| `tests/unit/settings/includePdfsToggle.test.ts` | Settings toggle unit tests |

### Files to modify

| Path | Change |
|---|---|
| `src-tauri/src/commands/rag/extractor.rs` | Add `pdf` to `PDF_EXTENSIONS` constant (separate from `TEXT_EXTENSIONS`). Update `is_indexable` to optionally include PDF (gated by a parameter). |
| `src-tauri/src/commands/rag/store.rs` | Add `source_type: Utf8` and `page_number: UInt32` columns to schema. Update `build_schema`, `build_batch`, `nearest` reader, and `upsert_chunks_for_path` to accept the new columns. Migrate existing tables on open. |
| `src-tauri/src/commands/rag/mod.rs` | Register new `rag_index_pdf_chunks` command. Update `Hit` struct with `source_type` and `page_number`. Update `rag_retrieve` to map them. |
| `src/utils/tauri-commands.ts` | Extend `RagHit` with `sourceType?: 'text' | 'pdf'` and `pageNumber?: number`. Add `ragIndexPdfChunks(path, pages, pageCount)` wrapper. |
| `src/modules/memory/MemoryService.ts` | Add `indexPdfFile(path, workspaceService)` method. Add `isPdfIndexingEnabled` reader. |
| `src/settings/schema.ts` | Add `includePdfsInWorkspaceIndex` toggle entry under `memory` category. |
| `src/stores/settingsStore.ts` | No schema changes needed. Dynamic settings pattern handles it via `schema.ts`. Verify `getSetting('includePdfsInWorkspaceIndex')` returns false by default. |
| `src/hooks/useMemoryWiring.ts` | Wire `includePdfsInWorkspaceIndex` reader. When setting is ON, after standard `rag_index_workspace`, walk `.pdf` files and call `MemoryService.indexPdfFile` for each. When setting toggled OFF, call `MemoryService.deletePdfChunks()`. |
| `src/modules/memory/workspaceCommand.ts` | Extend `buildWorkspaceContextBlock` to show page number in citation label for PDF hits. |
| `src/components/ai/AIChatViewer.tsx` | In citation click handler, detect `.pdf` path and open PDF viewer at correct page using `pageNumber` from `RagHit`. |
| `src/components/settings/MemoryRagSettingsSection.tsx` (or wherever Memory settings are rendered in SettingsModal) | Add toggle for `includePdfsInWorkspaceIndex`. |
| `src-tauri/src/commands/rag/chunker.rs` | Add `chunk_page_text(path, text, page_number)` helper that wraps `chunk_text` and stamps `paragraph_index` as page-relative chunk offset. |
| `src-tauri/src/lib.rs` | Register `rag_index_pdf_chunks` in the Tauri handler list. |

### Files to NOT modify

- `src/lib/pdf-extract.ts` (A2 shipped it, reuse as-is)
- `src-tauri/src/commands/rag/embedder.rs` (no changes needed)
- Any provider files (A1/A2 scope)
- Any plugin, marketplace, mobile, or i18n files

---

## Task Decomposition

Seven groups, 11 tasks total. Groups I through IV are Rust-side. Groups V through VI are TypeScript-side. Group VII is verification.

- Group I: Discovery verification (Task 1)
- Group II: Schema extension + Rust PDF indexer module (Tasks 2-3)
- Group III: Wire PDF command into the Tauri backend (Task 4)
- Group IV: JS-side PDF indexing coordination (Tasks 5-6)
- Group V: Settings toggle (Task 7)
- Group VI: Query result display extensions (Tasks 8-9)
- Group VII: Verification + handoff (Tasks 10-11)

---

# Group I: Discovery Verification

## Task 1: Verify A2 foundations and existing RAG schema

Before writing any code, confirm the exact state of the codebase so the implementation tasks have a stable starting point.

**Files:**
- Read: `src/lib/pdf-extract.ts` (verify A2 shipped it)
- Read: `src-tauri/src/commands/rag/store.rs` (verify schema has no `source_type` column yet)
- Read: `src-tauri/src/commands/rag/extractor.rs` (verify `.pdf` is not in `TEXT_EXTENSIONS`)
- Read: `src/utils/tauri-commands.ts` (verify `RagHit` shape)

- [ ] **Step 1: Confirm `extractPdfText` exists**

```bash
grep -n "extractPdfText\|PdfExtractionResult" src/lib/pdf-extract.ts | head -10
```

Expected: `export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractionResult>` and `export interface PdfExtractionResult { pages: string[]; pageCount: number; encrypted: boolean; scanned: boolean; }`.

If the file does not exist, stop and report. Plan A3 cannot proceed until A2 is fully executed.

- [ ] **Step 2: Confirm LanceDB schema has no source_type column**

```bash
grep -n "source_type\|page_number" src-tauri/src/commands/rag/store.rs
```

Expected: no matches. If `source_type` already exists, update the plan tasks accordingly (skip schema extension steps).

- [ ] **Step 3: Confirm PDF is not in extractor TEXT_EXTENSIONS**

```bash
grep -n "\"pdf\"\|pdf" src-tauri/src/commands/rag/extractor.rs | head -10
```

Expected: PDF appears only in a test asserting it is NOT indexable.

- [ ] **Step 4: Confirm RagHit wire shape**

```bash
grep -n "RagHit\|sourceType\|pageNumber" src/utils/tauri-commands.ts | head -10
```

Expected: `RagHit` has `path`, `chunkText`, `score`, `paragraphIndex`. No `sourceType` or `pageNumber` yet.

- [ ] **Step 5: Confirm pdf_extracted audit event type exists**

```bash
grep -n "pdf_extracted\|pdfExtracted" src/types/audit.ts src/modules/audit/AuditService.ts 2>/dev/null | head -10
```

Record whether the audit event type was added by A2 or needs to be added in A3. Plan A3 emits `pdf_extracted` with `mode: 'workspace-index'` to distinguish workspace indexing from chat attachment extraction.

---

# Group II: Schema Extension + Rust PDF Indexer Module

## Task 2: Extend LanceDB schema with source_type and page_number

The existing schema has 6 columns. Two new columns are added: `source_type` (Utf8, values `'text'` or `'pdf'`) and `page_number` (UInt32, value is 0 for text chunks, 1-based page number for PDF chunks). Existing text chunks written before this change will not have these columns; LanceDB handles schema evolution when opening an existing table, but we must handle the case where old rows lack these columns by reading them with a null-safe cast.

**Files:**
- Modify: `src-tauri/src/commands/rag/store.rs`

- [ ] **Step 1: Update `build_schema()` to include new columns**

In `store.rs`, update `build_schema()`:

```rust
pub fn build_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("path", DataType::Utf8, false),
        Field::new("paragraph_index", DataType::UInt32, false),
        Field::new("text", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                EMBEDDING_DIM as i32,
            ),
            false,
        ),
        Field::new("indexed_at", DataType::Int64, false),
        // A3: source_type discriminates text vs PDF chunks.
        // Nullable so pre-A3 rows stored without the column don't error.
        Field::new("source_type", DataType::Utf8, true),
        // A3: 1-based page number for PDF chunks; 0 for text chunks.
        // Nullable for pre-A3 rows.
        Field::new("page_number", DataType::UInt32, true),
    ]))
}
```

- [ ] **Step 2: Add SourceType enum and update Chunk-adjacent types**

In `store.rs`, add a simple type alias for clarity in build_batch:

```rust
/// Identifies how a chunk was produced. Determines which columns
/// are meaningful in the chunks table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceType {
    Text,
    Pdf { page_number: u32 },
}
```

- [ ] **Step 3: Update `build_batch` to accept source metadata**

`build_batch` currently takes `rows: &[(Chunk, Vec<f32>)]`. Extend the signature to:

```rust
pub fn build_batch(
    rows: &[(Chunk, Vec<f32>)],
    source_type: SourceType,
) -> Result<RecordBatch>
```

Inside the function, build `source_type_arr` (StringArray of `"text"` or `"pdf"`) and `page_number_arr` (UInt32Array, 0 for text chunks, the page number for PDF chunks). Append these arrays to the RecordBatch columns.

For text chunks, `source_type = "text"`, `page_number = 0`.
For PDF chunks, `source_type = "pdf"`, `page_number = chunk.paragraph_index + 1` (paragraph_index will be the 0-based page index, so page_number is 1-based for display).

- [ ] **Step 4: Update `upsert_chunks_for_path` signature**

```rust
pub async fn upsert_chunks_for_path(
    table: &Table,
    path: &str,
    rows: Vec<(Chunk, Vec<f32>)>,
    source_type: SourceType,
) -> Result<()>
```

Pass `source_type` through to `build_batch`. Existing callers in `mod.rs` pass `SourceType::Text`.

- [ ] **Step 5: Update `StoredHit` and `nearest` to read new columns**

Extend `StoredHit`:

```rust
pub struct StoredHit {
    pub path: String,
    pub paragraph_index: u32,
    pub text: String,
    pub distance: f32,
    // A3 additions:
    pub source_type: Option<String>,
    pub page_number: Option<u32>,
}
```

In `nearest()`, read `source_type` and `page_number` columns with null-safe access. Pre-A3 rows will not have these columns (LanceDB returns null for missing rows); use `None` as default.

- [ ] **Step 6: Update schema tests**

In `store.rs` tests, update `schema_has_six_fields_in_canonical_order` to assert 8 fields:

```rust
assert_eq!(
    names,
    vec!["id", "path", "paragraph_index", "text", "vector", "indexed_at",
         "source_type", "page_number"]
);
```

Add a test `build_batch_text_source_type_is_text` and `build_batch_pdf_source_type_is_pdf`.

- [ ] **Step 7: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | head -40
```

Fix all errors before proceeding.

---

## Task 3: Create pdf_indexer.rs module

This module contains the Rust-side function `index_pdf_chunks` that receives already-extracted page text strings from the JS side and handles chunking, embedding, and storage. The JS side is responsible for calling `extractPdfText` via PDF.js; this module never reads a PDF file itself.

**Files:**
- Create: `src-tauri/src/commands/rag/pdf_indexer.rs`
- Modify: `src-tauri/src/commands/rag/mod.rs` (add `pub mod pdf_indexer;`)

- [ ] **Step 1: Create `pdf_indexer.rs`**

```rust
// PDF chunk indexing for the RAG indexer (Plan A3).
//
// The JS side (src/modules/memory/MemoryService.ts) calls extractPdfText via
// PDF.js, which runs in the renderer process. It then calls the Tauri command
// `rag_index_pdf_chunks` passing the extracted page strings. This module
// handles everything from that point forward: per-page chunking, batch
// embedding, and upsert into the LanceDB store.
//
// Design notes:
// - One chunk per page for short pages (< TARGET_BYTES from chunker).
// - Long pages are split further using the existing chunk_text logic.
// - paragraph_index on PDF chunks is the 0-based page index. For multi-chunk
//   pages, subsequent chunks within the same page get paragraph_index
//   page_index * MAX_CHUNKS_PER_PAGE + sub_index. MAX_CHUNKS_PER_PAGE is
//   conservatively 100 (no PDF page will produce 100 chunks).
// - source_type = SourceType::Pdf { page_number } where page_number is
//   1-based for display.

use anyhow::Result;
use lancedb::Table;

use super::chunker::{chunk_text, Chunk, TARGET_TOKENS, BYTES_PER_TOKEN};
use super::embedder::embed_documents;
use super::store::{upsert_chunks_for_path, SourceType};

const MAX_CHUNKS_PER_PAGE: u32 = 100;
const TARGET_BYTES: usize = TARGET_TOKENS * BYTES_PER_TOKEN;

/// Index the text content of a PDF file into the LanceDB table.
///
/// `pages` is the already-extracted text for each page (from PDF.js via the
/// JS bridge). `page_count` is the total page count from the PDF metadata.
///
/// Returns the number of chunks successfully stored.
pub async fn index_pdf_chunks(
    table: &Table,
    path: &str,
    pages: &[String],
    page_count: u32,
) -> Result<usize> {
    let _ = page_count; // stored in metadata but not needed for chunking

    let mut all_chunks: Vec<Chunk> = Vec::new();

    for (page_idx, page_text) in pages.iter().enumerate() {
        let trimmed = page_text.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.len() <= TARGET_BYTES {
            // Short page: one chunk = one page.
            all_chunks.push(Chunk {
                path: path.to_string(),
                paragraph_index: page_idx as u32 * MAX_CHUNKS_PER_PAGE,
                text: trimmed.to_string(),
                start_offset: 0,
                end_offset: trimmed.len(),
            });
        } else {
            // Long page: run through the standard text chunker.
            let sub_chunks = chunk_text(path, trimmed);
            for (sub_idx, mut c) in sub_chunks.into_iter().enumerate() {
                c.paragraph_index = page_idx as u32 * MAX_CHUNKS_PER_PAGE
                    + sub_idx as u32;
                all_chunks.push(c);
            }
        }
    }

    if all_chunks.is_empty() {
        // No extractable text. Delete any stale rows and return.
        super::store::delete_path(table, path).await?;
        return Ok(0);
    }

    let texts: Vec<String> = all_chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = embed_documents(&texts).await?;
    let count = all_chunks.len();

    // Build rows. Each row carries SourceType::Pdf with the 1-based page number.
    // We derive the page number from paragraph_index / MAX_CHUNKS_PER_PAGE.
    let rows: Vec<(Chunk, Vec<f32>, SourceType)> = all_chunks
        .into_iter()
        .zip(vectors)
        .map(|(chunk, vec)| {
            let page_num = chunk.paragraph_index / MAX_CHUNKS_PER_PAGE + 1;
            (chunk, vec, SourceType::Pdf { page_number: page_num })
        })
        .collect();

    upsert_pdf_chunks_for_path(table, path, rows).await?;
    Ok(count)
}
```

Note: `upsert_pdf_chunks_for_path` is a thin wrapper over `store::upsert_chunks_for_path` that handles the heterogeneous `SourceType` per row. Since the existing `upsert_chunks_for_path` takes one `SourceType` for the whole batch, split into one `upsert` call per page if needed, or update `upsert_chunks_for_path` to accept per-row source types. The simpler approach is a single pass since all rows in a PDF are `SourceType::Pdf`; the only variation is the `page_number`. Update `store::build_batch` to derive `page_number` from the chunk's `paragraph_index` when `source_type` is `Pdf`, making the signature cleaner.

- [ ] **Step 2: Declare the module in mod.rs**

In `src-tauri/src/commands/rag/mod.rs`, add after the existing `pub mod store;` line:

```rust
pub mod pdf_indexer;
```

- [ ] **Step 3: Add unit tests for `pdf_indexer.rs`**

In the `#[cfg(test)]` block of `pdf_indexer.rs`, add:

```rust
#[test]
fn short_page_produces_one_chunk_per_page() {
    // Two short pages -> two chunks with paragraph_index 0 and 100.
    let pages = vec!["First page text.".to_string(), "Second page text.".to_string()];
    // Call the chunking logic without the database (extract the chunk-building
    // loop into a testable helper function `build_pdf_chunks(path, pages)`).
    let chunks = build_pdf_chunks("/a.pdf", &pages);
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[0].paragraph_index, 0);
    assert_eq!(chunks[1].paragraph_index, MAX_CHUNKS_PER_PAGE);
}

#[test]
fn long_page_produces_multiple_chunks_within_page_band() {
    let long_page = "word ".repeat(500); // > TARGET_BYTES
    let pages = vec![long_page];
    let chunks = build_pdf_chunks("/b.pdf", &pages);
    assert!(chunks.len() >= 2);
    // All chunks should be in page 0's band (0..MAX_CHUNKS_PER_PAGE).
    for c in &chunks {
        assert!(c.paragraph_index < MAX_CHUNKS_PER_PAGE);
    }
}

#[test]
fn empty_page_is_skipped() {
    let pages = vec!["  \n  ".to_string(), "Real content.".to_string()];
    let chunks = build_pdf_chunks("/c.pdf", &pages);
    assert_eq!(chunks.len(), 1);
    // The surviving chunk is from page index 1.
    assert_eq!(chunks[0].paragraph_index, MAX_CHUNKS_PER_PAGE);
}
```

This requires extracting the chunk-building loop from `index_pdf_chunks` into a public `build_pdf_chunks(path: &str, pages: &[String]) -> Vec<Chunk>` helper that can be tested without async.

- [ ] **Step 4: Verify compilation and unit tests**

```bash
cd src-tauri && cargo test commands::rag::pdf_indexer 2>&1 | tail -20
```

All three tests pass.

---

# Group III: Wire PDF Command into the Tauri Backend

## Task 4: Add rag_index_pdf_chunks Tauri command and extend Hit struct

The JS side needs to call into Rust to store embedded PDF chunks. This task adds the Tauri command, extends the `Hit` wire struct with the new fields, and updates the `rag_retrieve` handler to populate them.

**Files:**
- Modify: `src-tauri/src/commands/rag/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend `Hit` struct**

In `mod.rs`, update `Hit`:

```rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub chunk_text: String,
    pub score: f32,
    pub paragraph_index: u32,
    // A3 additions. Optional so pre-A3 rows serialize cleanly (null in JS).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<u32>,
}
```

- [ ] **Step 2: Update `rag_retrieve` to populate new fields**

In the mapping from `StoredHit -> Hit`:

```rust
let mut hits: Vec<Hit> = raw
    .into_iter()
    .map(|h| Hit {
        path: h.path,
        chunk_text: h.text,
        score: embedder::cosine_distance_to_score(h.distance),
        paragraph_index: h.paragraph_index,
        source_type: h.source_type,
        page_number: h.page_number,
    })
    .collect();
```

- [ ] **Step 3: Add `rag_index_pdf_chunks` command**

In `mod.rs`, add after `rag_delete_path`:

```rust
/// Index pre-extracted PDF page text into the RAG store.
///
/// Called by the JS side after running `extractPdfText` in the renderer.
/// `pages` is one string per page. Empty strings are skipped. `page_count`
/// is the PDF's total page count (metadata only, not used for chunking).
///
/// Returns immediately for empty `pages`. Idempotent — re-indexing drops
/// stale rows first.
#[tauri::command]
pub async fn rag_index_pdf_chunks(
    state: State<'_, RagState>,
    path: String,
    pages: Vec<String>,
    page_count: u32,
) -> Result<u32, String> {
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    let count = pdf_indexer::index_pdf_chunks(&table, &path, &pages, page_count)
        .await
        .map_err(|e| format!("index_pdf_chunks: {e}"))?;
    Ok(count as u32)
}
```

- [ ] **Step 4: Register the command in lib.rs**

In `src-tauri/src/lib.rs`, find the `.invoke_handler(tauri::generate_handler![...])` block and add:

```rust
commands::rag::rag_index_pdf_chunks,
```

alongside the existing `rag_index_file`, `rag_index_workspace`, etc.

- [ ] **Step 5: Update Hit serialization test**

In `mod.rs` tests, add a test that `Hit` with `source_type` and `page_number` set serializes the new fields, and that `Hit` without them (the `None` variants) omits them from the JSON (because of `skip_serializing_if`):

```rust
#[test]
fn hit_with_source_type_includes_fields_in_json() {
    let hit = Hit {
        path: "/w/doc.pdf".into(),
        chunk_text: "page text".into(),
        score: 0.9,
        paragraph_index: 0,
        source_type: Some("pdf".into()),
        page_number: Some(1),
    };
    let s = serde_json::to_string(&hit).expect("serialize");
    assert!(s.contains("\"sourceType\":\"pdf\""), "got {}", s);
    assert!(s.contains("\"pageNumber\":1"), "got {}", s);
}

#[test]
fn hit_without_source_type_omits_fields() {
    let hit = Hit {
        path: "/w/doc.md".into(),
        chunk_text: "para".into(),
        score: 0.87,
        paragraph_index: 3,
        source_type: None,
        page_number: None,
    };
    let s = serde_json::to_string(&hit).expect("serialize");
    assert!(!s.contains("sourceType"), "got {}", s);
    assert!(!s.contains("pageNumber"), "got {}", s);
}
```

- [ ] **Step 6: Full Rust check**

```bash
cd src-tauri && cargo check 2>&1 | head -40
```

Zero errors. Fix any before continuing.

---

# Group IV: JS-Side PDF Indexing Coordination

## Task 5: Extend tauri-commands.ts and MemoryService with PDF indexing

Add the TypeScript-side bindings for the new Tauri command, and add `indexPdfFile` to `MemoryService`.

**Files:**
- Modify: `src/utils/tauri-commands.ts`
- Modify: `src/modules/memory/MemoryService.ts`

- [ ] **Step 1: Extend `RagHit` in tauri-commands.ts**

In `src/utils/tauri-commands.ts`, update the `RagHit` interface:

```typescript
export interface RagHit {
  path: string;
  chunkText: string;
  score: number;
  paragraphIndex: number;
  /** A3: discriminates text vs PDF chunks. Absent on pre-A3 rows. */
  sourceType?: 'text' | 'pdf';
  /** A3: 1-based page number for PDF chunks. Absent on pre-A3 rows. */
  pageNumber?: number;
}
```

- [ ] **Step 2: Add `ragIndexPdfChunks` command wrapper**

In `src/utils/tauri-commands.ts`, add after `ragDeletePath`:

```typescript
/**
 * Index pre-extracted PDF page text into the RAG store. Called after
 * `extractPdfText` produces page strings in the renderer process.
 *
 * Returns the number of chunks stored (0 if all pages were empty or skipped).
 */
export async function ragIndexPdfChunks(
  path: string,
  pages: string[],
  pageCount: number,
): Promise<number> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  return invoke<number>('rag_index_pdf_chunks', { path, pages, pageCount });
}
```

- [ ] **Step 3: Add `isPdfIndexingEnabled` reader to MemoryService**

In `src/modules/memory/MemoryService.ts`, add a second reader pattern mirroring `isEnabledReader`:

```typescript
export type PdfIndexingEnabledReader = () => boolean;

const DEFAULT_PDF_ENABLED_READER: PdfIndexingEnabledReader = () => false; // default OFF

let isPdfEnabledReader: PdfIndexingEnabledReader = DEFAULT_PDF_ENABLED_READER;

export function setPdfIndexingEnabledReader(reader: PdfIndexingEnabledReader): void {
  isPdfEnabledReader = reader;
}

export function resetPdfIndexingEnabledReader(): void {
  isPdfEnabledReader = DEFAULT_PDF_ENABLED_READER;
}

export function isPdfIndexingEnabled(): boolean {
  try {
    return isPdfEnabledReader();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Add `indexPdfFile` to MemoryService**

In the `MemoryService` object, add:

```typescript
/** Index a single PDF file into the RAG store. Reads bytes via the provided
 *  workspace service, extracts text with PDF.js, and stores chunks via the
 *  Rust-side command. No-op if memory or PDF indexing is disabled. */
async indexPdfFile(
  path: string,
  workspaceService: { readBinary: (path: string) => Promise<ArrayBuffer> },
): Promise<{ indexed: boolean; pageCount: number; reason?: string }> {
  if (!isMemoryEnabled()) return { indexed: false, pageCount: 0, reason: 'memory-disabled' };
  if (!isPdfIndexingEnabled()) return { indexed: false, pageCount: 0, reason: 'pdf-indexing-disabled' };

  let bytes: ArrayBuffer;
  try {
    bytes = await workspaceService.readBinary(path);
  } catch {
    return { indexed: false, pageCount: 0, reason: 'read-error' };
  }

  // extractPdfText is from src/lib/pdf-extract.ts (A2).
  const { extractPdfText } = await import('@/lib/pdf-extract');
  const result = await extractPdfText(new Uint8Array(bytes));

  if (result.encrypted) {
    return { indexed: false, pageCount: result.pageCount, reason: 'encrypted' };
  }
  if (result.scanned) {
    return { indexed: false, pageCount: result.pageCount, reason: 'scanned' };
  }

  const chunksStored = await ragIndexPdfChunks(path, result.pages, result.pageCount);
  return { indexed: chunksStored > 0, pageCount: result.pageCount, reason: undefined };
},

/** Remove all PDF chunks from the index. Called when the user turns OFF
 *  the includePdfsInWorkspaceIndex toggle. Best-effort — errors are silently
 *  swallowed since this is a housekeeping operation. */
async deleteAllPdfChunks(filePaths: string[]): Promise<void> {
  if (!isMemoryEnabled()) return;
  for (const path of filePaths) {
    try {
      await ragDeletePath(path);
    } catch {
      // swallow
    }
  }
},
```

Note: the `readBinary` method is on `FSBackend` (defined in `src/modules/workspace/types.ts`). The caller passes the workspace service reference.

- [ ] **Step 5: Add `ragIndexPdfChunks` import to MemoryService**

At the top of `MemoryService.ts`, add `ragIndexPdfChunks` and `ragDeletePath` to the existing import from `@/utils/tauri-commands`.

- [ ] **Step 6: Verify TypeScript compilation**

```bash
npx tsc -b --noEmit 2>&1 | head -40
```

Zero errors on the modified files.

---

## Task 6: Wire PDF indexing into useMemoryWiring

When the workspace opens (or when the toggle is turned ON), walk `.pdf` files in the workspace and call `MemoryService.indexPdfFile` for each. When the toggle is turned OFF, clean up PDF chunks.

**Files:**
- Modify: `src/hooks/useMemoryWiring.ts`

- [ ] **Step 1: Wire `isPdfIndexingEnabled` reader in the settings effect**

In the `useEffect` that calls `setMemoryEnabledReader`, also call:

```typescript
import {
  setPdfIndexingEnabledReader,
} from '@/modules/memory/MemoryService';

// Inside the useEffect:
setPdfIndexingEnabledReader(() =>
  Boolean(
    useSettingsStore.getState().getSetting<boolean>('includePdfsInWorkspaceIndex'),
  ),
);
```

- [ ] **Step 2: Add `indexWorkspacePdfs` helper**

Inside `useMemoryWiring`, add a local async function:

```typescript
async function indexWorkspacePdfs(
  root: string,
  workspaceService: { readBinary: (path: string) => Promise<ArrayBuffer> },
): Promise<void> {
  // Walk .pdf files in the workspace root via Tauri's FS commands.
  // Use the existing readDir Tauri bridge or walkdir-equivalent.
  // The simplest approach: call rag_list_pdf_files (a new lightweight
  // command) OR use the workspace file tree from workspaceStore.
  //
  // Preferred: use workspaceStore.getState().fileTree (already populated
  // when the workspace is open) and filter for .pdf extensions.
  // This avoids an extra Tauri command.
  const { fileTree } = await import('@/stores/workspaceStore').then(
    (m) => m.useWorkspaceStore.getState(),
  );

  function collectPdfs(nodes: typeof fileTree): string[] {
    if (!nodes) return [];
    const out: string[] = [];
    for (const node of nodes) {
      if (node.type === 'file' && node.name.toLowerCase().endsWith('.pdf')) {
        out.push(node.path);
      } else if (node.type === 'folder' && node.children) {
        out.push(...collectPdfs(node.children));
      }
    }
    return out;
  }

  const pdfPaths = collectPdfs(fileTree);
  for (const path of pdfPaths) {
    try {
      const r = await MemoryService.indexPdfFile(path, workspaceService);
      if (!r.indexed && r.reason && r.reason !== 'pdf-indexing-disabled' && r.reason !== 'memory-disabled') {
        log.warn(`PDF indexing skipped for ${path}: ${r.reason}`);
      }
    } catch (e) {
      log.warn(`PDF indexing error for ${path}:`, e);
    }
  }
}
```

- [ ] **Step 3: Call `indexWorkspacePdfs` after the standard workspace index**

In the per-workspace lifecycle `useEffect`, after `void MemoryService.indexWorkspace()`, add:

```typescript
// A3: if PDF indexing is enabled, also index PDF files.
if (MemoryService.isPdfIndexingEnabled && isPdfIndexingEnabled() && workspaceService) {
  void indexWorkspacePdfs(rootPath, workspaceService).catch(() => {});
}
```

Import `isPdfIndexingEnabled` from `MemoryService`.

- [ ] **Step 4: Watch for settings changes to re-trigger PDF indexing**

Add a `useEffect` that subscribes to `includePdfsInWorkspaceIndex` changes:

```typescript
useEffect(() => {
  const unsubscribe = useSettingsStore.subscribe(
    (state) => state.getSetting<boolean>('includePdfsInWorkspaceIndex'),
    (enabled) => {
      if (!rootPath || !workspaceService) return;
      if (enabled) {
        void indexWorkspacePdfs(rootPath, workspaceService).catch(() => {});
      } else {
        // Remove PDF chunks. Walk fileTree for .pdf paths, delete each.
        const { fileTree } = useWorkspaceStore.getState();
        function collectPdfs(nodes: typeof fileTree): string[] {
          if (!nodes) return [];
          const out: string[] = [];
          for (const n of nodes) {
            if (n.type === 'file' && n.name.toLowerCase().endsWith('.pdf')) out.push(n.path);
            else if (n.type === 'folder' && n.children) out.push(...collectPdfs(n.children));
          }
          return out;
        }
        void MemoryService.deleteAllPdfChunks(collectPdfs(fileTree)).catch(() => {});
      }
    },
  );
  return unsubscribe;
}, [rootPath, workspaceService]);
```

- [ ] **Step 5: Handle PDF file-watcher events**

In the existing `workspace-file-changed` listener, add a PDF branch:

```typescript
const isPdf = (p: string) => p.toLowerCase().endsWith('.pdf');

if (payload.kind === 'delete') {
  void MemoryService.deletePath(payload.path);
} else if (isPdf(payload.path) && workspaceService) {
  // Only re-index PDFs if the toggle is on.
  if (isPdfIndexingEnabled()) {
    void MemoryService.indexPdfFile(payload.path, workspaceService).catch(() => {});
  }
} else {
  void MemoryService.indexFile(payload.path);
}
```

- [ ] **Step 6: Add audit log emission for PDF workspace indexing**

When `indexPdfFile` succeeds, emit a `pdf_extracted` audit event. Extend `MemoryService.indexPdfFile` return value handling in `useMemoryWiring` to call `AuditService.log` with `{ action: 'pdf_extracted', path, pageCount, mode: 'workspace-index' }`. This reuses the same audit event type from A2.

```typescript
const r = await MemoryService.indexPdfFile(path, workspaceService);
if (r.indexed) {
  AuditService.log({
    action: 'file_update',        // reuse existing action type
    description: `PDF indexed into workspace RAG: ${path}`,
    metadata: { pdfPageCount: r.pageCount, mode: 'workspace-index' },
  });
}
```

Note: if `pdf_extracted` was added as a formal `AuditActionType` in A2, use it here. If not, `file_update` with descriptive metadata is the fallback.

- [ ] **Step 7: Verify TypeScript compilation**

```bash
npx tsc -b --noEmit 2>&1 | head -40
```

Zero errors.

---

# Group V: Settings Toggle

## Task 7: Add includePdfsInWorkspaceIndex toggle to settings

Add the toggle to the schema, verify the settings store exposes it, and render it in the Memory section of the Settings modal.

**Files:**
- Modify: `src/settings/schema.ts`
- Verify: `src/stores/settingsStore.ts` (no change needed, dynamic schema)
- Modify: `src/components/settings/SettingsModal.tsx` (or wherever Memory settings are rendered)

- [ ] **Step 1: Add setting entry to schema.ts**

In `src/settings/schema.ts`, after the `factsAutoAccept` entry (still inside the memory section):

```typescript
{
  key: 'includePdfsInWorkspaceIndex',
  category: 'memory',
  label: 'Include PDFs in workspace index',
  description:
    'When on, PDFs in your workspace are searchable via @workspace and considered for AI context. Indexing runs in the background after you toggle this on. Adds CPU work during indexing. Defaults to off.',
  type: 'toggle',
  defaultValue: false,
},
```

- [ ] **Step 2: Verify the setting resolves correctly**

Write a quick verification check (not a full test file, just a console assertion in the test suite):

In `tests/unit/settings/includePdfsToggle.test.ts`:

```typescript
/**
 * Plan A3 - includePdfsInWorkspaceIndex setting smoke tests.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA } from '@/settings/schema';

describe('includePdfsInWorkspaceIndex setting', () => {
  const entry = SETTINGS_SCHEMA.find((s) => s.key === 'includePdfsInWorkspaceIndex');

  it('exists in schema', () => {
    expect(entry).toBeDefined();
  });

  it('is in memory category', () => {
    expect(entry?.category).toBe('memory');
  });

  it('defaults to false', () => {
    expect(entry?.defaultValue).toBe(false);
  });

  it('is a toggle type', () => {
    expect(entry?.type).toBe('toggle');
  });
});
```

- [ ] **Step 3: Locate Memory settings rendering in the Settings modal**

```bash
grep -n "memoryEnabled\|Memory\|factsAutoAccept" src/components/settings/SettingsModal.tsx 2>/dev/null | head -20
```

The Settings modal renders settings by category using the schema. Verify that the toggle appears automatically because it has `category: 'memory'` and the modal iterates by category. If the modal has hardcoded memory settings instead of iterating the schema, add a manual entry for `includePdfsInWorkspaceIndex`.

- [ ] **Step 4: Confirm tooltip text is visible**

The `description` field set in Step 1 is the tooltip / helper text. Verify the rendering component shows `description` in its UI by reading the relevant section of `SettingsModal.tsx`.

- [ ] **Step 5: Run settings tests**

```bash
npm run test -- tests/unit/settings/includePdfsToggle.test.ts 2>&1 | tail -20
```

All 4 assertions pass.

---

# Group VI: Query Result Display Extensions

## Task 8: Extend workspace context block for PDF hits

When a `@workspace` query returns PDF chunks, the context block should label the source as a PDF page rather than a paragraph.

**Files:**
- Modify: `src/modules/memory/workspaceCommand.ts`

- [ ] **Step 1: Update `buildWorkspaceContextBlock` to show page numbers for PDF hits**

In `workspaceCommand.ts`, extend `buildWorkspaceContextBlock`:

```typescript
export function buildWorkspaceContextBlock(hits: RagHit[]): string {
  if (hits.length === 0) return '';
  const sourceLines = hits
    .map((hit, idx) => {
      const n = idx + 1;
      const location =
        hit.sourceType === 'pdf' && hit.pageNumber != null
          ? `page ${hit.pageNumber}`
          : `paragraph ${hit.paragraphIndex}`;
      return `[${n}] ${hit.path} ${location}\n${hit.chunkText}`;
    })
    .join('\n\n');
  return (
    '<workspace_context>\n' +
    'Source files for this question:\n\n' +
    sourceLines +
    '\n</workspace_context>\n\n' +
    'Answer the user\'s question using only the workspace context above ' +
    'when possible. Cite sources inline using the format ' +
    '`[filename paragraph N]` where `filename` is the basename from the ' +
    'citation header and `N` is the paragraph number or page number. If the answer ' +
    'cannot be found in the workspace context, say so plainly.'
  );
}
```

- [ ] **Step 2: Update unit tests for `buildWorkspaceContextBlock`**

In the existing test file for `workspaceCommand.ts`, add:

```typescript
it('shows page number for PDF hits', () => {
  const hits: RagHit[] = [
    {
      path: '/w/report.pdf',
      chunkText: 'This quarter revenue grew.',
      score: 0.9,
      paragraphIndex: 0,
      sourceType: 'pdf',
      pageNumber: 3,
    },
  ];
  const block = buildWorkspaceContextBlock(hits);
  expect(block).toContain('report.pdf page 3');
  expect(block).not.toContain('paragraph');
});

it('shows paragraph index for text hits without sourceType', () => {
  const hits: RagHit[] = [
    {
      path: '/w/notes.md',
      chunkText: 'Some notes.',
      score: 0.8,
      paragraphIndex: 2,
    },
  ];
  const block = buildWorkspaceContextBlock(hits);
  expect(block).toContain('notes.md paragraph 2');
});
```

- [ ] **Step 3: Run workspaceCommand tests**

```bash
npm run test -- tests/unit/memory/workspaceCommand.test.ts 2>&1 | tail -20
```

All assertions pass (both new and existing tests).

---

## Task 9: PDF citation click opens PDF viewer at correct page

When the user clicks a citation chip that points to a `.pdf` file, the app should open the PDF viewer and navigate to the cited page. The existing citation click path calls `onOpenFileAtPath(path, paragraphIndex)`. For PDF hits, `paragraphIndex` encodes the page band (page 0's chunks are at index 0..99, page 1's at 100..199). Use `pageNumber` from the `RagHit` instead.

**Files:**
- Modify: `src/components/ai/AIChatViewer.tsx`
- Modify: `src/modules/memory/workspaceCommand.ts` (extend `ParsedCitation` for PDF context)

- [ ] **Step 1: Pass `sourceType` and `pageNumber` through the sources list**

In `AIChatViewer.tsx`, find where `RagHit` results are mapped into the `sources` state used by citation rendering. The hits already have `sourceType` and `pageNumber` from the extended `RagHit` interface. Verify they are included:

```bash
grep -n "paragraphIndex\|sources\|ragHits\|workspaceHits" src/components/ai/AIChatViewer.tsx | head -20
```

Find the mapping line (approximately line 757 based on existing code) and confirm `paragraphIndex: h.paragraphIndex` is there. Add alongside it:

```typescript
sourceType: h.sourceType,
pageNumber: h.pageNumber,
```

Update the interface for the `sources` array element (an inline type or a local interface) to include `sourceType?: string` and `pageNumber?: number`.

- [ ] **Step 2: Update citation click to use pageNumber for PDFs**

In `AIChatViewer.tsx`, find the citation click handler (approximately line 1335):

```typescript
const handleCitationClick = useCallback(
  (path: string, paragraphIndex: number) => {
    if (onOpenFileAtPath) {
      void onOpenFileAtPath(path, paragraphIndex);
    }
  },
  [onOpenFileAtPath],
);
```

Extend to detect PDF files and resolve the correct page number:

```typescript
const handleCitationClick = useCallback(
  (path: string, paragraphIndex: number, sourceType?: string, pageNumber?: number) => {
    if (!onOpenFileAtPath) return;
    if (sourceType === 'pdf' && pageNumber != null) {
      // Open PDF viewer at the specific page. Pass pageNumber as the
      // paragraphIndex equivalent — the PDF viewer interprets it as a
      // page number when the file is a .pdf.
      void onOpenFileAtPath(path, pageNumber);
    } else {
      void onOpenFileAtPath(path, paragraphIndex);
    }
  },
  [onOpenFileAtPath],
);
```

Update the citation chip `onClick` to pass `sourceType` and `pageNumber` from the resolved source:

```typescript
onClick={() => {
  if (resolved) {
    const source = (sources ?? []).find((s) => s.path === resolved);
    handleCitationClick(
      resolved,
      cite.paragraphIndex,
      source?.sourceType,
      source?.pageNumber,
    );
  } else {
    onMissingCitation(cite.basename);
  }
}}
```

- [ ] **Step 3: Verify the PDF viewer accepts a page parameter**

```bash
grep -n "initialPage\|page.*prop\|PDFViewerProps" src/components/media/PDFViewer.tsx | head -10
```

If the PDF viewer does not yet accept an `initialPage` prop, add it:

In `PDFViewer.tsx`, update `PDFViewerProps`:

```typescript
interface PDFViewerProps {
  src: string;
  fileName?: string;
  className?: string;
  /** 1-based page number to scroll to on initial render. Default: 1. */
  initialPage?: number;
}
```

Add the scroll-to-page logic inside the component. The iframe-based viewer renders the PDF via the browser's native viewer; the `#page=N` fragment on a blob URL causes the browser to jump to that page:

```typescript
// When generating the blobUrl, append the page fragment:
const urlWithPage = initialPage && initialPage > 1
  ? `${blobUrl}#page=${initialPage}`
  : blobUrl;
```

Use `urlWithPage` as the iframe `src`.

- [ ] **Step 4: Wire initialPage in MediaViewer or the file-open handler**

Find where `.pdf` files are opened (App.tsx around line 1388 or `onOpenFileAtPath` handler). When `paragraphIndex` is passed for a PDF file, interpret it as a page number and pass it to `PDFViewer` as `initialPage`:

```typescript
// In the PDF case inside openFileAtPath:
if (fileName.toLowerCase().endsWith('.pdf')) {
  openFile(path, fileName, dataUrl);
  // paragraphIndex = pageNumber for PDF citations
  if (paragraphIndex) {
    // Store desired page in editorStore or pass through to MediaViewer
    // via a scroll-to event. The simplest approach: encode in the tab
    // content or set a session-scoped ref.
  }
}
```

Pragmatic approach: if wiring `initialPage` all the way through is complex (because `openFile` only takes `path, name, content`), treat this as a best-effort improvement. The citation click still opens the correct PDF file; the page-scroll is an enhancement. Mark it optional in this task and leave a `// A3-TODO: scroll to page` comment if full wiring is too invasive. The plan spec says "click result opens PDF at that page" with "may be deferred" language -- implement the page fragment on the blob URL as the minimum viable path.

- [ ] **Step 5: Verify TypeScript compilation**

```bash
npx tsc -b --noEmit 2>&1 | head -40
```

Zero errors.

---

# Group VII: Verification + Handoff

## Task 10: Write unit tests for MemoryService PDF indexing

**Files:**
- Create: `tests/unit/rag/pdf-indexer.test.ts`

- [ ] **Step 1: Write JS-side unit tests for `MemoryService.indexPdfFile`**

```typescript
/**
 * Plan A3 - MemoryService.indexPdfFile unit tests.
 *
 * Stubs out extractPdfText and ragIndexPdfChunks so tests run without
 * PDF.js or Tauri.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MemoryService,
  setMemoryEnabledReader,
  resetMemoryEnabledReader,
  setPdfIndexingEnabledReader,
  resetPdfIndexingEnabledReader,
} from '@/modules/memory/MemoryService';

// Stub the tauri commands module.
vi.mock('@/utils/tauri-commands', () => ({
  ragIndexPdfChunks: vi.fn().mockResolvedValue(3),
  ragDeletePath: vi.fn().mockResolvedValue(undefined),
  isTauri: () => true,
}));

// Stub pdf-extract module.
vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Page one text.', 'Page two text.', 'Page three text.'],
    pageCount: 3,
    encrypted: false,
    scanned: false,
  }),
}));

const fakeWorkspaceService = {
  readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
};

describe('MemoryService.indexPdfFile', () => {
  beforeEach(() => {
    resetMemoryEnabledReader();
    resetPdfIndexingEnabledReader();
    vi.clearAllMocks();
  });

  it('returns not-indexed when memory is disabled', async () => {
    setMemoryEnabledReader(() => false);
    setPdfIndexingEnabledReader(() => true);
    const r = await MemoryService.indexPdfFile('/w/doc.pdf', fakeWorkspaceService);
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('memory-disabled');
  });

  it('returns not-indexed when PDF indexing toggle is off', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => false);
    const r = await MemoryService.indexPdfFile('/w/doc.pdf', fakeWorkspaceService);
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('pdf-indexing-disabled');
  });

  it('returns not-indexed with reason encrypted for encrypted PDFs', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const { extractPdfText } = await import('@/lib/pdf-extract');
    vi.mocked(extractPdfText).mockResolvedValueOnce({
      pages: [],
      pageCount: 5,
      encrypted: true,
      scanned: false,
    });
    const r = await MemoryService.indexPdfFile('/w/locked.pdf', fakeWorkspaceService);
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('encrypted');
  });

  it('returns not-indexed with reason scanned for scanned PDFs', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const { extractPdfText } = await import('@/lib/pdf-extract');
    vi.mocked(extractPdfText).mockResolvedValueOnce({
      pages: ['', '', ''],
      pageCount: 3,
      encrypted: false,
      scanned: true,
    });
    const r = await MemoryService.indexPdfFile('/w/scan.pdf', fakeWorkspaceService);
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned');
  });

  it('calls ragIndexPdfChunks with extracted pages on success', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const { ragIndexPdfChunks } = await import('@/utils/tauri-commands');
    const r = await MemoryService.indexPdfFile('/w/report.pdf', fakeWorkspaceService);
    expect(r.indexed).toBe(true);
    expect(r.pageCount).toBe(3);
    expect(ragIndexPdfChunks).toHaveBeenCalledWith(
      '/w/report.pdf',
      ['Page one text.', 'Page two text.', 'Page three text.'],
      3,
    );
  });
});
```

- [ ] **Step 2: Run unit tests**

```bash
npm run test -- tests/unit/rag/pdf-indexer.test.ts 2>&1 | tail -20
```

All 5 tests pass.

---

## Task 11: Full verification and handoff

**Files:**
- Read-only verification commands only

- [ ] **Step 1: Run full Vitest suite**

```bash
npm run test 2>&1 | tail -40
```

All existing tests pass. New tests added in this plan pass. No regressions.

- [ ] **Step 2: Run TypeScript type check**

```bash
npx tsc -b --noEmit 2>&1 | head -40
```

Zero errors.

- [ ] **Step 3: Run Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -30
```

All existing Rust tests pass. New Rust tests in `pdf_indexer.rs` and the updated `mod.rs`/`store.rs` tests pass.

- [ ] **Step 4: Run Vite build**

```bash
npm run build 2>&1 | tail -20
```

Build completes without errors.

- [ ] **Step 5: Self-review checklist**

```bash
# Check for em dashes
grep -rn " — " docs/superpowers/plans/2026-04-28-stream-a3-pdf-rag.md | wc -l
# Expected: 0

# Check for TODO / TBD in implementation steps
grep -in "TODO\|TBD" docs/superpowers/plans/2026-04-28-stream-a3-pdf-rag.md | grep -v "A3-TODO"

# Check for time estimates
grep -n "hour\|minute\|day" docs/superpowers/plans/2026-04-28-stream-a3-pdf-rag.md | grep -iv "today\|birthday\|update\|daily\|Monday\|every"
```

Fix any findings before committing.

- [ ] **Step 6: Stage and commit**

```bash
cd /home/jameson/projelli
git add src-tauri/src/commands/rag/pdf_indexer.rs
git add src-tauri/src/commands/rag/mod.rs
git add src-tauri/src/commands/rag/store.rs
git add src-tauri/src/commands/rag/extractor.rs
git add src-tauri/src/commands/rag/chunker.rs
git add src-tauri/src/lib.rs
git add src/utils/tauri-commands.ts
git add src/modules/memory/MemoryService.ts
git add src/hooks/useMemoryWiring.ts
git add src/settings/schema.ts
git add src/modules/memory/workspaceCommand.ts
git add src/components/ai/AIChatViewer.tsx
git add src/components/media/PDFViewer.tsx
git add tests/unit/rag/pdf-indexer.test.ts
git add tests/unit/settings/includePdfsToggle.test.ts
git status
```

Verify only A3 files are staged. Commit and open a PR when Plan A4 is also complete, as both are part of the `feature/stream-a` branch.

---

## Concerns and Follow-Ups for the Implementer

**1. Store schema migration**

LanceDB does not auto-migrate existing table schemas when new columns are added. The `open_or_create_table` function in `store.rs` opens an existing table without checking for the new `source_type` / `page_number` columns. When running against a workspace that was indexed before A3, the query path reads those columns with null-safe access (`StoredHit.source_type = None`), which is safe. But `build_batch` will fail if it tries to write rows using the A3 schema to a table created with the A1-era 6-column schema.

Resolution: before the first `upsert`, check whether `source_type` exists as a column in the open table. If not, run `table.alter_columns()` (LanceDB API) to add the new nullable columns. Add this check inside `open_or_create_table` or as a separate `migrate_table_schema` helper called from both `rag_index_file` and `rag_index_workspace` startup.

This is the most technically uncertain part of the plan. The implementer should read the LanceDB Rust docs for `Table::alter_columns` before writing this code.

**2. `workspaceService.readBinary` availability in `useMemoryWiring`**

The `useMemoryWiring` hook currently receives `workspaceService` with `readFile`, `writeFile`, `exists`, and optionally `delete`. The PDF indexing path needs `readBinary`. Verify that `workspaceService` passed from `App.tsx` is the full `WorkspaceService` instance (which exposes `readBinary` via the `FSBackend` abstraction) rather than a narrowed interface. If it is narrowed, extend the interface in `useMemoryWiring.ts`'s parameter type to include `readBinary`.

**3. File tree dependency for PDF discovery**

The `indexWorkspacePdfs` helper reads from `useWorkspaceStore.getState().fileTree`. If the file tree is not yet populated when the background index runs, no PDFs will be found. The existing text index runs via a Rust-side walkdir that does not depend on the TS file tree. For correctness, a safer approach would be a new `rag_list_pdf_files` Tauri command that walks the workspace root and returns all `.pdf` paths (using the same `walkdir` as `rag_index_workspace`). This removes the JS-side dependency on the file tree being populated. The implementer should decide which approach to use based on how reliably `fileTree` is populated by the time the hook fires.

**4. PDF viewer page navigation via iframe fragment**

The `#page=N` fragment works for PDFs rendered in Chrome's native viewer but may not work in all Tauri WebView backends. Test on the actual Tauri build. If fragment navigation does not work, the fallback is to open the PDF file without a specific page, and the page-jump feature is deferred to a future improvement.

**5. MAX_CHUNKS_PER_PAGE constant**

The encoding `paragraph_index = page_idx * MAX_CHUNKS_PER_PAGE + sub_idx` is a simple scheme that reserves 100 slots per page. A PDF with more than 100 chunks on a single page (extremely unlikely for any normal document) would cause collision. The constant can be raised to 1000 without any concern about overflow in `u32` for any reasonable PDF.

---

## Architecture Diagram

```
User toggles ON "Include PDFs in workspace index"
        |
        v
useMemoryWiring detects setting change
        |
        v
indexWorkspacePdfs(root, workspaceService)
        |
        for each .pdf in fileTree
        |
        v
MemoryService.indexPdfFile(path, workspaceService)
  |
  +-- workspaceService.readBinary(path) -> ArrayBuffer
  |
  +-- extractPdfText(bytes) -> { pages, pageCount, encrypted, scanned }
  |       [runs in renderer, uses PDF.js]
  |
  +-- if encrypted/scanned: return { indexed: false, reason }
  |
  +-- ragIndexPdfChunks(path, pages, pageCount)  [Tauri invoke]
          |
          v [Rust side]
  rag_index_pdf_chunks command
          |
          v
  pdf_indexer::index_pdf_chunks(table, path, pages, pageCount)
    |
    +-- for each page: chunk_text (if long) or one chunk per page
    |
    +-- embed_documents(chunk texts) -> vectors
    |         [fastembed-rs, MultilingualE5Small, 384-dim]
    |
    +-- upsert_chunks_for_path(table, path, rows, SourceType::Pdf)
              [LanceDB, .projelli/vectors/]

Query path (@workspace):
  user message "how did revenue grow? @workspace"
        |
        v
  rag_retrieve(query, top_k) -> Vec<Hit>
        |    [includes PDF chunks if indexed]
        v
  buildWorkspaceContextBlock(hits)
        |    [shows "page N" for PDF hits, "paragraph N" for text hits]
        v
  AI receives context including PDF page text
        |
        v
  AI cites: [report.pdf page 3]
        |
        v
  User clicks citation chip
        |
        v
  handleCitationClick(path, pageNumber, 'pdf')
        |
        v
  openFileAtPath('report.pdf', pageNumber=3)
        |
        v
  PDFViewer renders report.pdf at page 3
```
