// VG-3c — certified-transcript detection + page:line chunking.
//
// Court reporters deliver depositions in a standard certified layout: every
// content line carries its line number (1-25), pages are separated by a
// page-marker line, and lawyers cite the result as "Tr. 45:12-46:3". This
// module detects that layout at ingest and chunks it carrying a page:line
// `locator` string so citations can read the way lawyers actually cite.
//
// Detection is DELIBERATELY CONSERVATIVE: a false negative just falls back
// to the generic chunker (always correct, citations say "paragraph N"); a
// false positive would mislabel ordinary prose with fabricated page:line
// cites. All three structural signals are required:
//   1. ≥ 60% of non-blank lines begin with a 1-25 line number
//      (`^\s{0,8}(\d{1,2})\s+\S` — hand-rolled below, no regex dep);
//   2. the numbers form ascending runs that reset near 25 → 1 at least
//      once (the certified page rhythm);
//   3. a page marker (`^\s*(-\s*)?(Page|PAGE)\s+\d+` or a form feed)
//      appears at least once.
// The existing Johnson fixture (Q./A. prose + "PAGE N" headers, deliberately
// NOT line-numbered) fails signal 1 and must NEVER detect — leg-1's chunk-id
// assertions depend on it staying on the generic path.
//
// Chunks carry the SPOKEN text (the line-number gutter is stripped — it
// would pollute embeddings and quote verification) and a locator
// "startPage:startLine-endPage:endLine". `paragraph_index` stays the
// sequential chunk index — the content-addressed citation contract
// (`chunk_id(path, paragraph_index)`) is unchanged; page:line is metadata
// ON TOP.

use super::chunker::{Chunk, BYTES_PER_TOKEN, TARGET_TOKENS};

const TARGET_BYTES: usize = TARGET_TOKENS * BYTES_PER_TOKEN;

/// Minimum share of non-blank lines that must carry a leading 1-25 line
/// number for the text to qualify as a certified transcript.
const MIN_NUMBERED_RATIO_PERCENT: usize = 60;

/// Once a chunk is this full, prefer to break at the next Q./A. boundary
/// rather than mid-answer.
const SOFT_BREAK_BYTES: usize = TARGET_BYTES * 3 / 4;

/// Is `text` in the standard certified line-numbered deposition format?
/// Conservative three-signal test (see module docs); false negatives fall
/// back to the generic chunker, which is always correct.
pub fn detect_transcript(text: &str) -> bool {
    let mut non_blank = 0usize;
    let mut numbered = 0usize;
    let mut has_page_marker = false;
    let mut numbers: Vec<u32> = Vec::new();

    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        non_blank += 1;
        if parse_page_marker(line).is_some() {
            has_page_marker = true;
            continue;
        }
        if let Some((n, _)) = leading_line_number(line) {
            numbered += 1;
            numbers.push(n);
        }
    }

    if non_blank == 0 || !has_page_marker {
        return false;
    }
    if numbered * 100 < non_blank * MIN_NUMBERED_RATIO_PERCENT {
        return false;
    }

    // The page rhythm: line numbers ascend within a page and reset near
    // 25 → 1 at a page boundary at least once. "Near": a drop from ≥ 20
    // down to ≤ 3 (tolerates short final pages / headers eating a line).
    let mut resets = 0usize;
    let mut ascending_pairs = 0usize;
    let mut total_pairs = 0usize;
    for w in numbers.windows(2) {
        total_pairs += 1;
        if w[1] > w[0] {
            ascending_pairs += 1;
        }
        if w[0] >= 20 && w[1] <= 3 {
            resets += 1;
        }
    }
    if resets == 0 || total_pairs == 0 {
        return false;
    }
    // The non-reset pairs must be overwhelmingly ascending — random numeric
    // prefixes (numbered lists, log files) don't hold a monotone 1..25 run.
    ascending_pairs * 100 >= total_pairs * 80
}

/// Chunk a certified transcript: gutter stripped, consecutive testimony
/// lines grouped under the chunker's byte budget (breaking preferentially
/// at Q./A. boundaries), each chunk stamped with its page:line `locator`
/// ("startPage:startLine-endPage:endLine"). `paragraph_index` is the
/// sequential chunk index, exactly like the generic chunker.
pub fn chunk_transcript(path: &str, text: &str) -> Vec<Chunk> {
    let mut out: Vec<Chunk> = Vec::new();

    let mut current_page: u32 = 1;
    let mut buf = String::new();
    let mut buf_start: Option<(u32, u32)> = None; // (page, line) of first buffered line
    let mut buf_end: (u32, u32) = (1, 1); // (page, line) of last buffered line
    let mut buf_start_offset: usize = 0;
    let mut buf_end_offset: usize = 0;
    let mut chunk_idx: u32 = 0;

    let flush = |buf: &mut String,
                     buf_start: &mut Option<(u32, u32)>,
                     buf_end: (u32, u32),
                     start_offset: usize,
                     end_offset: usize,
                     chunk_idx: &mut u32,
                     out: &mut Vec<Chunk>| {
        if buf.trim().is_empty() {
            buf.clear();
            *buf_start = None;
            return;
        }
        let (sp, sl) = buf_start.unwrap_or((1, 1));
        let (ep, el) = buf_end;
        out.push(Chunk {
            path: path.to_string(),
            paragraph_index: *chunk_idx,
            text: buf.trim_end().to_string(),
            start_offset,
            end_offset,
            locator: Some(format!("{sp}:{sl}-{ep}:{el}")),
        });
        *chunk_idx += 1;
        buf.clear();
        *buf_start = None;
    };

    let mut offset = 0usize;
    for raw in text.split_inclusive('\n') {
        let line_start = offset;
        offset += raw.len();
        let line = raw.trim_end_matches(['\n', '\r']);

        if line.trim().is_empty() {
            continue;
        }
        if let Some(page) = parse_page_marker(line) {
            match page {
                Some(n) => current_page = n,
                None => current_page += 1, // bare form feed: next page
            }
            continue;
        }
        let Some((line_no, content_start)) = leading_line_number(line) else {
            // Unnumbered, non-marker line (caption stray, reporter note):
            // in a detected certified transcript these are rare (< 40% by
            // the detection gate); skip rather than fabricate a locator.
            continue;
        };
        let content = &line[content_start..];
        let content = content.trim_end();
        if content.is_empty() {
            continue;
        }

        // Break BEFORE adding this line when it would overflow the budget,
        // or — preferentially — when it opens a new Q./A. exchange and the
        // chunk is already mostly full.
        let would_overflow =
            !buf.is_empty() && buf.len() + content.len() + 1 > TARGET_BYTES;
        let qa_boundary = (content.starts_with("Q.") || content.starts_with("A."))
            && buf.len() >= SOFT_BREAK_BYTES;
        if would_overflow || qa_boundary {
            flush(
                &mut buf,
                &mut buf_start,
                buf_end,
                buf_start_offset,
                buf_end_offset,
                &mut chunk_idx,
                &mut out,
            );
        }

        if buf.is_empty() {
            buf_start = Some((current_page, line_no));
            buf_start_offset = line_start;
        } else {
            buf.push('\n');
        }
        buf.push_str(content);
        buf_end = (current_page, line_no);
        buf_end_offset = line_start + raw.trim_end_matches(['\n', '\r']).len();
    }

    flush(
        &mut buf,
        &mut buf_start,
        buf_end,
        buf_start_offset,
        buf_end_offset,
        &mut chunk_idx,
        &mut out,
    );

    out
}

/// The start page of a "sp:sl-ep:el" locator — the honest `page_number` for
/// the store's `SourceType::Transcript` (mirrors how PDF pages band).
pub fn locator_start_page(locator: Option<&str>) -> Option<u32> {
    locator?.split(':').next()?.parse().ok()
}

/// Parse a leading certified-gutter line number: up to 8 leading
/// spaces/tabs, then 1-2 digits forming 1..=25, then whitespace, then
/// non-whitespace content (`^\s{0,8}(\d{1,2})\s+\S`). Returns the number
/// and the byte offset where the content starts.
fn leading_line_number(line: &str) -> Option<(u32, usize)> {
    let bytes = line.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
        if i > 8 {
            return None;
        }
    }
    let digit_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let digits = i - digit_start;
    if digits == 0 || digits > 2 {
        return None;
    }
    let n: u32 = line[digit_start..i].parse().ok()?;
    if !(1..=25).contains(&n) {
        return None;
    }
    // Whitespace, then content.
    let ws_start = i;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    if i == ws_start || i >= bytes.len() {
        return None; // no separator, or a bare number line (no content)
    }
    Some((n, i))
}

/// Is this line a page marker? `Some(Some(n))` for "Page N"/"PAGE N"
/// (optionally dash-prefixed), `Some(None)` for a form-feed page break,
/// `None` otherwise.
fn parse_page_marker(line: &str) -> Option<Option<u32>> {
    if line.contains('\u{0C}') {
        return Some(None);
    }
    let t = line.trim_start();
    let t = match t.strip_prefix('-') {
        Some(rest) => rest.trim_start(),
        None => t,
    };
    let rest = t.strip_prefix("Page").or_else(|| t.strip_prefix("PAGE"))?;
    let rest = rest.strip_prefix(|c: char| c == ' ' || c == '\t')?;
    let rest = rest.trim();
    if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
        rest.parse().ok().map(Some)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_DIR: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/matter-corpus"
    );

    fn read_fixture(name: &str) -> String {
        let path = format!("{FIXTURE_DIR}/{name}");
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read fixture {path}: {e}"))
    }

    /// Parse "sp:sl-ep:el" into ((sp, sl), (ep, el)). Panics on malformation —
    /// the well-formedness test below is the gate.
    fn parse_locator(loc: &str) -> ((u32, u32), (u32, u32)) {
        let (start, end) = loc.split_once('-').expect("locator has a dash");
        let parse_pair = |s: &str| -> (u32, u32) {
            let (p, l) = s.split_once(':').expect("page:line");
            (p.parse().expect("page"), l.parse().expect("line"))
        };
        (parse_pair(start), parse_pair(end))
    }

    // -----------------------------------------------------------------------
    // Detection — conservative in BOTH directions. The certified Weston
    // fixture must detect; the existing Johnson fixture (Q./A. + "PAGE N"
    // prose, deliberately NOT line-numbered) must NOT — leg-1's c1/c2/c3
    // chunk-id assertions depend on it staying on the generic path.
    // -----------------------------------------------------------------------

    #[test]
    fn detects_the_certified_weston_fixture() {
        let text = read_fixture("deposition-transcript-weston-certified.txt");
        assert!(detect_transcript(&text), "certified fixture must detect");
    }

    #[test]
    fn does_not_detect_the_johnson_prose_transcript() {
        let text = read_fixture("deposition-transcript-johnson.txt");
        assert!(
            !detect_transcript(&text),
            "the Q./A. prose transcript must stay on the generic path"
        );
    }

    #[test]
    fn does_not_detect_the_incident_summary_markdown() {
        let text = read_fixture("incident-summary-johnson.md");
        assert!(!detect_transcript(&text));
    }

    #[test]
    fn does_not_detect_a_code_file() {
        // Numbered-list-ish code/prose with no page rhythm must never detect.
        let code = "\
fn main() {
    let x = 1;
    let y = 2;
    println!(\"{}\", x + y);
}

1 first item
2 second item
3 third item
";
        assert!(!detect_transcript(code));
        assert!(!detect_transcript(""));
        assert!(!detect_transcript("   \n  \n"));
    }

    #[test]
    fn page_marker_alone_is_not_enough() {
        // The Johnson fixture has "PAGE N" headers; without the numbered
        // gutter + reset rhythm those markers must not flip detection.
        let text = "PAGE 1\n\nQ. Hello?\nA. Hi.\n\nPAGE 2\n\nQ. More?\nA. Yes.\n";
        assert!(!detect_transcript(text));
    }

    // -----------------------------------------------------------------------
    // Chunking — locators well-formed + strictly ordered; the planted
    // litigation-hold sentence's chunk covers page 2 lines 14-16 (the
    // generator's WESTON_HOLD_* constants); gutter stripped from chunk text.
    // -----------------------------------------------------------------------

    #[test]
    fn weston_chunks_have_well_formed_strictly_ordered_locators() {
        let text = read_fixture("deposition-transcript-weston-certified.txt");
        let chunks = chunk_transcript("/t/weston.txt", &text);
        assert!(chunks.len() >= 2, "4 certified pages must span several chunks");

        let mut prev_end: Option<(u32, u32)> = None;
        for (i, c) in chunks.iter().enumerate() {
            assert_eq!(c.paragraph_index, i as u32, "sequential paragraph_index");
            let loc = c.locator.as_deref().unwrap_or_else(|| {
                panic!("chunk {i} missing locator")
            });
            // ^\d+:\d+-\d+:\d+$ — parse_locator panics on anything else.
            let ((sp, sl), (ep, el)) = parse_locator(loc);
            assert!(
                (sp, sl) <= (ep, el),
                "chunk {i} locator {loc} runs backwards"
            );
            if let Some(prev) = prev_end {
                assert!(
                    (sp, sl) > prev,
                    "chunk {i} locator {loc} does not advance past {prev:?}"
                );
            }
            prev_end = Some((ep, el));
        }
    }

    #[test]
    fn litigation_hold_sentence_chunk_covers_page_2_lines_14_to_16() {
        // Mirrors the generator constants WESTON_HOLD_PAGE = 2,
        // WESTON_HOLD_LINES = (14, 16).
        let text = read_fixture("deposition-transcript-weston-certified.txt");
        let chunks = chunk_transcript("/t/weston.txt", &text);
        let c = chunks
            .iter()
            .find(|c| c.text.contains("The litigation hold notice went out to"))
            .expect("the planted sentence must be in a chunk");
        let ((sp, sl), (ep, el)) = parse_locator(c.locator.as_deref().unwrap());
        assert!(
            (sp, sl) <= (2, 14) && (2, 16) <= (ep, el),
            "locator {}:{}-{}:{} must cover 2:14-2:16",
            sp, sl, ep, el
        );
        // The spoken words survive across the line wraps.
        assert!(c.text.contains("the cloud infrastructure team on September"));
        assert!(c.text.contains("12, 2025."));
    }

    #[test]
    fn chunk_text_preserves_spoken_words_but_strips_the_gutter() {
        let text = read_fixture("deposition-transcript-weston-certified.txt");
        let chunks = chunk_transcript("/t/weston.txt", &text);
        assert!(!chunks.is_empty());
        let joined: String = chunks
            .iter()
            .map(|c| c.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        // Spoken words present…
        assert!(joined.contains("Thomas Edward Weston."));
        assert!(joined.contains("document retention policy"));
        // …and no line of any chunk still carries the line-number gutter
        // (it would pollute embeddings and quote verification).
        for c in &chunks {
            for line in c.text.lines() {
                assert!(
                    leading_line_number(line).is_none(),
                    "gutter leaked into chunk {} line {:?}",
                    c.paragraph_index,
                    line
                );
            }
        }
        // Page markers are layout, not testimony.
        assert!(!joined.contains("Page 2"));
    }

    #[test]
    fn empty_input_chunks_to_nothing() {
        assert!(chunk_transcript("/t/x.txt", "").is_empty());
        assert!(chunk_transcript("/t/x.txt", "  \n \n").is_empty());
    }

    // -----------------------------------------------------------------------
    // Helpers.
    // -----------------------------------------------------------------------

    #[test]
    fn locator_start_page_parses_the_first_number() {
        assert_eq!(locator_start_page(Some("45:12-46:3")), Some(45));
        assert_eq!(locator_start_page(Some("2:14-2:16")), Some(2));
        assert_eq!(locator_start_page(None), None);
        assert_eq!(locator_start_page(Some("garbage")), None);
    }

    #[test]
    fn leading_line_number_matches_the_certified_gutter_only() {
        assert_eq!(leading_line_number(" 1   Hello there."), Some((1, 5)));
        assert_eq!(leading_line_number("25   Last line."), Some((25, 5)));
        assert_eq!(leading_line_number("        14  text"), Some((14, 12)));
        // 3+ digits, 0, 26+, bare numbers, no separator: never a gutter.
        assert_eq!(leading_line_number("1200 Commerce Drive"), None);
        assert_eq!(leading_line_number("0  zero"), None);
        assert_eq!(leading_line_number("26  too high"), None);
        assert_eq!(leading_line_number("14"), None);
        assert_eq!(leading_line_number("14"), None);
        assert_eq!(leading_line_number("Q. Did you?"), None);
        // More than 8 leading spaces: centered text, not a gutter.
        assert_eq!(leading_line_number("          12   centered"), None);
    }

    #[test]
    fn parse_page_marker_variants() {
        assert_eq!(parse_page_marker("Page 2"), Some(Some(2)));
        assert_eq!(parse_page_marker("   PAGE 14"), Some(Some(14)));
        assert_eq!(parse_page_marker("- Page 3"), Some(Some(3)));
        assert_eq!(parse_page_marker("\u{0C}"), Some(None));
        assert_eq!(parse_page_marker("Page two"), None);
        assert_eq!(parse_page_marker("Pages 2-4 follow"), None);
        assert_eq!(parse_page_marker("The Page 2 ruling"), None);
    }
}
