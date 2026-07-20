//! Executable proof that the c34 capability-surface narrowing actually BITES at
//! the real enforcement layer (`tauri::scope::fs::Scope::is_allowed`), not just
//! in the config file.
//!
//! This mirrors exactly how `tauri-plugin-fs` builds and checks its scope
//! (see `tauri-plugin-fs-2.5.1/src/commands.rs:1540`): the effective allow-list
//! is the capability's `fs:scope` allow union'd with whatever the runtime adds
//! via `allow_directory`. Because the shipped capability now grants an EMPTY
//! static allow-list, the ONLY thing that is ever reachable is the directory the
//! app grants at workspace-open time (`workspace_grant_fs_scope`). Every other
//! path — the rest of the disk — is refused.
//!
//! `is_allowed` canonicalizes, so all the paths below are real files/dirs.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::scope::fs::Scope;
use tauri::utils::config::FsScope;

/// Read the SHIPPED capability's `fs:scope` allow/deny lists, so this test binds
/// to the real config rather than a hand-copied duplicate.
fn capability_fs_scope() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let raw = fs::read_to_string(manifest.join("capabilities/default.json"))
        .expect("read capability file");
    let json: Value = serde_json::from_str(&raw).expect("parse capability file");
    let perms = json["permissions"].as_array().expect("permissions array");
    let fs_scope = perms
        .iter()
        .find(|p| p.get("identifier").and_then(Value::as_str) == Some("fs:scope"))
        .expect("fs:scope entry present");
    let read_paths = |key: &str| -> Vec<PathBuf> {
        fs_scope[key]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|e| e.get("path").and_then(Value::as_str).map(PathBuf::from))
            .collect()
    };
    (read_paths("allow"), read_paths("deny"))
}

#[test]
fn capability_grants_no_static_filesystem_allow() {
    let (allow, _deny) = capability_fs_scope();
    assert!(
        allow.is_empty(),
        "fs:scope must grant NO static path — the whole-disk **/* grant is removed; found {allow:?}"
    );
}

#[test]
fn narrowed_scope_refuses_out_of_workspace_and_admits_the_workspace() {
    let (allow, deny) = capability_fs_scope();
    let app = tauri::test::mock_app();

    // The effective fs scope the plugin enforces, with require_literal_leading_dot
    // = false (as tauri.conf.json sets it).
    let scope = Scope::new(
        &app,
        &FsScope::Scope {
            allow,
            deny,
            require_literal_leading_dot: Some(false),
        },
    )
    .expect("build fs scope");

    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let outside = tempfile::tempdir().expect("outside tempdir");

    let ws_file = workspace.path().join("client.docx");
    fs::write(&ws_file, b"in-workspace").unwrap();
    let ws_nested_dir = workspace.path().join("Matters").join("Coast");
    fs::create_dir_all(&ws_nested_dir).unwrap();
    let ws_nested = ws_nested_dir.join("transcript.json");
    fs::write(&ws_nested, b"nested").unwrap();
    let ws_dot_dir = workspace.path().join(".trash");
    fs::create_dir_all(&ws_dot_dir).unwrap();
    let ws_dot = ws_dot_dir.join("metadata.json");
    fs::write(&ws_dot, b"dot").unwrap();

    let outside_file = outside.path().join("someone-elses-secret.txt");
    fs::write(&outside_file, b"outside").unwrap();

    // BEFORE the runtime grant: even the in-workspace file is refused, because the
    // static allow-list is empty. This is precisely the migration's premise.
    assert!(
        !scope.is_allowed(&ws_file),
        "with an empty static allow-list and no runtime grant, NOTHING is allowed"
    );

    // The grant that workspace_grant_fs_scope performs on workspace open.
    scope
        .allow_directory(workspace.path(), true)
        .expect("grant workspace");

    // AFTER the grant: the workspace tree is admitted...
    assert!(scope.is_allowed(&ws_file), "granted workspace file must be allowed");
    assert!(scope.is_allowed(&ws_nested), "granted nested workspace file must be allowed");
    assert!(
        scope.is_allowed(&ws_dot),
        "in-workspace dotfile (.trash/metadata.json) must be allowed with require_literal_leading_dot=false"
    );

    // ...and a path OUTSIDE it is still refused. THIS is the narrowing biting.
    assert!(
        !scope.is_allowed(&outside_file),
        "a path outside the granted workspace must be REFUSED"
    );
}

#[test]
fn deny_overrides_a_broad_grant() {
    // Proves the deny mechanism: a denied subtree is refused even when a broad
    // ancestor is granted. Uses controlled temp paths so it is deterministic on
    // every platform.
    let app = tauri::test::mock_app();
    let root = tempfile::tempdir().expect("root tempdir");
    let blocked_dir = root.path().join("blocked");
    fs::create_dir_all(&blocked_dir).unwrap();
    let blocked_file = blocked_dir.join("secret.txt");
    fs::write(&blocked_file, b"secret").unwrap();
    let ok_file = root.path().join("ok.txt");
    fs::write(&ok_file, b"ok").unwrap();

    let deny_pattern = blocked_dir.join("**");
    let scope = Scope::new(
        &app,
        &FsScope::Scope {
            allow: Vec::new(),
            deny: vec![deny_pattern],
            require_literal_leading_dot: Some(false),
        },
    )
    .expect("build fs scope");

    scope.allow_directory(root.path(), true).expect("grant root");

    assert!(scope.is_allowed(&ok_file), "un-denied file under a granted root is allowed");
    assert!(
        !scope.is_allowed(&blocked_file),
        "a denied subtree must be refused even under a broad grant (deny overrides allow)"
    );
}
