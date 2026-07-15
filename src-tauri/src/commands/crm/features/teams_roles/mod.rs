//! Atomic teams-and-roles CRM commands.

pub mod commands;
pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "teams-roles",
    module_path: "crate::commands::crm::features::teams_roles",
};
