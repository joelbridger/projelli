//! OOXML package (ZIP / Open Packaging Conventions) read/write, with
//! **package-level preserve-by-default**.
//!
//! A .docx is a ZIP of XML parts plus two manifests: `[Content_Types].xml`
//! (part name -> MIME type) and `_rels/*.rels` (the relationship graph). The
//! spike hand-authored these and emitted only `document.xml` + `comments.xml`,
//! silently dropping every other part (styles, numbering, theme, fonts,
//! settings, headers/footers, media). For real legal documents that is
//! unacceptable data loss.
//!
//! The production rule: **read every part into memory and keep it.** On write,
//! re-serialize only the parts we actually model (`word/document.xml`, and
//! `word/comments.xml` when comments exist); every other part — including the
//! original `[Content_Types].xml` and all rels — is written back byte-for-byte.
//! When building a brand-new document from scratch (no source package) we
//! synthesize a minimal but spec-correct set of plumbing parts.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{DocxError, Result};

// Decompression-bomb defenses for untrusted .docx input. A .docx is an
// attacker-controllable ZIP; its per-entry uncompressed-size header is NOT
// trustworthy, so we never allocate or read based on it alone. We cap (a) the
// number of entries, (b) any single entry's decompressed size, and (c) the
// total decompressed bytes across all entries as a running budget. This mirrors
// the rigor of `src-tauri/src/commands/tarball.rs` for untrusted archives. See
// also `read_from_bytes_with_limits`.

/// Maximum total decompressed bytes across every entry in one package. A
/// generous ceiling for real legal documents (large embedded media + many
/// parts) while bounding a zip bomb to a fixed, recoverable allocation.
pub const MAX_TOTAL_DECOMPRESSED: u64 = 512 * 1024 * 1024; // 512 MiB
/// Maximum decompressed bytes for any single entry.
pub const MAX_ENTRY_DECOMPRESSED: u64 = 256 * 1024 * 1024; // 256 MiB
/// Maximum number of entries in one package (defends against a zip with
/// millions of tiny entries exhausting memory / time).
pub const MAX_ENTRY_COUNT: usize = 10_000;

/// Caps applied while decompressing an untrusted package. Use
/// [`Limits::default`] (production ceilings) for real input;
/// [`Package::read_from_bytes_with_limits`] lets tests assert the guard fires
/// with small caps, without allocating gigabytes.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Cap on total decompressed bytes summed across all entries.
    pub max_total_decompressed: u64,
    /// Cap on any one entry's decompressed bytes.
    pub max_entry_decompressed: u64,
    /// Cap on the number of (non-directory) entries.
    pub max_entry_count: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_total_decompressed: MAX_TOTAL_DECOMPRESSED,
            max_entry_decompressed: MAX_ENTRY_DECOMPRESSED,
            max_entry_count: MAX_ENTRY_COUNT,
        }
    }
}

/// The main document part name.
pub const DOCUMENT_PART: &str = "word/document.xml";
/// The comments part name.
pub const COMMENTS_PART: &str = "word/comments.xml";
/// The content-types manifest part name.
pub const CONTENT_TYPES_PART: &str = "[Content_Types].xml";
/// The package root relationships part name.
pub const ROOT_RELS_PART: &str = "_rels/.rels";
/// The main document's relationships part name.
pub const DOCUMENT_RELS_PART: &str = "word/_rels/document.xml.rels";

/// An OOXML package: an ordered map of part name -> raw bytes. Part names are
/// the in-zip paths, e.g. `"word/document.xml"`.
#[derive(Debug, Default, Clone)]
pub struct Package {
    /// BTreeMap keeps a deterministic, reproducible part ordering on write.
    pub parts: BTreeMap<String, Vec<u8>>,
}

impl Package {
    pub fn new() -> Self {
        Package {
            parts: BTreeMap::new(),
        }
    }

    pub fn insert(&mut self, name: impl Into<String>, bytes: impl Into<Vec<u8>>) {
        self.parts.insert(name.into(), bytes.into());
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.parts.get(name).map(|v| v.as_slice())
    }

    pub fn get_str(&self, name: &str) -> Option<String> {
        self.get(name).map(|b| String::from_utf8_lossy(b).into_owned())
    }

    pub fn contains(&self, name: &str) -> bool {
        self.parts.contains_key(name)
    }

    pub fn part_names(&self) -> impl Iterator<Item = &String> {
        self.parts.keys()
    }

    /// Read a .docx from raw bytes into a `Package`, decompressing every part.
    /// Every part — modeled or not — is retained, which is the foundation of
    /// preserve-by-default.
    ///
    /// Decompression-bomb safe: the bytes are untrusted, so production
    /// [`Limits`] bound the entry count, per-entry size, and total decompressed
    /// size. We never trust the ZIP's `uncompressed_size` header for allocation
    /// or reading — see [`read_from_bytes_with_limits`](Self::read_from_bytes_with_limits).
    pub fn read_from_bytes(bytes: &[u8]) -> Result<Self> {
        Self::read_from_bytes_with_limits(bytes, Limits::default())
    }

    /// Like [`read_from_bytes`](Self::read_from_bytes) but with explicit
    /// [`Limits`]. Tests use small caps to prove the decompression-bomb guard
    /// fires without allocating gigabytes; production uses [`Limits::default`].
    ///
    /// RELIED-UPON PROPERTY: `zip` only decompresses on read, and we read each
    /// entry through `Read::take(budget)`, so a lying uncompressed-size header
    /// cannot make us allocate or read more than the running budget. The
    /// `with_capacity` hint is clamped to the budget for the same reason.
    pub fn read_from_bytes_with_limits(bytes: &[u8], limits: Limits) -> Result<Self> {
        let reader = Cursor::new(bytes);
        let mut archive =
            ZipArchive::new(reader).map_err(|e| DocxError::Package(format!("open zip: {e}")))?;

        if archive.len() > limits.max_entry_count {
            return Err(DocxError::Package(format!(
                "too many entries: {} (max {})",
                archive.len(),
                limits.max_entry_count
            )));
        }

        let mut parts = BTreeMap::new();
        // Running budget of total decompressed bytes still allowed across all
        // remaining entries. Starts at the total cap and is debited per entry.
        let mut total_remaining = limits.max_total_decompressed;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| DocxError::Package(format!("read zip entry: {e}")))?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().to_string();

            // Per-entry budget: the smaller of the per-entry cap and whatever
            // total budget is left. We read at most `budget + 1` bytes so that
            // an entry which would exactly fill (or overflow) the budget is
            // detected rather than silently truncated.
            let entry_budget = limits.max_entry_decompressed.min(total_remaining);
            // Clamp the allocation hint: never trust the (attacker-controlled)
            // uncompressed-size header — cap it at the budget.
            let cap_hint = file.size().min(entry_budget).min(usize::MAX as u64) as usize;
            let mut buf = Vec::with_capacity(cap_hint);

            // `take` bounds the read regardless of the declared size.
            let read = (&mut file)
                .take(entry_budget.saturating_add(1))
                .read_to_end(&mut buf)
                .map_err(|e| DocxError::Package(format!("read part {name}: {e}")))?
                as u64;

            if read > entry_budget {
                return Err(DocxError::Package(format!(
                    "decompression-bomb guard: entry {name} exceeds size limit \
                     (per-entry {} bytes, remaining total budget {} bytes)",
                    limits.max_entry_decompressed, total_remaining
                )));
            }
            // Debit the running total budget (read <= entry_budget <= total_remaining).
            total_remaining -= read;

            parts.insert(name, buf);
        }

        if !parts.contains_key(DOCUMENT_PART) {
            return Err(DocxError::Package(format!(
                "not a Word document: missing {DOCUMENT_PART}"
            )));
        }
        Ok(Package { parts })
    }

    /// Serialize the package back to .docx bytes.
    ///
    /// Per OPC spec the `[Content_Types].xml` part should be first in the
    /// archive; many readers tolerate any order but Word is happiest with it
    /// first, so we write it explicitly before the rest. The remaining parts
    /// are written in deterministic (BTreeMap) order for stable, diffable
    /// output.
    pub fn write_to_bytes(&self) -> Result<Vec<u8>> {
        let mut out = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut out);
            let opts =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

            if let Some(ct) = self.parts.get(CONTENT_TYPES_PART) {
                zip.start_file(CONTENT_TYPES_PART, opts)
                    .map_err(|e| DocxError::Package(format!("start content types: {e}")))?;
                zip.write_all(ct)
                    .map_err(|e| DocxError::Package(format!("write content types: {e}")))?;
            }
            for (name, bytes) in &self.parts {
                if name == CONTENT_TYPES_PART {
                    continue;
                }
                zip.start_file(name.as_str(), opts)
                    .map_err(|e| DocxError::Package(format!("start part {name}: {e}")))?;
                zip.write_all(bytes)
                    .map_err(|e| DocxError::Package(format!("write part {name}: {e}")))?;
            }
            zip.finish()
                .map_err(|e| DocxError::Package(format!("finish zip: {e}")))?;
        }
        Ok(out.into_inner())
    }

    /// Copy-on-write serialize: write to `.docx` bytes substituting `overrides`
    /// for the matching parts (and adding any override part not already present),
    /// WITHOUT cloning the whole package. Byte-for-byte identical to
    /// `{ let mut p = self.clone(); for (k, v) in overrides { p.insert(k, v); } p.write_to_bytes() }`
    /// — same content-types-first ordering, same BTreeMap part order — but it
    /// never duplicates the (potentially large) unmodified parts (media, fonts,
    /// theme). This is the P2.3 row 10 save hot path: a body edit overrides only
    /// `word/document.xml`, so every other part is streamed straight from `self`.
    pub fn write_to_bytes_with_overrides(
        &self,
        overrides: &BTreeMap<String, Vec<u8>>,
    ) -> Result<Vec<u8>> {
        // Resolve a part's bytes: an override wins over the original.
        let bytes_for = |name: &str| -> Option<&[u8]> {
            overrides
                .get(name)
                .map(|v| v.as_slice())
                .or_else(|| self.get(name))
        };

        let mut out = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut out);
            let opts =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

            // Content-types first (OPC spec / Word preference), exactly as
            // `write_to_bytes`.
            if let Some(ct) = bytes_for(CONTENT_TYPES_PART) {
                zip.start_file(CONTENT_TYPES_PART, opts)
                    .map_err(|e| DocxError::Package(format!("start content types: {e}")))?;
                zip.write_all(ct)
                    .map_err(|e| DocxError::Package(format!("write content types: {e}")))?;
            }

            // Then the union of original + override part names, in BTreeMap
            // (sorted) order — the same order `write_to_bytes` produces after a
            // clone+insert. Only the small name strings are collected, never the
            // byte buffers.
            let mut names: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
            for k in self.parts.keys() {
                names.insert(k.as_str());
            }
            for k in overrides.keys() {
                names.insert(k.as_str());
            }
            for name in names {
                if name == CONTENT_TYPES_PART {
                    continue;
                }
                let bytes = bytes_for(name).expect("name came from one of the two maps");
                zip.start_file(name, opts)
                    .map_err(|e| DocxError::Package(format!("start part {name}: {e}")))?;
                zip.write_all(bytes)
                    .map_err(|e| DocxError::Package(format!("write part {name}: {e}")))?;
            }
            zip.finish()
                .map_err(|e| DocxError::Package(format!("finish zip: {e}")))?;
        }
        Ok(out.into_inner())
    }

    /// Ensure `[Content_Types].xml` declares an Override for the comments part.
    /// Used when we add a `comments.xml` to a document that previously had
    /// none, so Word recognizes the new part. No-op if already declared or if
    /// there is no content-types part to patch.
    ///
    /// The "already declared" check is ANCHORED on an `<Override>` whose
    /// `PartName` is exactly `/word/comments.xml` (parsed with quick-xml), not a
    /// loose substring of the content-type string — so an unrelated mention of
    /// the comments MIME type can't cause us to skip a needed Override.
    pub fn ensure_comments_content_type(&mut self) {
        let override_xml = "<Override PartName=\"/word/comments.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml\"/>";
        let Some(ct) = self.get_str(CONTENT_TYPES_PART) else {
            return;
        };
        if content_types_has_override(&ct, "/word/comments.xml") {
            return;
        }
        if let Some(idx) = ct.rfind("</Types>") {
            let mut patched = String::with_capacity(ct.len() + override_xml.len());
            patched.push_str(&ct[..idx]);
            patched.push_str(override_xml);
            patched.push_str(&ct[idx..]);
            self.insert(CONTENT_TYPES_PART, patched.into_bytes());
        }
    }

    /// Ensure `word/_rels/document.xml.rels` relates the main document to
    /// `comments.xml`. Used when adding comments to a document that had none.
    /// Allocates a fresh relationship id. No-op if already related.
    ///
    /// The "already related" check is anchored on a `<Relationship>` whose
    /// `Type` is exactly the comments relationship type (parsed with quick-xml),
    /// and the new id is computed by [`next_rel_id`] which tolerates quote/space
    /// variants and ignores non-`rId` ids.
    pub fn ensure_comments_relationship(&mut self) {
        let rels_target = "comments.xml";
        let comments_rel_type =
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

        match self.get_str(DOCUMENT_RELS_PART) {
            Some(rels) => {
                if rels_has_relationship_type(&rels, comments_rel_type) {
                    return;
                }
                let next_id = next_rel_id(&rels);
                let rel = format!(
                    "<Relationship Id=\"{next_id}\" Type=\"{comments_rel_type}\" Target=\"{rels_target}\"/>"
                );
                if let Some(idx) = rels.rfind("</Relationships>") {
                    let mut patched = String::with_capacity(rels.len() + rel.len());
                    patched.push_str(&rels[..idx]);
                    patched.push_str(&rel);
                    patched.push_str(&rels[idx..]);
                    self.insert(DOCUMENT_RELS_PART, patched.into_bytes());
                }
            }
            None => {
                // No document rels at all — synthesize a minimal one.
                let rels = format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"{comments_rel_type}\" Target=\"{rels_target}\"/></Relationships>"
                );
                self.insert(DOCUMENT_RELS_PART, rels.into_bytes());
            }
        }
    }
}

/// Local name (after any `:` prefix) of a raw qualified-name byte slice.
fn local_of_bytes(b: &[u8]) -> &str {
    let l = match b.iter().position(|&c| c == b':') {
        Some(i) => &b[i + 1..],
        None => b,
    };
    std::str::from_utf8(l).unwrap_or("")
}

/// Read an attribute value by its (prefix-insensitive) local name from a start
/// tag. Quote style and surrounding whitespace are handled by the XML parser.
fn attr_value(e: &quick_xml::events::BytesStart, want_local: &str) -> Option<String> {
    e.attributes().with_checks(false).flatten().find_map(|a| {
        if local_of_bytes(a.key.as_ref()) == want_local {
            Some(String::from_utf8_lossy(&a.value).into_owned())
        } else {
            None
        }
    })
}

/// True if `[Content_Types].xml` contains an `<Override>` whose `PartName`
/// equals `part_name` exactly. Parsed (not substring-matched) so it is robust to
/// attribute order, quote style, and incidental mentions of the MIME type.
fn content_types_has_override(ct_xml: &str, part_name: &str) -> bool {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut reader = Reader::from_str(ct_xml);
    reader.config_mut().trim_text(false);
    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) | Ok(Event::Start(e))
                if local_of_bytes(e.name().as_ref()) == "Override" =>
            {
                if attr_value(&e, "PartName").as_deref() == Some(part_name) {
                    return true;
                }
            }
            Ok(Event::Eof) => return false,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

/// True if a `.rels` manifest contains a `<Relationship>` whose `Type` equals
/// `rel_type` exactly. Parsed rather than substring-matched.
fn rels_has_relationship_type(rels_xml: &str, rel_type: &str) -> bool {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut reader = Reader::from_str(rels_xml);
    reader.config_mut().trim_text(false);
    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) | Ok(Event::Start(e))
                if local_of_bytes(e.name().as_ref()) == "Relationship" =>
            {
                if attr_value(&e, "Type").as_deref() == Some(rel_type) {
                    return true;
                }
            }
            Ok(Event::Eof) => return false,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

/// Find the next free `rIdN` given an existing `.rels` XML blob.
///
/// Parses each `<Relationship Id="...">` with quick-xml (so quote/space variants
/// are handled by the parser), takes only ids of the form `rId<digits>`,
/// ignoring non-`rId` ids (e.g. GUID-style ids some producers use), and returns
/// `rId(max+1)`. If no `rId<digits>` id is present, returns `rId1`.
fn next_rel_id(rels_xml: &str) -> String {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut reader = Reader::from_str(rels_xml);
    reader.config_mut().trim_text(false);
    let mut max = 0u32;
    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) | Ok(Event::Start(e))
                if local_of_bytes(e.name().as_ref()) == "Relationship" =>
            {
                if let Some(id) = attr_value(&e, "Id") {
                    if let Some(digits) = id.strip_prefix("rId") {
                        if let Ok(n) = digits.parse::<u32>() {
                            max = max.max(n);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    format!("rId{}", max + 1)
}

// ---------------------------------------------------------------------------
// Plumbing parts synthesized ONLY when building a brand-new document with no
// source package. For any imported document these are preserved verbatim and
// never touched.
// ---------------------------------------------------------------------------

/// Minimal `[Content_Types].xml` for a new document (document + comments).
pub const NEW_CONTENT_TYPES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>"#;

/// Minimal `_rels/.rels` for a new document.
pub const NEW_ROOT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

/// Minimal `word/_rels/document.xml.rels` for a new document (relates to comments).
pub const NEW_DOCUMENT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>"#;
