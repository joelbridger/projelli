//! Serialize the model back into `word/document.xml` + `word/comments.xml`,
//! and assemble a full, valid .docx `Package`.
//!
//! We use `quick-xml`'s writer so text content and attribute values get
//! correct XML escaping for free (`&`, `<`, `>`, quotes). The output is
//! deterministic, which keeps the round-trip test stable and makes diffs
//! reviewable.

use anyhow::Result;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::writer::Writer;
use std::io::Cursor;

use crate::model::{Comment, Document, Inline, Run};
use crate::package::{
    Package, CONTENT_TYPES_XML, DOCUMENT_RELS_XML, ROOT_RELS_XML,
};

/// The wordprocessingml main namespace, declared on every root element.
const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type W = Writer<Cursor<Vec<u8>>>;

fn new_writer() -> W {
    // Indent for human-readability; not semantically required, and we keep
    // xml:space="preserve" on runs so whitespace-significant text is safe.
    Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2)
}

fn finish(writer: W) -> String {
    String::from_utf8(writer.into_inner().into_inner()).expect("utf8 xml")
}

fn decl(writer: &mut W) -> Result<()> {
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), Some("yes"))))?;
    Ok(())
}

/// Write a `<w:r><w:t>text</w:t></w:r>` (or `<w:delText>` when `as_del`).
fn write_text_run(writer: &mut W, run: &Run, as_del: bool) -> Result<()> {
    writer.write_event(Event::Start(BytesStart::new("w:r")))?;
    let tag = if as_del { "w:delText" } else { "w:t" };
    let mut t = BytesStart::new(tag);
    // Preserve whitespace whenever it is significant, so leading/trailing
    // spaces survive the round-trip exactly.
    if run.preserve_space || run.text != run.text.trim() {
        t.push_attribute(("xml:space", "preserve"));
    }
    writer.write_event(Event::Start(t))?;
    writer.write_event(Event::Text(BytesText::new(&run.text)))?;
    writer.write_event(Event::End(BytesEnd::new(tag)))?;
    writer.write_event(Event::End(BytesEnd::new("w:r")))?;
    Ok(())
}

fn write_inline(writer: &mut W, inline: &Inline) -> Result<()> {
    match inline {
        Inline::Run(run) => write_text_run(writer, run, false)?,
        Inline::Insertion { meta, runs } => {
            let mut ins = BytesStart::new("w:ins");
            ins.push_attribute(("w:id", meta.id.as_str()));
            ins.push_attribute(("w:author", meta.author.as_str()));
            ins.push_attribute(("w:date", meta.date.as_str()));
            writer.write_event(Event::Start(ins))?;
            for run in runs {
                write_text_run(writer, run, false)?;
            }
            writer.write_event(Event::End(BytesEnd::new("w:ins")))?;
        }
        Inline::Deletion { meta, runs } => {
            let mut del = BytesStart::new("w:del");
            del.push_attribute(("w:id", meta.id.as_str()));
            del.push_attribute(("w:author", meta.author.as_str()));
            del.push_attribute(("w:date", meta.date.as_str()));
            writer.write_event(Event::Start(del))?;
            for run in runs {
                write_text_run(writer, run, true)?;
            }
            writer.write_event(Event::End(BytesEnd::new("w:del")))?;
        }
        Inline::CommentRangeStart { id } => {
            let mut e = BytesStart::new("w:commentRangeStart");
            e.push_attribute(("w:id", id.as_str()));
            writer.write_event(Event::Empty(e))?;
        }
        Inline::CommentRangeEnd { id } => {
            let mut e = BytesStart::new("w:commentRangeEnd");
            e.push_attribute(("w:id", id.as_str()));
            writer.write_event(Event::Empty(e))?;
        }
        Inline::CommentReference { id } => {
            // commentReference lives inside its own run, with the comment-ref
            // style applied (we keep the minimal run that Word requires).
            writer.write_event(Event::Start(BytesStart::new("w:r")))?;
            writer.write_event(Event::Start(BytesStart::new("w:rPr")))?;
            let mut style = BytesStart::new("w:rStyle");
            style.push_attribute(("w:val", "CommentReference"));
            writer.write_event(Event::Empty(style))?;
            writer.write_event(Event::End(BytesEnd::new("w:rPr")))?;
            let mut cr = BytesStart::new("w:commentReference");
            cr.push_attribute(("w:id", id.as_str()));
            writer.write_event(Event::Empty(cr))?;
            writer.write_event(Event::End(BytesEnd::new("w:r")))?;
        }
    }
    Ok(())
}

/// Serialize the body to a full `word/document.xml` string.
pub fn serialize_document(doc: &Document) -> Result<String> {
    let mut writer = new_writer();
    decl(&mut writer)?;

    let mut root = BytesStart::new("w:document");
    root.push_attribute(("xmlns:w", W_NS));
    writer.write_event(Event::Start(root))?;
    writer.write_event(Event::Start(BytesStart::new("w:body")))?;

    for para in &doc.body {
        writer.write_event(Event::Start(BytesStart::new("w:p")))?;
        for inline in &para.inlines {
            write_inline(&mut writer, inline)?;
        }
        writer.write_event(Event::End(BytesEnd::new("w:p")))?;
    }

    // A valid Word body ends with sectPr (page setup). Minimal but present so
    // Word treats the body as complete.
    writer.write_event(Event::Start(BytesStart::new("w:sectPr")))?;
    writer.write_event(Event::End(BytesEnd::new("w:sectPr")))?;

    writer.write_event(Event::End(BytesEnd::new("w:body")))?;
    writer.write_event(Event::End(BytesEnd::new("w:document")))?;
    Ok(finish(writer))
}

fn write_comment(writer: &mut W, c: &Comment) -> Result<()> {
    let mut e = BytesStart::new("w:comment");
    e.push_attribute(("w:id", c.id.as_str()));
    e.push_attribute(("w:author", c.author.as_str()));
    e.push_attribute(("w:date", c.date.as_str()));
    if let Some(init) = &c.initials {
        e.push_attribute(("w:initials", init.as_str()));
    }
    writer.write_event(Event::Start(e))?;
    // Comment body is itself a paragraph with a run.
    writer.write_event(Event::Start(BytesStart::new("w:p")))?;
    write_text_run(writer, &Run { text: c.text.clone(), preserve_space: false }, false)?;
    writer.write_event(Event::End(BytesEnd::new("w:p")))?;
    writer.write_event(Event::End(BytesEnd::new("w:comment")))?;
    Ok(())
}

/// Serialize all comments to a full `word/comments.xml` string.
pub fn serialize_comments(doc: &Document) -> Result<String> {
    let mut writer = new_writer();
    decl(&mut writer)?;

    let mut root = BytesStart::new("w:comments");
    root.push_attribute(("xmlns:w", W_NS));
    writer.write_event(Event::Start(root))?;
    for c in doc.comments.values() {
        write_comment(&mut writer, c)?;
    }
    writer.write_event(Event::End(BytesEnd::new("w:comments")))?;
    Ok(finish(writer))
}

/// Assemble a complete, valid .docx `Package` from the model: the two content
/// parts we generate plus the static plumbing (content-types + rels).
pub fn serialize_package(doc: &Document) -> Result<Package> {
    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", CONTENT_TYPES_XML.as_bytes().to_vec());
    pkg.insert("_rels/.rels", ROOT_RELS_XML.as_bytes().to_vec());
    pkg.insert(
        "word/_rels/document.xml.rels",
        DOCUMENT_RELS_XML.as_bytes().to_vec(),
    );
    pkg.insert("word/document.xml", serialize_document(doc)?.into_bytes());
    pkg.insert("word/comments.xml", serialize_comments(doc)?.into_bytes());
    Ok(pkg)
}

/// Convenience: model -> .docx bytes in one call.
pub fn serialize_to_bytes(doc: &Document) -> Result<Vec<u8>> {
    serialize_package(doc)?.write_to_bytes()
}
