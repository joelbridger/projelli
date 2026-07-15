//! Atomic CRM trash and recovery commands.
//!
//! This feature is the single native soft-delete path for future CRM delete
//! lanes. It owns the recovery snapshot, 30-day retention window, and the
//! deny-by-default permanent-purge boundary.

pub mod commands;

pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "trash",
    module_path: "crate::commands::crm::features::trash",
};
