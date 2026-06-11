//! Parse `word/document.xml` (+ `word/comments.xml`) into the [`Document`]
//! DOM, with **preserve-by-default fidelity**.
//!
//! Approach: `quick-xml`'s borrowing slice reader (`Reader::from_str`). OOXML
//! element names are namespace-prefixed (`w:p`, `w:ins`, ...); we match on the
//! *local* name (after the colon), which is robust to whatever prefix the
//! producer used.
//!
//! The production upgrade over the spike is that we never silently drop
//! content. Three preservation mechanisms:
//!
//!   * **Unknown inline elements** inside a paragraph (hyperlinks, fields,
//!     drawings, bookmarks, smartTags, ...) are captured as their *exact source
//!     XML* and stored in [`Inline::Raw`]. We capture the verbatim span by
//!     recording the reader's byte position immediately before the start tag,
//!     skipping the subtree with `read_to_end`, then slicing the original
//!     source string.
//!   * **Unknown block elements** in the body (tables `w:tbl`, content controls
//!     `w:sdt`, the `w:sectPr`, ...) are captured the same way into
//!     [`BlockContent::Raw`].
//!   * **Properties** (`w:pPr` on a paragraph, `w:rPr` on a run) are captured
//!     verbatim into `properties_xml` so styles/numbering/bold/italic/color
//!     survive even though the engine does not interpret them.

// SECURITY — relied-upon properties (a quick-xml bump must not regress these):
//   1. quick-xml does NOT expand general/DTD entities, so a `<!DOCTYPE ...>`
//      with recursive entities (billion-laughs / XXE) is inert here — it is
//      never expanded into document content. Locked in by
//      `tests/roundtrip.rs::test_doctype_entity_is_not_expanded_billion_laughs`.
//   2. Every parse loop below is ITERATIVE (no recursion on document depth) and
//      has an explicit `Event::Eof` arm that returns/breaks, so truncated or
//      adversarial input terminates promptly instead of hanging or overflowing
//      the stack. Locked in by `test_truncated_document_xml_returns_err_*`.

use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::{BytesEnd, BytesRef, BytesStart, Event};
use quick_xml::name::QName;
use quick_xml::reader::Reader;

use crate::error::{DocxError, Result};
use crate::model::{
    BlockContent, Comment, Document, Inline, Paragraph, RevisionMeta, Run, DOM_FORMAT_VERSION,
};

type SliceReader<'a> = Reader<&'a [u8]>;

fn xml_err(e: impl std::fmt::Display) -> DocxError {
    DocxError::Xml(e.to_string())
}

/// Local name (after any `:` prefix) of a qualified name. `pub(crate)` so the
/// plain-text extraction walk (`text.rs`) shares the exact same name handling.
pub(crate) fn local_of(name: QName) -> String {
    let bytes = name.as_ref();
    let local = match bytes.iter().position(|&b| b == b':') {
        Some(idx) => &bytes[idx + 1..],
        None => bytes,
    };
    String::from_utf8_lossy(local).into_owned()
}

fn local_name(e: &BytesStart) -> String {
    local_of(e.name())
}

/// Read a `w:*` attribute by local name (e.g. "author", "date", "id").
fn attr(e: &BytesStart, want_local: &str) -> Option<String> {
    for a in e.attributes().with_checks(false).flatten() {
        let kb = a.key.as_ref();
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

/// Capture the exact source XML of the element whose start tag is about to be
/// (or has just been) read, INCLUDING its own start and end tags.
///
/// `start_pos` is `reader.buffer_position()` captured immediately *before* the
/// start tag was read; the reader must currently be positioned just after that
/// start tag (i.e. you have already consumed the `Event::Start`). We skip to
/// the matching end tag and slice `[start_pos .. end_pos]` from the original
/// source. This is the heart of preserve-by-default: unmodeled markup
/// round-trips byte-for-byte.
fn capture_element(
    reader: &mut SliceReader,
    source: &str,
    start_pos: usize,
    end: &BytesEnd,
) -> Result<String> {
    // `read_to_end` returns the span of the *content* between the start and end
    // tags (its `.end` stops just before `</...>`). To capture the WHOLE element
    // including its own closing tag we take the reader's byte position AFTER the
    // call, which sits just past `</...>`.
    let _span = reader.read_to_end(end.name()).map_err(xml_err)?;
    let end_pos = reader.buffer_position() as usize;
    Ok(source[start_pos..end_pos].to_string())
}

/// Capture an empty element (`<w:foo .../>`) verbatim from `start_pos` to the
/// reader's current position (just after the empty tag was consumed).
fn capture_empty(source: &str, start_pos: usize, end_pos: usize) -> String {
    source[start_pos..end_pos].to_string()
}

/// Capture the exact INNER content of an element (everything between its start
/// and end tags, NOT including either tag), given its owned end tag and the
/// reader positioned just after the start tag. `read_to_end`'s returned span is
/// precisely that inner range, so this is robust to attributes/whitespace and
/// avoids any string surgery.
fn capture_inner(reader: &mut SliceReader, source: &str, end: &BytesEnd) -> Result<String> {
    let span = reader.read_to_end(end.name()).map_err(xml_err)?;
    let (s, e) = (span.start as usize, span.end as usize);
    if e < s {
        return Ok(String::new());
    }
    Ok(source[s..e].to_string())
}

/// Parse a complete `word/document.xml` into the body.
pub fn parse_document(document_xml: &str, comments_xml: Option<&str>) -> Result<Document> {
    let body = parse_body(document_xml)?;
    let comments = match comments_xml {
        Some(xml) => parse_comments(xml)?,
        None => Default::default(),
    };
    Ok(Document {
        format_version: DOM_FORMAT_VERSION,
        body,
        comments,
    })
}

fn parse_body(xml: &str) -> Result<Vec<BlockContent>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false); // keep whitespace verbatim

    let mut blocks: Vec<BlockContent> = Vec::new();
    // Whether we are inside <w:body>. Block-level capture is scoped to the body
    // so we don't accidentally raw-capture <w:document> itself.
    let mut in_body = false;

    loop {
        let pos = reader.buffer_position() as usize;
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let ln = local_name(&e);
                if ln == "body" {
                    in_body = true;
                } else if in_body && ln == "p" {
                    let para = parse_paragraph(&mut reader, xml)?;
                    blocks.push(BlockContent::Paragraph(para));
                } else if in_body {
                    // PRESERVE: any other block element (tbl, sdt, sectPr, ...)
                    // captured verbatim.
                    let end = e.to_end().into_owned();
                    let xml_src = capture_element(&mut reader, xml, pos, &end)?;
                    blocks.push(BlockContent::Raw { xml: xml_src });
                }
                // (outside body: <w:document> wrapper — descend into it.)
            }
            Event::Empty(e) if in_body => {
                let ln = local_name(&e);
                if ln == "p" {
                    // A self-closing <w:p/> is a valid empty paragraph in OOXML.
                    // Treat it as an empty Paragraph (no inlines, no properties)
                    // so it renders as an editable surface rather than a
                    // preserved-content placeholder.
                    blocks.push(BlockContent::Paragraph(Paragraph::default()));
                } else {
                    // PRESERVE: any other empty block-level element (sectPr,
                    // tbl written empty, etc.) captured verbatim.
                    let end_pos = reader.buffer_position() as usize;
                    blocks.push(BlockContent::Raw {
                        xml: capture_empty(xml, pos, end_pos),
                    });
                }
            }
            Event::End(e) if local_of(e.name()) == "body" => {
                in_body = false;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(blocks)
}

/// Parse the contents of a `<w:p>` until its matching `</w:p>`. The reader is
/// positioned just after the `<w:p>` start tag.
fn parse_paragraph(reader: &mut SliceReader, source: &str) -> Result<Paragraph> {
    let mut para = Paragraph::default();

    loop {
        let pos = reader.buffer_position() as usize;
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => match local_name(&e).as_str() {
                "pPr" => {
                    // PRESERVE paragraph properties verbatim (styles, numbering,
                    // alignment, paragraph-mark revisions).
                    let end = e.to_end().into_owned();
                    para.properties_xml =
                        Some(capture_element(reader, source, pos, &end)?);
                }
                "ins" => {
                    let meta = revision_meta(&e);
                    let runs = parse_runs_until(reader, source, "ins", false)?;
                    para.inlines.push(Inline::Insertion { meta, runs });
                }
                "del" => {
                    let meta = revision_meta(&e);
                    let runs = parse_runs_until(reader, source, "del", true)?;
                    para.inlines.push(Inline::Deletion { meta, runs });
                }
                "r" => {
                    // `pos` is the byte offset of this run's `<w:r>` start tag,
                    // so a run with unmodeled content can be preserved verbatim
                    // from source.
                    if let Some(inline) = parse_plain_run(reader, source, pos)? {
                        para.inlines.push(inline);
                    }
                }
                // PRESERVE: any other inline element (hyperlink, smartTag,
                // bookmarkStart/End that aren't empty, fldSimple, ...) verbatim.
                _ => {
                    let end = e.to_end().into_owned();
                    let xml_src = capture_element(reader, source, pos, &end)?;
                    para.inlines.push(Inline::Raw { xml: xml_src });
                }
            },
            Event::Empty(e) => match local_name(&e).as_str() {
                "commentRangeStart" => {
                    if let Some(id) = attr(&e, "id") {
                        para.inlines.push(Inline::CommentRangeStart { id });
                    }
                }
                "commentRangeEnd" => {
                    if let Some(id) = attr(&e, "id") {
                        para.inlines.push(Inline::CommentRangeEnd { id });
                    }
                }
                // PRESERVE: any other empty inline element (bookmarkStart/End,
                // a self-closing field char, etc.) verbatim.
                _ => {
                    let end_pos = reader.buffer_position() as usize;
                    para.inlines.push(Inline::Raw {
                        xml: capture_empty(source, pos, end_pos),
                    });
                }
            },
            Event::End(e) if local_of(e.name()) == "p" => break,
            Event::Eof => return Err(DocxError::Xml("unexpected EOF inside <w:p>".into())),
            _ => {}
        }
    }

    Ok(para)
}

/// Parse a sequence of `<w:r>` runs until the named closing wrapper
/// (`ins`/`del`). When `is_del`, run text lives in `<w:delText>`. `source` is
/// the full document.xml so `rPr` can be sliced VERBATIM from it (byte-exact),
/// the same way `pPr` is, instead of re-serialized through the XML writer.
fn parse_runs_until(
    reader: &mut SliceReader,
    source: &str,
    wrapper: &str,
    is_del: bool,
) -> Result<Vec<Run>> {
    let mut runs: Vec<Run> = Vec::new();
    // We must capture rPr inside the run; do a position-aware walk per run.
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) if local_name(&e) == "r" => {
                if let Some(run) = parse_run_inner(reader, source, is_del)? {
                    runs.push(run);
                }
            }
            Event::End(e) if local_of(e.name()) == wrapper => break,
            Event::Eof => {
                return Err(DocxError::Xml(format!("unexpected EOF inside <w:{wrapper}>")))
            }
            _ => {}
        }
    }
    Ok(runs)
}

/// Parse a single `<w:r>` inside an ins/del wrapper. Captures `<w:rPr>`
/// verbatim (sliced from `source`) and the text from `<w:t>` or `<w:delText>`.
/// Returns None if the run had no text node. The reader is positioned just after
/// the `<w:r>` start.
fn parse_run_inner(reader: &mut SliceReader, source: &str, is_del: bool) -> Result<Option<Run>> {
    let text_tag = if is_del { "delText" } else { "t" };
    let mut text = String::new();
    let mut saw_text = false;
    let mut preserve = false;
    let mut rpr: Option<String> = None;

    // `rPr` is preserved VERBATIM by slicing the source span (identical
    // treatment to `pPr`), so attribute order / whitespace / namespaces survive
    // byte-for-byte rather than being normalized by an XML round-trip.
    loop {
        let pos = reader.buffer_position() as usize;
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) if local_name(&e) == "rPr" => {
                let end = e.to_end().into_owned();
                rpr = Some(capture_element(reader, source, pos, &end)?);
            }
            Event::Start(e) if local_name(&e) == text_tag => {
                saw_text = true;
                if attr(&e, "space").as_deref() == Some("preserve") {
                    preserve = true;
                }
                read_text_content(reader, text_tag, &mut text)?;
            }
            Event::End(e) if local_of(e.name()) == "r" => break,
            Event::Eof => return Err(DocxError::Xml("unexpected EOF inside <w:r>".into())),
            _ => {}
        }
    }

    if saw_text {
        Ok(Some(Run {
            text,
            preserve_space: preserve,
            properties_xml: rpr,
        }))
    } else {
        Ok(None)
    }
}

/// Parse a plain `<w:r>` directly under a paragraph. It is either a text run
/// (-> `Inline::Run`, with `rPr` preserved), a run carrying
/// `<w:commentReference>` (-> `Inline::CommentReference`), or — if it contains
/// something we don't model (a drawing, a field char, a footnote ref) — the
/// whole run is preserved verbatim as `Inline::Raw`.
fn parse_plain_run(
    reader: &mut SliceReader,
    source: &str,
    run_start_pos: usize,
) -> Result<Option<Inline>> {
    // We walk the run's children, deciding as we go. A plain text run becomes
    // `Inline::Run` (with rPr preserved); a commentReference run becomes
    // `Inline::CommentReference`; a run containing ANYTHING we don't model is
    // preserved WHOLE and verbatim from the source as `Inline::Raw` — that keeps
    // child order, `<w:r>` attributes, and inert markup byte-exact, never
    // dropping content.
    let mut text = String::new();
    let mut saw_text = false;
    let mut preserve = false;
    let mut rpr: Option<String> = None;
    let mut comment_ref: Option<String> = None;
    // Set as soon as we see any child we do not model; triggers verbatim
    // whole-run preservation below.
    let mut has_unmodeled = false;

    loop {
        let pos = reader.buffer_position() as usize;
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => match local_name(&e).as_str() {
                "rPr" => {
                    // Slice rPr VERBATIM from source (byte-exact), unified with
                    // how pPr is captured — no XML-writer normalization.
                    let end = e.to_end().into_owned();
                    rpr = Some(capture_element(reader, source, pos, &end)?);
                }
                "t" => {
                    saw_text = true;
                    if attr(&e, "space").as_deref() == Some("preserve") {
                        preserve = true;
                    }
                    read_text_content(reader, "t", &mut text)?;
                }
                // Unmodeled non-empty child (drawing, field, footnoteReference,
                // ...): skip its subtree; the whole run is preserved verbatim.
                _ => {
                    has_unmodeled = true;
                    let end = e.to_end().into_owned();
                    reader.read_to_end(end.name()).map_err(xml_err)?;
                }
            },
            Event::Empty(e) => match local_name(&e).as_str() {
                "commentReference" => {
                    comment_ref = attr(&e, "id");
                }
                // Unmodeled empty child (fldChar, br, tab, drawing ref, ...):
                // the whole run is preserved verbatim.
                _ => {
                    has_unmodeled = true;
                }
            },
            Event::End(e) if local_of(e.name()) == "r" => break,
            Event::Eof => return Err(DocxError::Xml("unexpected EOF inside <w:r>".into())),
            _ => {}
        }
    }
    let run_end_pos = reader.buffer_position() as usize;

    // Priority: a run with any unmodeled content is preserved WHOLE and verbatim
    // (keeps order + attributes); else commentReference; else a text run; else a
    // formatting-only run is preserved; else nothing.
    if has_unmodeled {
        return Ok(Some(Inline::Raw {
            xml: source[run_start_pos..run_end_pos].to_string(),
        }));
    }
    if let Some(id) = comment_ref {
        return Ok(Some(Inline::CommentReference { id }));
    }
    if saw_text {
        return Ok(Some(Inline::Run(Run {
            text,
            preserve_space: preserve,
            properties_xml: rpr,
        })));
    }
    // A run with only rPr and no text/children: preserve it verbatim so we don't
    // drop formatting-only runs (rare but possible).
    if rpr.is_some() {
        return Ok(Some(Inline::Raw {
            xml: source[run_start_pos..run_end_pos].to_string(),
        }));
    }
    Ok(None)
}

/// Resolve a general-reference event (`&amp;`, `&#233;`, `&#x2014;`, ...) to
/// its character content. quick-xml 0.38 splits text at entity boundaries and
/// emits [`Event::GeneralRef`] for each reference — text readers must handle
/// it or silently DROP characters (e.g. "Smith &amp; Jones" losing its "&").
///
/// Numeric character references and the five predefined XML entities resolve;
/// unknown (DTD-defined) entities return `None` and are skipped — they are
/// NEVER expanded, so the billion-laughs / XXE stance above is unchanged.
pub(crate) fn general_ref_text(r: &BytesRef) -> Option<String> {
    if let Ok(Some(ch)) = r.resolve_char_ref() {
        return Some(ch.to_string());
    }
    let name = r.decode().ok()?;
    resolve_predefined_entity(&name).map(|s| s.to_string())
}

/// Read text content (concatenating Text events) until the closing `</tag>`.
fn read_text_content(reader: &mut SliceReader, tag: &str, out: &mut String) -> Result<()> {
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Text(t) => out.push_str(&t.xml_content().map_err(xml_err)?),
            Event::GeneralRef(r) => {
                if let Some(s) = general_ref_text(&r) {
                    out.push_str(&s);
                }
            }
            Event::CData(c) => {
                // Preserve CDATA text content (rare in run text, but be safe).
                out.push_str(&String::from_utf8_lossy(c.as_ref()));
            }
            Event::End(e) if local_of(e.name()) == tag => break,
            Event::Eof => return Err(DocxError::Xml(format!("EOF inside <w:{tag}>"))),
            _ => {}
        }
    }
    Ok(())
}

// (Removed `capture_subtree_as_xml`: both `rPr` capture sites now slice the
// source verbatim via `capture_element`, identical to how `pPr` is preserved,
// so there is no longer an XML-writer round-trip that could normalize markup.)

// ---------------------------------------------------------------------------
// comments.xml
// ---------------------------------------------------------------------------

pub(crate) fn parse_comments(
    xml: &str,
) -> Result<std::collections::BTreeMap<String, Comment>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut out = std::collections::BTreeMap::new();

    loop {
        let pos = reader.buffer_position() as usize;
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) if local_name(&e) == "comment" => {
                let id = attr(&e, "id").unwrap_or_default();
                let author = attr(&e, "author").unwrap_or_default();
                let date = attr(&e, "date").unwrap_or_default();
                let initials = attr(&e, "initials");
                // Capture the comment's inner body verbatim (between <w:comment>
                // and </w:comment>) so rich bodies survive, AND flatten the text
                // for display. `pos` is unused here because we capture the inner
                // span directly from read_to_end.
                let _ = pos;
                let end = e.to_end().into_owned();
                let body_xml = capture_inner(&mut reader, xml, &end)?;
                let text = flatten_text(&body_xml);
                out.insert(
                    id.clone(),
                    Comment {
                        id,
                        author,
                        date,
                        initials,
                        text,
                        body_xml: Some(body_xml),
                    },
                );
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

/// Flatten all `<w:t>` text inside a fragment into a single string.
fn flatten_text(fragment: &str) -> String {
    let mut reader = Reader::from_str(fragment);
    reader.config_mut().trim_text(false);
    let mut text = String::new();
    let mut in_t = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if local_name(&e) == "t" => in_t = true,
            Ok(Event::End(e)) if local_of(e.name()) == "t" => in_t = false,
            Ok(Event::Text(t)) if in_t => {
                if let Ok(s) = t.xml_content() {
                    text.push_str(&s);
                }
            }
            Ok(Event::GeneralRef(r)) if in_t => {
                if let Some(s) = general_ref_text(&r) {
                    text.push_str(&s);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    text
}
