//! Serialize the [`Document`] DOM back into `word/document.xml` +
//! `word/comments.xml`, and assemble a complete .docx package with
//! **preserve-by-default fidelity at the package level**.
//!
//! Two design choices make preservation exact:
//!
//!   1. **We build `document.xml` as a string**, writing modeled text with
//!      proper XML escaping (`quick_xml::escape`) and injecting every preserved
//!      span (`Inline::Raw`, `BlockContent::Raw`, `properties_xml`) *verbatim*.
//!      Re-parsing those spans through an XML writer would risk normalizing
//!      attribute order / whitespace; emitting them literally guarantees they
//!      round-trip byte-for-byte.
//!
//!   2. **We re-use the original package.** [`serialize_into_package`] takes the
//!      package the document was parsed from and replaces only the parts we own
//!      (`document.xml`, and `comments.xml` when comments exist). Every other
//!      part — styles, numbering, theme, fonts, settings, headers/footers,
//!      media, the original `[Content_Types].xml` and rels — is left untouched.
//!      This is what makes unmodeled features survive a real-document round-trip.

use std::borrow::Cow;

use quick_xml::escape::escape;

use crate::error::Result;
use crate::model::{BlockContent, Comment, Document, Inline, Paragraph, Run};
use crate::package::{
    Package, COMMENTS_PART, DOCUMENT_PART, NEW_CONTENT_TYPES_XML, NEW_DOCUMENT_RELS_XML,
    NEW_ROOT_RELS_XML,
};

/// The wordprocessingml main namespace, declared on root elements of parts we
/// author from scratch.
const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const XML_DECL: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

// ---------------------------------------------------------------------------
// Single-writer w:id allocator
// ---------------------------------------------------------------------------

/// Ensure every tracked revision in `doc` has a DISTINCT, non-empty `w:id`.
///
/// This is the **single-writer allocation pass** for the live co-editing
/// architecture (Task 12, R3).  The CRDT (`yDocToDocumentJson`) deliberately
/// emits tracked insertions/deletions with `meta.id = ""` so that serialize —
/// not the distributed replicas — is the sole authority that mints `w:id`s.
/// That eliminates the only coordination problem: concurrent replicas cannot
/// produce colliding `w:id`s because they never touch this field.
///
/// Contract:
///   - If `meta.id` is `""` (empty placeholder) → assign a fresh sequential id
///     starting from `document.max_revision_id() + 1`.
///   - If `meta.id` is already non-empty → leave it untouched.
///   - Returns `Cow::Borrowed(doc)` when no empty ids exist (zero-cost fast
///     path for normal documents and the existing regression tests); returns
///     `Cow::Owned(clone)` when allocation is needed (does not mutate the
///     caller's `Document`).
fn allocate_revision_ids(doc: &Document) -> Cow<'_, Document> {
    // Fast path: scan for any empty id. If none, return a borrow.
    let needs_alloc = doc.body.iter().any(|b| {
        if let BlockContent::Paragraph(p) = b {
            p.inlines.iter().any(|i| match i {
                Inline::Insertion { meta, .. } | Inline::Deletion { meta, .. } => {
                    meta.id.is_empty()
                }
                _ => false,
            })
        } else {
            false
        }
    });
    if !needs_alloc {
        return Cow::Borrowed(doc);
    }

    // Slow path: clone and fill in empty ids.
    let mut doc = doc.clone();
    // Start the counter from max_existing + 1 so we never collide with ids that
    // were already assigned by the AI redliner or a prior serialize pass.
    let mut next = doc.max_revision_id() + 1;

    for block in doc.body.iter_mut() {
        if let BlockContent::Paragraph(p) = block {
            for inline in p.inlines.iter_mut() {
                match inline {
                    Inline::Insertion { meta, .. } | Inline::Deletion { meta, .. } => {
                        if meta.id.is_empty() {
                            meta.id = next.to_string();
                            next += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    Cow::Owned(doc)
}

/// Serialize a run's `<w:t>`/`<w:delText>` text node body, with `rPr` if present.
fn write_text_run(out: &mut String, run: &Run, as_del: bool) {
    out.push_str("<w:r>");
    if let Some(rpr) = &run.properties_xml {
        // PRESERVE run properties verbatim.
        out.push_str(rpr);
    }
    let tag = if as_del { "w:delText" } else { "w:t" };
    let space = if run.preserve_space || run.text != run.text.trim() {
        " xml:space=\"preserve\""
    } else {
        ""
    };
    out.push('<');
    out.push_str(tag);
    out.push_str(space);
    out.push('>');
    out.push_str(&escape(&run.text));
    out.push_str("</");
    out.push_str(tag);
    out.push('>');
    out.push_str("</w:r>");
}

fn attr_escape(s: &str) -> String {
    escape(s).into_owned()
}

fn write_inline(out: &mut String, inline: &Inline) {
    match inline {
        Inline::Run(run) => write_text_run(out, run, false),
        Inline::Insertion { meta, runs } => {
            out.push_str(&format!(
                "<w:ins w:id=\"{}\" w:author=\"{}\" w:date=\"{}\">",
                attr_escape(&meta.id),
                attr_escape(&meta.author),
                attr_escape(&meta.date)
            ));
            for run in runs {
                write_text_run(out, run, false);
            }
            out.push_str("</w:ins>");
        }
        Inline::Deletion { meta, runs } => {
            out.push_str(&format!(
                "<w:del w:id=\"{}\" w:author=\"{}\" w:date=\"{}\">",
                attr_escape(&meta.id),
                attr_escape(&meta.author),
                attr_escape(&meta.date)
            ));
            for run in runs {
                write_text_run(out, run, true);
            }
            out.push_str("</w:del>");
        }
        Inline::CommentRangeStart { id } => {
            out.push_str(&format!(
                "<w:commentRangeStart w:id=\"{}\"/>",
                attr_escape(id)
            ));
        }
        Inline::CommentRangeEnd { id } => {
            out.push_str(&format!("<w:commentRangeEnd w:id=\"{}\"/>", attr_escape(id)));
        }
        Inline::CommentReference { id } => {
            out.push_str("<w:r><w:rPr><w:rStyle w:val=\"CommentReference\"/></w:rPr>");
            out.push_str(&format!(
                "<w:commentReference w:id=\"{}\"/></w:r>",
                attr_escape(id)
            ));
        }
        // PRESERVE: emit the captured XML verbatim.
        Inline::Raw { xml } => out.push_str(xml),
    }
}

fn write_paragraph(out: &mut String, para: &Paragraph) {
    out.push_str("<w:p>");
    if let Some(ppr) = &para.properties_xml {
        // PRESERVE paragraph properties verbatim.
        out.push_str(ppr);
    }
    for inline in &para.inlines {
        write_inline(out, inline);
    }
    out.push_str("</w:p>");
}

/// Serialize the body to a full `word/document.xml` string.
///
/// If the body contains no `BlockContent::Raw` carrying a `sectPr`, we still
/// emit a minimal trailing `<w:sectPr/>` so a from-scratch document is a valid,
/// complete body. For imported documents the original `sectPr` rides along as a
/// preserved raw block, so we do not synthesize a duplicate.
///
/// **Single-writer w:id allocation:** any tracked revision whose `meta.id` is
/// `""` (the CRDT placeholder) is assigned a fresh sequential id here before
/// any XML is emitted.  See [`allocate_revision_ids`].
pub fn serialize_document(doc: &Document) -> Result<String> {
    // Run the single-writer allocator first (fast no-op when all ids are present).
    let doc = allocate_revision_ids(doc);
    let doc: &Document = &doc;

    let mut out = String::with_capacity(4096);
    out.push_str(XML_DECL);
    out.push_str(&format!("<w:document xmlns:w=\"{W_NS}\"><w:body>"));

    for block in &doc.body {
        match block {
            BlockContent::Paragraph(p) => write_paragraph(&mut out, p),
            BlockContent::Raw { xml } => out.push_str(xml),
        }
    }

    // A valid body ends with exactly one body-level <w:sectPr>. We synthesize a
    // trailing one ONLY when the body does not already end with a body-level
    // sectPr block. We key on whether the FINAL body child is a sectPr element
    // (its root local-name), NOT a substring scan: a paragraph-level
    // <w:sectPr> (inside a pPr) or the literal text "sectPr" appearing anywhere
    // else must not suppress the required body-level one.
    if !body_ends_with_sectpr(&doc.body) {
        out.push_str("<w:sectPr/>");
    }

    out.push_str("</w:body></w:document>");
    Ok(out)
}

/// True when the document body's FINAL child is a raw block whose root element's
/// local name is `sectPr` (i.e. a body-level section-properties element). This
/// is the precise replacement for the old `xml.contains("sectPr")` scan.
fn body_ends_with_sectpr(body: &[BlockContent]) -> bool {
    match body.last() {
        Some(BlockContent::Raw { xml }) => root_local_name_is(xml, "sectPr"),
        _ => false,
    }
}

/// Parse just the first element start of `xml` and test whether its LOCAL name
/// equals `want`. Robust to the namespace prefix and to leading whitespace /
/// XML declarations. Returns false if `xml` has no element start.
fn root_local_name_is(xml: &str, want: &str) -> bool {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                return local_of_bytes(e.name().as_ref()) == want;
            }
            Ok(Event::Eof) => return false,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

fn write_comment(out: &mut String, c: &Comment) {
    out.push_str(&format!(
        "<w:comment w:id=\"{}\" w:author=\"{}\" w:date=\"{}\"",
        attr_escape(&c.id),
        attr_escape(&c.author),
        attr_escape(&c.date)
    ));
    if let Some(init) = &c.initials {
        out.push_str(&format!(" w:initials=\"{}\"", attr_escape(init)));
    }
    out.push('>');
    match &c.body_xml {
        // PRESERVE the original comment body verbatim (rich content survives).
        Some(body) => out.push_str(body),
        // Programmatically-authored comment: emit a minimal paragraph+run.
        None => {
            out.push_str("<w:p><w:r><w:t");
            if c.text != c.text.trim() {
                out.push_str(" xml:space=\"preserve\"");
            }
            out.push('>');
            out.push_str(&escape(&c.text));
            out.push_str("</w:t></w:r></w:p>");
        }
    }
    out.push_str("</w:comment>");
}

/// Serialize all comments to a full `word/comments.xml` string, synthesizing a
/// minimal `<w:comments>` root. Used only when there is no original
/// comments.xml to take the root from (a brand-new document).
pub fn serialize_comments(doc: &Document) -> Result<String> {
    let mut out = String::with_capacity(1024);
    out.push_str(XML_DECL);
    out.push_str(&format!("<w:comments xmlns:w=\"{W_NS}\">"));
    for c in doc.comments.values() {
        write_comment(&mut out, c);
    }
    out.push_str("</w:comments>");
    Ok(out)
}

/// Serialize comments while PRESERVING the original `<w:comments ...>` root
/// element (its attributes + namespace declarations such as `w15` /
/// `mc:Ignorable`) verbatim, replacing only the comment children. Used when the
/// comment set changed but we still want the producer's root to survive (so
/// namespaces referenced by comment bodies aren't dropped). Falls back to the
/// synthesized root if the original root can't be located.
fn serialize_comments_preserving_root(doc: &Document, original_xml: &str) -> Result<String> {
    let Some((decl_and_open, close_tag)) = split_root(original_xml, "comments") else {
        return serialize_comments(doc);
    };
    let mut out = String::with_capacity(original_xml.len().max(1024));
    out.push_str(&decl_and_open);
    for c in doc.comments.values() {
        write_comment(&mut out, c);
    }
    out.push_str(&close_tag);
    Ok(out)
}

/// Given an XML document, return `(everything up to and including the root start
/// tag, the root end tag verbatim)` for a root whose LOCAL name is `local`.
/// Returns `None` if the structure can't be parsed (caller falls back).
///
/// We preserve the XML prolog + the exact `<w:comments ...>` open tag (with all
/// attrs/namespaces) and the exact `</w:comments>` close tag from the source,
/// substituting only the children. This keeps the producer's root verbatim.
fn split_root(xml: &str, local: &str) -> Option<(String, String)> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut open_end: Option<usize> = None; // byte index just after the root start tag
    let mut close_start: Option<usize> = None; // byte index of the root end tag start

    loop {
        let pos_before = reader.buffer_position() as usize;
        match reader.read_event() {
            Ok(Event::Start(e)) if local_of_bytes(e.name().as_ref()) == local => {
                if open_end.is_none() {
                    open_end = Some(reader.buffer_position() as usize);
                }
            }
            Ok(Event::End(e)) if local_of_bytes(e.name().as_ref()) == local => {
                close_start = Some(pos_before);
                // do not break: take the LAST matching close (there is only one
                // root, but being defensive is cheap).
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return None,
        }
    }

    let open_end = open_end?;
    let close_start = close_start?;
    if close_start < open_end || close_start > xml.len() || open_end > xml.len() {
        return None;
    }
    let decl_and_open = xml[..open_end].to_string();
    let close_tag = xml[close_start..].to_string();
    Some((decl_and_open, close_tag))
}

/// Local name (after any `:` prefix) of a raw qualified-name byte slice.
fn local_of_bytes(b: &[u8]) -> &str {
    let l = match b.iter().position(|&c| c == b':') {
        Some(i) => &b[i + 1..],
        None => b,
    };
    std::str::from_utf8(l).unwrap_or("")
}

/// Serialize the document INTO an existing package, replacing only the parts we
/// own and preserving everything else byte-for-byte. This is the production
/// path used on save: `original` is the package the document was parsed from.
///
/// Comments are PRESERVE-BY-DEFAULT like every other unmodeled part: we only
/// regenerate `comments.xml` when the comment set actually changed versus what
/// was parsed from `original`. An unedited commented document therefore keeps
/// its `comments.xml` byte-for-byte (stable diffs / idempotent round-trip),
/// rather than being normalized by the synthesizer.
pub fn serialize_into_package(doc: &Document, original: &Package) -> Result<Package> {
    // INVARIANT: reject dangling comment references before producing any bytes,
    // so we never write a document Word would treat as corrupt.
    check_comment_refs(doc)?;

    let mut pkg = original.clone();
    pkg.insert(DOCUMENT_PART, serialize_document(doc)?.into_bytes());

    // What comments did the ORIGINAL package carry? (Empty if it had none.)
    let original_comments_xml = original.get_str(COMMENTS_PART);
    let original_comments = match &original_comments_xml {
        Some(xml) => crate::parse::parse_comments(xml)?,
        None => Default::default(),
    };

    let unchanged = doc.comments == original_comments;

    if unchanged {
        // No change to the comment set. If the original had a comments.xml, it is
        // already in `pkg` (cloned from `original`) byte-for-byte — leave it. If
        // it had none, there is nothing to write. Either way we do NOT touch the
        // manifests. This is the comment-level preserve-by-default path.
    } else if doc.comments.is_empty() {
        // The document's comments were all removed. We deliberately leave any
        // pre-existing comments.xml + its content-type/rel in place rather than
        // mutate the manifests — removing a part cleanly (and pruning its
        // content-type/rel) is out of scope for A1. The dangling-ref guard above
        // already ensured the body carries no orphaned comment markers.
    } else {
        // The comment set changed (added / edited / removed-some). Regenerate
        // comments.xml, but PRESERVE the original `<w:comments>` root element
        // (its namespaces/attrs) verbatim when we have one to take it from.
        let comments_xml = match &original_comments_xml {
            Some(orig) => serialize_comments_preserving_root(doc, orig)?,
            None => serialize_comments(doc)?,
        };
        pkg.insert(COMMENTS_PART, comments_xml.into_bytes());
        // Make sure the package declares + relates the comments part, in case
        // we are adding comments to a document that previously had none.
        pkg.ensure_comments_content_type();
        pkg.ensure_comments_relationship();
    }

    Ok(pkg)
}

/// Document invariant: every comment-range/reference id used in the body must
/// resolve to a `<w:comment>` in `doc.comments`, and every comment must be
/// referenced by the body. A dangling id (either direction) is what Word treats
/// as a corrupt comment graph, so we reject it on the save path BEFORE emitting
/// bytes. Returns `Err(DocxError::Xml(..))` describing the first dangling id.
///
/// Note: `commentRangeStart`/`End`/`Reference` all point at a comment id; we
/// require each referenced id to exist, and each existing comment to be pointed
/// at by at least one of those markers.
pub fn check_comment_refs(doc: &Document) -> Result<()> {
    use crate::model::{BlockContent, Inline};
    use std::collections::BTreeSet;

    let mut referenced: BTreeSet<&str> = BTreeSet::new();
    for block in &doc.body {
        if let BlockContent::Paragraph(p) = block {
            for inline in &p.inlines {
                match inline {
                    Inline::CommentRangeStart { id }
                    | Inline::CommentRangeEnd { id }
                    | Inline::CommentReference { id } => {
                        referenced.insert(id.as_str());
                    }
                    _ => {}
                }
            }
        }
    }

    // Every referenced id must have a matching comment.
    for id in &referenced {
        if !doc.comments.contains_key(*id) {
            return Err(crate::error::DocxError::Xml(format!(
                "dangling comment reference: id {id:?} is used in the body but has \
                 no <w:comment> in comments"
            )));
        }
    }
    // Every comment must be referenced somewhere in the body.
    for id in doc.comments.keys() {
        if !referenced.contains(id.as_str()) {
            return Err(crate::error::DocxError::Xml(format!(
                "orphaned comment: id {id:?} has a <w:comment> but is never \
                 referenced (commentRangeStart/End/Reference) in the body"
            )));
        }
    }
    Ok(())
}

/// Build a brand-new package from a document that has no source package (e.g.
/// a document created from scratch). Synthesizes minimal, spec-correct plumbing
/// parts. Imported documents should use [`serialize_into_package`] instead so
/// their original parts are preserved.
pub fn serialize_new_package(doc: &Document) -> Result<Package> {
    // Same invariant as the preserve path: never emit a dangling comment graph.
    check_comment_refs(doc)?;

    let mut pkg = Package::new();
    pkg.insert(
        crate::package::CONTENT_TYPES_PART,
        NEW_CONTENT_TYPES_XML.as_bytes().to_vec(),
    );
    pkg.insert(
        crate::package::ROOT_RELS_PART,
        NEW_ROOT_RELS_XML.as_bytes().to_vec(),
    );
    pkg.insert(
        crate::package::DOCUMENT_RELS_PART,
        NEW_DOCUMENT_RELS_XML.as_bytes().to_vec(),
    );
    pkg.insert(DOCUMENT_PART, serialize_document(doc)?.into_bytes());
    pkg.insert(COMMENTS_PART, serialize_comments(doc)?.into_bytes());
    Ok(pkg)
}
