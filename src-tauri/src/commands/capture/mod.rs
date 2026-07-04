//! Local meeting capture: dual-channel (mic + system loopback) chunked
//! recording. NO network paths exist in this module by design.
pub mod chunks;
pub mod engine;
pub mod recovery;
pub mod session;
pub mod sources;

/// Resolve a matter folder under the workspace, refusing `..` traversal and
/// symlink escapes. Accepts BOTH a workspace-relative path ("Clients/A")
/// and an absolute path that resolves inside the workspace — `Matter.
/// folderPaths` (src/platform/matter/matterStore.ts) stores entries as
/// absolute, workspace-prefixed paths (e.g. "C:/WS/Clients/Reyes"), which
/// is what a real `capture_start` caller passes; a relative-only guard
/// would reject every normal call. An absolute path OUTSIDE the workspace
/// (e.g. "/etc") still correctly fails the escape check below — this
/// doesn't relax the security guarantee, only the accepted input shape.
/// Every capture command that receives a folder/dir string MUST route
/// through one of these two guards before any create/join/delete.
///
/// Built on `pathguard::canonicalize_symlink_safe_absolute` — the SAME
/// no-follow-symlink walk `retention`'s own sweep/redaction guards, and the
/// vault/MCP/diarize command sites, all share (the 2026-07-04 hardening pass
/// promoted it out of `retention::sweep` into this crate-wide shared module)
/// — not a second, independent implementation of "refuse a symlink
/// component." An earlier version of this guard called plain
/// `.canonicalize()` on the deepest existing ancestor, which FOLLOWS
/// symlinks: a matter folder alias (`Clients/Alias -> Clients/RealClient`,
/// both inside the workspace) would resolve to the real target and still
/// pass workspace containment, letting a capture write chunks into (and, on
/// a failed start, `remove_dir_all` a) DIFFERENT client's folder while the
/// audit trail and UI still say "Alias".
pub(crate) fn guard_matter_folder(
    workspace: &std::path::Path,
    matter_folder: &str,
) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{anyhow, bail, Context};
    let input = std::path::Path::new(matter_folder);
    let canon_ws = workspace
        .canonicalize()
        .context("cannot canonicalize workspace")?;
    let joined = if input.is_absolute() { input.to_path_buf() } else { canon_ws.join(input) };
    let canon = super::pathguard::canonicalize_symlink_safe_absolute(&joined)
        .map_err(|e| anyhow!(e))?;
    if !canon.starts_with(&canon_ws) {
        bail!("path '{}' escapes workspace '{}'", canon.display(), canon_ws.display());
    }
    Ok(canon)
}

/// Same contract for an already-materialized meeting dir passed back from the
/// frontend (stop/recover/index/retention): canonicalize and require it to be
/// a descendant of the workspace. Tolerates a not-yet-existing tail (e.g. a
/// meeting dir path checked before it's created) via the same symlink-safe
/// walk as `guard_matter_folder` — see that function's doc for why a plain
/// `.canonicalize()` isn't safe here either.
pub(crate) fn guard_meeting_path(
    workspace: &std::path::Path,
    meeting_dir: &std::path::Path,
) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{anyhow, bail, Context};
    let canon_ws = workspace
        .canonicalize()
        .context("cannot canonicalize workspace")?;
    let canon = super::pathguard::canonicalize_symlink_safe_absolute(meeting_dir)
        .map_err(|e| anyhow!(e))?;
    if !canon.starts_with(&canon_ws) {
        bail!("path '{}' escapes workspace '{}'", canon.display(), canon_ws.display());
    }
    Ok(canon)
}

#[cfg(test)]
mod path_guard_tests {
    use super::*;

    #[test]
    fn rejects_absolute_matter_folder_outside_workspace() {
        let ws = tempfile::tempdir().unwrap();
        let err = guard_matter_folder(ws.path(), "/etc").unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }

    #[test]
    fn accepts_absolute_matter_folder_inside_workspace() {
        // Matter.folderPaths (matterStore.ts) stores absolute, workspace-
        // prefixed paths — this is the real shape capture_start receives.
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/Reyes Household")).unwrap();
        let abs = ws.path().join("Clients/Reyes Household");
        let p = guard_matter_folder(ws.path(), abs.to_str().unwrap()).unwrap();
        assert!(p.starts_with(ws.path().canonicalize().unwrap()));
    }

    #[test]
    fn rejects_dotdot_traversal() {
        // Rejected unconditionally by canonicalize_symlink_safe_absolute the
        // moment a `..` component appears — a stricter, defense-in-depth
        // guarantee than relying solely on the final containment check
        // (which this input would ALSO fail, but that's no longer why it's
        // rejected).
        let ws = tempfile::tempdir().unwrap();
        let err = guard_matter_folder(ws.path(), "../outside").unwrap_err();
        assert!(err.to_string().contains("must not contain '..'"), "got: {err}");
    }

    // Symlink creation on Windows requires elevated/dev-mode privileges and a
    // different API (std::os::windows::fs::symlink_dir); the escape-guard
    // logic itself is platform-agnostic (proven by the Unix run), so this
    // test only runs on Unix rather than skipping the check on Windows CI.
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        // Rejected the moment the symlink component itself is walked — never
        // silently followed and then caught (or missed) by a later
        // containment check.
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("link")).unwrap();
        let err = guard_matter_folder(ws.path(), "link/Clients/A").unwrap_err();
        assert!(err.to_string().contains("is a symlink"), "got: {err}");
    }

    /// Regression for the codex-review / security-audit finding (2026-07-04):
    /// the OLD guard's plain `.canonicalize()` on the deepest existing
    /// ancestor FOLLOWED a symlink alias sitting fully INSIDE the workspace
    /// (`Clients/Alias -> Clients/RealClient`) — the escaped-outside-the-
    /// workspace check couldn't catch this because the resolved target was
    /// never actually outside the workspace, just a DIFFERENT client's real
    /// folder than the caller named. Proves the new guard refuses this
    /// outright instead of silently resolving through it.
    #[cfg(unix)]
    #[test]
    fn rejects_in_workspace_symlink_alias_to_a_different_client_folder() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/RealClient")).unwrap();
        std::os::unix::fs::symlink(
            ws.path().join("Clients/RealClient"),
            ws.path().join("Clients/Alias"),
        )
        .unwrap();
        let err = guard_matter_folder(ws.path(), "Clients/Alias").unwrap_err();
        assert!(err.to_string().contains("is a symlink"), "got: {err}");
    }

    /// Same alias-symlink attack, but exercised through `guard_meeting_path`
    /// (the guard `capture_recover` uses) rather than `guard_matter_folder`
    /// (`capture_start`'s) — both guards share the same underlying primitive,
    /// but each has its own call site and its own regression coverage.
    #[cfg(unix)]
    #[test]
    fn guard_meeting_path_rejects_symlink_ancestor() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/RealClient/Meetings/2026-07-01-m")).unwrap();
        std::os::unix::fs::symlink(
            ws.path().join("Clients/RealClient"),
            ws.path().join("Clients/Alias"),
        )
        .unwrap();
        let meeting_dir = ws.path().join("Clients/Alias/Meetings/2026-07-01-m");
        let err = guard_meeting_path(ws.path(), &meeting_dir).unwrap_err();
        assert!(err.to_string().contains("is a symlink"), "got: {err}");
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
