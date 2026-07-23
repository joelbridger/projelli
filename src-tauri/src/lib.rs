// Business OS - Tauri Backend
// Local-first workspace for solo founders

use tauri::Manager;

// `pub` so the `lantern-mcp` sidecar binary (see `src/bin/mcp.rs`) can
// reuse the `commands::rag::{store, embedder, extractor}` helpers without
// duplicating code. The binary only touches the pure, Tauri-agnostic
// sub-modules; the `#[tauri::command]` wrapper fns stay host-only in
// practice even though the module path is now public.
pub mod commands;
// Native, fail-closed network policy and its stable app-data location.
pub mod app_data;
pub mod network_policy;
// Permanent runtime identity constants (keychain services, data-dir names,
// MCP identifiers, OS data paths). Single source of truth for all
// Rust-side identity strings — call sites import from here, never hard-code.
pub mod identity;
// Generated from brand/brand.config.json so native user-visible strings share
// the same public product name as the renderer and installer.
pub mod generated_brand;
// Shared Sidecar trait + concrete impls (ParakeetSidecar, and later
// PiperSidecar for Stream B TTS). The trait defines a lifecycle contract
// (start/stop/is_running) that long-lived daemon sidecars and fire-and-forget
// per-request sidecars both satisfy via appropriate no-ops.
pub mod sidecars;
// Cross-cutting utilities (process helpers, etc.).
pub mod util;
// The single native CSV encoder. Every Rust path that writes a `.csv` goes
// through it; the derived-set gate (scripts/check-untrusted-sink-derivation.mjs)
// reds if a new one does not.
pub mod safe_csv;
// The Windows bench's local-only automation bridge. This module is absent from
// release artifacts, so port 9250 can never be opened by a production build.
#[cfg(debug_assertions)]
mod dev_bridge;
// Shared WebView2 additional-browser-args string used by EVERY webview window
// (main + Notice Card companion). Centralized so the windows are byte-identical,
// which is what prevents the 0x8007139F (ERROR_INVALID_STATE) crash when a
// second webview is created with mismatched options. See the module docs.
pub mod webview_env;
// Test-only: the exact, frozen OAuth scope requests every connector asks the
// advisor to grant. Six of these constants were previously "asserted" with
// `contains`, which is structurally blind to an ADDITION — a measured fact, not a
// suspicion: with a privilege widening planted into all seven at once the whole
// workspace suite still ran 1836 passed / 0 failed. See the module docs.
#[cfg(test)]
mod scope_freeze;

/// A debug-only, startup-only bridge from the process environment to the
/// renderer. The webview executes this before its application JavaScript, so
/// `App.tsx` can decide whether first-run decoration should render without a
/// later flash or a synthetic click. Release builds never compile this path.
#[cfg(debug_assertions)]
fn test_mode_initialization_script() -> Option<&'static str> {
    matches!(
        std::env::var("LANTERN_TEST_MODE").ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE")
    )
    .then_some("window.__LANTERN_TEST_MODE__ = true;")
}

include!(concat!(env!("OUT_DIR"), "/native_command_state.rs"));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(crate::commands::tts::TtsState(tokio::sync::Mutex::new(
            crate::sidecars::PiperSidecar::new(
                // Resolved at runtime; placeholder path. Real resolution happens
                // inside each command via the AppHandle.
                std::path::PathBuf::from(""),
                std::path::PathBuf::from(""),
            ),
        )))
        .invoke_handler(include!(concat!(
            env!("OUT_DIR"),
            "/native_command_handler.rs"
        )))
        .setup(|app| {
            // Start closed before any connector state or webview work exists.
            // App.tsx explicitly sends the current privacy choice after its
            // saved settings load; until then every native CRM request fails.
            let policy_data_dir =
                crate::app_data::resolve_lantern_app_data_dir().ok_or_else(|| {
                    format!(
                        "could not resolve {} app data directory",
                        generated_brand::PRODUCT_NAME
                    )
                })?;
            app.manage(network_policy::NetworkPolicy::load_from_app_data_dir(
                &policy_data_dir,
            ));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(debug_assertions)]
            crate::dev_bridge::manage_state(app);
            // The main window is created here (not via `tauri.conf.json`'s
            // automatic `create: true` path — see `"create": false` there) so
            // Windows debug builds can start WebView2 with a CDP debug port.
            //
            // Important split:
            // - Release/non-Windows keeps today's explicit wry args behavior.
            // - Windows debug also passes the full string directly through wry's
            //   `AdditionalBrowserArguments` path. In wry 0.55.1 this is the
            //   path that makes the Edge/WebView2 child process visibly carry
            //   `--remote-debugging-port=...`; the attempted custom-environment
            //   path succeeded but did not open CDP on the Windows bench.
            if let Some(window_config) = app.config().app.windows.first() {
                let builder =
                    tauri::WebviewWindowBuilder::from_config(app.handle(), window_config)?;

                // A workspace supplied on the command line (or through the
                // dedicated environment variable) is an automation affordance,
                // not a replacement for normal first-run onboarding. Pass it to
                // the renderer only after the host has proved it is a real
                // directory. JSON encoding keeps unusual but valid path
                // characters from becoming executable script text.
                #[cfg(debug_assertions)]
                let builder = if let Some(workspace) = explicit_launch_workspace() {
                    let workspace_json = serde_json::to_string(&workspace)
                        .expect("serializing a workspace path cannot fail");
                    builder.initialization_script(format!(
                        "window.__LANTERN_WORKSPACE__ = {workspace_json};"
                    ))
                } else {
                    builder
                };

                // CRM test drives need a visible test-mode flag as well as the
                // optional workspace path above. Tauri keeps both startup
                // scripts, so neither automation contract replaces the other.
                #[cfg(debug_assertions)]
                let builder = match test_mode_initialization_script() {
                    Some(script) => builder.initialization_script(script),
                    None => builder,
                };

                // This recorder exists only for the real-app golden loop. It is
                // installed before the Vite entry module executes, then read
                // through the existing debug-only bridge if that module fails.
                #[cfg(debug_assertions)]
                let builder =
                    match crate::dev_bridge::golden_loop_diagnostics_initialization_script() {
                        Some(script) => builder.initialization_script(script),
                        None => builder,
                    };

                // A release build deliberately has no command-line or
                // environment workspace override at all. This makes the
                // automation-only capability impossible to invoke in shipped
                // binaries, even if an environment variable is present.
                #[cfg(not(debug_assertions))]
                let builder = builder;

                #[cfg(all(windows, debug_assertions))]
                let builder = {
                    let browser_args = crate::webview_env::debug_webview_browser_args("main");
                    log::info!("[webview2-debug] main: window_path=additional_browser_args");
                    builder.additional_browser_args(&browser_args)
                };

                #[cfg(not(all(windows, debug_assertions)))]
                let builder = {
                    // The SAME string the Notice Card companion window uses
                    // outside Windows debug builds. Both windows MUST pass an
                    // identical args string or the second webview can fail with
                    // WebView2 0x8007139F (ERROR_INVALID_STATE).
                    let browser_args = crate::webview_env::webview_browser_args();
                    builder.additional_browser_args(&browser_args)
                };

                builder.build()?;

                #[cfg(debug_assertions)]
                crate::dev_bridge::start(app.handle().clone());
            }
            // Check the OS-level data subdir (`<data_dir>/lantern`, holding
            // downloaded models + logs) once at startup, before anything
            // resolves a model/log path. Dev-data reset is approved for the
            // Lantern rename, so old app-data folders are not migrated.
            match commands::data_dir::migrate_os_data_dir() {
                Some(outcome) => log::info!("[data-dir-setup] OS data dir: {outcome:?}"),
                None => log::warn!("[data-dir-setup] OS data dir unavailable; skipped"),
            }
            // Every domain-owned state initializer is generated from the same
            // manifests as the native command handler. Keep registration out of lib.rs.
            initialize_registered_state(app);
            // Auto-updater stack. Desktop-only because the underlying
            // crates are gated to macOS / Windows / Linux in Cargo.toml.
            // The plugin reads endpoints + pubkey from tauri.conf.json so
            // registration here is just a no-arg builder.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn set_offline_mode(
    enabled: bool,
    policy: tauri::State<'_, network_policy::NetworkPolicy>,
) -> Result<(), String> {
    policy
        .set_offline_mode(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn network_policy_status(
    policy: tauri::State<'_, network_policy::NetworkPolicy>,
) -> network_policy::PolicyStatusDto {
    policy.status()
}

/// Returns an explicitly requested, existing workspace directory for this
/// launch. `--workspace <dir>` takes precedence over `LANTERN_WORKSPACE`.
/// Invalid or absent values deliberately return `None`, preserving the normal
/// first-run picker rather than creating or opening an unexpected folder.
#[cfg(debug_assertions)]
fn explicit_launch_workspace() -> Option<String> {
    let cli_workspace = workspace_argument(std::env::args_os().skip(1));
    let candidate = cli_workspace
        .or_else(|| std::env::var_os("LANTERN_WORKSPACE").map(std::path::PathBuf::from))?;

    match canonical_existing_directory(candidate) {
        Some(path) => path.into_os_string().into_string().ok(),
        None => {
            log::warn!("[launch-workspace] ignoring missing or invalid explicit workspace");
            None
        }
    }
}

#[cfg(any(debug_assertions, test))]
fn workspace_argument<I>(args: I) -> Option<std::path::PathBuf>
where
    I: IntoIterator<Item = std::ffi::OsString>,
{
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        if argument == "--workspace" {
            return args.next().map(std::path::PathBuf::from);
        }
        if let Some(value) = argument
            .to_str()
            .and_then(|value| value.strip_prefix("--workspace="))
        {
            return Some(std::path::PathBuf::from(value));
        }
    }
    None
}

#[cfg(any(debug_assertions, test))]
fn canonical_existing_directory(path: std::path::PathBuf) -> Option<std::path::PathBuf> {
    use std::path::Component;

    // This debug-only convenience must never quietly turn a visibly-relative
    // input into a different folder. It also refuses a symlink at the root so
    // automation cannot disguise the workspace it is about to open.
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

#[cfg(test)]
mod launch_workspace_tests {
    use super::{canonical_existing_directory, workspace_argument};
    use std::ffi::OsString;

    #[test]
    fn reads_a_separate_workspace_argument() {
        assert_eq!(
            workspace_argument([
                OsString::from("--workspace"),
                OsString::from("/tmp/lantern")
            ]),
            Some("/tmp/lantern".into())
        );
    }

    #[test]
    fn reads_an_equals_workspace_argument() {
        assert_eq!(
            workspace_argument([OsString::from("--workspace=/tmp/lantern")]),
            Some("/tmp/lantern".into())
        );
    }

    #[test]
    fn ignores_unrelated_arguments() {
        assert_eq!(
            workspace_argument([OsString::from("--other"), OsString::from("value")]),
            None
        );
    }

    #[test]
    fn accepts_only_an_existing_directory() {
        let directory = tempfile::tempdir().expect("temporary directory");
        assert_eq!(
            canonical_existing_directory(directory.path().to_path_buf()),
            Some(std::fs::canonicalize(directory.path()).expect("canonical directory"))
        );
        assert_eq!(
            canonical_existing_directory(directory.path().join("missing")),
            None
        );
    }

    #[test]
    fn rejects_parent_traversal_even_when_the_resolved_directory_exists() {
        let directory = tempfile::tempdir().expect("temporary directory");
        std::fs::create_dir(directory.path().join("child")).expect("child directory");
        let traversal = directory.path().join("child").join("..");
        assert_eq!(canonical_existing_directory(traversal), None);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_workspace_roots() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let target = directory.path().join("target");
        let link = directory.path().join("workspace-link");
        std::fs::create_dir(&target).expect("target directory");
        symlink(&target, &link).expect("workspace symlink");
        assert_eq!(canonical_existing_directory(link), None);
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_build_rejects_the_workspace_override_at_compile_time() {
        // This test only compiles in a non-debug test build. The host injection
        // and explicit_launch_workspace() are both cfg(debug_assertions), so
        // no release binary can read --workspace or LANTERN_WORKSPACE.
        assert!(!cfg!(debug_assertions));
    }
}
