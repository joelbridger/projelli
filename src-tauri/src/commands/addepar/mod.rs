//! Read-only Addepar connector.
//!
//! Imports household portfolio summaries into encrypted, matter-scoped RAG
//! chunks with `source_type = "addepar"`.

pub mod client;
pub mod commands;
pub mod engine;
pub mod model;
pub mod render;
