//! Public error type for the engine.
//!
//! The Tauri command layer maps these to user-facing strings without leaking
//! internals. We keep variants coarse on purpose — the consumer only needs to
//! distinguish "the file isn't a valid .docx" from "we couldn't read it" from
//! "the JSON the editor sent is malformed".

use thiserror::Error;

/// Errors the engine can surface to its callers.
#[derive(Debug, Error)]
pub enum DocxError {
    /// I/O failure reading or writing a file on disk.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// The bytes are not a readable OOXML package (bad ZIP, missing the main
    /// document part, etc.).
    #[error("invalid .docx package: {0}")]
    Package(String),

    /// `word/document.xml` (or `comments.xml`) was malformed XML.
    #[error("malformed document XML: {0}")]
    Xml(String),

    /// The JSON DOM sent by the editor could not be (de)serialized.
    #[error("invalid document JSON: {0}")]
    Json(#[from] serde_json::Error),
}

/// Engine result alias.
pub type Result<T> = std::result::Result<T, DocxError>;
