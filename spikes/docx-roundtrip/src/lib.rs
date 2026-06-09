//! docx-roundtrip — DE-RISKING SPIKE for Keepance 3.0.
//!
//! Proves that faithful Microsoft Word track-changes round-trip is achievable
//! fully in-house using only generic XML/ZIP crates (no document SDK, no
//! cloud service). See the feasibility report in the spike's commit message
//! / NOTES for the verdict and the recommended engine design.
//!
//! Pipeline: .docx bytes -> [`package::Package`] -> [`model::Document`]
//! (revision/comment markup preserved) -> serialize -> .docx bytes.

pub mod author;
pub mod fixture;
pub mod model;
pub mod package;
pub mod parse;
pub mod serialize;
pub mod validate;

use anyhow::Result;
use model::Document;

/// Parse a full .docx byte buffer into the model.
pub fn parse_docx_bytes(bytes: &[u8]) -> Result<Document> {
    let pkg = package::Package::read_from_bytes(bytes)?;
    let document_xml = pkg
        .get_str("word/document.xml")
        .ok_or_else(|| anyhow::anyhow!("missing word/document.xml"))?;
    let comments_xml = pkg.get_str("word/comments.xml");
    parse::parse_document(&document_xml, comments_xml.as_deref())
}

/// Serialize the model back to a full .docx byte buffer.
pub fn serialize_docx_bytes(doc: &Document) -> Result<Vec<u8>> {
    serialize::serialize_to_bytes(doc)
}

/// Full round-trip in memory: bytes -> model -> bytes.
pub fn roundtrip_bytes(bytes: &[u8]) -> Result<Vec<u8>> {
    let doc = parse_docx_bytes(bytes)?;
    serialize_docx_bytes(&doc)
}
