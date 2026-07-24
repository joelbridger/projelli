//! Append-only registry for feature-owned CRM native commands.
//!
//! New atomic CRM capabilities get their own child module and colocated
//! `command-manifest.txt`.  They must not add implementations to the legacy
//! `crm::commands` compatibility facade.

pub mod activity;
pub mod connector;
pub mod local_task;
pub mod merge;
pub mod teams_roles;
pub mod trash;

/// A small descriptor used by boundary tests and future tooling to enumerate
/// feature-owned native command modules without inspecting their internals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrmFeatureDescriptor {
    pub id: &'static str,
    pub module_path: &'static str,
}

/// Append-only registry of CRM native feature modules.
pub const CRM_FEATURE_REGISTRY: &[CrmFeatureDescriptor] = &[
    activity::FEATURE_DESCRIPTOR,
    connector::FEATURE_DESCRIPTOR,
    local_task::FEATURE_DESCRIPTOR,
    teams_roles::FEATURE_DESCRIPTOR,
    trash::FEATURE_DESCRIPTOR,
    merge::FEATURE_DESCRIPTOR,
];

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn crm_feature_registry_has_unique_stable_ids_and_paths() {
        let mut ids = HashSet::new();
        let mut paths = HashSet::new();

        for feature in CRM_FEATURE_REGISTRY {
            assert!(
                ids.insert(feature.id),
                "duplicate CRM feature id: {}",
                feature.id
            );
            assert!(
                paths.insert(feature.module_path),
                "duplicate CRM feature module path: {}",
                feature.module_path
            );
            assert!(
                feature
                    .module_path
                    .starts_with("crate::commands::crm::features::"),
                "CRM feature modules must live below crm::features"
            );
        }
    }
}
