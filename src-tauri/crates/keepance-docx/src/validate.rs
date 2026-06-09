//! Vendor-free structural validation of a produced `.docx`.
//!
//! We cannot open the file in Word/LibreOffice here, so we validate as
//! rigorously as possible without a vendor:
//!   1. it contains the parts a Word document needs,
//!   2. every XML part is well-formed (parses to EOF with no error),
//!   3. content-types + rels declare the parts we emit,
//!   4. the revision / comment elements are schema-plausible (required
//!      attributes present, ranges balanced, comment refs resolve).
//!
//! This is the in-house gate the spike established; the residual "does Word's
//! accept/reject UI behave" check belongs to a real-Word fixture harness with
//! a design partner (out of scope for A1).

use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::package::{Package, CONTENT_TYPES_PART, DOCUMENT_PART, ROOT_RELS_PART};

/// A structural validation report. Collected (not fail-fast) so a test can see
/// every problem at once.
#[derive(Debug, Default)]
pub struct Report {
    pub errors: Vec<String>,
}

impl Report {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }
    fn err(&mut self, msg: impl Into<String>) {
        self.errors.push(msg.into());
    }
}

fn xml_is_well_formed(xml: &str) -> std::result::Result<(), String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    loop {
        match reader.read_event() {
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("XML error: {e}")),
        }
    }
    Ok(())
}

fn local(b: &[u8]) -> String {
    let l = match b.iter().position(|&c| c == b':') {
        Some(i) => &b[i + 1..],
        None => b,
    };
    String::from_utf8_lossy(l).into_owned()
}

/// Validate a package end-to-end. Returns a [`Report`]; `report.ok()` is the
/// overall verdict.
pub fn validate_package(pkg: &Package) -> Report {
    let mut r = Report::default();

    // 1. essential parts present (a real Word doc has at least these three;
    // styles/theme/etc. are preserved from the source but not strictly required
    // for structural validity here).
    for part in [CONTENT_TYPES_PART, ROOT_RELS_PART, DOCUMENT_PART] {
        if !pkg.contains(part) {
            r.err(format!("missing required part: {part}"));
        }
    }

    // 2. every .xml / .rels part is well-formed.
    for name in pkg.part_names() {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            match pkg.get_str(name) {
                Some(xml) => {
                    if let Err(e) = xml_is_well_formed(&xml) {
                        r.err(format!("{name} not well-formed: {e}"));
                    }
                }
                None => r.err(format!("{name} is not valid UTF-8")),
            }
        }
    }

    // 3. content-types declares the main document.
    if let Some(ct) = pkg.get_str(CONTENT_TYPES_PART) {
        if !ct.contains("wordprocessingml.document.main+xml") {
            r.err("[Content_Types].xml missing main document override".to_string());
        }
        // If a comments part exists, it must be declared.
        if pkg.contains(crate::package::COMMENTS_PART)
            && !ct.contains("wordprocessingml.comments+xml")
        {
            r.err("comments.xml present but not declared in [Content_Types].xml".to_string());
        }
    }
    // 3b. root rels points at the document.
    if let Some(rels) = pkg.get_str(ROOT_RELS_PART) {
        if !rels.contains("word/document.xml") {
            r.err("_rels/.rels does not target word/document.xml".to_string());
        }
    }

    // 4. schema-plausibility of revisions + comments.
    if let Some(doc_xml) = pkg.get_str(DOCUMENT_PART) {
        if let Err(e) = check_revisions_plausible(&doc_xml) {
            r.err(format!("revision markup implausible: {e}"));
        }
        if let Err(e) = check_comment_ranges_balanced(&doc_xml, pkg) {
            r.err(format!("comment anchoring implausible: {e}"));
        }
    }

    r
}

/// Every `w:ins`/`w:del` must carry `w:id`, `w:author`, `w:date`; every `w:del`
/// must contain `w:delText` (not `w:t`); `w:delText` must only appear inside
/// `w:del`.
// The per-arm `if` guards read more clearly as explicit checks than as match
// guards collapsed into the pattern, so keep them separate.
#[allow(clippy::collapsible_match)]
fn check_revisions_plausible(xml: &str) -> std::result::Result<(), String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut stack: Vec<&'static str> = Vec::new();

    let has_attr = |e: &quick_xml::events::BytesStart, want: &str| -> bool {
        e.attributes().with_checks(false).flatten().any(|a| {
            let kb = a.key.as_ref();
            let l = match kb.iter().position(|&b| b == b':') {
                Some(i) => &kb[i + 1..],
                None => kb,
            };
            l == want.as_bytes()
        })
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let ln = local(e.name().as_ref());
                match ln.as_str() {
                    "ins" | "del" => {
                        for req in ["id", "author", "date"] {
                            if !has_attr(&e, req) {
                                return Err(format!("<w:{ln}> missing w:{req}"));
                            }
                        }
                        stack.push(if ln == "ins" { "ins" } else { "del" });
                    }
                    "t" => {
                        if stack.last() == Some(&"del") {
                            return Err("<w:t> inside <w:del> (must be <w:delText>)".into());
                        }
                    }
                    "delText" => {
                        if stack.last() != Some(&"del") {
                            return Err("<w:delText> outside <w:del>".into());
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let ln = local(e.name().as_ref());
                if (ln == "ins" || ln == "del") && !stack.is_empty() {
                    stack.pop();
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("XML error: {e}")),
        }
    }
    if !stack.is_empty() {
        return Err(format!("unbalanced revision wrapper(s): {stack:?}"));
    }
    Ok(())
}

/// Each `commentRangeStart` id must have a matching `commentRangeEnd`; each
/// `commentReference` id must resolve to a `<w:comment>` in comments.xml.
fn check_comment_ranges_balanced(
    doc_xml: &str,
    pkg: &Package,
) -> std::result::Result<(), String> {
    use std::collections::BTreeSet;
    let mut starts: BTreeSet<String> = BTreeSet::new();
    let mut ends: BTreeSet<String> = BTreeSet::new();
    let mut refs: BTreeSet<String> = BTreeSet::new();

    let mut reader = Reader::from_str(doc_xml);
    reader.config_mut().trim_text(false);

    let id_attr = |e: &quick_xml::events::BytesStart| -> Option<String> {
        e.attributes().with_checks(false).flatten().find_map(|a| {
            let kb = a.key.as_ref();
            let lk = match kb.iter().position(|&b| b == b':') {
                Some(i) => &kb[i + 1..],
                None => kb,
            };
            if lk == b"id" {
                Some(String::from_utf8_lossy(&a.value).into_owned())
            } else {
                None
            }
        })
    };

    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                match local(e.name().as_ref()).as_str() {
                    "commentRangeStart" => {
                        if let Some(id) = id_attr(&e) {
                            starts.insert(id);
                        }
                    }
                    "commentRangeEnd" => {
                        if let Some(id) = id_attr(&e) {
                            ends.insert(id);
                        }
                    }
                    "commentReference" => {
                        if let Some(id) = id_attr(&e) {
                            refs.insert(id);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("XML error: {e}")),
        }
    }

    if starts != ends {
        return Err(format!(
            "commentRangeStart ids {starts:?} != commentRangeEnd ids {ends:?}"
        ));
    }

    if refs.is_empty() {
        return Ok(());
    }
    let comments_xml = pkg
        .get_str(crate::package::COMMENTS_PART)
        .ok_or_else(|| "comments referenced but no comments.xml".to_string())?;
    for id in &refs {
        let needle = format!("w:id=\"{id}\"");
        if !comments_xml.contains(&needle) {
            return Err(format!(
                "commentReference id {id} has no <w:comment> in comments.xml"
            ));
        }
    }
    Ok(())
}
