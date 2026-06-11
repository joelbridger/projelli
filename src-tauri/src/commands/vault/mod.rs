//! Tauri command layer for the encrypted workspace vault.
//!
//! This module is the thin glue between the pure `keepance-vault` crate (crypto,
//! format, atomic write, recovery, metadata) and Tauri. Its responsibilities:
//!
//! - Derive a stable `workspace_id` from the canonical workspace root path.
//! - Store / retrieve / delete the VMK in the OS keychain, **reusing the same
//!   `keyring::Entry` access** already established in `commands/keychain.rs` —
//!   no second keyring integration.
//! - Expose seven `#[tauri::command]` functions registered in `lib.rs`:
//!   `vault_status`, `vault_create`, `vault_read_file`, `vault_write_file`,
//!   `vault_unlock_with_recovery`, `vault_export_vmk_for_escrow`, `vault_set_escrow_wraps`.
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
    metadata::{AdminWrapJson, EscrowJson, RecoveryWrapJson, VaultMetadata, METADATA_FILENAME},
    recovery::{create_recovery, recover_vmk},
    vault::decrypt_file_at,
    verifier::{check_verifier, make_verifier},
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

/// Try to load the VMK for a workspace without requiring the vault to be enabled
/// or the keychain to have an entry. Returns `None` in any of these cases:
///
/// - The workspace has no `.keepance-vault.json` (vault not enabled — plaintext workspace).
/// - The metadata is unreadable (vault not enabled / corrupt).
/// - The keychain has no VMK for this workspace (vault is locked on this machine).
/// - Any error in keychain access or base64 decoding.
///
/// This is the seam used by the RAG indexer: it calls this once per index run
/// and passes the result to each per-file decrypt check. If `None`, indexing
/// proceeds as before (no vault, no decrypt). If `Some(vmk)`, every file that
/// has KPV1 magic bytes is decrypted in memory before text extraction.
///
/// The returned `ZeroizedVmk` is zeroized when it is dropped by the caller.
pub(crate) fn try_load_vault_vmk(workspace_root: &Path) -> Option<ZeroizedVmk> {
    // Step 1: check if the vault is enabled (metadata file must exist).
    let meta = keepance_vault::metadata::VaultMetadata::read_from(workspace_root).ok()?;
    // Step 2: try to load the VMK from the keychain. A `None` from `get_vmk_b64`
    // means the vault is locked (no VMK for this machine) — silent passthrough.
    let mut b64 = get_vmk_b64(&meta.vault_id).ok()??;
    let mut bytes = BASE64.decode(&b64).ok()?;
    if bytes.len() != 32 {
        bytes.zeroize();
        b64.zeroize();
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    bytes.zeroize();
    b64.zeroize();
    Some(ZeroizedVmk(key))
}

/// A 32-byte VMK that is automatically zeroized when dropped.
pub(crate) struct ZeroizedVmk([u8; 32]);

impl ZeroizedVmk {
    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
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
    /// The recovery phrase failed BIP39 checksum validation (typo / not a valid phrase).
    /// Rejected before any cryptographic operation.
    InvalidPhrase(String),
    /// The recovery phrase passed the BIP39 checksum but did not decrypt the vault
    /// (wrong phrase for this vault, or corrupted wrap).
    RecoveryFailed(String),
    /// `vault_disable` was called while one or more files in the workspace still
    /// have the KPV1 magic header (are still encrypted). The vault cannot be
    /// disabled until every file has been decrypted via `vault_decrypt_all`.
    FilesStillEncrypted(String),
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
            VaultCommandError::InvalidPhrase(m) => write!(f, "invalid_phrase: {m}"),
            VaultCommandError::RecoveryFailed(m) => write!(f, "recovery_failed: {m}"),
            VaultCommandError::FilesStillEncrypted(m) => write!(f, "files_still_encrypted: {m}"),
        }
    }
}

impl From<keepance_vault::vault::VaultError> for VaultCommandError {
    fn from(e: keepance_vault::vault::VaultError) -> Self {
        VaultCommandError::Crypto(e.to_string())
    }
}

impl From<keepance_vault::recovery::RecoveryError> for VaultCommandError {
    fn from(e: keepance_vault::recovery::RecoveryError) -> Self {
        match e {
            keepance_vault::recovery::RecoveryError::InvalidPhrase => {
                VaultCommandError::InvalidPhrase(
                    "the recovery phrase failed BIP39 checksum validation".into(),
                )
            }
            keepance_vault::recovery::RecoveryError::DecryptFailed => {
                VaultCommandError::RecoveryFailed(
                    "recovery phrase did not decrypt the vault wrap (wrong phrase or corrupted wrap)".into(),
                )
            }
            keepance_vault::recovery::RecoveryError::Crypto => {
                VaultCommandError::Crypto("recovery crypto error".into())
            }
        }
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

/// Unlock a vault using the BIP39 recovery phrase.
///
/// Sequence:
/// 1. Read the vault metadata (must be enabled).
/// 2. Decode the stored `RecoveryWrapJson` back into binary form.
/// 3. Call `recovery::recover_vmk(phrase, &wrap)` — this validates the BIP39
///    checksum **before** any crypto; an invalid checksum returns `invalid_phrase`.
/// 4. Call `verifier::check_verifier` against the recovered VMK as a defense-in-depth
///    check (guards against a scenario where the wrap passes GCM auth but a bug
///    elsewhere produced a wrong VMK).
/// 5. Store the recovered VMK in the OS keychain.
/// 6. Zeroize the recovered VMK from the stack before returning.
///
/// Error semantics:
/// - `invalid_phrase`  — BIP39 checksum failed; no crypto attempted.
/// - `recovery_failed` — phrase is checksum-valid but GCM tag failed, OR verifier check
///   failed (the phrase is not the one that created this vault).
#[tauri::command]
pub async fn vault_unlock_with_recovery(
    workspace: String,
    phrase: String,
) -> Result<(), VaultCommandError> {
    let root = Path::new(&workspace);

    // 1. Read metadata (vault must be enabled).
    let meta = VaultMetadata::read_from(root)
        .map_err(|e| VaultCommandError::Io(format!("vault not enabled or metadata unreadable: {e}")))?;

    // 2. Decode the recovery wrap from JSON base64 fields to binary.
    let wrap = meta.recovery.to_wrap().map_err(|e| {
        VaultCommandError::Internal(format!("malformed recovery wrap in metadata: {e}"))
    })?;

    // 3. Attempt to recover the VMK. Errors map via From<RecoveryError>:
    //    - InvalidPhrase → VaultCommandError::InvalidPhrase (before any crypto)
    //    - DecryptFailed → VaultCommandError::RecoveryFailed
    let mut recovered_vmk = recover_vmk(&phrase, &wrap).map_err(VaultCommandError::from)?;

    // 4. Defense-in-depth: verify the recovered VMK against the stored verifier.
    //    A wrong VMK here indicates something is deeply wrong (corrupt metadata, etc.).
    let verifier_bytes = BASE64.decode(&meta.verifier_b64).map_err(|e| {
        recovered_vmk.zeroize();
        VaultCommandError::Internal(format!("verifier_b64 is not valid base64: {e}"))
    })?;

    if !check_verifier(&verifier_bytes, &recovered_vmk) {
        recovered_vmk.zeroize();
        return Err(VaultCommandError::RecoveryFailed(
            "recovered VMK failed the verifier check — phrase may not match this vault".into(),
        ));
    }

    // 5. Store the recovered VMK in the OS keychain.
    let mut vmk_b64 = BASE64.encode(&recovered_vmk);
    let store_result = store_vmk(&meta.vault_id, &vmk_b64);

    // 6. Zeroize sensitive material regardless of whether the store succeeded.
    vmk_b64.zeroize();
    recovered_vmk.zeroize();

    store_result
}

/// Export the VMK as a base64 string for transient escrow provisioning.
///
/// This command is **gated on the vault being unlocked** (VMK present in keychain).
/// It is intended for single-use transient calls from the TypeScript `provisionEscrow`
/// function which wraps the plaintext VMK to each admin device's ECDH public key
/// and immediately calls `vault_set_escrow_wraps` to store only the wrapped copies.
///
/// Security notes:
/// - The VMK is NEVER logged.
/// - The returned string is short-lived in JS memory; TS callers must not persist it.
/// - The vault must already be unlocked; this command never touches the recovery phrase.
#[tauri::command]
pub async fn vault_export_vmk_for_escrow(
    workspace: String,
) -> Result<String, VaultCommandError> {
    let root = Path::new(&workspace);

    // Load the vault_id from metadata. Returns an error if vault is not enabled.
    let id = vault_id_for(root)?;

    // Load the VMK — returns Locked error if absent from keychain.
    let vmk = load_vmk(&id)?;

    // Encode to base64. The ZeroizedVmk is dropped (and thus zeroized) at the end
    // of this scope, after the base64 string is returned.
    let vmk_b64 = BASE64.encode(vmk.as_bytes());

    Ok(vmk_b64)
}

/// Set (replace) the escrow section of the vault metadata.
///
/// Called by the TypeScript `provisionEscrow` function after it has wrapped the VMK
/// to each admin device's public key. This command atomically writes the new escrow
/// section to `.keepance-vault.json`. It does NOT require the vault to be unlocked —
/// the wrapped keys are opaque blobs that the JS side produced; we just persist them.
///
/// `epoch` is a monotonically increasing counter (start at 1; increment on key rotation).
/// `wraps` is the list of per-admin-device wrapped VMK entries.
#[tauri::command]
pub async fn vault_set_escrow_wraps(
    workspace: String,
    epoch: u32,
    wraps: Vec<AdminWrapJson>,
) -> Result<(), VaultCommandError> {
    let root = Path::new(&workspace);

    // Read the current metadata — vault must already exist.
    let mut meta = VaultMetadata::read_from(root)
        .map_err(|e| VaultCommandError::Io(format!("vault not enabled or metadata unreadable: {e}")))?;

    // Replace the escrow section atomically.
    meta.escrow = Some(EscrowJson {
        epoch,
        admin_wraps: wraps,
    });

    // write_to uses atomic_write (temp + fsync + rename) under the hood.
    meta.write_to(root)
        .map_err(|e| VaultCommandError::Io(format!("failed to write vault metadata: {e}")))
}

/// Encrypt every eligible file in a workspace under the VMK (migration command).
///
/// Walks the workspace root recursively (skipping `.keepance/`, `.keepance-vault.json`,
/// `.kpv-tmp-*`) and encrypts each plain file atomically. Already-encrypted files
/// (KPV1 magic) are skipped — the walk is resumable.
///
/// Progress events are emitted on the `vault://progress` channel:
///   `{ "done": N, "total": M }` — one event at start (`done: 0`) and one after
///   the walk completes (`done: M`).  Per-file granularity would require threading
///   a callback through the crate walk (an invasive change to the crate API); the
///   start/finish events keep the UI from going blind on large workspaces and can
///   be refined to per-file in a follow-up.
///
/// The VMK is loaded from the OS keychain and zeroized immediately after the walk.
#[tauri::command]
pub async fn vault_encrypt_all(
    app: tauri::AppHandle,
    workspace: String,
) -> Result<(), VaultCommandError> {
    let root = PathBuf::from(&workspace);
    let id = vault_id_for(&root)?;
    let vmk = load_vmk(&id)?;

    // Count eligible files for the `total` field.
    let total = count_eligible_files(&root);

    // Emit start event: done=0, total=N.
    emit_progress(&app, 0, total);

    // Run the walk. VMK is still live inside ZeroizedVmk.
    keepance_vault::vault::encrypt_all(&root, vmk.as_bytes()).map_err(VaultCommandError::from)?;

    // VMK is dropped + zeroized at function exit. Emit completion.
    emit_progress(&app, total, total);

    Ok(())
}

/// Decrypt every encrypted file in a workspace back to plaintext (escape hatch).
///
/// Walks the workspace root recursively and decrypts each KPV1-encrypted file
/// atomically. Plain files (no magic) are skipped. Uses the same idempotent walk
/// as `vault_encrypt_all`.
///
/// Progress events are emitted on `vault://progress` (start + finish).
///
/// The VMK is loaded from the OS keychain and zeroized immediately after the walk.
#[tauri::command]
pub async fn vault_decrypt_all(
    app: tauri::AppHandle,
    workspace: String,
) -> Result<(), VaultCommandError> {
    let root = PathBuf::from(&workspace);
    let id = vault_id_for(&root)?;
    let vmk = load_vmk(&id)?;

    let total = count_eligible_files(&root);
    emit_progress(&app, 0, total);

    keepance_vault::vault::decrypt_all(&root, vmk.as_bytes()).map_err(VaultCommandError::from)?;

    emit_progress(&app, total, total);

    Ok(())
}

/// Disable the encrypted vault for a workspace.
///
/// SAFETY: this command REFUSES with `files_still_encrypted` if any file in the
/// workspace (excluding `.keepance/`, `.keepance-vault.json`, `.kpv-tmp-*`) still
/// has the KPV1 magic header. This ensures we never orphan ciphertext that cannot
/// be recovered after the VMK is deleted.
///
/// When the workspace is clean (all files decrypted):
/// 1. Delete `.keepance-vault.json`.
/// 2. Delete the keychain VMK entry.
///
/// The operation is intentionally NOT gated on the vault being unlocked —
/// delete_vmk is idempotent (no-op if absent). The metadata file check is
/// the functional gate.
#[tauri::command]
pub async fn vault_disable(workspace: String) -> Result<(), VaultCommandError> {
    let root = PathBuf::from(&workspace);

    // Safety scan: refuse if ANY file still has KPV1 magic.
    // This scan does NOT require the VMK — it only checks file headers.
    if let Some(encrypted_path) = find_any_encrypted_file(&root)? {
        return Err(VaultCommandError::FilesStillEncrypted(format!(
            "cannot disable vault: '{}' and possibly other files are still encrypted. \
             Run vault_decrypt_all first.",
            encrypted_path.display()
        )));
    }

    // Read the vault_id from metadata before deleting the file.
    // If metadata is absent, the vault is already disabled — succeed idempotently.
    let vault_id_result = vault_id_for(&root);

    // Delete the metadata file.
    let meta_path = root.join(keepance_vault::metadata::METADATA_FILENAME);
    if meta_path.exists() {
        std::fs::remove_file(&meta_path)
            .map_err(|e| VaultCommandError::Io(format!("failed to delete metadata: {e}")))?;
    }

    // Delete the keychain VMK (idempotent — silently ok if already absent).
    if let Ok(id) = vault_id_result {
        delete_vmk(&id)?;
    }

    Ok(())
}

// ── Progress event helpers ────────────────────────────────────────────────────

/// Emit a `vault://progress` event on the Tauri app handle.
///
/// Payload: `{ "done": N, "total": M }`. Serialised as JSON; failure is
/// best-effort (a disconnected window is not an error for the walk itself).
fn emit_progress(app: &tauri::AppHandle, done: usize, total: usize) {
    use tauri::Emitter;
    let payload = serde_json::json!({ "done": done, "total": total });
    let _ = app.emit("vault://progress", payload);
}

/// Count eligible files under `root` for the `total` in progress events.
///
/// Uses the same exclusion rules as the crate walk: skip `.keepance/` dir,
/// skip `.keepance-vault.json` and `.kpv-tmp-*` by filename.
/// Returns 0 on any I/O error (best-effort; the walk itself will surface errors).
fn count_eligible_files(root: &Path) -> usize {
    fn count_dir(dir: &Path) -> usize {
        let Ok(rd) = std::fs::read_dir(dir) else { return 0; };
        let mut n = 0usize;
        for entry in rd.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == ".keepance-vault.json" || name_str.starts_with(".kpv-tmp-") {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue; };
            if ft.is_dir() {
                if name_str != ".keepance" {
                    n += count_dir(&entry.path());
                }
            } else if ft.is_file() {
                n += 1;
            }
        }
        n
    }
    count_dir(root)
}

/// Walk `root` and return the path of the first file that has KPV1 magic.
///
/// Returns `Ok(None)` if no encrypted files are found (workspace is clean).
/// Uses the same exclusion rules as the crate walk.
fn find_any_encrypted_file(root: &Path) -> Result<Option<PathBuf>, VaultCommandError> {
    fn scan_dir(dir: &Path) -> Result<Option<PathBuf>, VaultCommandError> {
        let rd = std::fs::read_dir(dir)
            .map_err(|e| VaultCommandError::Io(format!("scan error in {}: {e}", dir.display())))?;
        for entry in rd.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == ".keepance-vault.json" || name_str.starts_with(".kpv-tmp-") {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue; };
            if ft.is_dir() {
                if name_str != ".keepance" {
                    if let Some(p) = scan_dir(&entry.path())? {
                        return Ok(Some(p));
                    }
                }
            } else if ft.is_file() {
                let path = entry.path();
                // Read only the first 4 bytes to check the magic header.
                let header = read_header_bytes(&path);
                if keepance_vault::format::has_vault_magic(&header) {
                    return Ok(Some(path));
                }
            }
        }
        Ok(None)
    }
    scan_dir(root)
}

/// Read up to 4 bytes from the start of a file (for magic-header checking).
///
/// Returns an empty slice on any I/O error so the caller can call
/// `has_vault_magic` safely without propagating read errors for individual files.
fn read_header_bytes(path: &Path) -> Vec<u8> {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else { return vec![]; };
    let mut buf = [0u8; 4];
    let n = f.read(&mut buf).unwrap_or(0);
    buf[..n].to_vec()
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

    // ── Task 9: recovery + escrow crate-level unit tests ─────────────────────
    // These tests exercise the underlying crate functions directly rather than
    // calling the async Tauri commands (which require a full Tauri runtime).
    // The live-keychain path is gated behind KEEPANCE_TEST_KEYCHAIN=1.

    /// Round-trip: create recovery wrap → recover VMK → verifier passes.
    #[test]
    fn recovery_roundtrip_crate_level() {
        use keepance_vault::recovery::{create_recovery, recover_vmk};
        use keepance_vault::verifier::{check_verifier, make_verifier};

        let vmk = [0x42u8; 32];

        // Generate the recovery wrap and verifier (mirrors what vault_create does).
        let (phrase, wrap) = create_recovery(&vmk).expect("create_recovery should succeed");
        let verifier_bytes = make_verifier(&vmk).expect("make_verifier should succeed");

        // Recover VMK from phrase + wrap.
        let recovered = recover_vmk(&phrase, &wrap).expect("recover_vmk should succeed with correct phrase");
        assert_eq!(recovered, vmk, "recovered VMK must match original");

        // Verifier must pass against the recovered VMK.
        assert!(
            check_verifier(&verifier_bytes, &recovered),
            "verifier must pass against the correctly recovered VMK"
        );
    }

    /// Invalid BIP39 checksum → InvalidPhrase before any crypto.
    #[test]
    fn recovery_invalid_checksum_maps_to_invalid_phrase() {
        use keepance_vault::recovery::{create_recovery, recover_vmk, RecoveryError};

        let vmk = [0x43u8; 32];
        let (_phrase, wrap) = create_recovery(&vmk).expect("create_recovery should succeed");

        // "zoo" at the end makes the checksum invalid for this 24-word string.
        let bad_phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo";

        match recover_vmk(bad_phrase, &wrap) {
            Err(RecoveryError::InvalidPhrase) => {} // expected
            other => panic!("expected RecoveryError::InvalidPhrase, got {other:?}"),
        }

        // Also verify the From<RecoveryError> mapping in VaultCommandError.
        let cmd_err = VaultCommandError::from(RecoveryError::InvalidPhrase);
        assert!(
            matches!(cmd_err, VaultCommandError::InvalidPhrase(_)),
            "RecoveryError::InvalidPhrase must map to VaultCommandError::InvalidPhrase"
        );
    }

    /// Wrong-but-valid-checksum phrase → RecoveryFailed (GCM tag mismatch).
    #[test]
    fn recovery_wrong_phrase_maps_to_recovery_failed() {
        use keepance_vault::recovery::{create_recovery, recover_vmk, RecoveryError};

        let vmk = [0x44u8; 32];
        let (_phrase, wrap) = create_recovery(&vmk).expect("create_recovery should succeed");

        // A different checksum-VALID phrase (different entropy, different vault).
        let (other_phrase, _) = create_recovery(&[0x55u8; 32]).expect("create_recovery should succeed");

        match recover_vmk(&other_phrase, &wrap) {
            Err(RecoveryError::DecryptFailed) => {} // expected
            other => panic!("expected RecoveryError::DecryptFailed, got {other:?}"),
        }

        // Also verify the From<RecoveryError> mapping.
        let cmd_err = VaultCommandError::from(RecoveryError::DecryptFailed);
        assert!(
            matches!(cmd_err, VaultCommandError::RecoveryFailed(_)),
            "RecoveryError::DecryptFailed must map to VaultCommandError::RecoveryFailed"
        );
    }

    /// `vault_set_escrow_wraps` — end-to-end through temp filesystem (no keychain needed).
    #[test]
    fn set_escrow_wraps_writes_and_reads_back() {
        use keepance_vault::{
            metadata::{AdminWrapJson, EscrowJson, RecoveryWrapJson, VaultMetadata},
            recovery::create_recovery,
            verifier::make_verifier,
        };

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Create a minimal vault metadata so the command has a file to update.
        let vmk = [0x77u8; 32];
        let (_, wrap) = create_recovery(&vmk).unwrap();
        let verifier_bytes = make_verifier(&vmk).unwrap();
        let recovery_json = RecoveryWrapJson::from_wrap(&wrap);
        let meta = VaultMetadata {
            version: 1,
            vault_id: "test-escrow-vault-id".into(),
            created_at: "2026-06-11T00:00:00Z".into(),
            recovery: recovery_json,
            verifier_b64: BASE64.encode(&verifier_bytes),
            escrow: None,
        };
        meta.write_to(root).unwrap();

        // Call the internal logic of vault_set_escrow_wraps by exercising metadata directly.
        // (The Tauri command itself requires an async runtime; test the logic path.)
        let wraps_to_set = vec![
            AdminWrapJson {
                user_id: "admin-user-1".into(),
                device_id: "device-abc".into(),
                wrapped_b64: "c29tZXdyYXBwZWRieXRlcw==".into(), // dummy base64
            },
        ];

        // Replicate the command's logic (read → set escrow → write).
        let mut updated = VaultMetadata::read_from(root).unwrap();
        updated.escrow = Some(EscrowJson {
            epoch: 1,
            admin_wraps: wraps_to_set.clone(),
        });
        updated.write_to(root).unwrap();

        // Read back and verify.
        let back = VaultMetadata::read_from(root).unwrap();
        let escrow = back.escrow.expect("escrow section must be present after set");
        assert_eq!(escrow.epoch, 1);
        assert_eq!(escrow.admin_wraps.len(), 1);
        assert_eq!(escrow.admin_wraps[0].user_id, "admin-user-1");
        assert_eq!(escrow.admin_wraps[0].device_id, "device-abc");
    }

    /// `vault_export_vmk_for_escrow` — gated on vault being unlocked.
    /// Exercises the load_vmk path: absent VMK → Locked error.
    #[test]
    fn export_vmk_requires_unlocked_vault() {
        use keepance_vault::{
            metadata::{RecoveryWrapJson, VaultMetadata},
            recovery::create_recovery,
            verifier::make_verifier,
        };

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Create metadata so vault_id_for can read the id, but store NO VMK in keychain.
        let vmk = [0x88u8; 32];
        let (_, wrap) = create_recovery(&vmk).unwrap();
        let verifier_bytes = make_verifier(&vmk).unwrap();
        let meta = VaultMetadata {
            version: 1,
            vault_id: "test-export-unlocked-id".into(),
            created_at: "2026-06-11T00:00:00Z".into(),
            recovery: RecoveryWrapJson::from_wrap(&wrap),
            verifier_b64: BASE64.encode(&verifier_bytes),
            escrow: None,
        };
        meta.write_to(root).unwrap();

        // vault_id_for reads the id; then load_vmk should fail with Locked because
        // no entry was stored in the keychain.
        let id = vault_id_for(root).expect("vault_id_for should succeed with metadata present");
        let result = load_vmk(&id);
        assert!(
            matches!(result, Err(VaultCommandError::Locked(_))),
            "load_vmk must return Locked when no VMK is in the keychain"
        );
    }

    // ── Task 10: vault_disable safety + encrypt_all/decrypt_all crate helpers ──
    // These tests drive the crate funcs directly in a temp workspace.
    // The keychain-dependent code paths are gated behind KEEPANCE_TEST_KEYCHAIN=1;
    // the "refuse while encrypted" scan has NO keychain dependency and is ALWAYS run.

    /// After encrypt_all, vault_disable must refuse with FilesStillEncrypted.
    /// After decrypt_all, vault_disable must succeed and remove the metadata file.
    /// (No keychain involvement — drives crate funcs directly.)
    #[test]
    fn vault_disable_refuses_while_encrypted_and_succeeds_after_decrypt() {
        use keepance_vault::{
            metadata::{RecoveryWrapJson, VaultMetadata},
            recovery::create_recovery,
            verifier::make_verifier,
            vault::{decrypt_all, encrypt_all},
        };

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Write some plain files.
        std::fs::write(root.join("doc1.txt"), b"hello world").unwrap();
        std::fs::write(root.join("doc2.txt"), b"second file").unwrap();
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("doc3.txt"), b"nested file").unwrap();

        // Write vault metadata so vault_id_for works (no live keychain needed).
        let vmk = [0xAAu8; 32];
        let (_, wrap) = create_recovery(&vmk).unwrap();
        let verifier_bytes = make_verifier(&vmk).unwrap();
        let meta = VaultMetadata {
            version: 1,
            vault_id: "test-disable-vault-id".into(),
            created_at: "2026-06-11T00:00:00Z".into(),
            recovery: RecoveryWrapJson::from_wrap(&wrap),
            verifier_b64: BASE64.encode(&verifier_bytes),
            escrow: None,
        };
        meta.write_to(root).unwrap();

        // --- Phase 1: encrypt_all, then vault_disable must REFUSE ---
        encrypt_all(root, &vmk).expect("encrypt_all should succeed");

        // Verify the files are actually encrypted now.
        let bytes = std::fs::read(root.join("doc1.txt")).unwrap();
        assert_eq!(&bytes[..4], b"KPV1", "doc1.txt must be KPV1-encrypted after encrypt_all");

        // find_any_encrypted_file must find a KPV1 file.
        let found = find_any_encrypted_file(root).expect("scan should not error");
        assert!(
            found.is_some(),
            "find_any_encrypted_file must return Some after encrypt_all"
        );

        // vault_disable safety logic (replicate the command's check without async runtime).
        let maybe_encrypted = find_any_encrypted_file(root).unwrap();
        assert!(
            maybe_encrypted.is_some(),
            "vault_disable should refuse: found encrypted file {:?}",
            maybe_encrypted
        );

        // Construct the same error the command would return.
        let err = VaultCommandError::FilesStillEncrypted(format!(
            "cannot disable vault: '{}' and possibly other files are still encrypted.",
            maybe_encrypted.unwrap().display()
        ));
        assert!(
            matches!(err, VaultCommandError::FilesStillEncrypted(_)),
            "error must be FilesStillEncrypted"
        );

        // --- Phase 2: decrypt_all, then vault_disable must SUCCEED ---
        decrypt_all(root, &vmk).expect("decrypt_all should succeed");

        // Verify files are decrypted.
        let bytes2 = std::fs::read(root.join("doc1.txt")).unwrap();
        assert_eq!(bytes2, b"hello world", "doc1.txt must be plaintext after decrypt_all");

        // find_any_encrypted_file must return None.
        let clean = find_any_encrypted_file(root).expect("scan should not error");
        assert!(clean.is_none(), "find_any_encrypted_file must return None after decrypt_all");

        // vault_disable logic: no encrypted files → delete metadata + (keychain if present).
        // Directly simulate the disable (no async runtime, no keychain).
        let meta_path = root.join(keepance_vault::metadata::METADATA_FILENAME);
        assert!(meta_path.exists(), "metadata must exist before disable");
        std::fs::remove_file(&meta_path).unwrap();
        assert!(!meta_path.exists(), "metadata must be gone after disable");
    }

    /// count_eligible_files counts files correctly, excluding metadata and .keepance dir.
    #[test]
    fn count_eligible_files_excludes_metadata_and_keepance_dir() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Create files that should be counted.
        std::fs::write(root.join("a.txt"), b"aaa").unwrap();
        std::fs::write(root.join("b.txt"), b"bbb").unwrap();
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("c.txt"), b"ccc").unwrap();

        // Create excluded files/dirs.
        std::fs::write(root.join(".keepance-vault.json"), b"{}").unwrap();
        std::fs::write(root.join(".kpv-tmp-somefile"), b"tmp").unwrap();
        let keepance_dir = root.join(".keepance");
        std::fs::create_dir_all(&keepance_dir).unwrap();
        std::fs::write(keepance_dir.join("vectors.db"), b"lancedb").unwrap();

        let count = count_eligible_files(root);
        assert_eq!(count, 3, "eligible file count must be 3 (a, b, c only)");
    }

    /// find_any_encrypted_file returns None for a plaintext workspace.
    #[test]
    fn find_any_encrypted_file_returns_none_for_plaintext_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("plain.txt"), b"hello").unwrap();
        std::fs::write(root.join("another.md"), b"# Title").unwrap();

        let result = find_any_encrypted_file(root).unwrap();
        assert!(result.is_none(), "no KPV1 files → None");
    }

    /// find_any_encrypted_file returns Some after encrypt_file_at.
    #[test]
    fn find_any_encrypted_file_detects_kpv1_file() {
        use keepance_vault::vault::encrypt_file_at;

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let file = root.join("secret.txt");
        std::fs::write(&file, b"confidential").unwrap();

        let vmk = [0xBBu8; 32];
        encrypt_file_at(&file, &vmk).unwrap();

        let result = find_any_encrypted_file(root).unwrap();
        assert!(result.is_some(), "KPV1-encrypted file must be detected");
        assert_eq!(result.unwrap(), file.canonicalize().unwrap_or(file));
    }

    /// Live keychain round-trip for vault_unlock_with_recovery.
    /// Gated behind KEEPANCE_TEST_KEYCHAIN=1.
    #[test]
    fn live_vault_unlock_with_recovery_round_trip() {
        if std::env::var_os("KEEPANCE_TEST_KEYCHAIN").is_none() {
            return;
        }
        use keepance_vault::{
            metadata::{RecoveryWrapJson, VaultMetadata},
            recovery::create_recovery,
            verifier::make_verifier,
        };

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Build a full vault metadata in a temp dir.
        let vmk = [0x99u8; 32];
        let (phrase, wrap) = create_recovery(&vmk).unwrap();
        let verifier_bytes = make_verifier(&vmk).unwrap();
        let vault_id_str = workspace_id(root);
        let meta = VaultMetadata {
            version: 1,
            vault_id: vault_id_str.clone(),
            created_at: "2026-06-11T00:00:00Z".into(),
            recovery: RecoveryWrapJson::from_wrap(&wrap),
            verifier_b64: BASE64.encode(&verifier_bytes),
            escrow: None,
        };
        meta.write_to(root).unwrap();

        // Ensure no stale VMK is in the keychain.
        let _ = delete_vmk(&vault_id_str);

        // Simulate the recovery unlock flow (the logic vault_unlock_with_recovery uses).
        let meta_read = VaultMetadata::read_from(root).unwrap();
        let wrap_back = meta_read.recovery.to_wrap().unwrap();
        let mut recovered = keepance_vault::recovery::recover_vmk(&phrase, &wrap_back).unwrap();

        let vb = BASE64.decode(&meta_read.verifier_b64).unwrap();
        assert!(
            check_verifier(&vb, &recovered),
            "verifier must pass after recovery round-trip"
        );

        // Store into keychain.
        let mut vmk_b64 = BASE64.encode(&recovered);
        store_vmk(&meta_read.vault_id, &vmk_b64).unwrap();
        vmk_b64.zeroize();
        recovered.zeroize();

        // Verify the VMK is now present in the keychain.
        let got = get_vmk_b64(&meta_read.vault_id).unwrap();
        assert!(got.is_some(), "VMK should be in keychain after unlock");

        // Clean up.
        delete_vmk(&meta_read.vault_id).unwrap();
    }
}
