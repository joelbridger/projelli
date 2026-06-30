//! VG-2b — office-document extraction for the semantic index: xlsx
//! (worksheets → text sections), pptx (slides → text sections), rtf (text).
//!
//! Hand-rolled on `zip` + `quick-xml` at the SAME versions lantern-docx
//! already pins (zero new lockfile entries) — the in-house OOXML philosophy
//! ("only generic XML/ZIP/serde crates"; calamine was rejected in planning
//! as a new dependency tree). The host's `index_one_file` dispatch (Task 3)
//! bands `OfficeSection`s into chunks the way PDF pages band.
//!
//! Defensive stance (untrusted input — these bytes come straight from the
//! user's workspace):
//!   - Decompression-bomb guards mirror `lantern-docx/src/package.rs`:
//!     entry-count cap, per-part byte cap, and a running total budget; the
//!     ZIP's uncompressed-size headers are never trusted for allocation.
//!   - Per-sheet cell cap (`MAX_SHEET_CELLS`) bounds pathological worksheets;
//!     truncation is logged honestly, never silent.
//!   - Unknown DTD entities are skipped, never expanded (billion-laughs
//!     stays inert); numeric character references and the five predefined
//!     XML entities resolve (`Event::GeneralRef` — quick-xml 0.38 splits
//!     text at entity boundaries, so a loop without that arm silently drops
//!     the `&` in "P&L Statement").
//!   - Malformed XML inside a part ends that part's walk early, keeping what
//!     was collected (preserve-don't-crash); a malformed *package* is an
//!     `Err` the caller maps to skip-and-continue.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use anyhow::{ensure, Context, Result};
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::name::QName;
use quick_xml::reader::Reader;
use zip::ZipArchive;

// ---------------------------------------------------------------------------
// Limits (decompression-bomb + runaway-content guards)
// ---------------------------------------------------------------------------

/// Cap on any single XML part's decompressed bytes. The text-bearing parts of
/// real spreadsheets/decks stay far below this; media (which we never read)
/// is what makes office packages large.
const MAX_PART_BYTES: u64 = 64 * 1024 * 1024; // 64 MiB
/// Running budget of total decompressed bytes across every part we read from
/// one package.
const MAX_TOTAL_PART_BYTES: u64 = 256 * 1024 * 1024; // 256 MiB
/// Cap on the number of entries in one package (a zip with millions of tiny
/// entries exhausts time/memory before any content does).
const MAX_ENTRY_COUNT: usize = 10_000;
/// Per-sheet cell cap. No legitimate *legal-work* worksheet needs more text
/// cells than this in the semantic index; extraction past it truncates with
/// a warning (honest, logged) instead of chewing unbounded memory.
const MAX_SHEET_CELLS: usize = 50_000;

/// One indexable section of a sectioned office document: a worksheet or a
/// slide. `number` is 1-based (sheet/slide number) for citation labels.
#[derive(Debug, Clone)]
pub struct OfficeSection {
    pub number: u32,
    pub label: String, // sheet name / "Slide N"
    pub text: String,
}

// ---------------------------------------------------------------------------
// Bomb-guarded part access (mirrors lantern-docx/src/package.rs)
// ---------------------------------------------------------------------------

/// Selective, budgeted access to the XML parts of an OOXML ZIP. Unlike
/// lantern-docx's `Package` (which must preserve every part), extraction
/// only ever reads the handful of parts it names, so entries are decompressed
/// on demand and media is never touched.
struct OoxmlParts<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
    total_remaining: u64,
}

impl<'a> OoxmlParts<'a> {
    fn open(bytes: &'a [u8]) -> Result<Self> {
        ensure!(!bytes.is_empty(), "empty office file");
        let archive = ZipArchive::new(Cursor::new(bytes))
            .context("not a valid office package (zip open failed)")?;
        ensure!(
            archive.len() <= MAX_ENTRY_COUNT,
            "office package has too many entries: {} (max {MAX_ENTRY_COUNT})",
            archive.len()
        );
        Ok(OoxmlParts {
            archive,
            total_remaining: MAX_TOTAL_PART_BYTES,
        })
    }

    fn names(&self) -> Vec<String> {
        self.archive.file_names().map(str::to_owned).collect()
    }

    /// Decompress one part to (lossy) UTF-8 text. `Ok(None)` when the part
    /// does not exist. The ZIP's uncompressed-size header is never trusted:
    /// reads go through `Read::take(budget + 1)` so a lying header cannot
    /// force allocation past the budget (same property package.rs relies on).
    fn part_str(&mut self, name: &str) -> Result<Option<String>> {
        let Some(index) = self.archive.index_for_name(name) else {
            return Ok(None);
        };
        let mut file = self
            .archive
            .by_index(index)
            .with_context(|| format!("read zip entry {name}"))?;
        let budget = MAX_PART_BYTES.min(self.total_remaining);
        let cap_hint = file.size().min(budget).min(usize::MAX as u64) as usize;
        let mut buf = Vec::with_capacity(cap_hint);
        let read = (&mut file)
            .take(budget.saturating_add(1))
            .read_to_end(&mut buf)
            .with_context(|| format!("decompress part {name}"))? as u64;
        ensure!(
            read <= budget,
            "decompression-bomb guard: part {name} exceeds the size budget \
             (per-part {MAX_PART_BYTES} bytes, remaining total {})",
            self.total_remaining
        );
        self.total_remaining -= read;
        Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
    }
}

// ---------------------------------------------------------------------------
// Shared XML-walk helpers
// ---------------------------------------------------------------------------

/// Local name (after any `:` prefix) of a qualified name — same handling as
/// lantern-docx's `parse::local_of` (pub(crate) to that crate, so a copy).
fn local_of(name: QName) -> String {
    let bytes = name.as_ref();
    let local = match bytes.iter().position(|&b| b == b':') {
        Some(idx) => &bytes[idx + 1..],
        None => bytes,
    };
    String::from_utf8_lossy(local).into_owned()
}

/// Read an attribute by local name, XML-unescaped. Attribute text that lands
/// in the index (sheet names: `<sheet name="P&amp;L"/>`) MUST go through
/// `unescape_value()` — raw `.value` bytes would index "P&amp;L" verbatim
/// (the lantern-docx bug fixed after 4fe47ac). Malformed escapes fall back
/// to the raw bytes (preserve-don't-crash).
fn attr_unescaped(e: &BytesStart, want_local: &str) -> Option<String> {
    for a in e.attributes().with_checks(false).flatten() {
        let kb = a.key.as_ref();
        let local = match kb.iter().position(|&b| b == b':') {
            Some(idx) => &kb[idx + 1..],
            None => kb,
        };
        if local == want_local.as_bytes() {
            return Some(match a.unescape_value() {
                Ok(v) => v.into_owned(),
                Err(_) => String::from_utf8_lossy(&a.value).into_owned(),
            });
        }
    }
    None
}

/// Resolve a general-reference event (`&amp;`, `&#8212;`, …) to its character
/// content. quick-xml 0.38 splits text at entity boundaries and emits
/// `Event::GeneralRef` for each reference — every text-collecting loop must
/// handle it or silently DROP characters ("P&L" losing its "&"). Numeric
/// character references and the five predefined XML entities resolve; unknown
/// (DTD-defined) entities resolve to nothing and are NEVER expanded
/// (billion-laughs stays inert). Local ~8-line copy of lantern-docx's
/// `parse::general_ref_text` (pub(crate) to that crate).
fn general_ref_text(r: &BytesRef) -> Option<String> {
    if let Ok(Some(ch)) = r.resolve_char_ref() {
        return Some(ch.to_string());
    }
    let name = r.decode().ok()?;
    resolve_predefined_entity(&name).map(|s| s.to_string())
}

/// Append the character content of a Text/CData/GeneralRef event to `out`.
/// Every collecting walk in this module routes content through here so the
/// GeneralRef arm can never be forgotten in one of them.
fn append_content(ev: &Event, out: &mut String) {
    match ev {
        Event::Text(t) => {
            if let Ok(s) = t.xml_content() {
                out.push_str(&s);
            }
        }
        Event::CData(c) => out.push_str(&String::from_utf8_lossy(c.as_ref())),
        Event::GeneralRef(r) => {
            if let Some(s) = general_ref_text(r) {
                out.push_str(&s);
            }
        }
        _ => {}
    }
}

fn top_is(stack: &[String], local: &str) -> bool {
    stack.last().map(String::as_str) == Some(local)
}

fn stack_has(stack: &[String], local: &str) -> bool {
    stack.iter().any(|s| s == local)
}

// ---------------------------------------------------------------------------
// xlsx
// ---------------------------------------------------------------------------

/// Worksheet text from .xlsx bytes, one section per non-empty sheet in
/// workbook order. Rows render as cell values joined `" | "`, rows joined
/// `"\n"`. Cached values only — formulas are not search text. Section
/// `number` is the sheet's 1-based workbook position (what Excel shows), so
/// citations stay truthful even when empty/unresolvable sheets are skipped.
pub fn extract_xlsx_sections(bytes: &[u8]) -> Result<Vec<OfficeSection>> {
    let mut parts = OoxmlParts::open(bytes)?;

    let shared = match parts.part_str("xl/sharedStrings.xml")? {
        Some(xml) => parse_shared_strings(&xml),
        None => Vec::new(),
    };

    // (1-based sheet number, sheet name, worksheet part name), workbook order.
    let mut sheets: Vec<(u32, String, String)> = Vec::new();
    if let (Some(wb), Some(rels)) = (
        parts.part_str("xl/workbook.xml")?,
        parts.part_str("xl/_rels/workbook.xml.rels")?,
    ) {
        let targets = parse_rels_targets(&rels);
        for (idx, (name, rid)) in parse_workbook_sheets(&wb).into_iter().enumerate() {
            if let Some(target) = targets.get(&rid) {
                sheets.push(((idx + 1) as u32, name, normalize_workbook_target(target)));
            }
        }
    }
    if sheets.is_empty() {
        // Fallback: no/unusable workbook plumbing — enumerate worksheet parts
        // in lexical order with generic labels.
        let mut names: Vec<String> = parts
            .names()
            .into_iter()
            .filter(|n| n.starts_with("xl/worksheets/sheet") && n.ends_with(".xml"))
            .collect();
        names.sort();
        sheets = names
            .into_iter()
            .enumerate()
            .map(|(i, n)| ((i + 1) as u32, format!("Sheet {}", i + 1), n))
            .collect();
    }

    let mut out = Vec::new();
    for (number, label, part) in sheets {
        let Some(xml) = parts.part_str(&part)? else {
            continue; // rels point at a part the package doesn't carry
        };
        let text = worksheet_text(&xml, &shared, &label);
        if text.is_empty() {
            continue; // nothing indexable; the sheet keeps its number anyway
        }
        out.push(OfficeSection {
            number,
            label,
            text,
        });
    }
    Ok(out)
}

/// `<sheet name="…" r:id="…"/>` entries from `xl/workbook.xml`, in workbook
/// order: (sheet name, relationship id). A nameless sheet gets a positional
/// "Sheet N" label; one without an r:id keeps an empty id (never resolves).
fn parse_workbook_sheets(xml: &str) -> Vec<(String, String)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out: Vec<(String, String)> = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if local_of(e.name()) == "sheet" => {
                let name = attr_unescaped(&e, "name")
                    .unwrap_or_else(|| format!("Sheet {}", out.len() + 1));
                // `r:id` matched by LOCAL name; `sheetId` is a distinct local.
                let rid = attr_unescaped(&e, "id").unwrap_or_default();
                out.push((name, rid));
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    out
}

/// `Id -> Target` for every `<Relationship>` in a .rels part.
fn parse_rels_targets(xml: &str) -> HashMap<String, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = HashMap::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if local_of(e.name()) == "Relationship" => {
                if let (Some(id), Some(target)) =
                    (attr_unescaped(&e, "Id"), attr_unescaped(&e, "Target"))
                {
                    out.insert(id, target);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    out
}

/// Relationship targets are package-relative to `xl/` ("worksheets/sheet1.xml")
/// or package-absolute ("/xl/worksheets/sheet1.xml" — openpyxl writes these).
fn normalize_workbook_target(target: &str) -> String {
    match target.strip_prefix('/') {
        Some(abs) => abs.to_string(),
        None => format!("xl/{target}"),
    }
}

/// `xl/sharedStrings.xml`: one string per `<si>`, concatenating its `<t>`
/// character content (rich runs `<r><t>` included; phonetic `<rPh>` runs
/// excluded — they are reading guides, not display text).
fn parse_shared_strings(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut shared = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut cur = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let ln = local_of(e.name());
                if ln == "si" {
                    cur.clear();
                }
                stack.push(ln);
            }
            Ok(Event::End(e)) => {
                if local_of(e.name()) == "si" {
                    shared.push(std::mem::take(&mut cur));
                }
                stack.pop();
            }
            Ok(ev @ (Event::Text(_) | Event::CData(_) | Event::GeneralRef(_))) => {
                if top_is(&stack, "t") && !stack_has(&stack, "rPh") {
                    append_content(&ev, &mut cur);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    shared
}

/// Which value a `<c>` cell carries, per its `t` attribute.
enum CellKind {
    /// `t="s"` — `<v>` holds an index into the shared-strings table.
    Shared,
    /// `t="inlineStr"` — the value is the `<is>…<t>` character content.
    Inline,
    /// `t="n"`/`"str"`/`"b"`/… or absent — the `<v>` literal is the value.
    /// Formula cells with an EMPTY cached `<v></v>` contribute nothing
    /// (`<f>` content is never collected — formulas are not search text).
    Literal,
}

/// One worksheet part → searchable text. Row line = non-empty cell values
/// joined `" | "`; sheet text = row lines joined `"\n"`.
fn worksheet_text(xml: &str, shared: &[String], sheet_label: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut stack: Vec<String> = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    let mut row_cells: Vec<String> = Vec::new();
    let mut kind = CellKind::Literal;
    let mut v_text = String::new(); // <v> content (literal value or shared index)
    let mut is_text = String::new(); // <is>…<t> content
    let mut cell_count: usize = 0;
    let mut truncated = false;

    'walk: loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let ln = local_of(e.name());
                if ln == "c" {
                    cell_count += 1;
                    if cell_count > MAX_SHEET_CELLS {
                        truncated = true;
                        break 'walk;
                    }
                    kind = match attr_unescaped(&e, "t").as_deref() {
                        Some("s") => CellKind::Shared,
                        Some("inlineStr") => CellKind::Inline,
                        _ => CellKind::Literal,
                    };
                    v_text.clear();
                    is_text.clear();
                }
                stack.push(ln);
            }
            Ok(Event::Empty(e)) => {
                // A self-closing <c/> carries no value but still counts toward
                // the cap (a bomb of a billion empty cells must also bound).
                if local_of(e.name()) == "c" {
                    cell_count += 1;
                    if cell_count > MAX_SHEET_CELLS {
                        truncated = true;
                        break 'walk;
                    }
                }
            }
            Ok(Event::End(e)) => {
                match local_of(e.name()).as_str() {
                    "c" => {
                        let value = match kind {
                            CellKind::Inline => is_text.trim().to_string(),
                            CellKind::Literal => v_text.trim().to_string(),
                            CellKind::Shared => v_text
                                .trim()
                                .parse::<usize>()
                                .ok()
                                .and_then(|i| shared.get(i))
                                .map(|s| s.trim().to_string())
                                .unwrap_or_default(),
                        };
                        if !value.is_empty() {
                            row_cells.push(value);
                        }
                    }
                    "row" => {
                        if !row_cells.is_empty() {
                            lines.push(row_cells.join(" | "));
                            row_cells.clear();
                        }
                    }
                    _ => {}
                }
                stack.pop();
            }
            Ok(ev @ (Event::Text(_) | Event::CData(_) | Event::GeneralRef(_))) => {
                if top_is(&stack, "v") && stack_has(&stack, "c") {
                    append_content(&ev, &mut v_text);
                } else if top_is(&stack, "t") && stack_has(&stack, "is") {
                    append_content(&ev, &mut is_text);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            // Malformed part: keep what was collected (preserve-don't-crash).
            Err(_) => break,
        }
    }

    if truncated {
        log::warn!(
            "xlsx sheet {sheet_label:?}: more than {MAX_SHEET_CELLS} cells — \
             extraction truncated at the cap"
        );
        if !row_cells.is_empty() {
            lines.push(row_cells.join(" | "));
        }
    }
    lines.join("\n").trim().to_string()
}

// ---------------------------------------------------------------------------
// pptx
// ---------------------------------------------------------------------------

/// Slide text from .pptx bytes, one section per non-empty slide, in slide
/// order (`ppt/slides/slide<N>.xml` sorted numerically by N — lexical order
/// would read slide10 before slide2).
pub fn extract_pptx_sections(bytes: &[u8]) -> Result<Vec<OfficeSection>> {
    let mut parts = OoxmlParts::open(bytes)?;
    let mut slides: Vec<(u32, String)> = parts
        .names()
        .into_iter()
        .filter_map(|n| slide_number(&n).map(|num| (num, n)))
        .collect();
    slides.sort_by_key(|(n, _)| *n);

    let mut out = Vec::new();
    for (number, part) in slides {
        let Some(xml) = parts.part_str(&part)? else {
            continue;
        };
        let text = slide_text(&xml);
        if text.is_empty() {
            continue;
        }
        out.push(OfficeSection {
            number,
            label: format!("Slide {number}"),
            text,
        });
    }
    Ok(out)
}

/// `ppt/slides/slide<N>.xml` → N. Rels parts (`ppt/slides/_rels/…`) and
/// non-numeric names never match.
fn slide_number(name: &str) -> Option<u32> {
    let digits = name
        .strip_prefix("ppt/slides/slide")?
        .strip_suffix(".xml")?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Visible text of one slide: `<a:t>` character content; the close of each
/// `</a:p>` paragraph emits a newline (deduplicated).
fn slide_text(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut stack: Vec<String> = Vec::new();
    let mut out = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => stack.push(local_of(e.name())),
            Ok(Event::End(e)) => {
                if local_of(e.name()) == "p" && !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                stack.pop();
            }
            Ok(ev @ (Event::Text(_) | Event::CData(_) | Event::GeneralRef(_))) => {
                if top_is(&stack, "t") {
                    append_content(&ev, &mut out);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    out.trim().to_string()
}

// ---------------------------------------------------------------------------
// rtf
// ---------------------------------------------------------------------------

/// Plain text from .rtf bytes. Group-depth tracker over the byte stream:
/// known destination groups (`\fonttbl`, `\colortbl`, `\stylesheet`, `\info`,
/// `\pict`) and any `{\*…}` group are skipped whole; `\par`/`\line` → newline,
/// `\tab` → tab (plus `\cell`/`\row` separators so table text never glues);
/// `\'hh` decodes the cp1252 byte; `\uN` emits the code point and consumes
/// the fallback char that follows; every other control word is formatting
/// and is dropped.
pub fn extract_rtf_text(bytes: &[u8]) -> Result<String> {
    ensure!(!bytes.is_empty(), "empty RTF file");
    // Strip a UTF-8 BOM / leading whitespace before the header check.
    let mut start = 0usize;
    if bytes.len() >= 3 && &bytes[..3] == b"\xEF\xBB\xBF" {
        start = 3;
    }
    while start < bytes.len() && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    let b = &bytes[start..];
    ensure!(
        b.starts_with(b"{\\rtf"),
        "not an RTF file (missing {{\\rtf header)"
    );

    let mut out = String::new();
    let mut depth: usize = 0;
    // While Some(d): we are inside a skipped destination group that opened at
    // depth d; nothing emits until depth drops below d. Tokens are still
    // PARSED while suppressed (escaped braces, \'hh, control words) so group
    // bookkeeping can never be desynchronized by content bytes.
    let mut suppress_depth: Option<usize> = None;
    // Fallback chars still to consume after a \uN (they duplicate the code
    // point for pre-Unicode readers; emitting both would double characters).
    let mut pending_skip: usize = 0;
    let mut i = 0usize;

    while i < b.len() {
        let suppressed = suppress_depth.is_some();
        match b[i] {
            b'{' => {
                depth += 1;
                i += 1;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                if suppress_depth.is_some_and(|d| depth < d) {
                    suppress_depth = None;
                }
                i += 1;
            }
            b'\\' => {
                i += 1;
                let Some(&next) = b.get(i) else { break };
                match next {
                    b'{' | b'}' | b'\\' => {
                        emit(&mut out, next as char, suppressed, &mut pending_skip);
                        i += 1;
                    }
                    b'\'' => {
                        // \'hh — exactly two hex digits; the byte is cp1252.
                        i += 1;
                        if let (Some(hi), Some(lo)) = (
                            b.get(i).copied().and_then(hexval),
                            b.get(i + 1).copied().and_then(hexval),
                        ) {
                            i += 2;
                            emit(
                                &mut out,
                                cp1252_char(hi * 16 + lo),
                                suppressed,
                                &mut pending_skip,
                            );
                        }
                        // Malformed escape: drop it, keep parsing.
                    }
                    b'*' => {
                        // {\*\dest …} — unknown destination: skip the group.
                        if suppress_depth.is_none() {
                            suppress_depth = Some(depth);
                        }
                        i += 1;
                    }
                    b'~' => {
                        // Non-breaking space renders as a space.
                        emit(&mut out, ' ', suppressed, &mut pending_skip);
                        i += 1;
                    }
                    c if c.is_ascii_alphabetic() => {
                        // Control word: letters, optional signed numeric
                        // parameter, optional ONE delimiting space (consumed).
                        let word_start = i;
                        while i < b.len() && b[i].is_ascii_alphabetic() {
                            i += 1;
                        }
                        let word = &b[word_start..i];
                        let param_start = i;
                        if i < b.len() && (b[i] == b'-' || b[i].is_ascii_digit()) {
                            i += 1;
                            while i < b.len() && b[i].is_ascii_digit() {
                                i += 1;
                            }
                        }
                        let param: Option<i32> = std::str::from_utf8(&b[param_start..i])
                            .ok()
                            .filter(|s| !s.is_empty() && *s != "-")
                            .and_then(|s| s.parse().ok());
                        if i < b.len() && b[i] == b' ' {
                            i += 1;
                        }
                        match word {
                            b"par" | b"line" | b"row" => {
                                emit(&mut out, '\n', suppressed, &mut pending_skip)
                            }
                            b"tab" | b"cell" => {
                                emit(&mut out, '\t', suppressed, &mut pending_skip)
                            }
                            b"u" => {
                                // \uN — signed 16-bit code point. A new \u
                                // means any previous fallback never appeared.
                                pending_skip = 0;
                                if let Some(n) = param {
                                    let cp = if n < 0 { n + 0x1_0000 } else { n } as u32;
                                    if !suppressed {
                                        if let Some(ch) = char::from_u32(cp) {
                                            out.push(ch);
                                        }
                                    }
                                    pending_skip = 1;
                                }
                            }
                            b"fonttbl" | b"colortbl" | b"stylesheet" | b"info" | b"pict" => {
                                // Known destination: its group's content is
                                // plumbing, never document text.
                                if suppress_depth.is_none() {
                                    suppress_depth = Some(depth);
                                }
                            }
                            _ => {} // formatting control word — dropped
                        }
                    }
                    _ => {
                        // Control symbol we don't map (\-, \_, \:, …) — dropped.
                        i += 1;
                    }
                }
            }
            // Raw CR/LF in the file are not content (writers wrap freely).
            b'\r' | b'\n' => i += 1,
            c => {
                emit(&mut out, cp1252_char(c), suppressed, &mut pending_skip);
                i += 1;
            }
        }
    }
    Ok(out.trim().to_string())
}

/// Emit one visible character, honoring destination suppression and the
/// pending `\uN` fallback consumption.
fn emit(out: &mut String, ch: char, suppressed: bool, pending_skip: &mut usize) {
    if *pending_skip > 0 {
        *pending_skip -= 1;
        return;
    }
    if !suppressed {
        out.push(ch);
    }
}

fn hexval(b: u8) -> Option<u8> {
    (b as char).to_digit(16).map(|d| d as u8)
}

/// Decode one cp1252 byte (the RTF `\ansi` default). 0x80–0x9F is the
/// Windows-specific block; everything else matches Latin-1 (and ASCII).
fn cp1252_char(b: u8) -> char {
    const C1: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž',
        '\u{8F}', '\u{90}', '\u{2018}', '\u{2019}', '“', '”', '•', '–', '—', '˜', '™', 'š', '›',
        'œ', '\u{9D}', 'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9F => C1[(b - 0x80) as usize],
        _ => b as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    // ---- fixture + builder helpers -----------------------------------------

    /// Read a matter-corpus fixture. `CARGO_MANIFEST_DIR` is `src-tauri/`;
    /// the corpus lives at the repo root (same resolution as
    /// `lantern-docx/src/text.rs`'s helper, one level shallower).
    fn read_corpus(rel: &str) -> Vec<u8> {
        let mut p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri lives under the repo root")
            .join("tests")
            .join("fixtures")
            .join("matter-corpus");
        for part in rel.split('/') {
            p = p.join(part);
        }
        assert!(
            p.exists(),
            "fixture missing: {p:?} — run generators/generate-fixtures.py"
        );
        std::fs::read(&p).expect("read fixture")
    }

    /// In-memory ZIP from (name, content) parts — synthetic office packages.
    fn zip_bytes(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut cur = std::io::Cursor::new(Vec::new());
        {
            let mut zw = zip::ZipWriter::new(&mut cur);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (name, content) in parts {
                zw.start_file(*name, opts).expect("start zip entry");
                zw.write_all(content.as_bytes()).expect("write zip entry");
            }
            zw.finish().expect("finish zip");
        }
        cur.into_inner()
    }

    fn worksheet_xml(rows: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>"#
        )
    }

    const WORKBOOK_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#;

    fn workbook_xml(sheet_name_escaped: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{sheet_name_escaped}" sheetId="1" r:id="rId1"/></sheets></workbook>"#
        )
    }

    fn slide_xml(text: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#
        )
    }

    // ---- xlsx: real fixtures ------------------------------------------------

    #[test]
    fn xlsx_damages_model_extracts_sheet_sections() {
        let sections =
            extract_xlsx_sections(&read_corpus("damages-model.xlsx")).expect("extract xlsx");
        assert!(!sections.is_empty(), "expected at least one section");
        let s0 = &sections[0];
        assert_eq!(s0.number, 1);
        assert!(
            s0.label.contains("Damages"),
            "section label should carry the sheet name, got {:?}",
            s0.label
        );
        assert!(
            s0.text.contains("Punitive damages (if awarded)"),
            "fixture row text missing:\n{}",
            s0.text
        );
        assert!(
            s0.text.contains("500000"),
            "numeric cached value missing:\n{}",
            s0.text
        );
        // Formula cells carry an EMPTY cached <v></v> (the F-506 fixture
        // shape): the formula itself must never become search text, and the
        // empty value must drop cleanly from the middle of its row.
        assert!(
            !s0.text.contains("SUM("),
            "formula text leaked into search text:\n{}",
            s0.text
        );
        assert!(
            s0.text.contains("TOTAL (base) | Excludes punitive"),
            "empty cached formula value should vanish from its row:\n{}",
            s0.text
        );
    }

    #[test]
    fn xlsx_numeric_character_refs_resolve_in_cell_text() {
        // The fixture stores "Estimate — two PM peers received" with the em
        // dash as &#8212;. quick-xml 0.38 emits that as Event::GeneralRef —
        // a walk without that arm silently drops the character.
        let sections =
            extract_xlsx_sections(&read_corpus("damages-model.xlsx")).expect("extract xlsx");
        assert!(
            sections[0].text.contains("Estimate — two PM peers received"),
            "numeric character reference dropped:\n{}",
            sections[0].text
        );
    }

    #[test]
    fn xlsx_acme_damages_summary_extracts() {
        let sections =
            extract_xlsx_sections(&read_corpus("matter-b-acme/acme-damages-summary.xlsx"))
                .expect("extract xlsx");
        assert!(!sections.is_empty(), "expected at least one section");
        assert!(
            sections[0].text.contains("Liquidated Damages"),
            "fixture header missing:\n{}",
            sections[0].text
        );
    }

    // ---- xlsx: synthetic packages -------------------------------------------

    #[test]
    fn xlsx_sheet_name_attribute_unescapes_entities() {
        // Sheet NAMES are attributes (<sheet name="P&amp;L"/>). Attribute
        // text that lands in the index must go through unescape_value(),
        // never the raw bytes ("P&amp;L" indexed verbatim is the bug class
        // fixed in lantern-docx after 4fe47ac).
        let wb = workbook_xml("P&amp;L");
        let sheet = worksheet_xml(
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>P&amp;L Statement</t></is></c></row>"#,
        );
        let bytes = zip_bytes(&[
            ("xl/workbook.xml", wb.as_str()),
            ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
            ("xl/worksheets/sheet1.xml", sheet.as_str()),
        ]);
        let sections = extract_xlsx_sections(&bytes).expect("extract xlsx");
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].label, "P&L", "sheet name must unescape");
        assert!(
            sections[0].text.contains("P&L Statement"),
            "inline string entity must resolve:\n{}",
            sections[0].text
        );
        assert!(
            !sections[0].text.contains("amp;"),
            "raw escape leaked:\n{}",
            sections[0].text
        );
    }

    #[test]
    fn xlsx_shared_strings_resolve_including_rich_runs() {
        let shared = r#"<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Smith &amp; Jones LLP</t></si><si><r><t>Rich </t></r><r><t>run</t></r></si></sst>"#;
        let sheet = worksheet_xml(
            r#"<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="n"><v>42</v></c></row>"#,
        );
        let bytes = zip_bytes(&[
            ("xl/workbook.xml", workbook_xml("Clients").as_str()),
            ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
            ("xl/sharedStrings.xml", shared),
            ("xl/worksheets/sheet1.xml", sheet.as_str()),
        ]);
        let sections = extract_xlsx_sections(&bytes).expect("extract xlsx");
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].text, "Smith & Jones LLP | Rich run | 42");
    }

    #[test]
    fn xlsx_falls_back_to_sorted_sheet_parts_without_workbook() {
        // No workbook.xml / rels — the extractor falls back to lexically
        // sorted xl/worksheets/sheet*.xml with generic labels.
        let sheet = worksheet_xml(
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>orphan sheet text</t></is></c></row>"#,
        );
        let bytes = zip_bytes(&[("xl/worksheets/sheet1.xml", sheet.as_str())]);
        let sections = extract_xlsx_sections(&bytes).expect("extract xlsx");
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].number, 1);
        assert_eq!(sections[0].label, "Sheet 1");
        assert!(sections[0].text.contains("orphan sheet text"));
    }

    #[test]
    fn xlsx_sheet_cell_cap_truncates_honestly() {
        // A sheet past MAX_SHEET_CELLS stops collecting (logged) instead of
        // chewing unbounded memory; everything before the cap is kept.
        let total = MAX_SHEET_CELLS + 1_000;
        let mut rows = String::new();
        let mut n = 0usize;
        while n < total {
            rows.push_str("<row>");
            for _ in 0..1_000 {
                if n >= total {
                    break;
                }
                rows.push_str(&format!(
                    r#"<c t="inlineStr"><is><t>cell{n}</t></is></c>"#
                ));
                n += 1;
            }
            rows.push_str("</row>");
        }
        let sheet = worksheet_xml(&rows);
        let bytes = zip_bytes(&[
            ("xl/workbook.xml", workbook_xml("Big").as_str()),
            ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
            ("xl/worksheets/sheet1.xml", sheet.as_str()),
        ]);
        let sections = extract_xlsx_sections(&bytes).expect("extract xlsx");
        assert_eq!(sections.len(), 1);
        let text = &sections[0].text;
        assert!(text.contains("cell0 | cell1"), "early cells kept");
        let last_kept = format!("cell{}", MAX_SHEET_CELLS - 1);
        let first_dropped = format!("cell{}", MAX_SHEET_CELLS);
        assert!(text.contains(&last_kept), "cell at the cap boundary kept");
        assert!(
            !text.contains(&first_dropped),
            "cells past the cap must truncate"
        );
    }

    // ---- pptx ----------------------------------------------------------------

    #[test]
    fn pptx_exhibit_deck_extracts_slides_in_order() {
        let sections =
            extract_pptx_sections(&read_corpus("exhibit-deck.pptx")).expect("extract pptx");
        assert_eq!(sections.len(), 2, "deck has exactly two slides");
        assert_eq!(sections[0].number, 1);
        assert_eq!(sections[1].number, 2);
        assert_eq!(sections[1].label, "Slide 2");
        assert!(
            sections[0].text.contains("Johnson v. Nexus Dynamics Corp."),
            "title slide text missing:\n{}",
            sections[0].text
        );
        assert!(
            sections[1].text.contains("Key Events Timeline"),
            "slide 2 title missing:\n{}",
            sections[1].text
        );
        assert!(
            sections[1].text.contains("November 12, 2025: Termination"),
            "slide 2 body paragraph missing:\n{}",
            sections[1].text
        );
    }

    #[test]
    fn pptx_entity_refs_resolve_in_slide_text() {
        // slide2.xml stores "Compliance meeting &amp; deadline" — the &
        // arrives as Event::GeneralRef and must not be dropped.
        let sections =
            extract_pptx_sections(&read_corpus("exhibit-deck.pptx")).expect("extract pptx");
        assert!(
            sections[1].text.contains("Compliance meeting & deadline"),
            "entity reference dropped from slide text:\n{}",
            sections[1].text
        );
        assert!(!sections[1].text.contains("amp;"));
    }

    #[test]
    fn pptx_slides_sort_numerically_not_lexically() {
        // Lexical order would read slide10 before slide2.
        let s1 = slide_xml("one");
        let s2 = slide_xml("two");
        let s10 = slide_xml("ten");
        let bytes = zip_bytes(&[
            ("ppt/slides/slide10.xml", s10.as_str()),
            ("ppt/slides/slide1.xml", s1.as_str()),
            ("ppt/slides/slide2.xml", s2.as_str()),
        ]);
        let sections = extract_pptx_sections(&bytes).expect("extract pptx");
        assert_eq!(
            sections.iter().map(|s| s.number).collect::<Vec<_>>(),
            vec![1, 2, 10]
        );
        assert_eq!(
            sections.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(),
            vec!["one", "two", "ten"]
        );
        assert_eq!(sections[2].label, "Slide 10");
    }

    // ---- rtf -------------------------------------------------------------------

    #[test]
    fn rtf_minimal_document_extracts_lines() {
        let rtf = br"{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 First line.\par Second {\b bold} line.\par}";
        assert_eq!(
            extract_rtf_text(rtf).expect("extract rtf"),
            "First line.\nSecond bold line."
        );
    }

    #[test]
    fn rtf_hex_escape_decodes_cp1252() {
        let rtf = br"{\rtf1\ansi caf\'e9 menu}";
        assert_eq!(extract_rtf_text(rtf).expect("extract rtf"), "café menu");
    }

    #[test]
    fn rtf_unicode_escape_emits_char_and_consumes_fallback() {
        // \u233 is é; the '?' that follows is the fallback char — consumed,
        // never doubled into the output.
        let rtf = br"{\rtf1 caf\u233?!}";
        assert_eq!(extract_rtf_text(rtf).expect("extract rtf"), "café!");
    }

    #[test]
    fn rtf_starred_destination_groups_skip_whole() {
        let rtf = br"{\rtf1 Keep{\*\generator Riched20 10.0.19041}ing}";
        assert_eq!(extract_rtf_text(rtf).expect("extract rtf"), "Keeping");
    }

    #[test]
    fn rtf_known_destination_groups_skip_whole() {
        let rtf =
            br"{\rtf1{\colortbl;\red0\green0\blue0;}{\info{\title secret title}}Visible body}";
        assert_eq!(extract_rtf_text(rtf).expect("extract rtf"), "Visible body");
    }

    #[test]
    fn rtf_escaped_braces_and_backslash_are_literal() {
        let rtf = br"{\rtf1 a\{b\}c\\d}";
        assert_eq!(extract_rtf_text(rtf).expect("extract rtf"), r"a{b}c\d");
    }

    // ---- guards ------------------------------------------------------------------

    #[test]
    fn zero_byte_input_errors_never_panics() {
        assert!(extract_xlsx_sections(&[]).is_err(), "xlsx: empty must Err");
        assert!(extract_pptx_sections(&[]).is_err(), "pptx: empty must Err");
        assert!(extract_rtf_text(&[]).is_err(), "rtf: empty must Err");
    }

    #[test]
    fn non_zip_non_rtf_garbage_errors() {
        let junk = b"this is neither a zip nor rtf";
        assert!(extract_xlsx_sections(junk).is_err());
        assert!(extract_pptx_sections(junk).is_err());
        assert!(extract_rtf_text(junk).is_err());
    }
}
