//! Wealthbox-to-Lantern migration importer.
//!
//! This module deliberately owns migration-only concerns: verbatim capture,
//! replay-safe landing, fidelity accounting, and the operator-local cutover
//! records.  It does not replace the ordinary read-only connector.

pub mod archive;
pub mod fetchers;
pub mod fidelity;
pub mod pipeline;

pub use archive::*;
pub use fetchers::*;
pub use fidelity::*;
pub use pipeline::*;
