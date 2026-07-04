//! Symlink-safe workspace-path containment — the single implementation every
//! command that resolves a caller-supplied path against a workspace (or
//! matter) root should go through, rather than each duplicating its own
//! `base.join(relative).canonicalize()` + `starts_with` check.
//!
//! That naive pattern FOLLOWS every symlink component and accepts the
//! result as long as the final resolved target happens to land inside the
//! root — so an in-workspace alias directory (`Clients/Alias` ->
//! `Clients/RealClient`, both inside the workspace) passes containment and
//! lets the caller read/write/delete a DIFFERENT client's files, while the
//! audit trail (which records the caller's own relative string) still names
//! "Alias": a cross-client isolation breach with a wrong audit trail.
//!
//! The fix: walk the relative path component-by-component, checking each
//! one with `symlink_metadata` (which never follows) BEFORE trusting it,
//! and refuse outright — never "helpfully" resolve through — the moment any
//! component, intermediate or final, turns out to be a symlink.
//!
//! `pub` (not `pub(crate)`): the `lantern-mcp` sidecar binary
//! (`src/mcp_bin/`) links against this crate as an external crate
//! (`lantern_lib`) even though it lives in the same Cargo package, so
//! `pub(crate)` items here are invisible to it. See the `pub mod commands`
//! comment in `lib.rs` — the same reasoning that made `commands::rag::*`
//! public applies here.

use std::path::{Component, Path, PathBuf};

/// Resolve a workspace-relative path to its canonical form, refusing the
/// walk the MOMENT any component — the target itself or any intermediate
/// directory along the way — is a symlink.
///
/// Returns:
/// - `Ok(Some(path))` — fully resolved, symlink-free, confirmed inside
///   `root_for_containment`.
/// - `Ok(None)` — the path doesn't exist (yet). Benign; callers decide what
///   that means for them (e.g. "this matter folder was already removed
///   before the sweep ran" vs. "this is a new file about to be created" —
///   see [`resolve_creatable`] for the latter).
/// - `Err(_)` — an absolute path, a `..` component (never allowed — this is
///   always meant to stay under `base`), or a symlink anywhere along the
///   walk.
pub fn canonicalize_symlink_safe(
    base: &Path,
    relative: &str,
    root_for_containment: &Path,
) -> Result<Option<PathBuf>, String> {
    let p = Path::new(relative);
    if p.is_absolute() {
        return Err(format!("path must be workspace-relative: {relative}"));
    }
    let mut current = base.to_path_buf();
    for component in p.components() {
        match component {
            Component::Normal(seg) => {
                current.push(seg);
                match current.symlink_metadata() {
                    Ok(meta) if meta.file_type().is_symlink() => {
                        return Err(format!(
                            "path component is a symlink: {} (in {relative})",
                            current.display()
                        ));
                    }
                    Ok(_) => {} // a real (non-symlink) component so far — keep walking
                    Err(_) => return Ok(None), // vanished/doesn't exist — benign
                }
            }
            Component::CurDir => {} // "." — harmless, doesn't change the path
            Component::ParentDir => {
                return Err(format!("path must not contain '..': {relative}"));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("path must be workspace-relative: {relative}"));
            }
        }
    }
    // Every component walked above was confirmed NOT a symlink, so this
    // canonicalize can't silently jump anywhere unexpected — it only
    // resolves things like a trailing `.` this loop already treated as
    // harmless. A failure here means the fully-walked path doesn't actually
    // exist (same "vanished" semantics as above).
    let abs = match current.canonicalize() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    if !abs.starts_with(root_for_containment) {
        return Err(format!("path escapes workspace: {relative}"));
    }
    Ok(Some(abs))
}

/// Resolve a caller-supplied path relative to the workspace root, refusing
/// an absolute or escaping input outright.
pub fn canonicalize_workspace_relative(
    canon_ws: &Path,
    relative: &str,
) -> Result<Option<PathBuf>, String> {
    canonicalize_symlink_safe(canon_ws, relative, canon_ws)
}

/// Same symlink-safe walk as [`canonicalize_workspace_relative`], but rooted
/// at (and contained within) an already-resolved MATTER folder rather than
/// the workspace root — used to resolve a path that must stay inside its
/// own matter folder specifically, not merely somewhere in the workspace.
pub fn canonicalize_within(base: &Path, relative: &str) -> Result<Option<PathBuf>, String> {
    canonicalize_symlink_safe(base, relative, base)
}

/// Same no-follow walk as [`canonicalize_symlink_safe`], but tolerant of a
/// missing TAIL: once a component doesn't exist, nothing further along the
/// same relative path can exist either (a filesystem entry can't have
/// children without existing itself), so the remaining components are
/// appended lexically onto the deepest verified-safe, verified-existing
/// prefix instead of failing outright.
///
/// Use this where the caller may be about to CREATE the target (a new
/// file, possibly several new directories deep, e.g. an MCP
/// `write_workspace_file` call). Unlike `canonicalize_symlink_safe`'s
/// `Ok(None)`, this always returns a concrete, symlink-free, contained path
/// or an `Err` — there's no "doesn't exist, caller decides" case, because
/// for a create-capable caller "doesn't exist" IS the expected, valid case.
pub fn resolve_creatable(
    base: &Path,
    relative: &str,
    root_for_containment: &Path,
) -> Result<PathBuf, String> {
    let p = Path::new(relative);
    if p.is_absolute() {
        return Err(format!("path must be workspace-relative: {relative}"));
    }
    let mut current = base.to_path_buf();
    let mut verified_existing = base.to_path_buf();
    let mut still_checking = true;
    for component in p.components() {
        match component {
            Component::Normal(seg) => {
                current.push(seg);
                if still_checking {
                    match current.symlink_metadata() {
                        Ok(meta) if meta.file_type().is_symlink() => {
                            return Err(format!(
                                "path component is a symlink: {} (in {relative})",
                                current.display()
                            ));
                        }
                        Ok(_) => verified_existing = current.clone(),
                        Err(_) => still_checking = false, // this and everything after is unwritten — can't be a symlink
                    }
                }
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!("path must not contain '..': {relative}"));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("path must be workspace-relative: {relative}"));
            }
        }
    }
    let canon_existing = verified_existing
        .canonicalize()
        .map_err(|e| format!("cannot canonicalize '{}': {e}", verified_existing.display()))?;
    if !canon_existing.starts_with(root_for_containment) {
        return Err(format!("path escapes workspace: {relative}"));
    }
    if verified_existing == current {
        return Ok(canon_existing);
    }
    let suffix = current
        .strip_prefix(&verified_existing)
        .expect("verified_existing is always a lexical prefix of current — built by sequential pushes");
    Ok(canon_existing.join(suffix))
}

/// Last-line-of-defense containment check for a path that was already
/// assembled by directory enumeration (not a caller-supplied relative
/// string) under `canon_ws` — e.g. the retention sweep re-verifying just
/// before every unlink. Recomputes the no-follow component walk from
/// `canon_ws` down to `path` so an alias anywhere along the way (not only
/// its immediate parent) is still caught, rather than trusting a single
/// parent-canonicalize that FOLLOWS through any alias above the parent.
pub fn contained(path: &Path, canon_ws: &Path) -> bool {
    match path.strip_prefix(canon_ws) {
        Ok(relative) => matches!(
            canonicalize_symlink_safe(canon_ws, &relative.to_string_lossy(), canon_ws),
            Ok(Some(_))
        ),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_creatable_accepts_existing_nested_path() {
        let ws = tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("a/b")).unwrap();
        std::fs::write(ws.path().join("a/b/c.txt"), b"hi").unwrap();
        let canon = ws.path().canonicalize().unwrap();
        let resolved = resolve_creatable(&canon, "a/b/c.txt", &canon).unwrap();
        assert_eq!(resolved, canon.join("a/b/c.txt"));
    }

    #[test]
    fn resolve_creatable_allows_multi_level_missing_tail() {
        let ws = tempdir().unwrap();
        let canon = ws.path().canonicalize().unwrap();
        let resolved = resolve_creatable(&canon, "new/dir/file.txt", &canon).unwrap();
        assert_eq!(resolved, canon.join("new/dir/file.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_creatable_rejects_in_workspace_alias_symlink() {
        let ws = tempdir().unwrap();
        let real = ws.path().join("Clients/RealClient");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("secret.docx"), b"secret").unwrap();
        let alias = ws.path().join("Clients/Alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();

        let canon = ws.path().canonicalize().unwrap();
        let err = resolve_creatable(&canon, "Clients/Alias/secret.docx", &canon).unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn resolve_creatable_rejects_out_of_workspace_symlink() {
        let ws = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("escape")).unwrap();

        let canon = ws.path().canonicalize().unwrap();
        let err = resolve_creatable(&canon, "escape/x.txt", &canon).unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    #[test]
    fn resolve_creatable_rejects_dotdot() {
        let ws = tempdir().unwrap();
        let canon = ws.path().canonicalize().unwrap();
        let err = resolve_creatable(&canon, "../escape.txt", &canon).unwrap_err();
        assert!(err.contains(".."), "got: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn contained_rejects_in_workspace_alias() {
        let ws = tempdir().unwrap();
        let canon_ws = ws.path().canonicalize().unwrap();
        let real = canon_ws.join("Clients/RealClient");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("audio.wav"), b"x").unwrap();
        let alias = canon_ws.join("Clients/Alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();

        assert!(!contained(&alias.join("audio.wav"), &canon_ws));
    }

    #[test]
    fn contained_accepts_plain_nested_path() {
        let ws = tempdir().unwrap();
        let canon_ws = ws.path().canonicalize().unwrap();
        std::fs::create_dir_all(canon_ws.join("Clients/A")).unwrap();
        std::fs::write(canon_ws.join("Clients/A/audio.wav"), b"x").unwrap();
        assert!(contained(&canon_ws.join("Clients/A/audio.wav"), &canon_ws));
    }
}
