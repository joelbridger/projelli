//! Local meeting capture: dual-channel (mic + system loopback) chunked
//! recording. NO network paths exist in this module by design.
pub mod chunks;
pub mod session;
pub mod sources;

#[cfg(target_os = "macos")]
pub fn mac_sidecar_path() -> Option<std::path::PathBuf> {
    // Same dev-dir fallbacks as commands::voice::resolve_sidecar_path, with
    // the app handle path checked by the caller at command level.
    let cwd = std::env::current_dir().ok()?;
    crate::commands::voice::find_sidecar_in(&cwd.join("src-tauri").join("binaries"), &["capture-mac"])
        .or_else(|| crate::commands::voice::find_sidecar_in(&cwd.join("binaries"), &["capture-mac"]))
}
