//! Vendor-free validation of a produced .docx.
//!
//! `soffice` is not available in this environment, so we cannot ask Word /
//! LibreOffice to open the file. Instead we validate as rigorously as we can
//! without a vendor:
//!   1. it is a valid ZIP and contains every required OPC part,
//!   2. every XML part is well-formed (parses to EOF with no error),
//!   3. content-types + rels declare the parts we emit,
//!   4. the revision / comment elements are schema-plausible (required
//!      attributes present, ranges balanced, comment refs resolve).
//!
//! An independent Python `python-docx` reader (see tests/python_validate.rs)
//! provides a second, non-Keepance opinion that the package actually opens.

use anyhow::{anyhow, bail, Result};
use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::package::{Package, REQUIRED_PARTS};

/// A structural validation report. Collected rather than fail-fast so a test
/// can see everything at once.
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

/// Assert every byte buffer that claims to be a part is well-formed XML.
fn xml_is_well_formed(xml: &str) -> Result<()> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(anyhow!("XML error: {e}")),
        }
        buf.clear();
    }
    Ok(())
}

/// Validate a package end-to-end. Returns a [`Report`]; `report.ok()` is the
/// overall verdict.
pub fn validate_package(pkg: &Package) -> Report {
    let mut r = Report::default();

    // 1. required parts present
    for part in REQUIRED_PARTS {
        if !pkg.contains(part) {
            r.err(format!("missing required part: {part}"));
        }
    }

    // 2. every .xml / .rels part is well-formed
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

    // 3. content-types declares document + comments
    if let Some(ct) = pkg.get_str("[Content_Types].xml") {
        for needle in [
            "wordprocessingml.document.main+xml",
            "wordprocessingml.comments+xml",
        ] {
            if !ct.contains(needle) {
                r.err(format!("[Content_Types].xml missing override for {needle}"));
            }
        }
    }
    // 3b. root rels points at the document
    if let Some(rels) = pkg.get_str("_rels/.rels") {
        if !rels.contains("word/document.xml") {
            r.err("_rels/.rels does not target word/document.xml".to_string());
        }
    }
    // 3c. document rels points at comments
    if let Some(rels) = pkg.get_str("word/_rels/document.xml.rels") {
        if !rels.contains("comments.xml") {
            r.err("word/_rels/document.xml.rels does not target comments.xml".to_string());
        }
    }

    // 4. schema-plausibility of revisions + comments
    if let Some(doc_xml) = pkg.get_str("word/document.xml") {
        if let Err(e) = check_revisions_plausible(&doc_xml) {
            r.err(format!("revision markup implausible: {e}"));
        }
        if let Err(e) = check_comment_ranges_balanced(&doc_xml, pkg) {
            r.err(format!("comment anchoring implausible: {e}"));
        }
    }

    r
}

/// Every `w:ins` / `w:del` must carry `w:id`, `w:author`, `w:date`; every
/// `w:del` must contain `w:delText` (not `w:t`); every `w:ins` must contain
/// `w:t` runs (not `w:delText`).
fn check_revisions_plausible(xml: &str) -> Result<()> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    // Track which revision wrapper we are inside to validate the text tag.
    let mut stack: Vec<&'static str> = Vec::new();

    let has_attr = |e: &quick_xml::events::BytesStart, want: &str| -> bool {
        e.attributes().with_checks(false).flatten().any(|a| {
            let kb = a.key.as_ref();
            let local = match kb.iter().position(|&b| b == b':') {
                Some(i) => &kb[i + 1..],
                None => kb,
            };
            local == want.as_bytes()
        })
    };
    let local = |name: quick_xml::name::QName| -> String {
        let b = name.as_ref();
        let l = match b.iter().position(|&c| c == b':') {
            Some(i) => &b[i + 1..],
            None => b,
        };
        String::from_utf8_lossy(l).into_owned()
    };

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => {
                let ln = local(e.name());
                match ln.as_str() {
                    "ins" | "del" => {
                        for req in ["id", "author", "date"] {
                            if !has_attr(&e, req) {
                                bail!("<w:{ln}> missing w:{req}");
                            }
                        }
                        stack.push(if ln == "ins" { "ins" } else { "del" });
                    }
                    "t" => {
                        if stack.last() == Some(&"del") {
                            bail!("<w:t> found inside <w:del> (must be <w:delText>)");
                        }
                    }
                    "delText" => {
                        if stack.last() != Some(&"del") {
                            bail!("<w:delText> found outside <w:del>");
                        }
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let ln = local(e.name());
                if (ln == "ins" || ln == "del") && !stack.is_empty() {
                    stack.pop();
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    if !stack.is_empty() {
        bail!("unbalanced revision wrapper(s): {stack:?}");
    }
    Ok(())
}

/// Each `commentRangeStart` id must have a matching `commentRangeEnd`, each
/// `commentReference` id must resolve to a `<w:comment>` in comments.xml.
fn check_comment_ranges_balanced(doc_xml: &str, pkg: &Package) -> Result<()> {
    use std::collections::BTreeSet;
    let mut starts: BTreeSet<String> = BTreeSet::new();
    let mut ends: BTreeSet<String> = BTreeSet::new();
    let mut refs: BTreeSet<String> = BTreeSet::new();

    let mut reader = Reader::from_str(doc_xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    let local = |b: &[u8]| -> String {
        let l = match b.iter().position(|&c| c == b':') {
            Some(i) => &b[i + 1..],
            None => b,
        };
        String::from_utf8_lossy(l).into_owned()
    };
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
        let ev = reader.read_event_into(&mut buf)?;
        match &ev {
            Event::Empty(e) | Event::Start(e) => {
                let nb = e.name();
                match local(nb.as_ref()).as_str() {
                    "commentRangeStart" => {
                        if let Some(id) = id_attr(e) {
                            starts.insert(id);
                        }
                    }
                    "commentRangeEnd" => {
                        if let Some(id) = id_attr(e) {
                            ends.insert(id);
                        }
                    }
                    "commentReference" => {
                        if let Some(id) = id_attr(e) {
                            refs.insert(id);
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    if starts != ends {
        bail!("commentRangeStart ids {starts:?} != commentRangeEnd ids {ends:?}");
    }

    // Every referenced comment id must exist in comments.xml.
    let comments_xml = pkg
        .get_str("word/comments.xml")
        .ok_or_else(|| anyhow!("comments referenced but no comments.xml"))?;
    for id in &refs {
        let needle = format!("w:id=\"{id}\"");
        if !comments_xml.contains(&needle) {
            bail!("commentReference id {id} has no <w:comment> in comments.xml");
        }
    }
    Ok(())
}
