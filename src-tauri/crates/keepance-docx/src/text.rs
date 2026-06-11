//! VG-2b — plain-text extraction from the parsed Document tree, for the
//! semantic index. Produces the document's CURRENT READING: tracked
//! insertions included, tracked deletions excluded (the same semantics as
//! resolve_all(Accept), without mutating). Comments are not included.
//! Unmodeled Raw blocks/inlines (tables, hyperlinks, sdt, …) contribute
//! their visible `<w:t>` text via a guarded XML walk — raw markup must
//! never leak into the search index.

use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::model::{BlockContent, Document, Inline, Paragraph, Run};
use crate::parse::{general_ref_text, local_of};

/// One trimmed plain-text string per non-empty paragraph/table-block,
/// in document order.
pub fn extract_paragraph_texts(doc: &Document) -> Vec<String> {
    let mut out = Vec::new();
    for block in &doc.body {
        let text = match block {
            BlockContent::Paragraph(p) => paragraph_text(p),
            // Tables (and other unmodeled blocks) arrive as Raw — recover
            // their visible text so contracts with tabular clauses index.
            BlockContent::Raw { xml } => raw_visible_text(xml),
        };
        let t = text.trim().to_string();
        if !t.is_empty() {
            out.push(t);
        }
    }
    out
}

fn runs_text(runs: &[Run], s: &mut String) {
    for r in runs {
        s.push_str(&r.text);
    }
}

fn paragraph_text(p: &Paragraph) -> String {
    let mut s = String::new();
    for inline in &p.inlines {
        match inline {
            Inline::Run(r) => s.push_str(&r.text),
            Inline::Insertion { runs, .. } => runs_text(runs, &mut s),
            Inline::Deletion { .. } => {} // deleted text is not the current reading
            Inline::Raw { xml } => s.push_str(&raw_visible_text(xml)),
            _ => {} // comment markers carry no text
        }
    }
    s
}

/// Visible text inside an unmodeled XML fragment: the character content of
/// `<w:t>` elements, EXCLUDING anything inside `<w:del>` (deleted text) —
/// `<w:delText>` is a distinct element and is skipped by construction.
///
/// Word boundaries: the end of a block-level unit (`w:p`, `w:tr`) and the
/// visible break/tab empties (`w:br`, `w:cr`, `w:tab`, empty `w:p`) emit a
/// single separating space before the next text, so table cells and tabbed
/// runs never glue together in the index.
///
/// Defensive by design: malformed fragments end the walk early (returning
/// what was collected), unknown entities are skipped (never expanded — the
/// parser's billion-laughs stance, see parse.rs SECURITY notes), and raw
/// markup can never leak into the output because only character content of
/// `<w:t>` is collected.
fn raw_visible_text(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false); // mirror parse.rs: whitespace verbatim

    fn top_is_t(stack: &[String]) -> bool {
        stack.last().map(String::as_str) == Some("t")
    }
    fn push_text(out: &mut String, pending_sep: &mut bool, s: &str) {
        if *pending_sep {
            // One separating space, deduplicated. Kept even when leading (a
            // fragment starting with <w:tab/> must not glue onto the caller's
            // previous run text; standalone fragments are trimmed upstream).
            if !out.ends_with(' ') {
                out.push(' ');
            }
            *pending_sep = false;
        }
        out.push_str(s);
    }

    let mut out = String::new();
    let mut stack: Vec<String> = Vec::new();
    let mut del_depth: usize = 0;
    let mut pending_sep = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let ln = local_of(e.name());
                if ln == "del" {
                    del_depth += 1;
                }
                stack.push(ln);
            }
            Ok(Event::End(e)) => {
                let ln = local_of(e.name());
                if ln == "del" {
                    del_depth = del_depth.saturating_sub(1);
                }
                if matches!(ln.as_str(), "p" | "tr") {
                    pending_sep = true;
                }
                stack.pop();
            }
            Ok(Event::Empty(e)) => {
                if matches!(local_of(e.name()).as_str(), "br" | "cr" | "tab" | "p") {
                    pending_sep = true;
                }
            }
            Ok(Event::Text(t)) if del_depth == 0 && top_is_t(&stack) => {
                if let Ok(s) = t.xml_content() {
                    push_text(&mut out, &mut pending_sep, &s);
                }
            }
            Ok(Event::CData(c)) if del_depth == 0 && top_is_t(&stack) => {
                push_text(
                    &mut out,
                    &mut pending_sep,
                    &String::from_utf8_lossy(c.as_ref()),
                );
            }
            Ok(Event::GeneralRef(r)) if del_depth == 0 && top_is_t(&stack) => {
                if let Some(s) = general_ref_text(&r) {
                    push_text(&mut out, &mut pending_sep, &s);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            // A preserved fragment should always be well-formed (it was sliced
            // from a parsed document), but never panic on one that is not.
            Err(_) => break,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Paragraph, RevisionMeta};

    /// Absolute path to the matter-corpus fixture directory.
    /// `CARGO_MANIFEST_DIR` points to `src-tauri/crates/keepance-docx/`
    /// (same helper as `tests/campaign_fixtures.rs`).
    fn corpus_path(filename: &str) -> std::path::PathBuf {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest
            .parent() // crates/
            .and_then(|p| p.parent()) // src-tauri/
            .and_then(|p| p.parent()) // repo root
            .expect("unexpected crate layout");
        repo_root
            .join("tests")
            .join("fixtures")
            .join("matter-corpus")
            .join(filename)
    }

    fn extract_fixture(filename: &str) -> Vec<String> {
        let path = corpus_path(filename);
        assert!(
            path.exists(),
            "fixture missing: {:?} — run generators/generate-fixtures.py",
            path
        );
        let bytes = std::fs::read(&path).expect("read fixture");
        let doc = crate::parse_docx_bytes(&bytes).expect("parse fixture");
        extract_paragraph_texts(&doc)
    }

    /// Parse a synthetic `word/document.xml` body fragment through the real
    /// parser, so tests exercise parse + extract end to end.
    fn parse_body_xml(body_inner: &str) -> Document {
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body_inner}</w:body></w:document>"#
        );
        crate::parse::parse_document(&xml, None).expect("parse synthetic document")
    }

    // -----------------------------------------------------------------------
    // Real fixtures (strings probed verbatim from the corpus — Wave 2 plan,
    // corrections table)
    // -----------------------------------------------------------------------

    #[test]
    fn services_agreement_key_clauses_extracted() {
        let texts = extract_fixture("contract-services-agreement.docx");
        let joined = texts.join("\n\n");
        assert!(
            joined.contains("blended hourly rate of $375 per hour"),
            "rate clause missing from extraction:\n{joined}"
        );
        assert!(
            joined.contains("the laws of the State of New York"),
            "governing-law clause missing from extraction:\n{joined}"
        );
    }

    #[test]
    fn xml_entities_in_fixture_run_text_resolve() {
        // The fixture's document.xml says `Marchetti &amp; Associates LLP`
        // inside <w:t>. quick-xml 0.38 emits entities as separate GeneralRef
        // events; dropping them loses the "&" (real data loss for a firm name).
        let texts = extract_fixture("contract-services-agreement.docx");
        let joined = texts.join("\n\n");
        assert!(
            joined.contains("Marchetti & Associates LLP"),
            "&amp; inside <w:t> must extract as '&':\n{joined}"
        );
        assert!(
            !joined.contains("Marchetti  Associates"),
            "entity reference was dropped instead of resolved:\n{joined}"
        );
    }

    #[test]
    fn tracked_letter_reads_as_accepted_view() {
        let texts = extract_fixture("engagement-letter-tracked.docx");
        let joined = texts.join("\n\n");
        // Tracked insertions are part of the current reading — KEPT.
        assert!(
            joined.contains(
                "[INSERTED BY MARCHETTI] Additionally, we will provide monthly status updates."
            ),
            "tracked insertion missing from extraction:\n{joined}"
        );
        assert!(
            joined.contains("[INSERTED BY THORNTON] Hourly rate subject to annual review."),
            "second tracked insertion missing from extraction:\n{joined}"
        );
        // Tracked deletions are not the current reading — EXCLUDED.
        assert!(
            !joined.contains("[TO BE REMOVED: placeholder text from template]"),
            "tracked deletion leaked into extraction:\n{joined}"
        );
        assert!(
            !joined.contains("[DELETED BY THORNTON: duplicated clause — see section 4]"),
            "second tracked deletion leaked into extraction:\n{joined}"
        );
    }

    #[test]
    fn no_markup_ever_leaks_from_fixture_extraction() {
        for fixture in [
            "contract-services-agreement.docx",
            "engagement-letter-tracked.docx",
            "matter-b-acme/intake-memo-acme.docx",
        ] {
            let texts = extract_fixture(fixture);
            assert!(!texts.is_empty(), "no text extracted from {fixture}");
            for t in &texts {
                assert!(
                    !t.contains('<') && !t.contains("w:p") && !t.contains("xml"),
                    "raw markup leaked from {fixture}: {t}"
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Synthetic model walks
    // -----------------------------------------------------------------------

    #[test]
    fn plain_runs_concatenate_and_empty_paragraphs_drop() {
        let doc = Document {
            body: vec![
                BlockContent::Paragraph(Paragraph::from_inlines(vec![
                    Inline::Run(Run::new("Hello, ")),
                    Inline::Run(Run::new("world.")),
                ])),
                BlockContent::Paragraph(Paragraph::default()), // empty -> dropped
                BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(
                    "   ",
                ))])), // whitespace-only -> dropped
                BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(
                    "Second.",
                ))])),
            ],
            ..Default::default()
        };
        assert_eq!(extract_paragraph_texts(&doc), vec!["Hello, world.", "Second."]);
    }

    #[test]
    fn revisions_extract_as_current_reading_and_comment_markers_are_silent() {
        let meta = RevisionMeta {
            id: "1".into(),
            author: "Marchetti".into(),
            date: "2026-06-10T00:00:00Z".into(),
        };
        let doc = Document {
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![
                Inline::CommentRangeStart { id: "0".into() },
                Inline::Run(Run::new("Fees are ")),
                Inline::Deletion {
                    meta: meta.clone(),
                    runs: vec![Run::new("negotiable")],
                },
                Inline::Insertion {
                    meta,
                    runs: vec![Run::new("fixed"), Run::new(" annually")],
                },
                Inline::Run(Run::new(".")),
                Inline::CommentRangeEnd { id: "0".into() },
                Inline::CommentReference { id: "0".into() },
            ]))],
            ..Default::default()
        };
        assert_eq!(extract_paragraph_texts(&doc), vec!["Fees are fixed annually."]);
    }

    #[test]
    fn raw_hyperlink_inline_text_recovers() {
        let doc = Document {
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![
                Inline::Run(Run::new("See ")),
                Inline::Raw {
                    xml: r#"<w:hyperlink r:id="rId4"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the fee schedule</w:t></w:r></w:hyperlink>"#.into(),
                },
                Inline::Run(Run::new(" for details.")),
            ]))],
            ..Default::default()
        };
        assert_eq!(
            extract_paragraph_texts(&doc),
            vec!["See the fee schedule for details."]
        );
    }

    #[test]
    fn raw_table_block_recovers_cell_text_without_markup() {
        let tbl = r#"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Service</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rate &amp; basis</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Litigation</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$375/hour</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
        let doc = Document {
            body: vec![BlockContent::Raw { xml: tbl.into() }],
            ..Default::default()
        };
        let texts = extract_paragraph_texts(&doc);
        assert_eq!(texts, vec!["Service Rate & basis Litigation $375/hour"]);
    }

    #[test]
    fn raw_walk_excludes_deleted_text() {
        // <w:delText> is skipped by construction; a (nonconforming) <w:t>
        // inside <w:del> is excluded by the del-depth guard.
        let tbl = r#"<w:tbl><w:tr><w:tc><w:p><w:r><w:t>kept</w:t></w:r><w:del w:id="9" w:author="T" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del><w:del w:id="10" w:author="T" w:date="2026-01-01T00:00:00Z"><w:r><w:t>also-gone</w:t></w:r></w:del></w:p></w:tc></w:tr></w:tbl>"#;
        let doc = Document {
            body: vec![BlockContent::Raw { xml: tbl.into() }],
            ..Default::default()
        };
        assert_eq!(extract_paragraph_texts(&doc), vec!["kept"]);
    }

    #[test]
    fn raw_walk_resolves_numeric_refs_and_skips_unknown_entities() {
        // Numeric character references resolve; unknown (DTD-style) entities
        // are skipped, never expanded (billion-laughs stays inert).
        let xml = r#"<w:p><w:r><w:t>caf&#233; &undefinedEntity; menu</w:t></w:r></w:p>"#;
        let doc = Document {
            body: vec![BlockContent::Raw { xml: xml.into() }],
            ..Default::default()
        };
        assert_eq!(extract_paragraph_texts(&doc), vec!["café  menu"]);
    }

    // -----------------------------------------------------------------------
    // Parse + extract end to end (synthetic documents through the real parser)
    // -----------------------------------------------------------------------

    #[test]
    fn parser_resolves_predefined_entities_in_run_text() {
        let doc = parse_body_xml(r#"<w:p><w:r><w:t>Smith &amp; Jones &lt;LLP&gt;</w:t></w:r></w:p>"#);
        assert_eq!(extract_paragraph_texts(&doc), vec!["Smith & Jones <LLP>"]);
    }

    #[test]
    fn parser_resolves_entities_inside_tracked_insertions() {
        let doc = parse_body_xml(
            r#"<w:p><w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Fees &amp; costs</w:t></w:r></w:ins></w:p>"#,
        );
        assert_eq!(extract_paragraph_texts(&doc), vec!["Fees & costs"]);
    }

    #[test]
    fn resolved_entities_round_trip_without_double_escaping() {
        // parse (&amp; -> "&") -> serialize (escapes back) -> parse: stable.
        let doc = parse_body_xml(r#"<w:p><w:r><w:t>Smith &amp; Jones</w:t></w:r></w:p>"#);
        let bytes = crate::serialize_docx_bytes(&doc).expect("serialize");
        let reparsed = crate::parse_docx_bytes(&bytes).expect("re-parse");
        assert_eq!(extract_paragraph_texts(&reparsed), vec!["Smith & Jones"]);
    }

    #[test]
    fn raw_run_with_tab_separates_words() {
        // A run containing <w:tab/> is preserved whole as Inline::Raw; its
        // visible text must not glue onto the previous run's text.
        let doc = parse_body_xml(
            r#"<w:p><w:r><w:t>Name:</w:t></w:r><w:r><w:tab/><w:t>Diane Marchetti</w:t></w:r></w:p>"#,
        );
        assert_eq!(extract_paragraph_texts(&doc), vec!["Name: Diane Marchetti"]);
    }

    #[test]
    fn comment_display_text_resolves_entities_and_comments_stay_out_of_extraction() {
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body text.</w:t></w:r></w:p></w:body></w:document>"#;
        let comments_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="A" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Check &amp; verify</w:t></w:r></w:p></w:comment></w:comments>"#;
        let doc = crate::parse::parse_document(document_xml, Some(comments_xml))
            .expect("parse with comments");
        assert_eq!(
            doc.comments.get("0").map(|c| c.text.as_str()),
            Some("Check & verify"),
            "comment display text must resolve entities"
        );
        // Comments are not part of the extracted reading.
        assert_eq!(extract_paragraph_texts(&doc), vec!["Body text."]);
    }
}
