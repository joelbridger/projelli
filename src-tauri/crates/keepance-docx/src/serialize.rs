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
pub fn serialize_document(doc: &Document) -> Result<String> {
    let mut out = String::with_capacity(4096);
    out.push_str(XML_DECL);
    out.push_str(&format!("<w:document xmlns:w=\"{W_NS}\"><w:body>"));

    let mut saw_sectpr = false;
    for block in &doc.body {
        match block {
            BlockContent::Paragraph(p) => write_paragraph(&mut out, p),
            BlockContent::Raw { xml } => {
                if xml.contains("sectPr") {
                    saw_sectpr = true;
                }
                out.push_str(xml);
            }
        }
    }

    if !saw_sectpr {
        out.push_str("<w:sectPr/>");
    }

    out.push_str("</w:body></w:document>");
    Ok(out)
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

/// Serialize all comments to a full `word/comments.xml` string.
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

/// Serialize the document INTO an existing package, replacing only the parts we
/// own and preserving everything else byte-for-byte. This is the production
/// path used on save: `original` is the package the document was parsed from.
pub fn serialize_into_package(doc: &Document, original: &Package) -> Result<Package> {
    let mut pkg = original.clone();
    pkg.insert(DOCUMENT_PART, serialize_document(doc)?.into_bytes());

    if doc.comments.is_empty() {
        // No comments to write. We deliberately leave any pre-existing
        // comments.xml + its content-type/rel in place rather than mutate the
        // manifests — removing a part cleanly is out of scope for A1 and risks
        // dangling references. (In practice an imported doc with comments keeps
        // them; a doc that never had comments has no part to leave.)
    } else {
        pkg.insert(COMMENTS_PART, serialize_comments(doc)?.into_bytes());
        // Make sure the package declares + relates the comments part, in case
        // we are adding comments to a document that previously had none.
        pkg.ensure_comments_content_type();
        pkg.ensure_comments_relationship();
    }

    Ok(pkg)
}

/// Build a brand-new package from a document that has no source package (e.g.
/// a document created from scratch). Synthesizes minimal, spec-correct plumbing
/// parts. Imported documents should use [`serialize_into_package`] instead so
/// their original parts are preserved.
pub fn serialize_new_package(doc: &Document) -> Result<Package> {
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
