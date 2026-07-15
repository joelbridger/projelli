//! Native authority for CRM own-clients-only permissions.

pub mod commands;
pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "permissions",
    module_path: "crate::commands::crm::features::permissions",
};
