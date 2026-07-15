#[allow(dead_code)]
#[path = "../build_support/native_command_manifest.rs"]
mod native_command_manifest;

use std::fs;

use native_command_manifest::load_registry;

fn source(relative: &str) -> String {
    fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(relative))
        .unwrap_or_else(|error| panic!("read {relative}: {error}"))
}

#[test]
fn crm_commands_remains_a_small_implementation_free_compatibility_facade() {
    let facade = source("src/commands/crm/commands.rs");
    let line_count = facade.lines().count();

    assert!(
        line_count < 180,
        "CRM compatibility facade grew to {line_count} lines; feature commands belong below crm/features"
    );
    assert!(
        !facade
            .lines()
            .any(|line| line.trim_start().starts_with("#[tauri::command]")),
        "CRM compatibility facade must not regain command implementations"
    );
    assert!(
        facade.contains("pub use super::features::connector::commands::*;"),
        "existing command paths must remain compatibility re-exports"
    );
    assert!(
        facade.contains("pub struct CrmService"),
        "feature commands need the stable CRM service boundary"
    );
}

#[test]
fn crm_feature_registry_owns_the_connector_implementation() {
    let crm_module = source("src/commands/crm/mod.rs");
    let registry = source("src/commands/crm/features/mod.rs");
    let connector = source("src/commands/crm/features/connector/commands.rs");

    assert!(crm_module.contains("pub mod features;"));
    assert!(registry.contains("pub mod connector;"));
    assert!(registry.contains("CRM_FEATURE_REGISTRY"));
    assert!(
        connector.contains("#[tauri::command]"),
        "landed connector commands must have a feature owner"
    );
}

#[test]
fn a_dummy_atomic_feature_manifest_is_discovered_without_touching_the_facade() {
    let directory = tempfile::tempdir().unwrap();
    let crm_root = directory.path().join("commands/crm");
    let atomic_feature = crm_root.join("features/dummy_atomic");
    fs::create_dir_all(&atomic_feature).unwrap();

    fs::write(
        crm_root.join(native_command_manifest::MANIFEST_FILE_NAME),
        "command 10 crate::commands::crm::commands::crm_connect\nstate 10 crate::commands::crm::commands::manage_state\n",
    )
    .unwrap();
    fs::write(
        atomic_feature.join(native_command_manifest::MANIFEST_FILE_NAME),
        "command 20 crate::commands::crm::features::dummy_atomic::dummy_atomic_command\n",
    )
    .unwrap();

    let registry = load_registry(directory.path()).expect("nested CRM feature manifest is valid");
    let paths = registry
        .commands
        .iter()
        .map(|command| command.rust_path.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        paths,
        vec![
            "crate::commands::crm::commands::crm_connect",
            "crate::commands::crm::features::dummy_atomic::dummy_atomic_command",
        ]
    );
    assert!(
        source("src/commands/crm/commands.rs").lines().count() < 180,
        "adding an atomic feature manifest must not grow the compatibility facade"
    );
}
