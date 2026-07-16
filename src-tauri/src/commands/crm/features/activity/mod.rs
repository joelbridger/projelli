//! Native ownership marker for the team activity feed.
//!
//! Activity records use the canonical transactional CRM live-record boundary.
//! This module intentionally exposes no alternate renderer command or store.

use super::super::CrmFeatureDescriptor;

pub const FEATURE_DESCRIPTOR: CrmFeatureDescriptor = CrmFeatureDescriptor {
    id: "team-activity-feed",
    module_path: "crate::commands::crm::features::activity",
};
