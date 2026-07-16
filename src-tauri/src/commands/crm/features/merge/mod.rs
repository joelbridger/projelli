//! Review-first, transactional household duplicate resolution.
//!
//! The module owns only an approved merge's durable mutation and its redacted
//! receipt. It deliberately has no outbound transport or background retry.

pub mod commands;

pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "merge",
    module_path: "crate::commands::crm::features::merge",
};
