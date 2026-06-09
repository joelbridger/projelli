//! Parse `word/document.xml` (+ `word/comments.xml`) into the model,
//! PRESERVING revision markup and comments.
//!
//! Approach: `quick-xml` streaming reader. OOXML element names are
//! namespace-prefixed (`w:p`, `w:ins`, ...). For the spike we match on the
//! local name (the bit after the colon) which is robust to whatever prefix
//! the producer used. We walk the body element-by-element, building
//! paragraphs and the typed `Inline` nodes the model defines.

use anyhow::{bail, Context, Result};
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::QName;
use quick_xml::reader::Reader;

use crate::model::{Comment, Document, Inline, Paragraph, RevisionMeta, Run};

/// Return the local name (after any `:` prefix) of a qualified name. Works for
/// both Start and End events (both expose `.name() -> QName`).
fn local_of(name: QName) -> String {
    let bytes = name.as_ref();
    let local = match bytes.iter().position(|&b| b == b':') {
        Some(idx) => &bytes[idx + 1..],
        None => bytes,
    };
    String::from_utf8_lossy(local).into_owned()
}

/// Convenience for the common `Event::Start`/`Empty` case.
fn local_name(e: &BytesStart) -> String {
    local_of(e.name())
}

/// Read a `w:*` attribute by local name (e.g. "author", "date", "id").
fn attr(e: &BytesStart, want_local: &str) -> Option<String> {
    for a in e.attributes().with_checks(false).flatten() {
        let key = a.key;
        let kb = key.as_ref();
        let local = match kb.iter().position(|&b| b == b':') {
            Some(idx) => &kb[idx + 1..],
            None => kb,
        };
        if local == want_local.as_bytes() {
            return Some(String::from_utf8_lossy(&a.value).into_owned());
        }
    }
    None
}

fn revision_meta(e: &BytesStart) -> RevisionMeta {
    RevisionMeta {
        id: attr(e, "id").unwrap_or_default(),
        author: attr(e, "author").unwrap_or_default(),
        date: attr(e, "date").unwrap_or_default(),
    }
}

/// Parse the whole document. `comments_xml` may be `None` if the package has
/// no comments part.
pub fn parse_document(document_xml: &str, comments_xml: Option<&str>) -> Result<Document> {
    let body = parse_body(document_xml).context("parse document.xml body")?;
    let comments = match comments_xml {
        Some(xml) => parse_comments(xml).context("parse comments.xml")?,
        None => Default::default(),
    };
    Ok(Document { body, comments })
}

fn parse_body(xml: &str) -> Result<Vec<Paragraph>> {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.trim_text(false); // keep whitespace verbatim inside runs

    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == "p" => {
                let para = parse_paragraph(&mut reader)?;
                paragraphs.push(para);
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(paragraphs)
}

/// Parse the contents of a `<w:p>` until its matching `</w:p>`. The reader is
/// positioned just after the `<w:p>` start tag.
fn parse_paragraph(reader: &mut Reader<&[u8]>) -> Result<Paragraph> {
    let mut inlines: Vec<Inline> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => match local_name(&e).as_str() {
                "ins" => {
                    let meta = revision_meta(&e);
                    let runs = parse_runs_until(reader, "ins", false)?;
                    inlines.push(Inline::Insertion { meta, runs });
                }
                "del" => {
                    let meta = revision_meta(&e);
                    // Deletions carry <w:delText> rather than <w:t>.
                    let runs = parse_runs_until(reader, "del", true)?;
                    inlines.push(Inline::Deletion { meta, runs });
                }
                "r" => {
                    // A plain run sitting directly in the paragraph. It may be a
                    // normal text run OR the run that carries a commentReference.
                    if let Some(inline) = parse_plain_run(reader)? {
                        inlines.push(inline);
                    }
                }
                // Paragraph properties etc. — skip the subtree wholesale.
                other => {
                    skip_element(reader, &other)?;
                }
            },
            Event::Empty(e) => match local_name(&e).as_str() {
                "commentRangeStart" => {
                    if let Some(id) = attr(&e, "id") {
                        inlines.push(Inline::CommentRangeStart { id });
                    }
                }
                "commentRangeEnd" => {
                    if let Some(id) = attr(&e, "id") {
                        inlines.push(Inline::CommentRangeEnd { id });
                    }
                }
                _ => {}
            },
            Event::End(e) if local_of(e.name()) == "p" => break,
            Event::Eof => bail!("unexpected EOF inside <w:p>"),
            _ => {}
        }
        buf.clear();
    }

    Ok(Paragraph { inlines })
}

/// Parse a sequence of `<w:r>` runs until the named closing wrapper
/// (`ins`/`del`). When `is_del` is true, text lives in `<w:delText>`.
fn parse_runs_until(reader: &mut Reader<&[u8]>, wrapper: &str, is_del: bool) -> Result<Vec<Run>> {
    let mut runs: Vec<Run> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == "r" => {
                if let Some(run) = parse_run_text(reader, is_del)? {
                    runs.push(run);
                }
            }
            Event::End(e) if local_of(e.name()) == wrapper => break,
            Event::Eof => bail!("unexpected EOF inside <w:{wrapper}>"),
            _ => {}
        }
        buf.clear();
    }
    Ok(runs)
}

/// Parse a single `<w:r>` that contains text in `<w:t>` or `<w:delText>`.
/// Returns the run text, or None if the run had no text node.
fn parse_run_text(reader: &mut Reader<&[u8]>, is_del: bool) -> Result<Option<Run>> {
    let text_tag = if is_del { "delText" } else { "t" };
    let mut text = String::new();
    let mut saw_text = false;
    let mut preserve = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == text_tag => {
                saw_text = true;
                if attr(&e, "space").as_deref() == Some("preserve") {
                    preserve = true;
                }
                // Read text content up to the closing tag.
                let mut tbuf = Vec::new();
                loop {
                    match reader.read_event_into(&mut tbuf)? {
                        Event::Text(t) => text.push_str(&t.xml_content()?),
                        Event::End(en) if local_of(en.name()) == text_tag => break,
                        Event::Eof => bail!("EOF inside <w:{text_tag}>"),
                        _ => {}
                    }
                    tbuf.clear();
                }
            }
            Event::End(e) if local_of(e.name()) == "r" => break,
            Event::Eof => bail!("unexpected EOF inside <w:r>"),
            _ => {}
        }
        buf.clear();
    }

    if saw_text {
        Ok(Some(Run { text, preserve_space: preserve }))
    } else {
        Ok(None)
    }
}

/// Parse a plain `<w:r>` directly under a paragraph. It is either a text run
/// (-> Inline::Run) or a run carrying `<w:commentReference>` (-> Inline::CommentReference).
fn parse_plain_run(reader: &mut Reader<&[u8]>) -> Result<Option<Inline>> {
    let mut text = String::new();
    let mut saw_text = false;
    let mut preserve = false;
    let mut comment_ref: Option<String> = None;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == "t" => {
                saw_text = true;
                if attr(&e, "space").as_deref() == Some("preserve") {
                    preserve = true;
                }
                let mut tbuf = Vec::new();
                loop {
                    match reader.read_event_into(&mut tbuf)? {
                        Event::Text(t) => text.push_str(&t.xml_content()?),
                        Event::End(en) if local_of(en.name()) == "t" => break,
                        Event::Eof => bail!("EOF inside <w:t>"),
                        _ => {}
                    }
                    tbuf.clear();
                }
            }
            Event::Empty(e) if local_name(&e) == "commentReference" => {
                comment_ref = attr(&e, "id");
            }
            Event::Start(e) if local_name(&e) == "commentReference" => {
                comment_ref = attr(&e, "id");
            }
            Event::End(e) if local_of(e.name()) == "r" => break,
            Event::Eof => bail!("unexpected EOF inside <w:r>"),
            _ => {}
        }
        buf.clear();
    }

    if let Some(id) = comment_ref {
        Ok(Some(Inline::CommentReference { id }))
    } else if saw_text {
        Ok(Some(Inline::Run(Run { text, preserve_space: preserve })))
    } else {
        Ok(None)
    }
}

/// Skip an element and its entire subtree (used for paragraph properties etc.).
fn skip_element(reader: &mut Reader<&[u8]>, name: &str) -> Result<()> {
    let mut depth = 1usize;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == name => depth += 1,
            Event::End(e) if local_of(e.name()) == name => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            Event::Eof => bail!("unexpected EOF skipping <{name}>"),
            _ => {}
        }
        buf.clear();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// comments.xml
// ---------------------------------------------------------------------------

fn parse_comments(xml: &str) -> Result<std::collections::BTreeMap<String, Comment>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut out = std::collections::BTreeMap::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == "comment" => {
                let id = attr(&e, "id").unwrap_or_default();
                let author = attr(&e, "author").unwrap_or_default();
                let date = attr(&e, "date").unwrap_or_default();
                let initials = attr(&e, "initials");
                let text = parse_comment_body(&mut reader)?;
                out.insert(
                    id.clone(),
                    Comment { id, author, date, initials, text },
                );
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

/// Flatten all `<w:t>` text inside a `<w:comment>` into a single string.
fn parse_comment_body(reader: &mut Reader<&[u8]>) -> Result<String> {
    let mut text = String::new();
    let mut in_t = false;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if local_name(&e) == "t" => in_t = true,
            Event::End(e) if local_of(e.name()) == "t" => in_t = false,
            Event::Text(t) if in_t => text.push_str(&t.xml_content()?),
            Event::End(e) if local_of(e.name()) == "comment" => break,
            Event::Eof => bail!("unexpected EOF inside <w:comment>"),
            _ => {}
        }
        buf.clear();
    }
    Ok(text)
}
