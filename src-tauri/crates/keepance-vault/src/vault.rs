//! Vault orchestration: open, per-file encrypt/decrypt, resumable walk for migration
//! and the escape-hatch decrypt-all.
//!
//! Implements §7 (VaultFSBackend seam) and §8 (command-layer backing) of the
//! encrypted-workspace-vault design spec.
//!
//! All operations are idempotent through the KPV1 magic-header guard:
//!   - `encrypt_file_at` is a no-op if the file is already encrypted.
//!   - `decrypt_file_to_disk` is a no-op if the file is already plaintext.
//!   - `encrypt_all` / `decrypt_all` resume safely mid-walk (partial failure recovery).

use crate::atomic::{atomic_write, sweep_temps};
use crate::format::{decrypt_file, encrypt_file, has_vault_magic, VaultFormatError};
use std::io;
use std::path::{Path, PathBuf};

/// Unified error type for vault orchestration operations.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("I/O error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("crypto error: {0}")]
    Format(#[from] VaultFormatError),
}

impl VaultError {
    fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        VaultError::Io { path: path.into(), source }
    }
}

// ── Per-file operations ──────────────────────────────────────────────────────

/// Encrypt the file at `path` using `vmk` and write it back atomically.
///
/// **Idempotent:** if the file already has the KPV1 magic header this is a no-op.
/// This guards against double-encryption during a resumed migration.
pub fn encrypt_file_at(path: impl AsRef<Path>, vmk: &[u8; 32]) -> Result<(), VaultError> {
    let path = path.as_ref();
    let bytes = std::fs::read(path).map_err(|e| VaultError::io(path, e))?;
    if has_vault_magic(&bytes) {
        // Already encrypted — idempotent no-op.
        return Ok(());
    }
    let blob = encrypt_file(&bytes, vmk)?;
    atomic_write(path, &blob).map_err(|e| VaultError::io(path, e))
}

/// Read the (possibly encrypted) file at `path` and return its plaintext bytes.
///
/// - If the file starts with KPV1 magic, it is decrypted with `vmk` and the
///   plaintext is returned.
/// - If the file is not vaulted (no magic), the raw bytes are returned unchanged
///   (passthrough for plain files in a mixed vault).
pub fn decrypt_file_at(path: impl AsRef<Path>, vmk: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
    let path = path.as_ref();
    let bytes = std::fs::read(path).map_err(|e| VaultError::io(path, e))?;
    if !has_vault_magic(&bytes) {
        return Ok(bytes);
    }
    Ok(decrypt_file(&bytes, vmk)?)
}

/// Decrypt the file at `path` **in place** (atomic write back to disk).
///
/// **Idempotent:** if the file has no KPV1 magic header this is a no-op.
pub fn decrypt_file_to_disk(path: impl AsRef<Path>, vmk: &[u8; 32]) -> Result<(), VaultError> {
    let path = path.as_ref();
    let bytes = std::fs::read(path).map_err(|e| VaultError::io(path, e))?;
    if !has_vault_magic(&bytes) {
        return Ok(());
    }
    let plaintext = decrypt_file(&bytes, vmk)?;
    atomic_write(path, &plaintext).map_err(|e| VaultError::io(path, e))
}

// ── Walk helpers ─────────────────────────────────────────────────────────────

/// Returns true if a filename should be excluded from vault walks.
///
/// Excluded:
/// - `.keepance-vault.json` — the vault metadata file
/// - `.kpv-tmp-*`           — orphan temp files (handled by `sweep_temps`)
fn should_skip_filename(name: &str) -> bool {
    name == ".keepance-vault.json" || name.starts_with(".kpv-tmp-")
}

/// Recursively encrypt every eligible file under `root` using `vmk`.
///
/// - Sweeps orphan `.kpv-tmp-*` files before visiting each directory.
/// - Skips `.keepance-vault.json` and `.kpv-tmp-*` by filename.
/// - Already-encrypted files (KPV1 magic) are silently skipped (resumable).
/// - A single unreadable/unencryptable file is a hard error (fail closed).
pub fn encrypt_all(root: impl AsRef<Path>, vmk: &[u8; 32]) -> Result<(), VaultError> {
    walk_and_apply(root.as_ref(), vmk, |path, vmk| encrypt_file_at(path, vmk))
}

/// Recursively decrypt every eligible vaulted file under `root` using `vmk`.
///
/// - Sweeps orphan `.kpv-tmp-*` files before visiting each directory.
/// - Skips `.keepance-vault.json` and `.kpv-tmp-*` by filename.
/// - Files without KPV1 magic are silently skipped (already plaintext).
/// - A single unreadable/undecryptable file is a hard error (fail closed).
pub fn decrypt_all(root: impl AsRef<Path>, vmk: &[u8; 32]) -> Result<(), VaultError> {
    walk_and_apply(root.as_ref(), vmk, |path, vmk| decrypt_file_to_disk(path, vmk))
}

/// Internal recursive walker.
///
/// For each directory:
///   1. `sweep_temps` — remove orphan `.kpv-tmp-*` left by crashed previous runs.
///   2. Visit all entries: apply `op` to files, recurse into subdirectories.
///   3. Excluded filenames are skipped before any I/O.
fn walk_and_apply<F>(dir: &Path, vmk: &[u8; 32], op: F) -> Result<(), VaultError>
where
    F: Fn(&Path, &[u8; 32]) -> Result<(), VaultError> + Copy,
{
    // Sweep orphan temps in this directory before processing files.
    sweep_temps(dir).map_err(|e| VaultError::io(dir, e))?;

    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| VaultError::io(dir, e))?
        .collect::<Result<_, _>>()
        .map_err(|e| VaultError::io(dir, e))?;

    // Sort for deterministic ordering (aids reproducibility and testing).
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if should_skip_filename(&name_str) {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| VaultError::io(&path, e))?;

        if file_type.is_dir() {
            walk_and_apply(&path, vmk, op)?;
        } else if file_type.is_file() {
            op(&path, vmk)?;
        }
        // Symlinks are skipped (is_symlink() returns true for symlinks when is_file()/is_dir() are false).
    }

    Ok(())
}
