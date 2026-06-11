//! `.keepance-vault.json` metadata file: vault identity, recovery wrap, verifier,
//! and optional firm-escrow wraps.
//!
//! Implements §4 + §14 of the encrypted-workspace-vault design spec.
//!
//! The metadata file is written crash-safely via `atomic::atomic_write` so a
//! kill between stages never leaves a partially-written JSON file.
//!
//! File location: `<workspace_root>/.keepance-vault.json`
//!
//! JSON shape (all binary fields are standard base64-encoded):
//! ```json
//! {
//!   "version": 1,
//!   "vault_id": "<uuid or random hex>",
//!   "created_at": "<ISO-8601>",
//!   "recovery": {
//!     "salt_b64": "<base64(16-byte HKDF salt)>",
//!     "wrapped_b64": "<base64(nonce+ct+tag)>"
//!   },
//!   "verifier_b64": "<base64(KPV1 verifier blob)>",
//!   "escrow": null                  // or:
//!   "escrow": {
//!     "epoch": 1,
//!     "admin_wraps": [
//!       { "user_id": "…", "device_id": "…", "wrapped_b64": "…" }
//!     ]
//!   }
//! }
//! ```

use crate::atomic::atomic_write;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Filename written inside the workspace root.
pub const METADATA_FILENAME: &str = ".keepance-vault.json";

// ---------------------------------------------------------------------------
// JSON structs
// ---------------------------------------------------------------------------

/// Root metadata document for an encrypted workspace vault.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VaultMetadata {
    /// Schema version. Must be `1` for this implementation.
    pub version: u32,

    /// Stable identifier for this vault (random hex or UUID assigned at creation).
    pub vault_id: String,

    /// ISO-8601 creation timestamp (UTC). Informational; not used for crypto.
    pub created_at: String,

    /// Base64-encoded recovery wrap fields (HKDF salt + AES-GCM wrapped VMK).
    pub recovery: RecoveryWrapJson,

    /// Base64-encoded KPV1 verifier blob. Decrypts under the VMK to a fixed
    /// plaintext constant, proving the candidate key is correct without touching
    /// real document ciphertext.
    pub verifier_b64: String,

    /// Optional firm-escrow section. `None` for solo vaults; present when one or
    /// more admin devices hold wrapped copies of the VMK for emergency recovery.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escrow: Option<EscrowJson>,
}

/// Base64-encoded representation of a [`crate::recovery::RecoveryWrap`].
///
/// Stored this way in JSON so the binary fields survive round-trips through any
/// JSON parser without quoting or encoding issues.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecoveryWrapJson {
    /// `base64(salt)` — the 16-byte HKDF salt.
    pub salt_b64: String,
    /// `base64(nonce ‖ ciphertext ‖ tag)` — the wrapped VMK blob.
    pub wrapped_b64: String,
}

/// Firm-escrow section: a list of per-admin-device wrapped copies of the VMK,
/// all bound to the same `epoch` counter so stale wraps can be detected after
/// an epoch rotation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EscrowJson {
    /// Monotonically increasing epoch. Incremented on each key rotation.
    pub epoch: u32,
    /// One entry per admin device that holds a wrapped copy of the VMK.
    pub admin_wraps: Vec<AdminWrapJson>,
}

/// A single admin-device VMK wrap entry in the escrow section.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdminWrapJson {
    /// Identifies the admin user (e.g. their Keepance user ID).
    pub user_id: String,
    /// Identifies the admin's device (the ECDH public key fingerprint or device UUID).
    pub device_id: String,
    /// `base64(ECDH-wrapped VMK bytes)` — produced by TS `keyWrap.wrapMatterKey`.
    pub wrapped_b64: String,
}

// ---------------------------------------------------------------------------
// Conversion helpers between binary RecoveryWrap and JSON form
// ---------------------------------------------------------------------------

impl RecoveryWrapJson {
    /// Encode a binary `RecoveryWrap` into its JSON representation.
    pub fn from_wrap(wrap: &crate::recovery::RecoveryWrap) -> Self {
        Self {
            salt_b64: BASE64.encode(&wrap.salt),
            wrapped_b64: BASE64.encode(&wrap.wrapped),
        }
    }

    /// Decode the JSON representation back into a binary `RecoveryWrap`.
    ///
    /// Returns an error if the base64 is malformed.
    pub fn to_wrap(&self) -> Result<crate::recovery::RecoveryWrap, base64::DecodeError> {
        Ok(crate::recovery::RecoveryWrap {
            salt: BASE64.decode(&self.salt_b64)?,
            wrapped: BASE64.decode(&self.wrapped_b64)?,
        })
    }
}

// ---------------------------------------------------------------------------
// Serialisation / IO
// ---------------------------------------------------------------------------

impl VaultMetadata {
    /// Serialise to a pretty-printed JSON string.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Deserialise from a JSON string.
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    /// Read the metadata file from `<dir>/.keepance-vault.json`.
    ///
    /// Returns `Err` if the file is absent, unreadable, or contains invalid JSON.
    pub fn read_from(dir: &Path) -> std::io::Result<Self> {
        let path = dir.join(METADATA_FILENAME);
        let bytes = std::fs::read(&path)?;
        let s = String::from_utf8(bytes)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Self::from_json(&s).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    /// Write the metadata file to `<dir>/.keepance-vault.json` crash-safely.
    ///
    /// Uses `atomic::atomic_write` (temp + fsync + rename) so a kill mid-write
    /// leaves the previous metadata file fully intact.
    pub fn write_to(&self, dir: &Path) -> std::io::Result<()> {
        let path = dir.join(METADATA_FILENAME);
        let json = self
            .to_json()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        atomic_write(&path, json.as_bytes())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_metadata() -> VaultMetadata {
        VaultMetadata {
            version: 1,
            vault_id: "vid-123".into(),
            created_at: "2026-06-11T00:00:00Z".into(),
            recovery: RecoveryWrapJson {
                salt_b64: "AAAA".into(),
                wrapped_b64: "BBBB".into(),
            },
            verifier_b64: "CCCC".into(),
            escrow: Some(EscrowJson {
                epoch: 1,
                admin_wraps: vec![AdminWrapJson {
                    user_id: "u1".into(),
                    device_id: "d1".into(),
                    wrapped_b64: "DDDD".into(),
                }],
            }),
        }
    }

    #[test]
    fn metadata_roundtrips_through_json() {
        let m = sample_metadata();
        let json = m.to_json().unwrap();
        let back = VaultMetadata::from_json(&json).unwrap();
        assert_eq!(back.vault_id, "vid-123");
        assert_eq!(back.escrow.unwrap().admin_wraps[0].device_id, "d1");
    }

    #[test]
    fn metadata_without_escrow_roundtrips() {
        let mut m = sample_metadata();
        m.escrow = None;
        let json = m.to_json().unwrap();
        // The escrow field should be omitted from JSON when None.
        assert!(!json.contains("escrow"), "escrow must be absent from JSON when None");
        let back = VaultMetadata::from_json(&json).unwrap();
        assert!(back.escrow.is_none());
        assert_eq!(back.vault_id, "vid-123");
    }

    #[test]
    fn metadata_write_and_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let m = sample_metadata();
        m.write_to(dir.path()).unwrap();

        // The file must exist.
        let path = dir.path().join(METADATA_FILENAME);
        assert!(path.exists(), ".keepance-vault.json must be written");

        let back = VaultMetadata::read_from(dir.path()).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn metadata_write_is_crash_safe_via_atomic_write() {
        // Verify that write_to produces a single file with no temp left over,
        // using atomic_write under the hood (the atomic write tests already
        // verify the crash-safety contract; here we just confirm no orphan temps).
        let dir = tempfile::tempdir().unwrap();
        let m = sample_metadata();
        m.write_to(dir.path()).unwrap();

        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(entries.len(), 1, "write_to must leave exactly one file (no temp orphans)");
        assert_eq!(
            entries[0].file_name().to_str().unwrap(),
            METADATA_FILENAME
        );
    }

    #[test]
    fn recovery_wrap_json_roundtrips_binary() {
        use crate::recovery::RecoveryWrap;
        let wrap = RecoveryWrap {
            salt: vec![1u8; 16],
            wrapped: vec![2u8; 60],
        };
        let json_form = RecoveryWrapJson::from_wrap(&wrap);
        let back = json_form.to_wrap().unwrap();
        assert_eq!(back.salt, wrap.salt);
        assert_eq!(back.wrapped, wrap.wrapped);
    }

    #[test]
    fn json_rejects_malformed_input() {
        assert!(VaultMetadata::from_json("not json").is_err());
        assert!(VaultMetadata::from_json("{}").is_err()); // missing required fields
        assert!(VaultMetadata::from_json("null").is_err());
    }
}
