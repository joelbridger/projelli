//! Dark native-only delivery of one approved meeting Task proposal.

pub mod commands;

pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "local-meeting-task",
    module_path: "crate::commands::crm::features::local_task",
};
