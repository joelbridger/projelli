//! Native, matter-scoped team-activity validation and persistence.

use super::super::CrmFeatureDescriptor;

pub mod commands;
pub use commands::*;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "team-activity-feed",
    module_path: "crate::commands::crm::features::activity",
};
