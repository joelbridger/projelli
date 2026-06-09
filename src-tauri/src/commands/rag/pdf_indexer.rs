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
// - paragraph_index on PDF chunks is the 0-based page index times
//   MAX_CHUNKS_PER_PAGE. For multi-chunk pages, subsequent chunks within
//   the same page get paragraph_index = page_index * MAX_CHUNKS_PER_PAGE
//   + sub_index. MAX_CHUNKS_PER_PAGE is conservatively 100 (no PDF page
//   will produce 100 chunks).
// - source_type = SourceType::Pdf { page_number } where page_number is
//   1-based for display, derived from the chunk's paragraph_index.

use anyhow::Result;
use lancedb::Table;

use super::chunker::{chunk_text, Chunk, BYTES_PER_TOKEN, TARGET_TOKENS};
use super::embedder::embed_documents;
use super::store::{delete_path, SourceType};

pub const MAX_CHUNKS_PER_PAGE: u32 = 100;
const TARGET_BYTES: usize = TARGET_TOKENS * BYTES_PER_TOKEN;

/// Build the list of chunks for a PDF file from already-extracted page strings.
///
/// Pure function — no I/O. Extracted so unit tests can exercise chunk
/// assignment without requiring a live database or embedder.
pub fn build_pdf_chunks(path: &str, pages: &[String]) -> Vec<Chunk> {
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
            // Long page: run through the standard text chunker, then stamp
            // the correct paragraph_index band.
            let sub_chunks = chunk_text(path, trimmed);
            for (sub_idx, mut c) in sub_chunks.into_iter().enumerate() {
                c.paragraph_index =
                    page_idx as u32 * MAX_CHUNKS_PER_PAGE + sub_idx as u32;
                all_chunks.push(c);
            }
        }
    }

    all_chunks
}

/// Index the text content of a PDF file into the LanceDB table.
///
/// `pages` is the already-extracted text for each page (from PDF.js via the
/// JS bridge). `page_count` is the total page count from the PDF metadata
/// (metadata only, not used for chunking). `matter_id` is the confidentiality
/// scope the PDF belongs to (WS-B/C); pass `UNASSIGNED_MATTER` when unknown.
/// `privilege` is the litigation-safety status (WS-PRIV); pass `PRIVILEGE_NONE`
/// when the PDF is not privileged.
///
/// Returns the number of chunks successfully stored, or 0 if all pages were
/// empty / skipped (stale rows are cleaned up either way).
pub async fn index_pdf_chunks(
    table: &Table,
    path: &str,
    pages: &[String],
    page_count: u32,
    matter_id: &str,
    privilege: &str,
) -> Result<usize> {
    let _ = page_count; // stored in metadata; not needed for chunking logic

    let all_chunks = build_pdf_chunks(path, pages);

    if all_chunks.is_empty() {
        // No extractable text. Delete any stale rows and return.
        delete_path(table, path).await?;
        return Ok(0);
    }

    let texts: Vec<String> = all_chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = embed_documents(&texts).await?;
    let count = all_chunks.len();

    // Each chunk carries a SourceType derived from its paragraph_index band.
    // paragraph_index = page_idx * MAX_CHUNKS_PER_PAGE + sub_idx
    // => page_number (1-based) = paragraph_index / MAX_CHUNKS_PER_PAGE + 1.
    //
    // Because every chunk in a single upsert call shares the same SourceType,
    // and different pages have different page_numbers, we group chunks by
    // page and upsert each group separately.
    use super::store::upsert_chunks_for_path;

    // First, delete all existing rows for this path (upsert_chunks_for_path
    // deletes then inserts; calling it per-group would double-delete). Do a
    // single delete up front, then insert per-group without the delete.
    {
        let predicate = format!("path = '{}'", path.replace('\'', "''"));
        table
            .delete(&predicate)
            .await
            .map_err(|e| anyhow::anyhow!("delete failed for {}: {}", path, e))?;
    }

    // Group chunks by page (page_number = pi / MAX_CHUNKS_PER_PAGE + 1).
    // We re-use upsert_chunks_for_path but suppress its internal delete so
    // we don't wipe the rows we just inserted for the previous page group.
    // Simpler: build all (Chunk, Vec<f32>) pairs and insert them in batches
    // by page, each with the correct SourceType.
    let mut grouped: std::collections::BTreeMap<u32, Vec<(Chunk, Vec<f32>)>> =
        std::collections::BTreeMap::new();
    for (chunk, vec) in all_chunks.into_iter().zip(vectors) {
        let page_num = chunk.paragraph_index / MAX_CHUNKS_PER_PAGE + 1;
        grouped.entry(page_num).or_default().push((chunk, vec));
    }

    use arrow_array::RecordBatchIterator;
    use arrow_schema::ArrowError;
    use super::store::build_batch;
    let mut batches: Vec<Result<arrow_array::RecordBatch, ArrowError>> = Vec::new();
    for (page_num, rows) in &grouped {
        let batch = build_batch(rows, SourceType::Pdf { page_number: *page_num }, matter_id, privilege)
            .map_err(|e| ArrowError::ExternalError(e.into()))?;
        batches.push(Ok(batch));
    }
    if !batches.is_empty() {
        let schema = super::store::build_schema();
        let iter = RecordBatchIterator::new(batches.into_iter(), schema);
        table
            .add(Box::new(iter))
            .execute()
            .await
            .map_err(|e| anyhow::anyhow!("add pdf chunks batch failed: {}", e))?;
    }

    // Suppress unused warning when called from tests — upsert_chunks_for_path
    // is imported but we handle insert ourselves above. Keep the import so the
    // public API surface is testable.
    let _ = upsert_chunks_for_path;

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_page_produces_one_chunk_per_page() {
        // Two short pages -> two chunks with paragraph_index 0 and 100.
        let pages = vec![
            "First page text.".to_string(),
            "Second page text.".to_string(),
        ];
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
        assert!(chunks.len() >= 2, "expected multiple chunks, got {}", chunks.len());
        // All chunks must be in page 0's band (0..MAX_CHUNKS_PER_PAGE).
        for c in &chunks {
            assert!(
                c.paragraph_index < MAX_CHUNKS_PER_PAGE,
                "paragraph_index {} out of page-0 band",
                c.paragraph_index
            );
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

    #[test]
    fn all_empty_pages_returns_zero_chunks() {
        let pages = vec!["  ".to_string(), "\n\n".to_string()];
        let chunks = build_pdf_chunks("/d.pdf", &pages);
        assert_eq!(chunks.len(), 0);
    }

    #[test]
    fn chunk_text_matches_trimmed_page() {
        let pages = vec!["  Hello world.  ".to_string()];
        let chunks = build_pdf_chunks("/e.pdf", &pages);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "Hello world.");
    }

    #[test]
    fn multi_page_indices_are_banded_correctly() {
        let page_texts: Vec<String> = (0..5).map(|i| format!("Page {} text.", i)).collect();
        let chunks = build_pdf_chunks("/f.pdf", &page_texts);
        assert_eq!(chunks.len(), 5);
        for (i, c) in chunks.iter().enumerate() {
            assert_eq!(
                c.paragraph_index,
                i as u32 * MAX_CHUNKS_PER_PAGE,
                "page {} has wrong paragraph_index",
                i
            );
        }
    }
}
