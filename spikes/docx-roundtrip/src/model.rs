//! In-memory document model for the track-changes round-trip spike.
//!
//! Design intent (this is the part that matters for the real WS-A engine):
//! we model the document body as an ordered tree of paragraphs, and each
//! paragraph as an ordered list of *inline content* items. Crucially,
//! tracked revisions (`w:ins` / `w:del`) and comments are FIRST-CLASS nodes
//! in that list, not lossy annotations layered on top of plain text.
//!
//! Why first-class: the React editor needs to render an insertion/deletion
//! inline (green underline / red strikethrough) and let the user accept or
//! reject *that specific revision*, and the AI needs to author new revisions
//! by inserting these same nodes. A flat "string + list of ranges" model
//! makes accept/reject and nested revisions painful; an explicit node per
//! revision makes them trivial. This is a DOM model, not a streaming one
//! (see the feasibility report for the rationale).

use std::collections::BTreeMap;

/// A single text run with its raw text. We keep the text verbatim so
/// whitespace-significant runs (`xml:space="preserve"`) round-trip exactly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    pub text: String,
    /// Whether the source run carried `xml:space="preserve"`. We re-emit it
    /// whenever the text has leading/trailing space regardless, but we track
    /// it to stay faithful to the input.
    pub preserve_space: bool,
}

impl Run {
    pub fn new(text: impl Into<String>) -> Self {
        Run { text: text.into(), preserve_space: false }
    }
}

/// Author + date metadata shared by every revision element. In OOXML these
/// are the `w:author` and `w:date` attributes; `id` is the `w:id` that ties
/// a revision together (and that Word uses for accept/reject grouping).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionMeta {
    pub id: String,
    pub author: String,
    /// ISO-8601 timestamp string exactly as it appears in `w:date`.
    pub date: String,
}

/// One inline item inside a paragraph. This is the heart of the model: the
/// variants encode exactly the revision/comment markup we must preserve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inline {
    /// A plain, un-revised run of text.
    Run(Run),
    /// A tracked insertion: `<w:ins ...><w:r><w:t>..</w:t></w:r></w:ins>`.
    /// Holds the runs that were inserted.
    Insertion { meta: RevisionMeta, runs: Vec<Run> },
    /// A tracked deletion: `<w:del ...><w:r><w:delText>..</w:delText></w:r></w:del>`.
    /// Holds the runs (as delText) that were marked deleted.
    Deletion { meta: RevisionMeta, runs: Vec<Run> },
    /// `<w:commentRangeStart w:id=".."/>` — marks where a comment anchor begins.
    CommentRangeStart { id: String },
    /// `<w:commentRangeEnd w:id=".."/>` — marks where a comment anchor ends.
    CommentRangeEnd { id: String },
    /// The run carrying `<w:commentReference w:id=".."/>` (the little marker
    /// Word renders at the end of a commented range).
    CommentReference { id: String },
}

/// A paragraph: an ordered list of inline content. (Paragraph-level
/// properties, numbering, styles etc. are intentionally out of scope for the
/// spike — see the feasibility report for how they fit the full model.)
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Paragraph {
    pub inlines: Vec<Inline>,
}

/// One comment from word/comments.xml. `text` is the flattened comment body
/// (sufficient for the spike; the real model would keep the comment's own
/// paragraph/run tree). `anchored_id` ties it to the CommentRangeStart/End
/// pair in the document body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub date: String,
    /// `w:initials` — optional in OOXML; preserved when present.
    pub initials: Option<String>,
    pub text: String,
}

/// The whole document model. `comments` is keyed by comment id for O(1)
/// lookup when serializing comments.xml and when the editor resolves a
/// CommentReference to its body.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Document {
    pub body: Vec<Paragraph>,
    pub comments: BTreeMap<String, Comment>,
}

impl Document {
    /// Convenience: collect every revision present in the body, in document
    /// order. Used by tests to assert preservation and by (future) accept/reject.
    pub fn revisions(&self) -> Vec<(&RevisionMeta, RevisionKind, &Vec<Run>)> {
        let mut out = Vec::new();
        for para in &self.body {
            for inline in &para.inlines {
                match inline {
                    Inline::Insertion { meta, runs } => {
                        out.push((meta, RevisionKind::Insertion, runs))
                    }
                    Inline::Deletion { meta, runs } => {
                        out.push((meta, RevisionKind::Deletion, runs))
                    }
                    _ => {}
                }
            }
        }
        out
    }

    /// Highest numeric `w:id` used by any revision or comment, so new
    /// AI-authored revisions can pick a fresh, non-colliding id. Word keys
    /// accept/reject on these ids, so collisions would merge unrelated edits.
    pub fn max_revision_id(&self) -> u64 {
        let mut max = 0u64;
        let mut consider = |s: &str| {
            if let Ok(n) = s.parse::<u64>() {
                if n > max {
                    max = n;
                }
            }
        };
        for para in &self.body {
            for inline in &para.inlines {
                match inline {
                    Inline::Insertion { meta, .. } | Inline::Deletion { meta, .. } => {
                        consider(&meta.id)
                    }
                    Inline::CommentRangeStart { id }
                    | Inline::CommentRangeEnd { id }
                    | Inline::CommentReference { id } => consider(id),
                    _ => {}
                }
            }
        }
        for id in self.comments.keys() {
            consider(id);
        }
        max
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevisionKind {
    Insertion,
    Deletion,
}
