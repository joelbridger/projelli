//! VG-4c — firm letterhead merge.
//!
//! Re-houses a generated document's content inside a letterhead template's
//! package, so workflow deliverables (and new documents, via a plain byte copy
//! handled on the TS side) come out on the firm's letterhead.
//!
//! # What the template contributes vs the generated document
//!
//! The template package contributes EVERY package part the generated document
//! lacks: `word/header*.xml`, `word/footer*.xml`, `word/styles.xml`,
//! `word/numbering.xml`, theme, fonts, media, and the relationship files that
//! tie them together. Crucially it also contributes the body-level `<w:sectPr>`
//! — the section-properties element that carries the `headerReference` /
//! `footerReference` that BIND the header/footer parts to the printed pages.
//! Drop the template's sectPr and the headers/footers stop rendering even
//! though their parts are present.
//!
//! The generated document contributes only its CONTENT blocks (paragraphs and
//! tables). Its own body-level sectPr — the `docx` JS Packer always emits one;
//! see `createBlankDocx`'s comment in `docx-io.ts` — is dropped in favor of the
//! template's.
//!
//! # Why a package merge (not a byte copy) for deliverables
//!
//! New blank documents can be a straight byte copy of the template (trivially
//! correct: header, footer, styles, and an empty body all come along). A
//! workflow deliverable already HAS generated content, so its content blocks
//! must be transplanted into the template package. This is that transplant.

use crate::model::{BlockContent, Document};
use crate::OpenedDocument;

/// True when a body block is the body-level section-properties element
/// (`<w:sectPr>…`). The parser captures it as [`BlockContent::Raw`] (see
/// `parse.rs` — "PRESERVE: any other block element (tbl, sdt, sectPr, …)").
/// Paragraph-level sectPr (`<w:pPr><w:sectPr/>` marking a section break inside
/// a paragraph) lives inside a [`BlockContent::Paragraph`]'s `properties_xml`,
/// not as its own block, so it is unaffected by this body-block filter.
fn is_body_sect_pr(block: &BlockContent) -> bool {
    matches!(block, BlockContent::Raw { xml } if xml.contains("<w:sectPr"))
}

/// Re-house a generated document's content in a letterhead template's package.
///
/// The result is the template's [`OpenedDocument`] (every package part intact)
/// with its body replaced by: the generated document's content blocks (its own
/// body-level sectPr removed) followed by the template's body-level sectPr
/// (so the template's header/footer bindings survive). The generated document's
/// comments are carried over so AI redline comments in a deliverable are not
/// lost.
///
/// If the template has no body-level sectPr (unusual but possible for a
/// hand-built minimal package), the merged body simply omits one and the
/// serializer synthesizes its own on save — the same fallback the engine
/// already relies on for brand-new documents.
pub fn merge_into_template(generated: &Document, template: OpenedDocument) -> OpenedDocument {
    // Generated content blocks, minus the generated body-level sectPr.
    let mut body: Vec<BlockContent> = generated
        .body
        .iter()
        .filter(|b| !is_body_sect_pr(b))
        .cloned()
        .collect();

    // Append the template's body-level sectPr (the last one, the way Word
    // places the final section). This is what binds the letterhead's
    // header/footer parts to the pages.
    if let Some(sect) = template
        .document
        .body
        .iter()
        .rev()
        .find(|b| is_body_sect_pr(b))
    {
        body.push(sect.clone());
    }

    let mut doc = template.document.clone();
    doc.body = body;
    doc.comments = generated.comments.clone();
    template.with_document(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Comment, Inline, Paragraph, Run};
    use crate::{open_docx_bytes, parse_docx_bytes, Package};

    /// Absolute path to a matter-corpus fixture. `CARGO_MANIFEST_DIR` points to
    /// `src-tauri/crates/keepance-docx/` (same helper as `text.rs` /
    /// `tests/campaign_fixtures.rs`).
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

    fn read_fixture(filename: &str) -> Vec<u8> {
        let path = corpus_path(filename);
        assert!(
            path.exists(),
            "fixture missing: {:?} — run generators/generate-fixtures.py",
            path
        );
        std::fs::read(&path).expect("read fixture")
    }

    /// Count body-level `<w:sectPr>` occurrences in a package's
    /// `word/document.xml`.
    fn body_sect_pr_count(bytes: &[u8]) -> usize {
        let pkg = Package::read_from_bytes(bytes).expect("valid package");
        let doc_xml = pkg
            .get_str("word/document.xml")
            .expect("document.xml present");
        doc_xml.matches("<w:sectPr").count()
    }

    /// A small synthetic "generated" document: one content paragraph plus a
    /// trailing body-level sectPr Raw block (the shape the `docx` JS Packer
    /// emits — the thing the merge must drop).
    fn generated_with_own_sectpr(body_text: &str) -> Document {
        Document {
            body: vec![
                BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(
                    body_text,
                ))])),
                BlockContent::Raw {
                    // A uniquely-marked generated sectPr so the test can prove
                    // it was dropped (a real page size would collide with the
                    // template's default US-Letter sectPr).
                    xml: r#"<w:sectPr w:rsidR="GENERATEDSTUB"><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>"#.into(),
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn merge_keeps_template_header_part_and_one_sectpr_with_generated_body() {
        // Generated document: parse a real fixture so the body is realistic.
        let generated = parse_docx_bytes(&read_fixture("contract-services-agreement.docx"))
            .expect("parse generated");
        // It carries at least one body-level sectPr of its own (Word documents
        // always do) — the merge must NOT keep it.
        let generated_sectpr =
            generated.body.iter().filter(|b| is_body_sect_pr(b)).count();
        assert!(
            generated_sectpr >= 1,
            "test premise: the source doc should have a body-level sectPr"
        );

        let template =
            open_docx_bytes(&read_fixture("letterhead-template.docx")).expect("open template");
        // The template package carries the letterhead header part.
        assert!(
            template.package.contains("word/header1.xml"),
            "template should carry a header part"
        );

        let merged = merge_into_template(&generated, template);
        let bytes = merged.save_bytes().expect("serialize merged");

        // 1. Re-parses cleanly through the full open path.
        let reopened = open_docx_bytes(&bytes).expect("merged doc re-opens cleanly");

        // 2. The template's header part survived into the merged package.
        assert!(
            reopened.package.contains("word/header1.xml"),
            "merged package must keep the template header part"
        );
        assert!(
            reopened.package.contains("word/footer1.xml"),
            "merged package must keep the template footer part"
        );

        // 3. Exactly ONE body-level sectPr in document.xml — the template's;
        //    the generated document's was dropped.
        assert_eq!(
            body_sect_pr_count(&bytes),
            1,
            "merged document must have exactly one body-level sectPr (the template's)"
        );

        // 4. The generated body content is present (round-trips through the
        //    merge + serialize).
        let texts = crate::text::extract_paragraph_texts(&reopened.document);
        let joined = texts.join("\n\n");
        assert!(
            joined.contains("blended hourly rate of $375 per hour"),
            "generated body content must be present in the merged document:\n{joined}"
        );
    }

    #[test]
    fn merge_carries_generated_comments_and_drops_only_sectpr_blocks() {
        let mut generated = generated_with_own_sectpr("Deliverable body.");
        generated.comments.insert(
            "7".into(),
            Comment {
                id: "7".into(),
                author: "Keepance AI".into(),
                date: "2026-06-11T00:00:00Z".into(),
                initials: None,
                text: "Verify this clause.".into(),
                body_xml: None,
            },
        );

        let template =
            open_docx_bytes(&read_fixture("letterhead-template.docx")).expect("open template");
        let merged = merge_into_template(&generated, template);

        // Generated comments carried over.
        assert!(
            merged.document.comments.contains_key("7"),
            "generated comments must survive the merge"
        );

        // The generated paragraph survived; the generated sectPr did not.
        let para_blocks = merged
            .document
            .body
            .iter()
            .filter(|b| matches!(b, BlockContent::Paragraph(_)))
            .count();
        assert!(para_blocks >= 1, "generated content paragraph must survive");
        let sect_blocks = merged
            .document
            .body
            .iter()
            .filter(|b| is_body_sect_pr(b))
            .count();
        assert_eq!(
            sect_blocks, 1,
            "exactly one body-level sectPr (the template's) after merge"
        );
        // And it is the template's sectPr, not the generated stub — confirm
        // the uniquely-marked generated stub is gone.
        let has_generated_stub = merged
            .document
            .body
            .iter()
            .any(|b| matches!(b, BlockContent::Raw { xml } if xml.contains("GENERATEDSTUB")));
        assert!(
            !has_generated_stub,
            "the generated document's own sectPr stub must be dropped"
        );
    }

    #[test]
    fn merge_with_template_lacking_sectpr_omits_one() {
        // A hand-built minimal template with NO body-level sectPr.
        let minimal_doc_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document>"#;
        let mut pkg = Package::new();
        pkg.insert("word/document.xml", minimal_doc_xml.as_bytes().to_vec());
        // The merge only reads document.xml; a real serialize path needs the
        // plumbing, but here we exercise the body-merge logic + re-parse.
        let template = OpenedDocument {
            document: crate::parse::parse_document(minimal_doc_xml, None).expect("parse minimal"),
            package: pkg,
        };

        let generated = generated_with_own_sectpr("Body only.");
        let merged = merge_into_template(&generated, template);

        // No body-level sectPr at all (the serializer would synthesize one on
        // save, exactly as for a brand-new document).
        let sect_blocks = merged
            .document
            .body
            .iter()
            .filter(|b| is_body_sect_pr(b))
            .count();
        assert_eq!(
            sect_blocks, 0,
            "no template sectPr to carry, so none is added"
        );
        // The generated body paragraph is present.
        assert!(
            merged
                .document
                .body
                .iter()
                .any(|b| matches!(b, BlockContent::Paragraph(_))),
            "generated content must be present"
        );
    }
}
