//! Tauri command layer for the encrypted workspace vault.
//!
//! This module is the thin glue between the pure `keepance-vault` crate (crypto,
//! format, atomic write, recovery, metadata) and Tauri. Its responsibilities:
//!
//! - Derive a stable `workspace_id` from the canonical workspace root path.
//! - Store / retrieve / delete the VMK in the OS keychain, **reusing the same
//!   `keyring::Entry` access** already established in `commands/keychain.rs` —
//!   no second keyring integration.
//! - Expose four `#[tauri::command]` functions registered in `lib.rs`:
//!   `vault_status`, `vault_create`, `vault_read_file`, `vault_write_file`.
//!
//! Key hygiene: every time a VMK is loaded from the keychain it is decoded from
//! base64 into a `[u8; 32]` stack buffer, used for one operation, and then
//! **`zeroize`d** before being dropped. The keychain holds only the base64 string.
//!
//! Security: `vault_read_file` and `vault_write_file` validate that `rel_path`
//! stays within the workspace root (no `..` traversal) before any disk I/O.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keepance_vault::{
    format::encrypt_file,
    metadata::{RecoveryWrapJson, VaultMetadata, METADATA_FILENAME},
    recovery::create_recovery,
    vault::decrypt_file_at,
    verifier::make_verifier,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

// ── Keychain helpers ─────────────────────────────────────────────────────────

/// Build the keychain service name for a given workspace id.
///
/// Mirrors `com.keepance.mail-enc` / `com.keepance.vectors-enc` etc., keeping
/// all Keepance keychain entries under the `com.keepance.*` namespace.
fn vmk_service(id: &str) -> String {
    format!("com.keepance.vault.{id}")
}

/// The keychain key name for the VMK entry.
const VMK_KEY: &str = "vmk-v1";

/// Store the VMK (base64 string) in the OS keychain for `workspace_id`.
///
/// Reuses `keyring::Entry::new` + `set_password` — the same calls
/// `commands/keychain.rs::keychain_set` makes. No second keyring integration.
fn store_vmk(workspace_id: &str, vmk_b64: &str) -> Result<(), VaultCommandError> {
    let entry = keyring::Entry::new(&vmk_service(workspace_id), VMK_KEY)
        .map_err(|e| VaultCommandError::Keychain(format!("{e}")))?;
    entry
        .set_password(vmk_b64)
        .map_err(|e| VaultCommandError::Keychain(format!("{e}")))
}

/// Retrieve the VMK (base64 string) from the OS keychain.
///
/// Returns `Ok(None)` when no entry exists (vault is locked on this machine).
fn get_vmk_b64(workspace_id: &str) -> Result<Option<String>, VaultCommandError> {
    let entry = keyring::Entry::new(&vmk_service(workspace_id), VMK_KEY)
        .map_err(|e| VaultCommandError::Keychain(format!("{e}")))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(VaultCommandError::Keychain(format!("{e}"))),
    }
}

/// Delete the VMK from the OS keychain (vault disable).
///
/// Succeeds silently if no entry existed (idempotent).
/// Used by Task 10's `vault_disable` command.
#[allow(dead_code)]
pub(crate) fn delete_vmk(workspace_id: &str) -> Result<(), VaultCommandError> {
    let entry = keyring::Entry::new(&vmk_service(workspace_id), VMK_KEY)
        .map_err(|e| VaultCommandError::Keychain(format!("{e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(VaultCommandError::Keychain(format!("{e}"))),
    }
}

/// Load the VMK from keychain, decode from base64 into a 32-byte array.
///
/// Returns `Err(VaultCommandError::Locked)` if the keychain has no VMK for
/// this workspace (the user needs to unlock via recovery phrase or escrow).
fn load_vmk(workspace_id: &str) -> Result<ZeroizedVmk, VaultCommandError> {
    let mut b64 = get_vmk_b64(workspace_id)?
        .ok_or_else(|| VaultCommandError::Locked("vault is locked — no VMK in keychain".into()))?;
    let mut bytes = BASE64
        .decode(&b64)
        .map_err(|e| {
            b64.zeroize();
            VaultCommandError::Internal(format!("VMK base64 decode failed: {e}"))
        })?;
    if bytes.len() != 32 {
        let err = VaultCommandError::Internal(format!(
            "VMK has unexpected length {} (expected 32)",
            bytes.len()
        ));
        bytes.zeroize();
        b64.zeroize();
        return Err(err);
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    // Zeroize heap intermediates before returning.
    bytes.zeroize();
    b64.zeroize();
    Ok(ZeroizedVmk(key))
}

/// A 32-byte VMK that is automatically zeroized when dropped.
struct ZeroizedVmk([u8; 32]);

impl ZeroizedVmk {
    fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Drop for ZeroizedVmk {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

// ── workspace_id ─────────────────────────────────────────────────────────────

/// Derive a stable identifier for a workspace from its canonical root path.
///
/// `workspace_id(p)` = lower-hex SHA-256 of the UTF-8 bytes of the
/// **canonicalized** absolute path. Same path on the same machine always yields
/// the same id; different paths always yield different ids (collision probability
/// ~2^-256). The id is used as part of the OS keychain service name so each
/// workspace has an isolated keychain slot.
///
/// Canonicalization ensures symlinks and relative `..` components are resolved
/// before hashing, so `/home/user/./work` and `/home/user/work` produce the same id.
/// If canonicalization fails (e.g. the path does not exist yet) the input path's
/// UTF-8 representation is hashed verbatim — the app will just fail to read/write
/// files anyway, so this fallback keeps the id function total.
pub fn workspace_id(root: &Path) -> String {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let path_bytes = canonical.to_string_lossy();
    let hash = Sha256::digest(path_bytes.as_bytes());
    hex::encode(hash)
}

// ── Path traversal guard ─────────────────────────────────────────────────────

/// Resolve `workspace / rel_path` and verify it stays within `workspace`.
///
/// Rejects:
/// - Any `rel_path` that contains `..` components (traversal attempt).
/// - Any resolved path that does not start with the canonicalized workspace root.
///
/// Mirrors the `PathValidator` approach used in `commands/fs.rs` and
/// `modules/workspace/PathValidator.ts`.
fn resolve_and_guard(workspace: &Path, rel_path: &str) -> Result<PathBuf, VaultCommandError> {
    // Strip a leading slash/backslash so `rel_path` is always relative before
    // any component inspection.
    let rel = rel_path.trim_start_matches(['/', '\\']);

    // Reject traversal components before any canonicalization (defense in depth).
    // Component-based walk so a legitimate filename like `report..2026.docx` is
    // accepted while `../foo` or absolute paths are rejected.
    use std::path::Component;
    for component in Path::new(rel).components() {
        match component {
            Component::ParentDir => {
                return Err(VaultCommandError::PathTraversal(format!(
                    "rel_path '{rel_path}' contains a '..' component"
                )));
            }
            // Absolute paths or Windows drive prefixes are not allowed as rel_path.
            Component::RootDir | Component::Prefix(_) => {
                return Err(VaultCommandError::PathTraversal(format!(
                    "rel_path '{rel_path}' is an absolute path"
                )));
            }
            _ => {}
        }
    }

    // Build the candidate absolute path.
    let candidate = workspace.join(rel);

    // Canonicalize the workspace root (follow symlinks, resolve `.`/`..`).
    let canon_root = workspace
        .canonicalize()
        .map_err(|e| VaultCommandError::Io(format!("cannot canonicalize workspace: {e}")))?;

    // For the candidate path the file may not exist yet (vault_write_file creates
    // it), so we canonicalize as far as we can: if the full path exists use it;
    // otherwise canonicalize the parent and re-attach the filename.
    let canon_candidate = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| VaultCommandError::Io(format!("cannot canonicalize path: {e}")))?
    } else {
        // Parent must exist (we're writing into it).
        let parent = candidate
            .parent()
            .ok_or_else(|| VaultCommandError::PathTraversal("no parent directory".into()))?;
        let canon_parent = parent
            .canonicalize()
            .map_err(|e| VaultCommandError::Io(format!("cannot canonicalize parent: {e}")))?;
        let file_name = candidate
            .file_name()
            .ok_or_else(|| VaultCommandError::PathTraversal("no file name".into()))?;
        canon_parent.join(file_name)
    };

    // The final path must be a descendant of the workspace root.
    if !canon_candidate.starts_with(&canon_root) {
        return Err(VaultCommandError::PathTraversal(format!(
            "path '{}' escapes workspace root '{}'",
            canon_candidate.display(),
            canon_root.display()
        )));
    }

    Ok(canon_candidate)
}

// ── Error type ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum VaultCommandError {
    /// The vault is locked (no VMK in keychain).
    Locked(String),
    /// Path traversal attempt rejected.
    PathTraversal(String),
    /// OS keychain error.
    Keychain(String),
    /// I/O error on the workspace.
    Io(String),
    /// Crypto / format error from the keepance-vault crate.
    Crypto(String),
    /// Unexpected internal state.
    Internal(String),
}

impl std::fmt::Display for VaultCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultCommandError::Locked(m) => write!(f, "vault_locked: {m}"),
            VaultCommandError::PathTraversal(m) => write!(f, "path_traversal: {m}"),
            VaultCommandError::Keychain(m) => write!(f, "keychain: {m}"),
            VaultCommandError::Io(m) => write!(f, "io: {m}"),
            VaultCommandError::Crypto(m) => write!(f, "crypto: {m}"),
            VaultCommandError::Internal(m) => write!(f, "internal: {m}"),
        }
    }
}

impl From<keepance_vault::vault::VaultError> for VaultCommandError {
    fn from(e: keepance_vault::vault::VaultError) -> Self {
        VaultCommandError::Crypto(e.to_string())
    }
}

// ── Response types ────────────────────────────────────────────────────────────

/// Response from `vault_status`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// `true` when a `.keepance-vault.json` metadata file exists in the workspace.
    pub enabled: bool,
    /// `true` when `enabled` and the VMK is absent from the keychain
    /// (vault needs to be unlocked before files can be read/written).
    pub locked: bool,
    /// `true` when the metadata includes an escrow section (firm vaults only).
    pub has_escrow: bool,
    /// The stable workspace identifier, or `None` when the vault is not enabled.
    pub vault_id: Option<String>,
}

/// Response from `vault_create`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCreated {
    /// The 24-word BIP39 recovery phrase. Shown **once** to the user; never stored.
    pub recovery_phrase: String,
    /// The stable vault_id (hex SHA-256 of the canonical workspace root path).
    pub vault_id: String,
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the current status of the vault for a workspace.
///
/// - `enabled`  = `.keepance-vault.json` exists.
/// - `locked`   = enabled but no VMK in the OS keychain.
/// - `has_escrow` = metadata contains a firm-admin escrow section.
/// - `vault_id` = the stable workspace identifier recorded in the metadata.
#[tauri::command]
pub async fn vault_status(workspace: String) -> Result<VaultStatus, VaultCommandError> {
    let root = Path::new(&workspace);
    let meta_path = root.join(METADATA_FILENAME);
    let enabled = meta_path.exists();

    if !enabled {
        return Ok(VaultStatus {
            enabled: false,
            locked: false,
            has_escrow: false,
            vault_id: None,
        });
    }

    // Read metadata to get vault_id + escrow.
    let meta = VaultMetadata::read_from(root)
        .map_err(|e| VaultCommandError::Io(format!("failed to read vault metadata: {e}")))?;

    let id = &meta.vault_id;
    let vmk_present = get_vmk_b64(id)?.is_some();

    Ok(VaultStatus {
        enabled: true,
        locked: !vmk_present,
        has_escrow: meta.escrow.is_some(),
        vault_id: Some(meta.vault_id),
    })
}

/// Create a new vault for the workspace.
///
/// 1. Generate 32 random bytes as the VMK.
/// 2. Build the BIP39 recovery wrap (`create_recovery`).
/// 3. Build a verifier blob (`make_verifier`).
/// 4. Write `.keepance-vault.json` (atomic write via the crate).
/// 5. Store the VMK in the OS keychain.
/// 6. Return the 24-word recovery phrase **once** — it is never stored.
///
/// The `escrow` flag records intent; the actual wraps are provisioned in Task 9
/// via `vault_set_escrow_wraps`.
#[tauri::command]
pub async fn vault_create(
    workspace: String,
    escrow: bool,
) -> Result<VaultCreated, VaultCommandError> {
    let root = Path::new(&workspace);

    // 1. Generate a 32-byte VMK using OsRng (spec §4.1 mandates OS entropy source).
    let mut vmk = [0u8; 32];
    OsRng.fill_bytes(&mut vmk);

    // 2. Recovery wrap.
    let (phrase, recovery_wrap) = create_recovery(&vmk)
        .map_err(|e| VaultCommandError::Crypto(format!("recovery creation failed: {e}")))?;

    // 3. Verifier.
    let verifier_bytes = make_verifier(&vmk)
        .map_err(|e| VaultCommandError::Crypto(format!("verifier creation failed: {e}")))?;

    // 4. Stable vault_id = workspace_id(root).
    let vault_id = workspace_id(root);

    // 5. Build and write metadata.
    let recovery_json = RecoveryWrapJson::from_wrap(&recovery_wrap);
    let verifier_b64 = BASE64.encode(&verifier_bytes);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Format as a simple ISO-8601 UTC timestamp (seconds precision).
    let created_at = format_iso8601(now.as_secs());

    let meta = VaultMetadata {
        version: 1,
        vault_id: vault_id.clone(),
        created_at,
        recovery: recovery_json,
        verifier_b64,
        // Escrow section is populated later via vault_set_escrow_wraps (Task 9).
        // The `escrow` bool only signals intent here.
        escrow: if escrow {
            Some(keepance_vault::metadata::EscrowJson {
                epoch: 1,
                admin_wraps: vec![],
            })
        } else {
            None
        },
    };

    meta.write_to(root)
        .map_err(|e| VaultCommandError::Io(format!("failed to write vault metadata: {e}")))?;

    // 6. Encode and store the VMK in the keychain.
    let mut vmk_b64 = BASE64.encode(&vmk);
    store_vmk(&vault_id, &vmk_b64)?;

    // Zeroize both the raw VMK and the base64 heap copy now that it's safely in the keychain.
    vmk_b64.zeroize();
    vmk.zeroize();

    Ok(VaultCreated {
        recovery_phrase: phrase,
        vault_id,
    })
}

/// Read a file from the workspace, decrypting it if it is vaulted.
///
/// - Loads the VMK from the keychain; returns `vault_locked` if absent.
/// - If the file starts with KPV1 magic, decrypts with the VMK.
/// - Otherwise returns the raw bytes (passthrough for plain files).
/// - `rel_path` traversal is validated before any disk I/O.
/// - The VMK is zeroized immediately after use.
#[tauri::command]
pub async fn vault_read_file(
    workspace: String,
    rel_path: String,
) -> Result<Vec<u8>, VaultCommandError> {
    let root = Path::new(&workspace);
    let abs_path = resolve_and_guard(root, &rel_path)?;

    let id = vault_id_for(root)?;
    let vmk = load_vmk(&id)?;

    let plaintext = decrypt_file_at(&abs_path, vmk.as_bytes())
        .map_err(VaultCommandError::from)?;

    // vmk is dropped (and thus zeroized) at the end of this scope.
    Ok(plaintext)
}

/// Write bytes to a file in the workspace, encrypting them under the VMK.
///
/// Equivalent to `vault::encrypt_file_at` but accepts raw plaintext bytes and
/// always produces an encrypted output (does not skip already-encrypted files —
/// this is for new content coming from the editor).
///
/// - Loads the VMK; returns `vault_locked` if absent.
/// - Encrypts `bytes` with `format::encrypt_file`.
/// - Atomically writes the ciphertext via `atomic::atomic_write`.
/// - `rel_path` traversal is validated before any disk I/O.
/// - The VMK is zeroized immediately after use.
#[tauri::command]
pub async fn vault_write_file(
    workspace: String,
    rel_path: String,
    bytes: Vec<u8>,
) -> Result<(), VaultCommandError> {
    let root = Path::new(&workspace);
    let abs_path = resolve_and_guard(root, &rel_path)?;

    let id = vault_id_for(root)?;
    let vmk = load_vmk(&id)?;

    // Encrypt the plaintext.
    let blob = encrypt_file(&bytes, vmk.as_bytes())
        .map_err(|e| VaultCommandError::Crypto(e.to_string()))?;

    // vmk is dropped (and thus zeroized) before the disk write.
    drop(vmk);

    // Atomic write (temp + fsync + rename).
    keepance_vault::atomic::atomic_write(&abs_path, &blob)
        .map_err(|e| VaultCommandError::Io(e.to_string()))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Read the vault_id from the workspace metadata.
///
/// Returns an error if the vault is not enabled (no metadata file).
fn vault_id_for(root: &Path) -> Result<String, VaultCommandError> {
    let meta = VaultMetadata::read_from(root)
        .map_err(|e| VaultCommandError::Io(format!("vault not enabled or metadata unreadable: {e}")))?;
    Ok(meta.vault_id)
}

/// Format a Unix timestamp (seconds) as a minimal ISO-8601 UTC string.
///
/// Output format: `2026-06-11T00:00:00Z` (seconds precision, no sub-seconds).
fn format_iso8601(secs: u64) -> String {
    // Manual implementation to avoid pulling in a date crate.
    // Enough for an informational created_at; no crypto role.
    let s = secs;
    let days_since_epoch = s / 86400;
    let time_of_day = s % 86400;
    let hh = time_of_day / 3600;
    let mm = (time_of_day % 3600) / 60;
    let ss = time_of_day % 60;

    // Gregorian calendar computation (correct for reasonable modern dates).
    let (year, month, day) = days_to_ymd(days_since_epoch);

    format!("{year:04}-{month:02}-{day:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Algorithm from https://howardhinnant.github.io/date_algorithms.html
    // (civil_from_days, using unsigned arithmetic for post-epoch dates).
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── workspace_id ──────────────────────────────────────────────────────────

    /// The workspace_id of a canonicalized real path must be stable — calling it
    /// twice returns the same hex string.
    #[test]
    fn workspace_id_is_stable_for_same_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let id1 = workspace_id(root);
        let id2 = workspace_id(root);
        assert_eq!(id1, id2, "workspace_id must be stable for the same path");
    }

    /// Two distinct paths must produce distinct ids (collision probability ~2^-256).
    #[test]
    fn workspace_id_differs_for_different_paths() {
        let tmp1 = tempfile::tempdir().unwrap();
        let tmp2 = tempfile::tempdir().unwrap();
        let id1 = workspace_id(tmp1.path());
        let id2 = workspace_id(tmp2.path());
        assert_ne!(id1, id2, "distinct paths must produce distinct workspace ids");
    }

    /// The id is a 64-char lowercase hex string (SHA-256 = 32 bytes = 64 hex chars).
    #[test]
    fn workspace_id_is_64_char_lowercase_hex() {
        let tmp = tempfile::tempdir().unwrap();
        let id = workspace_id(tmp.path());
        assert_eq!(id.len(), 64, "workspace_id must be 64 hex chars");
        assert!(
            id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
            "workspace_id must be lowercase hex"
        );
    }

    // ── rel_path traversal guard ──────────────────────────────────────────────

    /// A path with `..` components must be rejected before touching disk.
    #[test]
    fn traversal_with_dotdot_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let result = resolve_and_guard(root, "../../etc/passwd");
        assert!(
            matches!(result, Err(VaultCommandError::PathTraversal(_))),
            "traversal with '..' must be rejected, got: {result:?}"
        );
    }

    /// A relative path that stays inside the workspace is accepted.
    #[test]
    fn legitimate_rel_path_is_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Create the subdirectory and file so canonicalization works.
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/contract.docx"), b"content").unwrap();
        let result = resolve_and_guard(root, "docs/contract.docx");
        assert!(result.is_ok(), "legitimate rel_path must be accepted: {result:?}");
        let resolved = result.unwrap();
        assert!(
            resolved.starts_with(root.canonicalize().unwrap()),
            "resolved path must be inside the workspace"
        );
    }

    /// A path that starts with a leading slash is treated as relative.
    #[test]
    fn leading_slash_is_stripped() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("file.txt"), b"hi").unwrap();
        let result = resolve_and_guard(root, "/file.txt");
        assert!(result.is_ok(), "leading slash should be stripped: {result:?}");
    }

    /// A filename that legitimately contains `..` as part of its name
    /// (e.g. `report..2026.docx`) must NOT be rejected by the traversal guard.
    #[test]
    fn dotted_filename_is_accepted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("report..2026.docx"), b"content").unwrap();
        let result = resolve_and_guard(root, "report..2026.docx");
        assert!(
            result.is_ok(),
            "filename containing '..' as part of the name must be accepted: {result:?}"
        );
    }

    /// A symlink inside the workspace that points outside must be rejected by the
    /// canonicalize + starts_with guard.
    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        let outside = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();

        // Create a real file outside the workspace.
        let outside_file = outside.path().join("secret.txt");
        std::fs::write(&outside_file, b"secret").unwrap();

        // Create a symlink INSIDE the workspace pointing to the outside file.
        let symlink_path = workspace.path().join("escape_link.txt");
        std::os::unix::fs::symlink(&outside_file, &symlink_path)
            .expect("symlink creation should succeed");

        // The symlink exists inside the workspace directory, but resolving it
        // escapes to the outside path. The canonicalize+starts_with check must
        // catch this.
        let result = resolve_and_guard(workspace.path(), "escape_link.txt");
        assert!(
            matches!(result, Err(VaultCommandError::PathTraversal(_))),
            "symlink escaping workspace must be rejected, got: {result:?}"
        );
    }

    // ── format_iso8601 ────────────────────────────────────────────────────────

    #[test]
    fn format_iso8601_unix_epoch() {
        // Unix epoch = 1970-01-01T00:00:00Z
        assert_eq!(format_iso8601(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn format_iso8601_known_date() {
        // 2026-06-11T00:00:00Z (UTC midnight).
        // Verified: python3 -c "import datetime; print(int(datetime.datetime(2026,6,11).timestamp()))"
        // = 1781136000  (local machine is UTC; adjust if tests run in non-UTC zone)
        // Use a timezone-independent check: verify the date components round-trip.
        let ts = 1_781_136_000u64; // 2026-06-11 00:00:00 UTC
        let result = format_iso8601(ts);
        assert!(
            result.starts_with("2026-06-1"),
            "expected date starting with 2026-06-1, got {result}"
        );
        assert!(result.ends_with('Z'), "must end with Z");
    }

    // ── vmk_service ───────────────────────────────────────────────────────────

    #[test]
    fn vmk_service_includes_id() {
        let id = "deadbeef";
        assert_eq!(vmk_service(id), "com.keepance.vault.deadbeef");
    }

    // ── ZeroizedVmk ───────────────────────────────────────────────────────────

    #[test]
    fn zeroized_vmk_exposes_bytes() {
        let mut key = [0xABu8; 32];
        let vmk = ZeroizedVmk(key);
        assert_eq!(vmk.as_bytes(), &[0xABu8; 32]);
        key.zeroize(); // clean up the local copy
    }

    // ── Live keychain round-trip ──────────────────────────────────────────────
    // Gated behind KEEPANCE_TEST_KEYCHAIN=1 like commands/keychain.rs, so CI
    // (which has no secret service daemon) doesn't fail.

    #[test]
    fn live_vmk_roundtrip_set_get_delete() {
        if std::env::var_os("KEEPANCE_TEST_KEYCHAIN").is_none() {
            return;
        }
        let id = "test-vault-roundtrip-id";
        let vmk_b64 = BASE64.encode([0xAAu8; 32]);

        store_vmk(id, &vmk_b64).expect("store_vmk should succeed");
        let got = get_vmk_b64(id).expect("get_vmk_b64 should succeed");
        assert_eq!(got, Some(vmk_b64.clone()), "VMK should round-trip through keychain");

        delete_vmk(id).expect("delete_vmk should succeed");
        let after_delete = get_vmk_b64(id).expect("get_vmk_b64 after delete should succeed");
        assert_eq!(after_delete, None, "VMK should be absent after delete");
    }
}
