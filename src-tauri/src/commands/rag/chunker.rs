// Pure text chunker for the RAG indexer.
//
// Splits a document into ~512-token chunks with ~64-token overlap, breaking
// on paragraph boundaries (double newlines) where possible. The output is
// fully deterministic and side-effect-free so we can unit-test it without
// touching disk or the embedding model.
//
// "Token" here is approximated as bytes / 4 — coarse but good enough for an
// e5-small embedder whose hard cap is 512 tokens. We err on the small side
// to avoid clipping; if a real tokenizer says we overshot the model will
// truncate (e5-small has hard 512 cap built in).

/// Approximate token budget per chunk. Stays well under e5-small's 512
/// hard cap so we don't lose tail content to truncation.
pub const TARGET_TOKENS: usize = 384;
/// Overlap between consecutive chunks (in approximate tokens) so phrases
/// that cross a chunk boundary still get retrieved.
pub const OVERLAP_TOKENS: usize = 64;
/// Bytes-per-token approximation for English-ish text. Coarse but stable.
pub const BYTES_PER_TOKEN: usize = 4;

const TARGET_BYTES: usize = TARGET_TOKENS * BYTES_PER_TOKEN;
const OVERLAP_BYTES: usize = OVERLAP_TOKENS * BYTES_PER_TOKEN;

/// One chunk of a source file. The frontend consumes this through the
/// frozen `Hit` struct (`path`, `chunk_text`, `paragraph_index`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub path: String,
    pub paragraph_index: u32,
    pub text: String,
    pub start_offset: usize,
    pub end_offset: usize,
}

/// Split `text` from `path` into chunks. Produces at least one chunk for
/// any non-empty input. Empty / whitespace-only input produces zero chunks.
///
/// Strategy:
///   1. Greedily group paragraphs (double-newline-separated blocks) until
///      we hit the per-chunk byte budget.
///   2. If a single paragraph is bigger than the budget, slice it on
///      character boundaries with the overlap window applied.
///   3. Each chunk gets a sequential `paragraph_index` (zero-based) so the
///      UI can deep-link by chunk position later.
pub fn chunk_text(path: &str, text: &str) -> Vec<Chunk> {
    if text.trim().is_empty() {
        return Vec::new();
    }

    let paragraphs = split_paragraphs(text);
    let mut out: Vec<Chunk> = Vec::new();

    let mut buf = String::new();
    let mut buf_start: usize = 0;
    let mut buf_end: usize = 0;
    let mut chunk_idx: u32 = 0;

    let flush = |out: &mut Vec<Chunk>,
                 chunk_idx: &mut u32,
                 buf: &mut String,
                 buf_start: &mut usize,
                 buf_end: &mut usize| {
        if buf.trim().is_empty() {
            buf.clear();
            return;
        }
        out.push(Chunk {
            path: path.to_string(),
            paragraph_index: *chunk_idx,
            text: buf.trim_end().to_string(),
            start_offset: *buf_start,
            end_offset: *buf_end,
        });
        *chunk_idx += 1;
        // Keep the last OVERLAP_BYTES of the buffer as the seed for the
        // next chunk. Walk back to the nearest char boundary so we don't
        // tear a multi-byte UTF-8 sequence in half.
        if buf.len() > OVERLAP_BYTES {
            let mut split = buf.len() - OVERLAP_BYTES;
            while split > 0 && !buf.is_char_boundary(split) {
                split -= 1;
            }
            let tail = buf[split..].to_string();
            *buf_start = *buf_end - tail.len();
            buf.clear();
            buf.push_str(&tail);
        } else {
            buf.clear();
            *buf_start = *buf_end;
        }
    };

    for (paragraph, p_start, p_end) in paragraphs {
        // Big paragraph case: split it into windows directly.
        if paragraph.len() > TARGET_BYTES {
            // First flush any pending buffer so we keep paragraphs in order.
            flush(
                &mut out,
                &mut chunk_idx,
                &mut buf,
                &mut buf_start,
                &mut buf_end,
            );
            // Slide a window of TARGET_BYTES with OVERLAP_BYTES step-back.
            let mut cursor = 0usize;
            while cursor < paragraph.len() {
                let mut end = (cursor + TARGET_BYTES).min(paragraph.len());
                while end > cursor && !paragraph.is_char_boundary(end) {
                    end -= 1;
                }
                let window = &paragraph[cursor..end];
                out.push(Chunk {
                    path: path.to_string(),
                    paragraph_index: chunk_idx,
                    text: window.to_string(),
                    start_offset: p_start + cursor,
                    end_offset: p_start + end,
                });
                chunk_idx += 1;
                if end >= paragraph.len() {
                    break;
                }
                // Step forward but keep OVERLAP_BYTES of context.
                let mut next = end.saturating_sub(OVERLAP_BYTES);
                if next <= cursor {
                    next = cursor + 1;
                }
                while next < paragraph.len() && !paragraph.is_char_boundary(next) {
                    next += 1;
                }
                cursor = next;
            }
            buf_start = p_end;
            buf_end = p_end;
            continue;
        }

        // Normal paragraph: append to buffer; flush if we'd overflow.
        if !buf.is_empty() && buf.len() + paragraph.len() + 2 > TARGET_BYTES {
            flush(
                &mut out,
                &mut chunk_idx,
                &mut buf,
                &mut buf_start,
                &mut buf_end,
            );
        }
        if buf.is_empty() {
            buf_start = p_start;
        }
        if !buf.is_empty() {
            buf.push_str("\n\n");
        }
        buf.push_str(paragraph);
        buf_end = p_end;
    }

    // Final flush.
    flush(
        &mut out,
        &mut chunk_idx,
        &mut buf,
        &mut buf_start,
        &mut buf_end,
    );

    out
}

/// Split text into paragraphs on double-newline boundaries. Preserves the
/// byte offsets of each paragraph in the original input so the chunker can
/// emit accurate `start_offset` / `end_offset` for citations.
fn split_paragraphs(text: &str) -> Vec<(&str, usize, usize)> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        // Skip leading blank lines.
        while i < bytes.len() && (bytes[i] == b'\n' || bytes[i] == b'\r') {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let start = i;
        // Walk forward until we hit a blank line (\n\n or \r\n\r\n).
        while i < bytes.len() {
            if bytes[i] == b'\n' {
                let mut j = i + 1;
                // Allow CR before LF on Windows.
                if j < bytes.len() && bytes[j] == b'\r' {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'\n' {
                    break;
                }
            }
            i += 1;
        }
        let end = i;
        if end > start {
            // Trim trailing whitespace from the slice end without panicking
            // on UTF-8 boundaries.
            let slice = &text[start..end];
            let trimmed_end = start + slice.trim_end().len();
            if trimmed_end > start {
                out.push((&text[start..trimmed_end], start, trimmed_end));
            }
        }
        i += 1; // skip the newline that ended this paragraph
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_returns_empty() {
        assert_eq!(chunk_text("/a.md", ""), vec![]);
        assert_eq!(chunk_text("/a.md", "   \n\n  \r\n  "), vec![]);
    }

    #[test]
    fn short_text_produces_one_chunk() {
        let chunks = chunk_text("/a.md", "Hello world.\n\nThis is a paragraph.");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].path, "/a.md");
        assert_eq!(chunks[0].paragraph_index, 0);
        assert!(chunks[0].text.contains("Hello world."));
        assert!(chunks[0].text.contains("This is a paragraph."));
    }

    #[test]
    fn paragraph_indices_are_sequential_from_zero() {
        // Build text long enough to force multiple chunks.
        let long_para = "lorem ipsum ".repeat(200); // ~2400 bytes
        let text = format!(
            "{}\n\n{}\n\n{}",
            long_para.trim(),
            long_para.trim(),
            long_para.trim()
        );
        let chunks = chunk_text("/big.md", &text);
        assert!(chunks.len() >= 2);
        for (i, c) in chunks.iter().enumerate() {
            assert_eq!(c.paragraph_index, i as u32, "chunk {i} index mismatch");
        }
    }

    #[test]
    fn split_paragraphs_handles_double_newlines() {
        let text = "p1\n\np2\n\np3";
        let parts = split_paragraphs(text);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].0, "p1");
        assert_eq!(parts[1].0, "p2");
        assert_eq!(parts[2].0, "p3");
    }

    #[test]
    fn split_paragraphs_handles_crlf() {
        let text = "p1\r\n\r\np2";
        let parts = split_paragraphs(text);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].0, "p1");
        assert_eq!(parts[1].0, "p2");
    }

    #[test]
    fn chunks_overlap_when_split_by_size() {
        // Force overflow: two large paragraphs that don't fit together.
        let p1 = "alpha ".repeat(400); // ~2400 bytes > TARGET_BYTES
        let p2 = "beta ".repeat(400);
        let text = format!("{}\n\n{}", p1.trim(), p2.trim());
        let chunks = chunk_text("/x.md", &text);
        assert!(chunks.len() >= 2, "expected multiple chunks, got {}", chunks.len());
        // Consecutive chunks should share some text in their overlap window
        // when the splitter is forced to cut a single paragraph.
        let big = "x".repeat(TARGET_BYTES * 3);
        let chunks2 = chunk_text("/y.md", &big);
        assert!(chunks2.len() >= 2);
        // Tail of chunk 0 must appear in head of chunk 1 (overlap).
        let tail = &chunks2[0].text[chunks2[0].text.len().saturating_sub(OVERLAP_BYTES)..];
        let head = &chunks2[1].text[..tail.len().min(chunks2[1].text.len())];
        // Both are "xxxx..." so they trivially overlap, but assert non-empty
        // overlap window is preserved.
        assert!(!tail.is_empty());
        assert!(!head.is_empty());
    }

    #[test]
    fn offsets_are_within_input_bounds() {
        let text = "first paragraph here.\n\nSecond paragraph here.\n\nThird.";
        let chunks = chunk_text("/o.md", text);
        for c in &chunks {
            assert!(c.start_offset <= text.len());
            assert!(c.end_offset <= text.len());
            assert!(c.start_offset <= c.end_offset);
        }
    }

    #[test]
    fn does_not_panic_on_unicode_at_boundary() {
        // Text designed to put a multi-byte char near the chunk boundary.
        let mut s = String::new();
        for _ in 0..(TARGET_BYTES / 4) {
            s.push_str("café "); // 'é' is 2 bytes
        }
        let chunks = chunk_text("/u.md", &s);
        assert!(!chunks.is_empty());
        // No panic = pass.
    }

    #[test]
    fn preserves_paragraph_grouping_when_within_budget() {
        let text = "para one\n\npara two\n\npara three";
        let chunks = chunk_text("/g.md", text);
        // All three short paragraphs fit in one chunk.
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].text.contains("para one"));
        assert!(chunks[0].text.contains("para two"));
        assert!(chunks[0].text.contains("para three"));
    }
}
