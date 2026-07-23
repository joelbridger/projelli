//! Dark, native-only delivery of one approved meeting task proposal.
//!
//! This feature owns no screen and performs no provider, mail, or network
//! action. Its sole result says whether one encrypted local Task and its
//! encrypted local receipt were created or replayed.

pub mod commands;

pub use commands::*;

use super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "local-meeting-task",
    module_path: "crate::commands::crm::features::local_task",
};
