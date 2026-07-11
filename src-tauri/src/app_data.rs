//! Shared resolution of Lantern's OS app-data directory.
//!
//! This must stay in lockstep with `tauri.conf.json`'s `com.lantern.app`
//! identifier.  The desktop process and the standalone MCP binary both use
//! this function for the Offline Mode record, so there is exactly one policy
//! file for a person and a machine.

use std::path::{Path, PathBuf};

/// The Tauri bundle identifier from `tauri.conf.json`.
pub const TAURI_APP_IDENTIFIER: &str = "com.lantern.app";

/// Resolve the app-data directory using a supplied platform data root.
/// Kept public for deterministic cross-binary tests.
pub fn resolve_lantern_app_data_dir_from(data_dir: &Path) -> PathBuf {
    data_dir.join(TAURI_APP_IDENTIFIER)
}

/// Resolve the exact directory Tauri uses for this app's `app_data_dir()`.
pub fn resolve_lantern_app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|data_dir| resolve_lantern_app_data_dir_from(&data_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_path_uses_the_tauri_identifier() {
        assert_eq!(
            resolve_lantern_app_data_dir_from(Path::new("/data")),
            Path::new("/data/com.lantern.app")
        );
    }
}
