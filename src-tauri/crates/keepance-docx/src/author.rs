//! AI authoring helpers: programmatically add NEW tracked changes to the DOM,
//! the way the Keepance AI redliner (task A4) will. These are simple,
//! content-addressed edits over the typed model — the ergonomic win of a DOM
//! over raw XML string-poking.
//!
//! A4 calls into this module (via the `docx_author_revision` Tauri command).
//! Each new revision gets a fresh `w:id` from [`Document::max_revision_id`] so
//! Word's accept/reject grouping never collides with existing or sibling edits.

use crate::model::{BlockContent, Document, Inline, Paragraph, RevisionMeta, Run};

/// The author string stamped on AI-authored revisions by default. Word groups
/// accept/reject by author + id, so a recipient can filter to review only the
/// machine edits. Callers may override with their own author string.
pub const AI_AUTHOR: &str = "Keepance AI";

/// Current UTC timestamp formatted as an OOXML `w:date` value
/// (`YYYY-MM-DDThh:mm:ssZ`). Convenience for callers (e.g. the Tauri command
/// layer) that want to stamp a revision with "now" without taking their own
/// `chrono` dependency.
pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Allocate the next fresh revision id for `doc`.
fn next_id(doc: &Document) -> String {
    (doc.max_revision_id() + 1).to_string()
}

/// Resolve the Nth paragraph (skipping raw blocks) to its index in `body`.
fn nth_paragraph_body_index(doc: &Document, para_idx: usize) -> Option<usize> {
    let mut seen = 0usize;
    for (i, block) in doc.body.iter().enumerate() {
        if let BlockContent::Paragraph(_) = block {
            if seen == para_idx {
                return Some(i);
            }
            seen += 1;
        }
    }
    None
}

/// Insert a NEW tracked insertion (`w:ins`) at the end of paragraph `para_idx`
/// (counting only paragraphs, not raw blocks), authored by `author` with the
/// given date. Returns the revision id used, or `None` if the paragraph index
/// is out of range.
pub fn insert_at_paragraph_end(
    doc: &mut Document,
    para_idx: usize,
    text: &str,
    author: &str,
    date: &str,
) -> Option<String> {
    let id = next_id(doc);
    let body_idx = nth_paragraph_body_index(doc, para_idx)?;
    let ins = Inline::Insertion {
        meta: RevisionMeta {
            id: id.clone(),
            author: author.into(),
            date: date.into(),
        },
        runs: vec![Run {
            text: text.into(),
            preserve_space: text != text.trim(),
            properties_xml: None,
        }],
    };
    if let BlockContent::Paragraph(p) = &mut doc.body[body_idx] {
        p.inlines.push(ins);
        return Some(id);
    }
    None
}

/// Mark the first plain `Inline::Run` whose text contains `needle` in paragraph
/// `para_idx` as a tracked deletion (`w:del`), authored by `author`. Preserves
/// the run's own properties on the deleted run. Returns the revision id, or
/// `None` if no matching run was found.
///
/// This mirrors how the AI redlines: locate text in the typed model, swap the
/// plain run for a tracked deletion. Accept/reject works in Word because each
/// deletion is its own `w:del` with a unique id.
pub fn delete_run_containing(
    doc: &mut Document,
    para_idx: usize,
    needle: &str,
    author: &str,
    date: &str,
) -> Option<String> {
    let id = next_id(doc);
    let body_idx = nth_paragraph_body_index(doc, para_idx)?;
    let para = match &mut doc.body[body_idx] {
        BlockContent::Paragraph(p) => p,
        BlockContent::Raw { .. } => return None,
    };
    for inline in para.inlines.iter_mut() {
        if let Inline::Run(run) = inline {
            if run.text.contains(needle) {
                let runs = vec![run.clone()];
                *inline = Inline::Deletion {
                    meta: RevisionMeta {
                        id: id.clone(),
                        author: author.into(),
                        date: date.into(),
                    },
                    runs,
                };
                return Some(id);
            }
        }
    }
    None
}

/// Insert a brand-new paragraph consisting entirely of a tracked insertion,
/// after paragraph `para_idx` (or at the end if out of range). Returns the
/// revision id. Useful for the AI proposing a whole new clause.
pub fn insert_paragraph_after(
    doc: &mut Document,
    para_idx: usize,
    text: &str,
    author: &str,
    date: &str,
) -> String {
    let id = next_id(doc);
    let ins = Inline::Insertion {
        meta: RevisionMeta {
            id: id.clone(),
            author: author.into(),
            date: date.into(),
        },
        runs: vec![Run {
            text: text.into(),
            preserve_space: text != text.trim(),
            properties_xml: None,
        }],
    };
    let new_para = BlockContent::Paragraph(Paragraph::from_inlines(vec![ins]));
    match nth_paragraph_body_index(doc, para_idx) {
        Some(body_idx) => doc.body.insert(body_idx + 1, new_para),
        None => doc.body.push(new_para),
    }
    id
}
