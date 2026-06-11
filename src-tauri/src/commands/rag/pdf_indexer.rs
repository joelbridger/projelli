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
use super::embedder::embed_documents_batched;
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
                // VG-3c: page:line locators are a certified-transcript
                // (text-path) concept; PDF chunks cite by page_number.
                locator: None,
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

/// VG-2 — the extraction marker for one PDF page.
///
/// `page_confidences` is aligned with the `pages` array (index = 0-based page
/// index): `Some(conf)` means the page's text came from the local OCR engine
/// with that mean word confidence (0-100); `None` (or no array at all) means
/// the page text was extracted natively. Pure so the mapping is unit-testable
/// without a table or embedder.
pub fn extraction_for_page(
    page_confidences: Option<&[Option<f32>]>,
    page_number: u32,
) -> Option<(&'static str, f32)> {
    let page_idx = page_number.checked_sub(1)? as usize;
    page_confidences?
        .get(page_idx)
        .copied()
        .flatten()
        .map(|conf| ("ocr", conf))
}

/// Index the text content of a PDF file into the LanceDB table.
///
/// `pages` is the already-extracted text for each page (from PDF.js via the
/// JS bridge). `page_count` is the total page count from the PDF metadata
/// (metadata only, not used for chunking). `matter_id` is the confidentiality
/// scope the PDF belongs to (WS-B/C); pass `UNASSIGNED_MATTER` when unknown.
/// `privilege` is the litigation-safety status (WS-PRIV); pass `PRIVILEGE_NONE`
/// when the PDF is not privileged. `page_confidences` (VG-2) is aligned with
/// `pages`: `Some(conf)` on a page whose text the local OCR engine read —
/// that page's chunks are stored with `extraction = ("ocr", conf)` so
/// citations can disclose it. `key` is the vector-store master key (WS-VEC);
/// `build_batch` encrypts every chunk's text at rest under it.
///
/// Returns the number of chunks successfully stored, or 0 if all pages were
/// empty / skipped (stale rows are cleaned up either way).
#[allow(clippy::too_many_arguments)] // mirrors the rag_index_pdf_chunks command surface
pub async fn index_pdf_chunks(
    table: &Table,
    path: &str,
    pages: &[String],
    page_count: u32,
    matter_id: &str,
    privilege: &str,
    page_confidences: Option<&[Option<f32>]>,
    key: &[u8; 32],
) -> Result<usize> {
    let _ = page_count; // stored in metadata; not needed for chunking logic

    let all_chunks = build_pdf_chunks(path, pages);

    if all_chunks.is_empty() {
        // No extractable text. Delete any stale rows and return.
        delete_path(table, path).await?;
        return Ok(0);
    }

    let texts: Vec<String> = all_chunks.iter().map(|c| c.text.clone()).collect();
    // F-501 class: a long legal PDF (hundreds of pages, no upstream size cap)
    // must never embed in one unbounded call. No cancel flag on this path, so
    // the batched helper always returns Some.
    let Some(vectors) = embed_documents_batched(&texts, None).await? else {
        return Ok(0);
    };

    // Each chunk carries a SourceType derived from its paragraph_index band.
    // paragraph_index = page_idx * MAX_CHUNKS_PER_PAGE + sub_idx
    // => page_number (1-based) = paragraph_index / MAX_CHUNKS_PER_PAGE + 1.
    //
    // Because every chunk in one batch shares one SourceType, and different
    // pages have different page_numbers, group chunks by page and write the
    // groups through `store::upsert_grouped` (single up-front delete, one
    // table.add — the shared sectioned-source write path, VG-2b). VG-2: each
    // page group carries its own extraction marker so an OCR-read page's
    // chunks are disclosable while native pages of the same file stay null.
    let mut grouped: std::collections::BTreeMap<u32, Vec<(Chunk, Vec<f32>)>> =
        std::collections::BTreeMap::new();
    for (chunk, vec) in all_chunks.into_iter().zip(vectors) {
        let page_num = chunk.paragraph_index / MAX_CHUNKS_PER_PAGE + 1;
        grouped.entry(page_num).or_default().push((chunk, vec));
    }
    let groups: Vec<(SourceType, Option<(&str, f32)>, Vec<(Chunk, Vec<f32>)>)> = grouped
        .into_iter()
        .map(|(page_num, rows)| {
            (
                SourceType::Pdf { page_number: page_num },
                extraction_for_page(page_confidences, page_num),
                rows,
            )
        })
        .collect();

    super::store::upsert_grouped(table, path, groups, matter_id, privilege, key).await
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

    // -----------------------------------------------------------------------
    // VG-2: per-page confidence -> extraction mapping. The confidences array
    // is aligned with `pages` (0-based); page_number is 1-based.
    // -----------------------------------------------------------------------

    #[test]
    fn extraction_for_page_maps_aligned_confidences() {
        // Page 1 native (None), page 2 OCR at 87.0.
        let confs: Vec<Option<f32>> = vec![None, Some(87.0)];
        assert_eq!(extraction_for_page(Some(&confs), 1), None);
        assert_eq!(extraction_for_page(Some(&confs), 2), Some(("ocr", 87.0)));
    }

    #[test]
    fn extraction_for_page_without_array_is_always_native() {
        assert_eq!(extraction_for_page(None, 1), None);
        assert_eq!(extraction_for_page(None, 7), None);
    }

    #[test]
    fn extraction_for_page_out_of_range_and_zero_are_safe() {
        let confs: Vec<Option<f32>> = vec![Some(50.0)];
        // Page beyond the array (a misaligned caller) degrades to native,
        // never panics; page_number 0 (invalid: pages are 1-based) too.
        assert_eq!(extraction_for_page(Some(&confs), 2), None);
        assert_eq!(extraction_for_page(Some(&confs), 0), None);
        assert_eq!(extraction_for_page(Some(&confs), 1), Some(("ocr", 50.0)));
    }
}
