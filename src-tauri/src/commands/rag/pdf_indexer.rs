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
            let band = MAX_CHUNKS_PER_PAGE as usize;
            let base = page_idx as u32 * MAX_CHUNKS_PER_PAGE;

            if sub_chunks.len() <= band {
                for (sub_idx, mut c) in sub_chunks.into_iter().enumerate() {
                    c.paragraph_index = base + sub_idx as u32;
                    all_chunks.push(c);
                }
            } else {
                // F2 — band overflow is impossible BY CONSTRUCTION. A single
                // page that produces more than the band width of sub-chunks
                // would otherwise stamp `sub_idx >= MAX_CHUNKS_PER_PAGE`, which
                // spills into the NEXT page's id band. Two chunks then collide
                // on `id` (= chunk_id(path, paragraph_index)); `merge_insert` on
                // duplicate source ids is undefined and the post-merge dedup
                // would delete all-but-one → SILENT content loss. It would also
                // corrupt the page label (page_number = paragraph_index /
                // MAX_CHUNKS_PER_PAGE + 1 would read the wrong page).
                //
                // Fix without dropping any text: keep the first band-1 chunks
                // as-is, then fold ALL remaining page text into ONE final
                // in-band chunk at the last slot. The tail chunk covers the
                // whole overflow region (from the first overflowed chunk's
                // start to the end of the page) so nothing is lost; its
                // embedding is truncated by the model's 512-token cap like any
                // oversized chunk, but the full text stays stored and citable.
                let overflow_start = sub_chunks[band - 1].start_offset;
                for (sub_idx, mut c) in sub_chunks.into_iter().take(band - 1).enumerate() {
                    c.paragraph_index = base + sub_idx as u32;
                    all_chunks.push(c);
                }
                all_chunks.push(Chunk {
                    path: path.to_string(),
                    paragraph_index: base + (band as u32 - 1),
                    text: trimmed[overflow_start..].to_string(),
                    start_offset: overflow_start,
                    end_offset: trimmed.len(),
                    locator: None,
                });
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

pub type PreparedPdfGroups =
    Vec<(SourceType, Option<(&'static str, f32)>, Vec<(Chunk, Vec<f32>)>)>;

pub enum PreparedPdfIndex {
    Empty,
    Groups(PreparedPdfGroups),
}

/// Chunk and embed PDF text without touching the database. Keeping this slow
/// phase separate lets the command re-check the workspace activation at the
/// exact commit point after an A → B → A switch.
pub async fn prepare_pdf_chunks(
    path: &str,
    pages: &[String],
    page_confidences: Option<&[Option<f32>]>,
) -> Result<PreparedPdfIndex> {
    let all_chunks = build_pdf_chunks(path, pages);
    if all_chunks.is_empty() {
        return Ok(PreparedPdfIndex::Empty);
    }

    let texts: Vec<String> = all_chunks.iter().map(|c| c.text.clone()).collect();
    let Some(vectors) = embed_documents_batched(&texts, None).await? else {
        return Ok(PreparedPdfIndex::Empty);
    };

    let mut grouped: std::collections::BTreeMap<u32, Vec<(Chunk, Vec<f32>)>> =
        std::collections::BTreeMap::new();
    for (chunk, vec) in all_chunks.into_iter().zip(vectors) {
        let page_num = chunk.paragraph_index / MAX_CHUNKS_PER_PAGE + 1;
        grouped.entry(page_num).or_default().push((chunk, vec));
    }
    let groups = grouped
        .into_iter()
        .map(|(page_num, rows)| {
            (
                SourceType::Pdf { page_number: page_num },
                extraction_for_page(page_confidences, page_num),
                rows,
            )
        })
        .collect();
    Ok(PreparedPdfIndex::Groups(groups))
}

/// Commit already-embedded PDF rows. The command layer calls this only while
/// holding the workspace switch/commit lock after a second pin validation.
pub async fn commit_pdf_chunks(
    table: &Table,
    path: &str,
    prepared: PreparedPdfIndex,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<usize> {
    match prepared {
        PreparedPdfIndex::Empty => {
            delete_path(table, path, key).await?;
            Ok(0)
        }
        PreparedPdfIndex::Groups(groups) => {
            super::store::upsert_grouped(table, path, groups, matter_id, privilege, key).await
        }
    }
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
    fn overlong_page_never_overflows_its_band_and_drops_no_text() {
        // F2 — a single page whose text is long enough to produce MORE than
        // MAX_CHUNKS_PER_PAGE sub-chunks must NOT spill into the next page's id
        // band. Build one ~200 KB page (one paragraph, no blank lines) so the
        // chunker's window-splitter yields well over 100 chunks, then a short
        // second page. Prove: (a) every page-0 chunk stays in [0, band); (b)
        // page 1 begins exactly at the band boundary (no chunk stole its slot);
        // (c) all ids/paragraph_index are unique; (d) no text is dropped — the
        // final page-0 chunk reaches the end of the page's text.
        let band = MAX_CHUNKS_PER_PAGE;
        let huge_page = "word ".repeat(40_000); // ~200 KB, single paragraph
        let huge_len = huge_page.trim().len();
        let pages = vec![huge_page, "Short second page.".to_string()];
        let chunks = build_pdf_chunks("/long.pdf", &pages);

        let page0: Vec<_> = chunks
            .iter()
            .filter(|c| c.paragraph_index < band)
            .collect();
        assert!(
            page0.len() > 1,
            "the huge page must produce many chunks, got {}",
            page0.len()
        );
        assert!(
            page0.len() as u32 <= band,
            "page-0 chunk count {} must never exceed the band width {}",
            page0.len(),
            band
        );
        for c in &page0 {
            assert!(
                c.paragraph_index < band,
                "page-0 chunk index {} spilled past the band {}",
                c.paragraph_index,
                band
            );
        }

        // Page 1's single short chunk must land at the band boundary — proving
        // no page-0 overflow ate into page 1's id space.
        let page1: Vec<_> = chunks
            .iter()
            .filter(|c| c.paragraph_index >= band)
            .collect();
        assert_eq!(page1.len(), 1, "page 1 should be one short chunk");
        assert_eq!(
            page1[0].paragraph_index, band,
            "page 1 must start exactly at the band boundary"
        );

        // Every id is unique (this is exactly what merge_insert keys on).
        let ids: std::collections::HashSet<_> = chunks
            .iter()
            .map(|c| c.paragraph_index)
            .collect();
        assert_eq!(ids.len(), chunks.len(), "paragraph_index values must be unique");

        // No text dropped: the last page-0 chunk reaches the end of the page.
        let last_page0 = page0.iter().max_by_key(|c| c.paragraph_index).unwrap();
        assert_eq!(
            last_page0.end_offset, huge_len,
            "the final page-0 chunk must reach the end of the page (no dropped tail)"
        );
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
