//! In-memory document object model (DOM) for the Lantern OOXML engine.
//!
//! This is the production promotion of the spike's `model.rs`, hardened for
//! real documents. The shape is the **canonical JSON contract** the React
//! editor (task A3) renders and the AI redliner (task A4) authors against, so
//! every type here `#[derive(Serialize, Deserialize)]` with a stable,
//! tag-discriminated representation.
//!
//! Design pillars:
//!
//! 1. **Revisions and comments are first-class nodes**, not lossy annotations.
//!    The editor renders an [`Inline::Insertion`] / [`Inline::Deletion`]
//!    inline (green underline / red strikethrough) and wires an accept/reject
//!    button straight to the node; the AI authors by swapping a [`Run`] for a
//!    `Deletion` or appending an `Insertion`. A flat "string + ranges" model
//!    makes nested revisions and accept/reject painful — explicit nodes make
//!    them trivial.
//!
//! 2. **Preserve-by-default (the key production hardening).** Anything we do
//!    not model is carried verbatim:
//!      - [`Inline::Raw`] holds the exact serialized XML of an unrecognized
//!        element inside a paragraph (e.g. `w:hyperlink`, `w:smartTag`, a
//!        field, a drawing) so it re-emits byte-for-byte.
//!      - [`Paragraph::properties_xml`] holds the paragraph's `<w:pPr>` verbatim
//!        (styles, numbering, alignment) — re-emitted untouched.
//!      - [`Run::properties_xml`] holds a run's `<w:rPr>` verbatim (bold,
//!        italic, color, run style) so formatting survives.
//!      - [`BlockContent::Raw`] holds any block-level element that is not a
//!        paragraph (e.g. a `w:tbl` table, a `w:sdt` content control) verbatim.
//!      - At the *package* level (see `package.rs`) every part we do not model
//!        — styles.xml, numbering.xml, settings.xml, theme, fontTable,
//!        headers/footers, media — is kept as raw bytes and written back
//!        unchanged.
//!
//!    This converts "did we model feature X?" from a *data-loss* risk into a
//!    *render-fidelity* nice-to-have, which is the single most important
//!    fidelity rule for legal work.
//!
//! 3. **Round-trip stability.** Combined with the deterministic serializer,
//!    `parse -> serialize -> parse` is model-stable and (for the parts we own)
//!    byte-stable, which plays well with Lantern's version-history feature.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// JSON document-format version. Bumped if the on-the-wire DOM shape changes in
/// a breaking way, so the editor (A3) and engine can negotiate. The current
/// shape is `1`.
pub const DOM_FORMAT_VERSION: u32 = 1;

/// A single text run with its raw text and (preserved) run properties.
///
/// We keep `text` verbatim so whitespace-significant runs
/// (`xml:space="preserve"`) round-trip exactly, and we keep `properties_xml`
/// (the serialized `<w:rPr>`) verbatim so bold/italic/color/run-style survive a
/// round-trip even though the engine does not interpret them yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub text: String,
    /// Whether the source run carried `xml:space="preserve"`. We also re-emit
    /// it whenever the text has leading/trailing space, but track it to stay
    /// faithful to the input.
    #[serde(default)]
    pub preserve_space: bool,
    /// The run's `<w:rPr>...</w:rPr>` exactly as it appeared in the source, or
    /// `None` if the run had no properties. Re-emitted verbatim — this is how
    /// formatting is preserved without modeling it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties_xml: Option<String>,
}

impl Run {
    pub fn new(text: impl Into<String>) -> Self {
        Run {
            text: text.into(),
            preserve_space: false,
            properties_xml: None,
        }
    }
}

/// Author + date metadata shared by every revision element. In OOXML these are
/// the `w:author` and `w:date` attributes; `id` is the `w:id` that ties a
/// revision together (and that Word uses to group accept/reject).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionMeta {
    pub id: String,
    pub author: String,
    /// ISO-8601 timestamp string exactly as it appears in `w:date`.
    pub date: String,
}

/// One inline item inside a paragraph. The variants encode exactly the
/// revision/comment markup we model; everything else rides along as
/// [`Inline::Raw`].
///
/// Serialized with an internal `kind` tag so the JSON is self-describing for
/// the React editor, e.g. `{ "kind": "insertion", "meta": {...}, "runs": [...] }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Inline {
    /// A plain, un-revised run of text.
    Run(Run),
    /// A tracked insertion: `<w:ins ...><w:r><w:t>..</w:t></w:r></w:ins>`.
    Insertion { meta: RevisionMeta, runs: Vec<Run> },
    /// A tracked deletion: `<w:del ...><w:r><w:delText>..</w:delText></w:r></w:del>`.
    Deletion { meta: RevisionMeta, runs: Vec<Run> },
    /// `<w:commentRangeStart w:id=".."/>` — where a comment anchor begins.
    CommentRangeStart { id: String },
    /// `<w:commentRangeEnd w:id=".."/>` — where a comment anchor ends.
    CommentRangeEnd { id: String },
    /// The run carrying `<w:commentReference w:id=".."/>` (the marker Word
    /// renders at the end of a commented range).
    CommentReference { id: String },
    /// PRESERVE-BY-DEFAULT: any inline-level element we do not model, captured
    /// as its exact serialized XML and re-emitted byte-for-byte. Covers
    /// hyperlinks, fields, drawings, smartTags, bookmarks, etc. `xml` includes
    /// the element's own start/end tags.
    Raw { xml: String },
}

/// One block-level item in the document body. Most blocks are paragraphs; any
/// other block element (tables, content controls, sectPr we choose not to
/// model) is preserved verbatim as [`BlockContent::Raw`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BlockContent {
    Paragraph(Paragraph),
    /// PRESERVE-BY-DEFAULT: a non-paragraph block (e.g. `<w:tbl>`, `<w:sdt>`)
    /// kept as exact serialized XML and re-emitted byte-for-byte.
    Raw { xml: String },
}

/// A paragraph: optional preserved properties plus an ordered list of inline
/// content.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    /// The paragraph's `<w:pPr>...</w:pPr>` exactly as it appeared, or `None`.
    /// Re-emitted verbatim — preserves styles, numbering, alignment, and
    /// paragraph-mark revisions without modeling them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties_xml: Option<String>,
    pub inlines: Vec<Inline>,
}

impl Paragraph {
    /// Convenience constructor for tests / authoring: a paragraph of inlines
    /// with no preserved properties.
    pub fn from_inlines(inlines: Vec<Inline>) -> Self {
        Paragraph {
            properties_xml: None,
            inlines,
        }
    }
}

/// One comment from `word/comments.xml`.
///
/// `body_xml` holds the comment's inner paragraph/run XML verbatim so rich
/// comment bodies (multiple paragraphs, formatting, even nested revisions)
/// survive a round-trip; `text` is the flattened plain-text rendering the
/// editor can show without parsing the body. `anchored` ids tie it to the
/// `CommentRangeStart`/`End` pair in the document body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub date: String,
    /// `w:initials` — optional in OOXML; preserved when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initials: Option<String>,
    /// Flattened plain text of the comment body (for display).
    pub text: String,
    /// The comment's inner content (`<w:p>...</w:p>` ...) exactly as it
    /// appeared, so rich bodies survive. `None` for comments authored
    /// programmatically with only `text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_xml: Option<String>,
}

/// The whole document model.
///
/// `comments` is keyed by comment id for O(1) lookup when serializing
/// `comments.xml` and when the editor resolves a `CommentReference` to its
/// body. `format_version` lets the editor detect the DOM shape it is consuming.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    /// DOM JSON format version (see [`DOM_FORMAT_VERSION`]).
    #[serde(default = "default_format_version")]
    pub format_version: u32,
    pub body: Vec<BlockContent>,
    #[serde(default)]
    pub comments: BTreeMap<String, Comment>,
}

fn default_format_version() -> u32 {
    DOM_FORMAT_VERSION
}

impl Default for Document {
    fn default() -> Self {
        Document {
            format_version: DOM_FORMAT_VERSION,
            body: Vec::new(),
            comments: BTreeMap::new(),
        }
    }
}

impl Document {
    /// Iterate the paragraphs in the body (skipping raw blocks). Convenient for
    /// the editor and authoring helpers that operate on paragraph indices.
    pub fn paragraphs(&self) -> impl Iterator<Item = &Paragraph> {
        self.body.iter().filter_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            BlockContent::Raw { .. } => None,
        })
    }

    /// Collect every revision present in the body, in document order. Used by
    /// tests to assert preservation and by accept/reject (later).
    pub fn revisions(&self) -> Vec<(&RevisionMeta, RevisionKind, &Vec<Run>)> {
        let mut out = Vec::new();
        for block in &self.body {
            if let BlockContent::Paragraph(para) = block {
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
        for block in &self.body {
            if let BlockContent::Paragraph(para) = block {
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
        }
        for id in self.comments.keys() {
            consider(id);
        }
        max
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RevisionKind {
    Insertion,
    Deletion,
}
