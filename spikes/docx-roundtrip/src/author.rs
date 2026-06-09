//! "AI authoring" helpers: programmatically add NEW tracked changes to the
//! model, the way the Keepance AI will when it redlines a document. These are
//! deliberately simple, content-addressed edits over the typed model — which
//! is exactly the ergonomic win of the DOM model over raw XML string-poking.

use crate::model::{Document, Inline, RevisionMeta, Run};

/// The author string stamped on every AI-authored revision. Word groups
/// accept/reject by author + id, and a recipient filtering "Keepance AI" can
/// review only the machine edits.
pub const AI_AUTHOR: &str = "Keepance AI";

/// Insert a NEW tracked insertion (`w:ins`) at the end of paragraph
/// `para_idx`, authored by Keepance AI with the given fixed date. Returns the
/// revision id used.
pub fn ai_insert_at_paragraph_end(
    doc: &mut Document,
    para_idx: usize,
    text: &str,
    date: &str,
) -> String {
    let id = (doc.max_revision_id() + 1).to_string();
    let ins = Inline::Insertion {
        meta: RevisionMeta { id: id.clone(), author: AI_AUTHOR.into(), date: date.into() },
        runs: vec![Run { text: text.into(), preserve_space: text != text.trim() }],
    };
    if let Some(p) = doc.body.get_mut(para_idx) {
        p.inlines.push(ins);
    }
    id
}

/// Mark an existing plain run deleted, in place, as a Keepance-AI tracked
/// deletion. Finds the first `Inline::Run` whose text contains `needle` in
/// paragraph `para_idx` and converts it to a `w:del` wrapping a `delText`.
/// Returns the revision id, or None if no matching run was found.
///
/// This mirrors how the AI will redline: locate text in the typed model,
/// swap the plain run for a tracked deletion. Accept/reject in Word then
/// works because each deletion is its own `w:del` with a unique id.
pub fn ai_delete_run_containing(
    doc: &mut Document,
    para_idx: usize,
    needle: &str,
    date: &str,
) -> Option<String> {
    let id = (doc.max_revision_id() + 1).to_string();
    let para = doc.body.get_mut(para_idx)?;
    for inline in para.inlines.iter_mut() {
        if let Inline::Run(run) = inline {
            if run.text.contains(needle) {
                let runs = vec![run.clone()];
                *inline = Inline::Deletion {
                    meta: RevisionMeta {
                        id: id.clone(),
                        author: AI_AUTHOR.into(),
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
