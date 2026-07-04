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

//! ## Windows verbatim-path safety (audited 2026-07-04)
//!
//! `Path::canonicalize()` ALWAYS returns a verbatim path on Windows
//! (`\\?\C:\…`), and the bare prefix component `\\?\C:` is NOT statable on
//! its own (`symlink_metadata` → os error 3). A component-walk that starts
//! from an EMPTY `PathBuf` and tries to stat that prefix as if it were a real
//! directory entry collapses to an empty base and then canonicalizes `""` —
//! that was the `capture_start` blocker fixed in
//! [`canonicalize_symlink_safe_absolute`], which is the ONLY function here
//! that walks a path from empty and therefore has to traverse the prefix/root
//! itself (now seeded verbatim, no symlink check on those anchors).
//!
//! The other three resolvers are safe against a verbatim base by
//! construction, because none of them ever stats a bare prefix or
//! canonicalizes an empty path:
//! - [`canonicalize_symlink_safe`] / [`resolve_creatable`] both seed their
//!   walk from a caller-supplied `base` that is already a real, existing,
//!   (typically already-canonical/verbatim) directory, and only ever `push`
//!   `Normal` segments onto it — any `Prefix`/`RootDir` in the *relative*
//!   argument is rejected outright. Their final `canonicalize()` runs on
//!   `base` (or a descendant), never on `""`.
//! - [`contained`] delegates to `canonicalize_symlink_safe` after
//!   `strip_prefix(canon_ws)`, so it inherits that safety; if the two paths'
//!   verbatim-ness ever disagrees, `strip_prefix` simply fails and it returns
//!   `false` (fail-closed).
//!
use std::path::{Component, Path, PathBuf};

/// True if `seg` is (or, extension-stripped, resolves to) a Windows reserved
/// device name — `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`,
/// case-insensitively. Windows intercepts these names in the normal Win32 API,
/// so a file created with one via an extended-length (`\\?\`) path becomes
/// un-renamable / un-deletable by Explorer, Word, backup tools, etc. (QA-36).
fn is_reserved_windows_name(seg: &str) -> bool {
    // The reserved word is matched against the portion before the FIRST dot:
    // `CON`, `CON.docx`, and `CON.a.b` are all reserved. Trailing spaces on the
    // base are stripped by Windows, so strip them here before matching.
    let base = seg.split('.').next().unwrap_or(seg).trim_end_matches(' ');
    let upper = base.to_ascii_uppercase();
    match upper.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" => true,
        // COM1-9 / LPT1-9 only (exactly one digit 1-9): "COM10" is NOT reserved.
        _ => {
            (upper.starts_with("COM") || upper.starts_with("LPT"))
                && upper.len() == 4
                && matches!(upper.as_bytes()[3], b'1'..=b'9')
        }
    }
}

/// Reject a single path segment that Windows can't faithfully store (QA-36
/// defense-in-depth for the CREATE path — the client-side `validateName` is the
/// primary guard; this catches AI/MCP create routes that bypass the UI dialogs).
/// Refuses reserved device names and trailing dots/spaces (which Windows
/// silently strips, so the on-disk name wouldn't match what was requested).
pub fn reject_reserved_windows_name(seg: &str) -> Result<(), String> {
    if seg.ends_with('.') || seg.ends_with(' ') {
        return Err(format!(
            "name has a trailing dot or space, which Windows strips: {seg:?}"
        ));
    }
    if is_reserved_windows_name(seg) {
        return Err(format!("name is a reserved Windows device name: {seg:?}"));
    }
    Ok(())
}

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
                // QA-36 defense-in-depth: refuse a reserved Windows device name
                // (CON/PRN/…) or a trailing-dot/space segment at ANY level before
                // it can be created — Windows reserves these at every path
                // component, and such a file/dir becomes un-manageable outside
                // this app. The client-side `validateName` is the primary guard;
                // this covers create routes (AI/MCP) that don't hit the dialogs.
                reject_reserved_windows_name(&seg.to_string_lossy())?;
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

/// Same no-follow, missing-tail-tolerant guarantee as [`resolve_creatable`],
/// but for a caller that already has an ALREADY-ABSOLUTE, fully-formed path
/// instead of a `(base, relative)` pair — e.g. Wave 3a's meeting-capture
/// guards, which accept a `matter_folder`/`meeting_dir` that may be absolute
/// (`Matter.folderPaths` entries are absolute, workspace-prefixed strings)
/// and may not exist in full yet (a `meeting_dir` being created for the
/// first time). A plain `.canonicalize()` on the deepest existing ancestor —
/// what those guards used to do before this module existed — silently
/// follows a symlinked matter folder alias (`Clients/Alias ->
/// Clients/RealClient`, both inside the workspace), which passes workspace
/// containment while writing into (and, on a failed start,
/// `remove_dir_all`-ing) a DIFFERENT client's real folder.
pub fn canonicalize_symlink_safe_absolute(path: &Path) -> Result<PathBuf, String> {
    // This resolver is contractually for an ALREADY-ABSOLUTE path (see the
    // doc above). Enforce it: a relative/drive-relative input (`""`, `.`,
    // `C:foo`, `foo/bar`) would otherwise walk to an empty or
    // caller-directory-relative `existing` and canonicalize something the
    // caller never named — reject it up front so the "never canonicalize an
    // empty/ambiguous base" guarantee holds by construction, not by luck.
    if !path.is_absolute() {
        return Err(format!("path must be absolute: {}", path.display()));
    }
    let mut existing = PathBuf::new();
    let mut tail = PathBuf::new();
    let mut still_existing = true;
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(format!("path must not contain '..': {}", path.display()));
            }
            // A drive `Prefix` (`\\?\C:`, `C:`) and a `RootDir` (`\`, `/`) are
            // STRUCTURAL anchors, not filesystem entries: they can never be a
            // symlink, and on Windows the bare verbatim prefix `\\?\C:` is not
            // even statable on its own (`symlink_metadata` returns os error 3).
            // Seed them into `existing` verbatim WITHOUT a symlink check so the
            // walk starts from a real, canonicalizable base. The pre-fix code
            // stat'd the prefix like a `Normal` component, its failure flipped
            // `still_existing = false` immediately, every component fell into
            // `tail`, `existing` stayed empty, and the final `canonicalize()`
            // ran on `""` — the exact `capture_start` blocker: `cannot
            // canonicalize : The system cannot find the path specified.`
            // (`Path::canonicalize()` ALWAYS returns a verbatim path on
            // Windows, and `guard_matter_folder` joins caller input onto a
            // canonicalized root, so this is the ordinary, not exotic, shape.)
            Component::Prefix(_) | Component::RootDir => {
                // `push` of a rooted/prefixed component REPLACES the base per
                // `PathBuf` semantics; from the empty start (and with the
                // prefix pushed before the root on Windows) that assembles the
                // anchor correctly rather than dropping it.
                existing.push(component.as_os_str());
            }
            // `.` never changes the resolved path; skip it (an absolute input
            // won't carry a leading `CurDir` anyway, but be explicit so it is
            // never stat'd or pushed into `tail`).
            Component::CurDir => {}
            Component::Normal(seg) => {
                // Defense-in-depth against a CRAFTED verbatim input. In a
                // verbatim path (`\\?\…`) Rust's `components()` does NOT treat
                // `/` as a separator and does NOT normalize `..`, so a single
                // `Normal` component can secretly carry embedded separators or
                // dot-segments (e.g. `Clients/../Other`). The outer `..` arm
                // never sees them — but the `existing.join(seg)` below RE-parses
                // the `OsStr` with the platform's normal path rules, which DO
                // split on `/` (and `\` on Windows) and re-materialize that
                // hidden `..`, defeating both the no-`..` and the check-every-
                // real-component-before-trusting-it (no-follow) guarantees.
                // Require each `Normal` segment to re-parse to exactly itself —
                // one clean `Normal` with no separator or dot-segment. A real
                // single filename never contains a path separator on any OS, so
                // this rejects only crafted inputs. (Found by independent review,
                // 2026-07-04.)
                {
                    let mut parts = Path::new(seg).components();
                    match (parts.next(), parts.next()) {
                        (Some(Component::Normal(only)), None) if only == seg => {}
                        _ => {
                            return Err(format!(
                                "path component contains a separator or dot-segment: {} (in {})",
                                Path::new(seg).display(),
                                path.display()
                            ));
                        }
                    }
                }
                if still_existing {
                    let candidate = existing.join(component.as_os_str());
                    match candidate.symlink_metadata() {
                        Ok(meta) if meta.file_type().is_symlink() => {
                            return Err(format!(
                                "path component is a symlink: {}",
                                candidate.display()
                            ));
                        }
                        Ok(_) => existing = candidate,
                        Err(_) => {
                            // This and everything after is unwritten — nothing
                            // that doesn't exist can be a symlink.
                            still_existing = false;
                            tail.push(component.as_os_str());
                        }
                    }
                } else {
                    tail.push(component.as_os_str());
                }
            }
        }
    }
    let canon = existing.canonicalize().map_err(|e| {
        format!(
            "cannot canonicalize existing prefix {} of {}: {e}",
            existing.display(),
            path.display()
        )
    })?;
    Ok(canon.join(&tail))
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

/// Strips Windows' extended-length ("verbatim") path prefix — `\\?\` or
/// `\\?\UNC\` — from an already-canonicalized path before it crosses the
/// Tauri IPC boundary into the frontend as a plain `String` field (e.g. a
/// meeting-capture command's `meeting_dir`/`audio_path`/`transcript_path`).
///
/// `Path::canonicalize()` ALWAYS returns the verbatim form on Windows (see
/// this module's header doc), and several meeting-capture commands
/// deliberately canonicalize `meeting_dir` (via
/// [`canonicalize_symlink_safe_absolute`], directly or through
/// `guard_meeting_path`/`guard_matter_folder` in `commands/capture/mod.rs`)
/// so every INTERNAL Rust-side comparison of the same directory agrees,
/// regardless of which call site produced it (the round-8 fix documented in
/// `commands/capture/recovery.rs`).
///
/// The frontend never asked for that guarantee, though: its `PathValidator`
/// compares a `meetingDir` string byte-for-byte against a workspace root
/// that came from a plain folder-picker dialog (never verbatim). Left
/// un-stripped, a verbatim `meeting_dir` fails `PathValidator`'s
/// `isWithinWorkspace` check even though it names the exact same on-disk
/// location as the plain-form root — every `${meetingDir}/...` read/write
/// the frontend makes then throws a `SecurityError` before touching a file,
/// which `tryGenerateNotes`'s bare `catch { return; }` silently treated as
/// "transcription still queued" forever (QA-41; see meetingStore.ts and
/// PathValidator.windows.test.ts's "Windows verbatim" coverage).
///
/// Purely a display/IPC-string transform — the canonical `PathBuf` used for
/// actual Rust-side filesystem calls (long-path safety included) is
/// untouched; only the string handed to the frontend changes. A no-op on
/// Unix (no verbatim prefix exists there) and on any path that isn't in this
/// form already.
pub fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.into_owned()
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

    // ── QA-36: Windows reserved device names / trailing dot-or-space ──────────

    #[test]
    fn reserved_windows_name_table() {
        // (name, is_reserved)
        let cases = [
            ("CON", true),
            ("con", true),
            ("CON.docx", true),
            ("con.txt", true),
            ("PRN", true),
            ("AUX", true),
            ("NUL", true),
            ("nul.dat", true),
            ("COM1", true),
            ("COM9.docx", true),
            ("LPT1", true),
            ("lpt9", true),
            // NOT reserved — ordinary names that merely contain the text.
            ("CONTRACT.docx", false),
            ("COM10.docx", false),
            ("COM0", false),
            ("LPT0", false),
            ("console.txt", false),
            ("brief.docx", false),
            ("MyCON.docx", false),
        ];
        for (name, expected) in cases {
            assert_eq!(
                is_reserved_windows_name(name),
                expected,
                "is_reserved_windows_name({name:?}) should be {expected}"
            );
        }
    }

    #[test]
    fn reject_reserved_windows_name_covers_reserved_and_trailing() {
        for bad in ["CON", "con.docx", "NUL", "COM1", "LPT9", "brief.", "brief ", "CON.a.b"] {
            assert!(
                reject_reserved_windows_name(bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
        for ok in ["brief.docx", "CONTRACT.docx", "COM10.docx", "notes", "my-folder"] {
            assert!(
                reject_reserved_windows_name(ok).is_ok(),
                "expected {ok:?} to be accepted"
            );
        }
    }

    #[test]
    fn resolve_creatable_rejects_reserved_name_at_any_level() {
        let ws = tempdir().unwrap();
        let canon = ws.path().canonicalize().unwrap();
        // Final-segment reserved name.
        let err = resolve_creatable(&canon, "Clients/CON.docx", &canon).unwrap_err();
        assert!(err.contains("reserved"), "got: {err}");
        // Intermediate reserved directory name is refused too.
        let err2 = resolve_creatable(&canon, "CON/notes.docx", &canon).unwrap_err();
        assert!(err2.contains("reserved"), "got: {err2}");
        // Trailing dot/space on the created segment.
        let err3 = resolve_creatable(&canon, "brief.", &canon).unwrap_err();
        assert!(err3.contains("trailing"), "got: {err3}");
        // An ordinary nested name still resolves fine.
        let ok = resolve_creatable(&canon, "Clients/brief.docx", &canon).unwrap();
        assert_eq!(ok, canon.join("Clients/brief.docx"));
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

    // ── canonicalize_symlink_safe_absolute: non-Normal leading components ──
    //
    // The absolute walk must seed `existing` from the path's structural anchor
    // (a drive Prefix and/or a RootDir) rather than starting from an EMPTY
    // PathBuf and trying to `symlink_metadata()` that anchor as if it were a
    // real directory entry. Getting this wrong is the Windows `capture_start`
    // blocker: on Windows the first component of a verbatim path (`\\?\C:\…`,
    // which `Path::canonicalize()` ALWAYS returns) is `Prefix(\\?\C:)`, which
    // is NOT statable on its own (os error 3) — the pre-fix walk collapsed
    // `existing` to "" and canonicalized the empty path, producing the
    // observed `cannot canonicalize : The system cannot find the path
    // specified. (os error 3)`.

    /// THE real repro — Windows only, because a verbatim string parses as a
    /// single `Normal` component on Unix (there is no `Prefix` variant off
    /// Windows), so this exact failure can only be exercised on Windows. Run
    /// on the Azure Windows bench per the worker brief.
    #[cfg(windows)]
    #[test]
    fn absolute_walk_handles_verbatim_windows_prefix() {
        let dir = tempdir().unwrap();
        // Path::canonicalize() yields the verbatim form (\\?\C:\…) — the exact
        // shape guard_matter_folder feeds this function after canonicalizing
        // the workspace root and joining caller input onto it.
        let verbatim = dir.path().canonicalize().unwrap();
        assert!(
            verbatim.to_string_lossy().starts_with(r"\\?\"),
            "test precondition: expected a verbatim path, got {verbatim:?}"
        );

        // (a) an existing verbatim directory must resolve to itself, NOT error
        //     out trying to stat the bare `\\?\C:` prefix.
        let got = canonicalize_symlink_safe_absolute(&verbatim)
            .expect("an existing verbatim absolute path must canonicalize");
        assert_eq!(got, verbatim);

        // (b) a not-yet-existing tail under a verbatim base (a meeting_dir
        //     about to be created) must be tolerated and appended lexically.
        let with_tail = verbatim.join("Meetings").join("2026-07-04-new-mtg");
        let got_tail = canonicalize_symlink_safe_absolute(&with_tail)
            .expect("a verbatim base with a missing tail must resolve");
        assert_eq!(got_tail, with_tail);
    }

    /// Platform-neutral guard for the same walk: on Unix an absolute path's
    /// first component is `RootDir` ("/"), the analogue of Windows' `Prefix`.
    /// It must seed `existing` so the final canonicalize runs against a real
    /// base ("/"), never the empty path — even when the ENTIRE remainder is a
    /// not-yet-existing tail. (Also pins that `PathBuf`'s rooted-component
    /// replace semantics — `join`/`push` of "/" REPLACES the base — accumulate
    /// the root correctly rather than silently dropping it.)
    #[cfg(unix)]
    #[test]
    fn absolute_walk_seeds_from_root_with_wholly_missing_tail() {
        let missing = Path::new("/nonexistent_top_lp_pathfix/child/leaf");
        let got = canonicalize_symlink_safe_absolute(missing).unwrap();
        assert_eq!(got, PathBuf::from("/nonexistent_top_lp_pathfix/child/leaf"));
    }

    /// An existing absolute directory with a missing tail resolves to the
    /// canonical existing prefix + the lexical tail — the create-a-new-
    /// meeting-dir path, exercised platform-neutrally.
    #[test]
    fn absolute_walk_resolves_existing_dir_with_missing_tail() {
        let dir = tempdir().unwrap();
        let canon = dir.path().canonicalize().unwrap();
        let with_tail = canon.join("Meetings").join("new-mtg");
        let got = canonicalize_symlink_safe_absolute(&with_tail).unwrap();
        assert_eq!(got, with_tail);
    }

    /// An existing absolute directory resolves to itself (guards that seeding
    /// from prefix+root then pushing each `Normal` never corrupts the path).
    #[test]
    fn absolute_walk_resolves_existing_dir_to_itself() {
        let dir = tempdir().unwrap();
        let canon = dir.path().canonicalize().unwrap();
        let got = canonicalize_symlink_safe_absolute(&canon).unwrap();
        assert_eq!(got, canon);
    }

    /// `..` is still rejected up-front, before any filesystem access, for an
    /// already-absolute input.
    #[test]
    fn absolute_walk_rejects_dotdot() {
        let err = canonicalize_symlink_safe_absolute(Path::new("/a/../b")).unwrap_err();
        assert!(err.contains(".."), "got: {err}");
    }

    /// A relative / drive-relative input is rejected up front — the resolver
    /// is contractually for already-absolute paths, and accepting a relative
    /// one would walk against an empty or caller-relative base and canonicalize
    /// something the caller never named.
    #[test]
    fn absolute_walk_rejects_relative_input() {
        for rel in ["", ".", "relative/x", "Clients/A"] {
            let err = canonicalize_symlink_safe_absolute(Path::new(rel)).unwrap_err();
            assert!(err.contains("must be absolute"), "for {rel:?} got: {err}");
        }
    }

    /// Defense-in-depth (independent-review finding, 2026-07-04): a CRAFTED
    /// verbatim path can hide a separator / `..` inside a single `Normal`
    /// component (verbatim `components()` doesn't split on `/` or normalize
    /// `..`), which `join` would later re-materialize. Such a component must be
    /// refused outright. Windows-only because only a verbatim path can carry a
    /// `/` inside a `Normal` component — on Unix `/` always splits, so the
    /// outer `..`/component walk already sees it.
    #[cfg(windows)]
    #[test]
    fn absolute_walk_rejects_verbatim_component_hiding_a_separator_or_dotdot() {
        // `Clients/../Other` is ONE Normal component under the `\\?\` prefix.
        let hidden_dotdot = Path::new(r"\\?\C:\ws\Clients/../Other\meeting");
        let err = canonicalize_symlink_safe_absolute(hidden_dotdot).unwrap_err();
        assert!(
            err.contains("separator or dot-segment"),
            "hidden '..' must be refused, got: {err}"
        );
        // A plain embedded separator (no `..`) is refused too — it would let
        // `join` re-parse a multi-segment path past the per-component checks.
        let hidden_sep = Path::new(r"\\?\C:\ws\a/b\meeting");
        let err2 = canonicalize_symlink_safe_absolute(hidden_sep).unwrap_err();
        assert!(
            err2.contains("separator or dot-segment"),
            "hidden separator must be refused, got: {err2}"
        );
    }

    /// A symlink anywhere along an absolute path is refused the moment it is
    /// walked — the no-follow guarantee must survive the prefix/root seeding
    /// change untouched.
    #[cfg(unix)]
    #[test]
    fn absolute_walk_rejects_symlink_component() {
        let root = tempdir().unwrap();
        let canon = root.path().canonicalize().unwrap();
        let real = canon.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, canon.join("alias")).unwrap();
        let err = canonicalize_symlink_safe_absolute(&canon.join("alias").join("x")).unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    // display_path is pure string manipulation (no OS-specific canonicalize
    // call), so — unlike the verbatim-prefix PRODUCTION shape, which only
    // Windows itself actually generates — these are portable and run on any
    // host, including this Linux CI/dev box, exercising exactly the strings
    // `canonicalize_symlink_safe_absolute` is documented to produce on a real
    // Windows machine.
    mod display_path_tests {
        use super::*;

        #[test]
        fn strips_the_plain_verbatim_prefix() {
            assert_eq!(
                display_path(Path::new(r"\\?\C:\Users\Jane\Keepance\Clients\Acme")),
                r"C:\Users\Jane\Keepance\Clients\Acme"
            );
        }

        #[test]
        fn strips_the_unc_verbatim_prefix_and_restores_the_plain_unc_form() {
            assert_eq!(
                display_path(Path::new(r"\\?\UNC\server\share\Keepance\Clients\Acme")),
                r"\\server\share\Keepance\Clients\Acme"
            );
        }

        #[test]
        fn is_a_no_op_for_an_already_plain_windows_path() {
            assert_eq!(
                display_path(Path::new(r"C:\Users\Jane\Keepance\Clients\Acme")),
                r"C:\Users\Jane\Keepance\Clients\Acme"
            );
        }

        #[test]
        fn is_a_no_op_for_a_unix_path() {
            assert_eq!(
                display_path(Path::new("/home/jane/keepance/Clients/Acme")),
                "/home/jane/keepance/Clients/Acme"
            );
        }
    }
}
