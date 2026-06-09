//! OOXML package (ZIP) read/write + the static "plumbing" parts.
//!
//! A .docx is a ZIP (Open Packaging Conventions) containing XML parts plus
//! two manifests: `[Content_Types].xml` (maps part names -> MIME types) and
//! `_rels/*.rels` (relationship graph). For the spike we hand-author these
//! plumbing parts; the real engine would preserve the originals verbatim so
//! we never drop a part Word cares about (themes, fonts, settings, ...).

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use anyhow::{Context, Result};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// An OOXML package as an ordered map of part name -> raw bytes.
/// Part names are the in-zip paths, e.g. "word/document.xml".
#[derive(Debug, Default, Clone)]
pub struct Package {
    /// BTreeMap keeps a deterministic, reproducible part ordering on write.
    pub parts: BTreeMap<String, Vec<u8>>,
}

impl Package {
    pub fn new() -> Self {
        Package { parts: BTreeMap::new() }
    }

    pub fn insert(&mut self, name: impl Into<String>, bytes: impl Into<Vec<u8>>) {
        self.parts.insert(name.into(), bytes.into());
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.parts.get(name).map(|v| v.as_slice())
    }

    pub fn get_str(&self, name: &str) -> Option<String> {
        self.get(name)
            .map(|b| String::from_utf8_lossy(b).into_owned())
    }

    pub fn contains(&self, name: &str) -> bool {
        self.parts.contains_key(name)
    }

    pub fn part_names(&self) -> impl Iterator<Item = &String> {
        self.parts.keys()
    }

    /// Read a .docx from raw bytes into a `Package`, decompressing every part.
    pub fn read_from_bytes(bytes: &[u8]) -> Result<Self> {
        let reader = Cursor::new(bytes);
        let mut archive = ZipArchive::new(reader).context("open zip archive")?;
        let mut parts = BTreeMap::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).context("read zip entry")?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().to_string();
            let mut buf = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut buf)
                .with_context(|| format!("read part {name}"))?;
            parts.insert(name, buf);
        }
        Ok(Package { parts })
    }

    /// Serialize the package back to .docx bytes.
    ///
    /// Per OPC spec the `[Content_Types].xml` part should be first in the
    /// archive; many readers tolerate any order, but Word is happiest with it
    /// first, so we write it explicitly before the rest.
    pub fn write_to_bytes(&self) -> Result<Vec<u8>> {
        let mut out = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut out);
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

            if let Some(ct) = self.parts.get("[Content_Types].xml") {
                zip.start_file("[Content_Types].xml", opts)
                    .context("start content types")?;
                zip.write_all(ct).context("write content types")?;
            }
            for (name, bytes) in &self.parts {
                if name == "[Content_Types].xml" {
                    continue;
                }
                zip.start_file(name.as_str(), opts)
                    .with_context(|| format!("start part {name}"))?;
                zip.write_all(bytes)
                    .with_context(|| format!("write part {name}"))?;
            }
            zip.finish().context("finish zip")?;
        }
        Ok(out.into_inner())
    }
}

// ---------------------------------------------------------------------------
// Static plumbing parts. Hand-authored for the spike; the real engine
// preserves originals. These are deliberately minimal but spec-correct.
// ---------------------------------------------------------------------------

/// `[Content_Types].xml` declaring the parts we emit (document + comments).
pub const CONTENT_TYPES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>"#;

/// `_rels/.rels` — the package root relationships, pointing at the main
/// document part.
pub const ROOT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

/// `word/_rels/document.xml.rels` — relates the main document to comments.xml.
pub const DOCUMENT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>"#;

/// Names of the parts every minimal track-changes .docx must contain.
pub const REQUIRED_PARTS: &[&str] = &[
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/comments.xml",
];
