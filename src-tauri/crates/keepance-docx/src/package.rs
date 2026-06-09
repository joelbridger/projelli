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
    pub fn read_from_bytes(bytes: &[u8]) -> Result<Self> {
        let reader = Cursor::new(bytes);
        let mut archive =
            ZipArchive::new(reader).map_err(|e| DocxError::Package(format!("open zip: {e}")))?;
        let mut parts = BTreeMap::new();
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| DocxError::Package(format!("read zip entry: {e}")))?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().to_string();
            let mut buf = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut buf)
                .map_err(|e| DocxError::Package(format!("read part {name}: {e}")))?;
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

    /// Ensure `[Content_Types].xml` declares an Override for a comments part.
    /// Used when we add a `comments.xml` to a document that previously had
    /// none, so Word recognizes the new part. No-op if already declared or if
    /// there is no content-types part to patch.
    pub fn ensure_comments_content_type(&mut self) {
        let needle = "wordprocessingml.comments+xml";
        let override_xml = "<Override PartName=\"/word/comments.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml\"/>";
        if let Some(ct) = self.get_str(CONTENT_TYPES_PART) {
            if ct.contains(needle) {
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
    }

    /// Ensure `word/_rels/document.xml.rels` relates the main document to
    /// `comments.xml`. Used when adding comments to a document that had none.
    /// Allocates a fresh relationship id. No-op if already related.
    pub fn ensure_comments_relationship(&mut self) {
        let rels_target = "comments.xml";
        let comments_rel_type =
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

        let existing = self.get_str(DOCUMENT_RELS_PART);
        match existing {
            Some(rels) => {
                if rels.contains(comments_rel_type) {
                    return;
                }
                // Allocate an id not already used (rIdN). Scan existing ids.
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

/// Find the next free `rIdN` given an existing rels XML blob.
fn next_rel_id(rels_xml: &str) -> String {
    let mut max = 0u32;
    let mut rest = rels_xml;
    while let Some(pos) = rest.find("Id=\"rId") {
        let after = &rest[pos + "Id=\"rId".len()..];
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>() {
            if n > max {
                max = n;
            }
        }
        rest = &after[digits.len()..];
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
