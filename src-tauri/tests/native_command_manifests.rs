#[allow(dead_code)]
#[path = "../build_support/native_command_manifest.rs"]
mod native_command_manifest;

use native_command_manifest::{load_registry, render_handler_expression, render_state_initializer};
use std::fs;

fn write_manifest(root: &std::path::Path, relative: &str, body: &str) {
    let path = root
        .join(relative)
        .join(native_command_manifest::MANIFEST_FILE_NAME);
    fs::create_dir_all(path.parent().expect("manifest has a parent")).unwrap();
    fs::write(path, body).unwrap();
}

#[test]
fn discovers_nested_manifests_and_renders_global_order() {
    let directory = tempfile::tempdir().unwrap();
    write_manifest(
        directory.path(),
        "commands/second/features/new-feature",
        "command 30 crate::commands::second::finish\nstate 20 crate::commands::second::manage_state\n",
    );
    write_manifest(
        directory.path(),
        "commands/first",
        "command 10 crate::commands::first::start cfg(debug_assertions)\nstate 10 crate::commands::first::manage_state\n",
    );

    let registry = load_registry(directory.path()).unwrap();
    let handler = render_handler_expression(&registry);
    let states = render_state_initializer(&registry);

    assert!(handler.find("first::start").unwrap() < handler.find("second::finish").unwrap());
    assert!(handler.contains("#[cfg(debug_assertions)]"));
    assert!(
        states.find("first::manage_state").unwrap() < states.find("second::manage_state").unwrap()
    );
}

#[test]
fn duplicate_public_command_names_fail_loudly() {
    let directory = tempfile::tempdir().unwrap();
    write_manifest(
        directory.path(),
        "commands/first",
        "command 10 crate::commands::first::status\n",
    );
    write_manifest(
        directory.path(),
        "commands/second",
        "command 20 crate::commands::second::status\n",
    );

    let error = load_registry(directory.path()).unwrap_err().to_string();
    assert!(error.contains("duplicate public Tauri command name `status`"));
    assert!(error.contains("first declared at"));
}

#[test]
fn duplicate_state_initializers_fail_loudly() {
    let directory = tempfile::tempdir().unwrap();
    write_manifest(
        directory.path(),
        "commands/first",
        "state 10 crate::commands::first::manage_state\nstate 20 crate::commands::first::manage_state\n",
    );

    let error = load_registry(directory.path()).unwrap_err().to_string();
    assert!(error.contains("duplicate state initializer"));
}

#[test]
fn malformed_entries_name_the_manifest_and_line() {
    let directory = tempfile::tempdir().unwrap();
    write_manifest(
        directory.path(),
        "commands/first",
        "# fine\ncommand not-a-number crate::commands::first::start\n",
    );

    let error = load_registry(directory.path()).unwrap_err().to_string();
    assert!(error.contains("command-manifest.txt:2"));
    assert!(error.contains("registration order must be an unsigned integer"));
}
