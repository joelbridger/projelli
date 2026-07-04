//! Crash-safe atomic file write: temp sibling -> fsync -> atomic rename.
//!
//! Implements §6 of the encrypted-workspace-vault design spec.
//!
//! Guarantee: a crash before the rename leaves the original file byte-for-byte intact.
//! The rename itself is atomic on POSIX (rename(2)) — a reader always sees either the
//! complete old file or the complete new file, never a half-written file.
//!
//! The writer NEVER opens the target in-place with truncate; it always writes a distinct
//! sibling temp file in the same directory (same filesystem → rename is always atomic),
//! fsyncs it, then renames over the target.
//!
//! Windows note: `fs::rename` over an existing file fails on some Windows configurations.
//! For the Windows target, the private `replace_atomically` helper should be extended to
//! fall back to `ReplaceFileW` / `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`
//! via the `windows-sys` crate behind `#[cfg(windows)]`. Add `windows-sys` as a
//! `[target.'cfg(windows)'.dependencies]` only if the plain-rename test fails on Windows CI.
//! The POSIX path (used here on Linux) needs none. This is a follow-up hardening task.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const TEMP_PREFIX: &str = ".kpv-tmp-";

/// Compute a unique temp path that is a sibling of `path` (same directory).
/// Using a random u64 suffix makes concurrent writers extremely unlikely to collide.
fn temp_path_for(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let rand: u64 = rand::random();
    path.with_file_name(format!("{TEMP_PREFIX}{name}-{rand:016x}"))
}

/// Perform the same-directory atomic replace: rename `tmp` over `dst`.
///
/// Kept in one private fn so a Windows `ReplaceFileW` fallback can be added here
/// later without changing any callers.
fn replace_atomically(tmp: &Path, dst: &Path) -> std::io::Result<()> {
    fs::rename(tmp, dst)
}

/// Write `bytes` to a temp sibling of `path` and fsync it.
/// Returns the temp path WITHOUT renaming over `path`.
///
/// This is the crash-injection seam: production code uses `atomic_write`;
/// tests call this to stop before the rename and verify the original is untouched.
pub fn write_temp_only(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let tmp = temp_path_for(path);
    // `create_new(true)` — O_EXCL: if two concurrent writers race on the same temp
    // name (astronomically unlikely with a 64-bit random suffix), one will error
    // rather than silently overwriting the other.
    let mut f = OpenOptions::new().create_new(true).write(true).open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?; // fsync the temp before we rename
    Ok(tmp)
}

/// Atomically replace `path`'s contents with `bytes`. Crash-safe.
///
/// Steps:
///   1. Write `bytes` to a temp sibling (same dir → same filesystem).
///   2. `fsync` the temp.
///   3. Atomically rename temp → `path`.
///   4. Best-effort `fsync` the containing directory (durability of the rename entry).
///
/// A crash before step 3 leaves the original file intact; the rename in step 3
/// is atomic — no reader ever sees a partial write.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = write_temp_only(path, bytes)?;
    // QA-34: if the atomic replace fails (e.g. antivirus/backup is holding an
    // exclusive lock on the target, or the destination is read-only), the temp
    // sibling we just wrote would otherwise be left behind as an orphan
    // `.kpv-tmp-*` file on every failed save. Clean it up before surfacing the
    // error so a document that's failing to save doesn't also litter the folder.
    // The error is still propagated so the caller (docx_save -> the editor's
    // retry/escalation) knows the write did NOT land.
    if let Err(e) = replace_atomically(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    // Best-effort directory fsync: makes the rename durable across a power loss.
    // Failure here is not fatal — the file content is already correct on disk.
    if let Some(dir) = path.parent() {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

/// Remove all orphan `.kpv-tmp-*` files from `dir`.
///
/// Orphans are left behind by a process that crashed after writing the temp but
/// before the rename. They are safe to delete because they represent a write that
/// never completed; the original target file was never touched.
pub fn sweep_temps(dir: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if let Some(name) = entry.file_name().to_str() {
            if name.starts_with(TEMP_PREFIX) {
                // Best-effort: ignore errors (e.g. concurrent sweep).
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn write_replaces_atomically() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.bin");
        fs::write(&path, b"ORIGINAL").unwrap();

        atomic_write(&path, b"NEWCONTENT").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"NEWCONTENT");
        // No temp left behind — only the target file should remain.
        assert_eq!(
            fs::read_dir(dir.path()).unwrap().count(),
            1,
            "atomic_write must leave no temp files behind"
        );
    }

    #[test]
    fn crash_before_rename_preserves_original() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.bin");
        fs::write(&path, b"ORIGINAL").unwrap();

        // write_temp_only stops AFTER fsync, BEFORE rename — the crash-injection seam.
        let tmp = write_temp_only(&path, b"NEWCONTENT").unwrap();

        assert_eq!(
            fs::read(&path).unwrap(),
            b"ORIGINAL",
            "target must be untouched before rename"
        );
        assert!(tmp.exists(), "temp file must exist and hold the new content");
        assert_eq!(fs::read(&tmp).unwrap(), b"NEWCONTENT");

        // sweep_temps removes the orphan temp.
        sweep_temps(dir.path()).unwrap();
        assert!(!tmp.exists(), "sweep_temps must remove the orphan temp");

        // Original is still intact after the sweep.
        assert_eq!(fs::read(&path).unwrap(), b"ORIGINAL");
    }

    #[test]
    fn failed_replace_propagates_error_and_leaves_no_orphan_temp() {
        // QA-34: when the atomic replace fails, atomic_write must (a) surface the
        // error to the caller (so the editor treats the save as FAILED and keeps
        // retrying / escalates), and (b) clean up the temp sibling so a failing
        // save doesn't litter `.kpv-tmp-*` orphans on every attempt.
        //
        // Force the rename to fail cross-platform by making the destination an
        // existing DIRECTORY: renaming a file onto a directory errors on both
        // Unix and Windows.
        let dir = tempdir().unwrap();
        let dst = dir.path().join("target");
        fs::create_dir(&dst).unwrap();

        let err = atomic_write(&dst, b"NEWCONTENT");
        assert!(err.is_err(), "atomic_write must surface the replace failure, not swallow it");

        // No orphan temp left behind — only the pre-existing directory remains.
        let leftover: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with(TEMP_PREFIX))
                    .unwrap_or(false)
            })
            .collect();
        assert!(
            leftover.is_empty(),
            "a failed atomic_write must not leave an orphan temp file, found: {:?}",
            leftover.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn target_is_never_truncated_in_place() {
        // The temp path must be a sibling (same parent) of the target, and must be
        // a distinct path — proving the writer never opened the target for truncation.
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.bin");
        fs::write(&path, b"OLD").unwrap();

        let tmp = write_temp_only(&path, b"NEWER").unwrap();

        // Temp is distinct from the target.
        assert_ne!(tmp, path, "temp path must differ from target path");
        // Temp is in the same directory (same filesystem → rename is atomic).
        assert_eq!(
            tmp.parent(),
            path.parent(),
            "temp must be a same-directory sibling of the target"
        );
        // Target is untouched — if the writer had truncated it, this would be empty.
        assert_eq!(
            fs::read(&path).unwrap(),
            b"OLD",
            "target content must not change before rename"
        );
    }
}
