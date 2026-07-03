//! Local meeting capture: dual-channel (mic + system loopback) chunked
//! recording. NO network paths exist in this module by design.
pub mod chunks;
pub mod engine;
pub mod recovery;
pub mod session;
pub mod sources;

/// Canonicalize `path`, allowing its tail to not yet exist on disk: walks up
/// to the deepest existing ancestor (so any symlink in the existing chain
/// resolves), canonicalizes that, then re-appends the not-yet-created tail
/// components verbatim. Shared by both guards below so a not-yet-materialized
/// path still gets a real escape check instead of a bare IO error.
fn canonicalize_allowing_missing_tail(path: &std::path::Path) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::Context;
    let mut existing = path.to_path_buf();
    let mut tail = std::path::PathBuf::new();
    while !existing.exists() {
        let name = existing
            .file_name()
            .map(std::ffi::OsString::from)
            .context("path has no file name while walking ancestors")?;
        tail = std::path::Path::new(&name).join(&tail);
        existing = existing
            .parent()
            .context("ran out of ancestors")?
            .to_path_buf();
    }
    Ok(existing
        .canonicalize()
        .context("cannot canonicalize existing ancestor")?
        .join(&tail))
}

/// Resolve a RELATIVE matter folder under the workspace, refusing absolute
/// inputs, `..` traversal, and symlink escapes. Every capture command that
/// receives a folder/dir string MUST route through one of these two guards
/// before any create/join/delete.
pub(crate) fn guard_matter_folder(
    workspace: &std::path::Path,
    matter_folder: &str,
) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{bail, Context};
    let rel = std::path::Path::new(matter_folder);
    if rel.is_absolute() {
        bail!("matter_folder must be workspace-relative, got absolute path");
    }
    let canon_ws = workspace
        .canonicalize()
        .context("cannot canonicalize workspace")?;
    let canon = canonicalize_allowing_missing_tail(&canon_ws.join(rel))?;
    if !canon.starts_with(&canon_ws) {
        bail!("path '{}' escapes workspace '{}'", canon.display(), canon_ws.display());
    }
    Ok(canon)
}

/// Same contract for an already-materialized meeting dir passed back from the
/// frontend (stop/recover/index/retention): canonicalize and require it to be
/// a descendant of the workspace. Tolerates a not-yet-existing tail (e.g. a
/// meeting dir path checked before it's created) via the same ancestor walk.
pub(crate) fn guard_meeting_path(
    workspace: &std::path::Path,
    meeting_dir: &std::path::Path,
) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{bail, Context};
    let canon_ws = workspace
        .canonicalize()
        .context("cannot canonicalize workspace")?;
    let canon = canonicalize_allowing_missing_tail(meeting_dir)?;
    if !canon.starts_with(&canon_ws) {
        bail!("path '{}' escapes workspace '{}'", canon.display(), canon_ws.display());
    }
    Ok(canon)
}

#[cfg(test)]
mod path_guard_tests {
    use super::*;

    #[test]
    fn rejects_absolute_matter_folder() {
        let ws = tempfile::tempdir().unwrap();
        let err = guard_matter_folder(ws.path(), "/etc").unwrap_err();
        assert!(err.to_string().contains("must be workspace-relative"), "got: {err}");
    }

    #[test]
    fn rejects_dotdot_traversal() {
        let ws = tempfile::tempdir().unwrap();
        let err = guard_matter_folder(ws.path(), "../outside").unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }

    // Symlink creation on Windows requires elevated/dev-mode privileges and a
    // different API (std::os::windows::fs::symlink_dir); the escape-guard
    // logic itself is platform-agnostic (proven by the Unix run), so this
    // test only runs on Unix rather than skipping the check on Windows CI.
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("link")).unwrap();
        let err = guard_matter_folder(ws.path(), "link/Clients/A").unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }

    #[test]
    fn accepts_normal_relative_folder() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/A")).unwrap();
        let p = guard_matter_folder(ws.path(), "Clients/A").unwrap();
        assert!(p.starts_with(ws.path().canonicalize().unwrap()));
    }

    #[test]
    fn meeting_dir_must_be_inside_workspace() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = guard_meeting_path(ws.path(), &outside.path().join("Meetings/x")).unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }
}

#[cfg(target_os = "macos")]
pub fn mac_sidecar_path() -> Option<std::path::PathBuf> {
    // Both filename conventions are checked: the bare name (matches
    // commands::voice's other sidecars once staged/bundled without a
    // suffix) and the target-triple-suffixed name the capture-mac README
    // documents as the staging convention (`capture-mac-<target-triple>`,
    // never renamed since capture-mac isn't in tauri.conf.json's
    // `externalBin` — that mechanism is what strips the suffix for piper/
    // llama-server, and capture-mac deliberately isn't wired into it yet).
    let triple_named = format!("capture-mac-{}-apple-darwin", std::env::consts::ARCH);
    let names = ["capture-mac", triple_named.as_str()];
    // 1. Packaged .app bundle: the running executable sits at
    //    Contents/MacOS/<exe>; staged binaries live in Contents/Resources/
    //    (the same location Tauri's own `resource_dir()` resolves to for a
    //    macOS app bundle). Using `current_exe()` gets us there without
    //    needing an `AppHandle` threaded through the whole capture call
    //    chain (mic/loopback source construction happens deep inside
    //    `CaptureEngine::start_with_sources`, which is OS-agnostic and has
    //    no Tauri context on Windows/Linux).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            let resources_bin = macos_dir.join("..").join("Resources").join("binaries");
            if let Some(p) = crate::commands::voice::find_sidecar_in(&resources_bin, &names) {
                return Some(p);
            }
        }
    }
    // 2. Dev fallback — same dev-dir pattern as
    //    commands::voice::resolve_sidecar_path's fallback.
    let cwd = std::env::current_dir().ok()?;
    crate::commands::voice::find_sidecar_in(&cwd.join("src-tauri").join("binaries"), &names)
        .or_else(|| crate::commands::voice::find_sidecar_in(&cwd.join("binaries"), &names))
}
