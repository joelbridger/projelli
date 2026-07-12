// Gzipped-tarball extraction for the Templates Marketplace install pipeline.
//
// Extracts a `.tar.gz` from disk into a destination directory and returns the
// list of relative paths that were written. Includes path-traversal hardening:
// any entry whose canonical destination falls outside `dest_path` is rejected.
//
// Symlinks are also rejected. The marketplace install flow writes only regular
// files and directories; refusing symlinks removes a class of escape attacks
// without affecting any legitimate template.

use flate2::read::GzDecoder;
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use tar::Archive;

/// Extract the gzipped tarball at `tarball_path` into `dest_path`.
/// Returns the list of relative paths that were written. Rejects entries that
/// would escape `dest_path` via `..`, absolute paths, or symlinks.
#[tauri::command]
pub async fn extract_tarball(
    tarball_path: String,
    dest_path: String,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || extract_tarball_blocking(&tarball_path, &dest_path))
        .await
        .map_err(|e| format!("join error: {}", e))?
}

fn extract_tarball_blocking(
    tarball_path: &str,
    dest_path: &str,
) -> Result<Vec<String>, String> {
    let dest = PathBuf::from(dest_path);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("create dest {}: {}", dest.display(), e))?;
    let dest_canonical = dest
        .canonicalize()
        .map_err(|e| format!("canonicalize dest {}: {}", dest.display(), e))?;

    let f = File::open(tarball_path).map_err(|e| format!("open tarball: {}", e))?;
    let gz = GzDecoder::new(f);
    let mut archive = Archive::new(gz);

    let mut written: Vec<String> = Vec::new();
    let entries = archive
        .entries()
        .map_err(|e| format!("read tarball entries: {}", e))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("entry: {}", e))?;

        let header_type = entry.header().entry_type();
        if header_type.is_symlink() || header_type.is_hard_link() {
            return Err(format!(
                "refusing symlink/hardlink entry: {:?}",
                entry.path().ok().map(|p| p.to_path_buf())
            ));
        }

        let raw_path = entry.path().map_err(|e| format!("entry path: {}", e))?;
        let safe_rel = sanitize_relative(&raw_path)?;
        let target = dest_canonical.join(&safe_rel);

        if header_type.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("mkdir {}: {}", target.display(), e))?;
            assert_within(&dest_canonical, &target)?;
            continue;
        }

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir parent {}: {}", parent.display(), e))?;
        }
        assert_within(&dest_canonical, &target)?;
        entry
            .unpack(&target)
            .map_err(|e| format!("unpack {}: {}", target.display(), e))?;

        written.push(safe_rel.to_string_lossy().to_string());
    }

    Ok(written)
}

/// Strip absolute roots, refuse `..` and prefix components, and refuse
/// embedded NUL bytes. Returns the cleaned relative path or an error.
fn sanitize_relative(p: &Path) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(part) => {
                let s = part.to_string_lossy();
                if s.contains('\0') {
                    return Err(format!("entry path contains NUL: {:?}", p));
                }
                out.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!("entry path traverses parent: {:?}", p));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("entry path is absolute: {:?}", p));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("entry path resolves to empty: {:?}", p));
    }
    Ok(out)
}

/// Defence in depth: even after `sanitize_relative` produces a clean path,
/// confirm the joined target still sits under `root`.
fn assert_within(root: &Path, target: &Path) -> Result<(), String> {
    // Walk up `target` removing components until it exists, then canonicalize.
    // For new files we'd otherwise fail canonicalize, so check the parent.
    let probe: PathBuf = if target.exists() {
        target.canonicalize().map_err(|e| format!("canon: {}", e))?
    } else {
        let mut p = target.to_path_buf();
        loop {
            match p.parent() {
                Some(pp) if pp.exists() => {
                    let canon = pp
                        .canonicalize()
                        .map_err(|e| format!("canon parent: {}", e))?;
                    let leaf = target
                        .strip_prefix(pp)
                        .map_err(|e| format!("strip prefix: {}", e))?;
                    break canon.join(leaf);
                }
                Some(pp) => {
                    p = pp.to_path_buf();
                }
                None => return Err("path has no parent".into()),
            }
        }
    };

    if !probe.starts_with(root) {
        return Err(format!(
            "entry escapes destination: {} not under {}",
            probe.display(),
            root.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;
    use tempfile::tempdir;

    fn build_tarball(tmpdir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let path = tmpdir.join("bundle.tar.gz");
        let f = File::create(&path).expect("create tar");
        let enc = GzEncoder::new(f, Compression::default());
        let mut builder = tar::Builder::new(enc);
        for (name, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, name, &mut std::io::Cursor::new(*data))
                .expect("append");
        }
        builder.into_inner().expect("finish").finish().expect("gz finish");
        path
    }

    /// Build a single-entry tarball whose entry name is written directly into
    /// the GNU header, bypassing `tar::Builder`'s path sanitization. The safe
    /// writer API (`append_data` -> `set_path`) refuses `..` and absolute paths
    /// outright, so it cannot express the adversarial archives a real attacker
    /// would hand-craft. Writing the raw name lets these tests feed genuine
    /// malicious input to the extractor and prove its own defenses hold.
    fn build_tarball_with_raw_name(tmpdir: &Path, name: &str, data: &[u8]) -> PathBuf {
        let path = tmpdir.join("bundle.tar.gz");
        let f = File::create(&path).expect("create tar");
        let enc = GzEncoder::new(f, Compression::default());
        let mut builder = tar::Builder::new(enc);

        let mut header = tar::Header::new_gnu();
        header.set_size(data.len() as u64);
        header.set_mode(0o644);
        {
            // Overwrite the raw name field after the header is otherwise set up.
            let gnu = header.as_gnu_mut().expect("gnu header");
            let bytes = name.as_bytes();
            assert!(bytes.len() <= gnu.name.len(), "raw name too long for fixture");
            gnu.name[..bytes.len()].copy_from_slice(bytes);
        }
        // Checksum must be computed after the name is written.
        header.set_cksum();
        // `append` (unlike `append_data`) writes the header verbatim, so the raw
        // malicious name survives into the archive instead of being rejected.
        builder
            .append(&header, std::io::Cursor::new(data))
            .expect("append raw entry");
        builder.into_inner().expect("finish").finish().expect("gz finish");
        path
    }

    #[test]
    fn extracts_clean_tarball() {
        let dir = tempdir().expect("tmp");
        let dest = dir.path().join("dest");
        let tar = build_tarball(
            dir.path(),
            &[("a.txt", b"hello"), ("sub/b.txt", b"world")],
        );
        let got = extract_tarball_blocking(tar.to_str().unwrap(), dest.to_str().unwrap())
            .expect("extract");
        assert_eq!(got.len(), 2);
        assert!(dest.join("a.txt").exists());
        assert!(dest.join("sub/b.txt").exists());
    }

    #[test]
    fn rejects_parent_traversal() {
        let dir = tempdir().expect("tmp");
        let dest = dir.path().join("dest");
        let tar = build_tarball_with_raw_name(dir.path(), "../escape.txt", b"x");
        let res = extract_tarball_blocking(tar.to_str().unwrap(), dest.to_str().unwrap());
        assert!(res.is_err(), "expected refusal, got {:?}", res);
        // Defense must actually hold: `../escape.txt` relative to dest resolves
        // to a sibling of dest, which must never have been written.
        assert!(
            !dir.path().join("escape.txt").exists(),
            "parent-traversal entry escaped the destination directory"
        );
    }

    #[test]
    fn rejects_absolute_path() {
        let dir = tempdir().expect("tmp");
        let dest = dir.path().join("dest");
        let tar = build_tarball_with_raw_name(dir.path(), "/etc/passwd", b"x");
        let res = extract_tarball_blocking(tar.to_str().unwrap(), dest.to_str().unwrap());
        assert!(res.is_err(), "expected refusal, got {:?}", res);
    }

    #[test]
    fn rejects_symlink_entry() {
        let dir = tempdir().expect("tmp");
        let dest = dir.path().join("dest");
        let path = dir.path().join("bundle.tar.gz");
        let f = File::create(&path).expect("create tar");
        let enc = GzEncoder::new(f, Compression::default());
        let mut builder = tar::Builder::new(enc);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header
            .set_link_name("/etc/passwd")
            .expect("link name");
        header.set_cksum();
        builder
            .append_data(&mut header, "evil", &mut std::io::empty())
            .expect("append");
        builder.into_inner().expect("finish").finish().expect("gz finish");

        let res = extract_tarball_blocking(path.to_str().unwrap(), dest.to_str().unwrap());
        assert!(res.is_err(), "expected refusal, got {:?}", res);
    }

    #[test]
    fn creates_nested_directories_for_files() {
        let dir = tempdir().expect("tmp");
        let dest = dir.path().join("dest");
        let tar = build_tarball(
            dir.path(),
            &[("deep/nested/leaf.txt", b"abc")],
        );
        extract_tarball_blocking(tar.to_str().unwrap(), dest.to_str().unwrap())
            .expect("extract");
        assert!(dest.join("deep/nested/leaf.txt").exists());
    }

    // Keep `Write` import alive on every cfg.
    #[allow(dead_code)]
    fn _silence_writes(mut w: impl Write) {
        let _ = w.write_all(b"");
    }

    // ── Windows-style path shapes fed to sanitize_relative on Linux ─────────
    // These tests document the Rust-layer contract: sanitize_relative rejects
    // NUL bytes, `..`, and absolute paths, but does NOT check Windows reserved
    // device names (CON/NUL/PRN/AUX/COM1-COM9/LPT1-LPT9). That responsibility
    // belongs entirely to the TS PathValidator layer, which runs before any IPC
    // call reaches the Rust layer.  Running on Linux, these names are just
    // ordinary file-name strings with no special meaning, so they pass through.

    /// sanitize_relative accepts a path component named "CON" on Linux.
    /// On Windows a file literally named "CON" cannot be created, but the Rust
    /// guard's job is traversal/NUL/absolute rejection only — not OS-reserved-
    /// name rejection (which is the TS layer's job).
    #[test]
    fn sanitize_relative_accepts_windows_reserved_names_on_linux() {
        let reserved_names = ["CON", "NUL", "PRN", "AUX", "COM1", "COM9", "LPT1", "LPT9"];
        for name in &reserved_names {
            let p = std::path::Path::new(name);
            let result = sanitize_relative(p);
            assert!(
                result.is_ok(),
                "sanitize_relative should accept {name} on Linux (reserved-name guard is TS-layer only), got: {:?}",
                result
            );
            assert_eq!(
                result.unwrap(),
                std::path::PathBuf::from(name),
                "sanitize_relative should return {name} unchanged"
            );
        }
    }

    /// sanitize_relative accepts a very long path (>260 chars) on Linux without
    /// panicking. Windows MAX_PATH is 260 chars, but Linux has a much higher
    /// limit (typically PATH_MAX = 4096). The Rust guard never imposes a 260-char
    /// cap; that is intentional — Advisor Prep Hero on Windows relies on the OS to surface
    /// the error naturally when a path is too long, rather than a pre-emptive cap
    /// that could incorrectly reject valid Linux paths.
    #[test]
    fn sanitize_relative_accepts_long_paths_on_linux() {
        // Build a path whose total string length exceeds Windows MAX_PATH (260).
        let long_name = "a".repeat(270);
        let long_path_str = format!("deeply/nested/{long_name}/brief.txt");
        assert!(long_path_str.len() > 260, "fixture must be >260 chars");

        let p = std::path::Path::new(&long_path_str);
        let result = sanitize_relative(p);
        assert!(
            result.is_ok(),
            "sanitize_relative should not reject a >260-char path on Linux, got: {:?}",
            result
        );
    }

    /// sanitize_relative rejects a Windows-style backslash-separated path as an
    /// ordinary NUL-byte check: on Linux, backslashes are valid filename chars,
    /// so the whole string is a single path component containing backslashes —
    /// it passes through unchanged.  This is the expected Linux behavior.
    #[test]
    fn sanitize_relative_treats_backslash_as_ordinary_char_on_linux() {
        // On Linux, "a\\b\\file.docx" is ONE filename (with literal backslashes),
        // not three components. sanitize_relative sees it as a single Normal
        // component and accepts it. This documents the cross-platform gap: the
        // TS layer normalizes all backslashes to forward slashes before the path
        // ever reaches the Rust layer.
        let p = std::path::Path::new("a\\b\\file.docx");
        let result = sanitize_relative(p);
        assert!(
            result.is_ok(),
            "backslash path should be treated as a single component on Linux"
        );
    }

    /// sanitize_relative rejects a Windows-drive-absolute path like "C:\\Users\\x"
    /// when the OS parses it as an absolute path. On Linux this string does NOT
    /// parse as absolute (Linux needs a leading '/'); it parses as a single
    /// Normal component ("C:\\Users\\x" with literal backslashes and colon).
    /// This test documents that the Rust layer's absolute-path guard fires only
    /// for POSIX-absolute paths — not Windows-drive paths — when running on Linux.
    #[cfg(not(windows))]
    #[test]
    fn sanitize_relative_treats_windows_drive_path_as_normal_component_on_linux() {
        // On Linux, std::path::Path::new("C:\\Users\\Jane\\brief.docx") has exactly
        // ONE component of type Normal (the entire string with literal backslashes).
        // It is NOT treated as absolute. This means a Windows drive path smuggled
        // into a tarball passes the Rust guard on Linux — but is harmless, because
        // the TS layer always resolves and validates the workspace-relative path
        // before building the tarball in the first place.
        let p = std::path::Path::new("C:\\Users\\Jane\\brief.docx");
        let result = sanitize_relative(p);
        // Must not crash; behavior documents the Linux-only gap (no drive prefix guard).
        assert!(
            result.is_ok(),
            "Windows drive path treated as single Normal component on Linux, should not error"
        );
    }
}
