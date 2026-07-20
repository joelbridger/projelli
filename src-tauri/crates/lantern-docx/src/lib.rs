//! lantern-docx — the in-house OOXML (.docx) document engine for Lantern 3.0
//! (workstream A). Production promotion of `spikes/docx-roundtrip`.
//!
//! Faithful Microsoft Word round-trip — including **tracked changes** and
//! **comments** — entirely in-house: only generic XML/ZIP/serde crates, no
//! proprietary document SDK, no cloud or SaaS service ever touching the
//! document.
//!
//! # What it does
//!
//! * [`parse_docx_bytes`] / [`open_docx_bytes`] — `.docx` bytes -> typed
//!   [`Document`] DOM, preserving tracked insertions/deletions, comments, run
//!   and paragraph properties, and **every unmodeled part/element verbatim**.
//! * [`serialize_docx_bytes`] / [`OpenedDocument::save_bytes`] — DOM -> `.docx`
//!   bytes, re-emitting modeled content and passing preserved content through
//!   byte-for-byte.
//! * JSON bridge ([`document_to_json`] / [`document_from_json`]) — the DOM
//!   (de)serializes to JSON via serde so the React editor (A3) can consume it.
//! * [`author`] — helpers the AI redliner (A4) calls to add new tracked
//!   changes alongside existing ones.
//! * [`resolve`] — helpers the editor (A3) calls to accept / reject tracked
//!   changes (the inverse of [`author`]).
//!
//! # Preserve-by-default
//!
//! The most important production property: nothing the engine does not model is
//! lost on round-trip. At the **package** level every original part (styles,
//! numbering, theme, fonts, settings, headers/footers, media) is kept as raw
//! bytes; at the **document.xml** level unrecognized elements, paragraph
//! properties, and run properties are captured as raw XML and re-emitted
//! unchanged. See [`OpenedDocument`].

pub mod author;
pub mod error;
pub mod letterhead;
pub mod model;
pub mod package;
pub mod parse;
pub mod resolve;
pub mod scrub;
pub mod serialize;
pub mod text;
pub mod validate;

/// Test-support fixtures (a realistic redlined document + its constants), used
/// by the crate's own integration tests in `tests/`. Public so external test
/// crates can build against the same single-source-of-truth model; it has no
/// runtime cost in production paths because nothing in the library calls it.
pub mod fixture;
pub mod generated_brand;

pub use error::{DocxError, Result};
pub use letterhead::merge_into_template;
pub use model::{
    BlockContent, Comment, Document, Inline, Paragraph, RevisionKind, RevisionMeta, Run,
    DOM_FORMAT_VERSION,
};
pub use package::Package;
pub use resolve::{resolve_all, resolve_revision, ResolveAction};
pub use scrub::{clean_copy_bytes, scrub_package_metadata, ScrubOptions};
pub use text::extract_paragraph_texts;

/// A document opened from `.docx` bytes, carrying both the typed [`Document`]
/// DOM and the *original* [`Package`] it came from.
///
/// Holding the original package is what enables **preserve-by-default on save**:
/// [`save_bytes`](Self::save_bytes) re-serializes only the parts the engine
/// owns (`document.xml`, and `comments.xml` when comments exist) and writes
/// every other original part back byte-for-byte. The frontend edits
/// `self.document` (round-tripped through JSON); the original package stays
/// intact behind it.
#[derive(Debug, Clone)]
pub struct OpenedDocument {
    pub document: Document,
    pub package: Package,
}

impl OpenedDocument {
    /// Open a `.docx` byte buffer: read the package (keeping every part) and
    /// parse the modeled content into the DOM.
    pub fn open_bytes(bytes: &[u8]) -> Result<Self> {
        let package = Package::read_from_bytes(bytes)?;
        let document_xml = package
            .get_str(package::DOCUMENT_PART)
            .ok_or_else(|| DocxError::Package("missing word/document.xml".into()))?;
        let comments_xml = package.get_str(package::COMMENTS_PART);
        let document = parse::parse_document(&document_xml, comments_xml.as_deref())?;
        Ok(OpenedDocument { document, package })
    }

    /// Replace the DOM with an edited one (e.g. coming back from the editor as
    /// JSON), keeping the original package for preservation.
    pub fn with_document(mut self, document: Document) -> Self {
        self.document = document;
        self
    }

    /// Serialize back to `.docx` bytes, preserving every unmodeled original
    /// part byte-for-byte. P2.3 row 10: uses the copy-on-write serialize path
    /// (`serialize_into_bytes`) so the common body-edit save streams the original
    /// parts instead of cloning the whole package. Output is byte-identical to the
    /// prior `serialize_into_package(..).write_to_bytes()`.
    pub fn save_bytes(&self) -> Result<Vec<u8>> {
        serialize::serialize_into_bytes(&self.document, &self.package)
    }

    /// Serialize a privilege-safe **clean copy** to `.docx` bytes: strip hidden
    /// identifying metadata (`docProps/core.xml` + `docProps/app.xml`) and,
    /// optionally, accept all tracked changes and drop comments. Preserves every
    /// other unmodeled part byte-for-byte. Does not mutate `self`. See
    /// [`scrub::clean_copy_bytes`].
    pub fn clean_copy_bytes(&self, options: scrub::ScrubOptions) -> Result<Vec<u8>> {
        scrub::clean_copy_bytes(self, options)
    }
}

/// Parse a `.docx` byte buffer into the DOM (discarding the original package).
/// Prefer [`OpenedDocument::open_bytes`] when you intend to save the result, so
/// preserve-by-default works on the way back out.
pub fn parse_docx_bytes(bytes: &[u8]) -> Result<Document> {
    Ok(OpenedDocument::open_bytes(bytes)?.document)
}

/// Open a `.docx` byte buffer into an [`OpenedDocument`] (DOM + original
/// package).
pub fn open_docx_bytes(bytes: &[u8]) -> Result<OpenedDocument> {
    OpenedDocument::open_bytes(bytes)
}

/// Serialize a DOM that has **no** source package into a fresh `.docx` byte
/// buffer (synthesizes minimal plumbing). For documents opened from bytes,
/// use [`OpenedDocument::save_bytes`] to preserve original parts.
pub fn serialize_docx_bytes(doc: &Document) -> Result<Vec<u8>> {
    serialize::serialize_new_package(doc)?.write_to_bytes()
}

/// Full in-memory round-trip preserving the original package: bytes -> DOM ->
/// bytes. Unmodeled parts and elements survive byte-for-byte.
pub fn roundtrip_bytes(bytes: &[u8]) -> Result<Vec<u8>> {
    OpenedDocument::open_bytes(bytes)?.save_bytes()
}

// ---------------------------------------------------------------------------
// JSON bridge (for the React editor — task A3)
// ---------------------------------------------------------------------------

/// Serialize the DOM to a JSON string for the frontend.
pub fn document_to_json(doc: &Document) -> Result<String> {
    Ok(serde_json::to_string(doc)?)
}

/// Serialize the DOM to a pretty JSON string (debugging / fixtures).
pub fn document_to_json_pretty(doc: &Document) -> Result<String> {
    Ok(serde_json::to_string_pretty(doc)?)
}

/// Deserialize the DOM from a JSON string sent by the frontend.
pub fn document_from_json(json: &str) -> Result<Document> {
    Ok(serde_json::from_str(json)?)
}

/// Serialize the DOM to a `serde_json::Value` (for Tauri commands that return
/// JSON directly rather than a string).
pub fn document_to_value(doc: &Document) -> Result<serde_json::Value> {
    Ok(serde_json::to_value(doc)?)
}

/// Deserialize the DOM from a `serde_json::Value` (from a Tauri command arg).
pub fn document_from_value(value: serde_json::Value) -> Result<Document> {
    Ok(serde_json::from_value(value)?)
}
