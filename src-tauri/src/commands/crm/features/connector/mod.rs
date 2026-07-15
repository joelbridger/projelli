//! Existing provider connector commands.
//!
//! This module owns the current Wealthbox, Salesforce, and Redtail connector
//! behavior.  Future local/atomic CRM features belong in sibling modules, not
//! in this connector implementation or the root compatibility facade.

pub mod commands;

pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "connector",
    module_path: "crate::commands::crm::features::connector",
};
