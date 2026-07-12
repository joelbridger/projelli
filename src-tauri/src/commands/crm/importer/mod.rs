//! Wealthbox-to-Lantern migration importer.
//!
//! This module deliberately owns migration-only concerns: verbatim capture,
//! replay-safe landing, fidelity accounting, and the operator-local cutover
//! records.  It does not replace the ordinary read-only connector.

pub mod archive;
pub mod export;
pub mod fetchers;
pub mod fidelity;
pub mod pipeline;

pub use archive::*;
pub use export::*;
pub use fetchers::*;
pub use fidelity::*;
pub use pipeline::*;

// The Layer-4 drive talks to the Bun Wealthbox simulator through the real
// client. It is intentionally test-only: production import orchestration is
// owned by the command layer, while this module guards the frozen fidelity
// contract end to end.
#[cfg(test)]
mod fidelity_drive;
