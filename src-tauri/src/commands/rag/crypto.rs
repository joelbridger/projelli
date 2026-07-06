// Master-key management for the encrypted vector store (chunk text at rest).
//
// The vector store gets its OWN 32-byte master key, stored in the OS keychain
// under service = "lantern-vectors-enc", key = "master-key-v1". It is kept
// cryptographically independent of the mail and audit keys (compromise or
// rotation of one store does not touch the others). The
// generate-store-return-on-first-use flow mirrors
// `commands/audit/crypto.rs::get_or_create_master_key` and
// `commands/mail/crypto.rs::get_or_create_master_key`.
//
// The actual AES-256-GCM encrypt/decrypt primitives are shared with the mail
// store (`commands/mail/crypto.rs::{encrypt_with_key, decrypt_with_key}`):
// wire format is 12-byte random nonce ‖ ciphertext ‖ 16-byte GCM tag, and the
// vector store stores that blob hex-encoded in the `text` column. This module
// only owns the KEY (which store it belongs to), never re-implements the cipher.

use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;

const KEYCHAIN_SERVICE: &str = crate::identity::VECTORS_ENC_SERVICE;
const KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

/// VG-6e — domain-separation label for the path-token key derivation. The
/// token key is DERIVED from the vector-store master key under this label,
/// so the token keyspace is cryptographically independent of the AES-GCM
/// use of the same master key (and of any future derived key, which must
/// pick its own label).
const PATH_TOKEN_DOMAIN: &[u8] = b"keepance-path-token-v1";

/// VG-6e — deterministic keyed token for the queryable `path` / `source_id`
/// columns: `hex(HMAC-SHA256(token_key, path))` where
/// `token_key = HMAC-SHA256(master_key, "keepance-path-token-v1")`.
///
/// Determinism is the point: every equality predicate the store runs over
/// `path` (upsert's stale-row delete, delete_path, the retag UPDATEs) keeps
/// working verbatim in shape — `path = '<token>'` — while a raw-disk reader
/// sees only an opaque 64-hex-char value, never the client/matter file map.
/// Without the master key the token is not invertible and not even
/// recognisable (an attacker cannot test path guesses without the key).
/// Display recovery does NOT come from the token: the real path travels in
/// the separate AES-256-GCM `path_enc` column and is decrypted on read.
pub fn path_token(master_key: &[u8; KEY_LEN], path: &str) -> String {
    type HmacSha256 = Hmac<Sha256>;
    // P1.1 (Windows correctness): HMAC the NORMALIZED path through the ONE shared
    // normalizer, so `C:\ws\a.docx` (the native form the Rust WalkDir/reconcile
    // sees) and `C:/ws/a.docx` (the forward-slash form the TS side builds via
    // appPath, and passes to retag/delete/index) produce the SAME token. Without
    // this, the two sides tokenized different strings → a retag/delete issued with
    // the TS form matched ZERO rows written under the native form on Windows, so a
    // mapped file could silently drop out of matter-scoped search. `chunk_id`
    // already normalizes; this closes the same trap for the `path` column token.
    // (`normalize_source_path` preserves `mail:<id>` keys verbatim.)
    let normalized = super::store::normalize_source_path(path);
    // Derive the domain-separated token key from the master key.
    let mut kdf = HmacSha256::new_from_slice(master_key).expect("HMAC accepts any key length");
    kdf.update(PATH_TOKEN_DOMAIN);
    let token_key = kdf.finalize().into_bytes();
    // Token = HMAC over the normalized path under the derived key.
    let mut mac = HmacSha256::new_from_slice(&token_key).expect("HMAC accepts any key length");
    mac.update(normalized.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Get the vector-store master key from the OS keychain, creating and storing it
/// on first call. Returns the 32-byte key as a fixed-size array.
pub fn get_or_create_master_key() -> Result<[u8; KEY_LEN]> {
    if let Ok(hex) = std::env::var("LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX") {
        let bytes =
            hex::decode(hex.trim()).context("decode headless test vectors master key hex")?;
        if bytes.len() != KEY_LEN {
            anyhow::bail!(
                "headless test vectors master key has wrong length: {}",
                bytes.len()
            );
        }
        let mut k = [0u8; KEY_LEN];
        k.copy_from_slice(&bytes);
        return Ok(k);
    }

    let entry =
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY).context("vectors keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode vectors master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!(
                    "stored vectors master key has wrong length: {}",
                    bytes.len()
                );
            }
            let mut k = [0u8; KEY_LEN];
            k.copy_from_slice(&bytes);
            Ok(k)
        }
        Err(keyring::Error::NoEntry) => {
            // First call: generate, store, return.
            let mut k = [0u8; KEY_LEN];
            rand::thread_rng().fill_bytes(&mut k);
            let hex = hex::encode(k);
            entry
                .set_password(&hex)
                .context("store vectors master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("vectors keychain read: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_A: [u8; 32] = [0x11u8; 32];
    const KEY_B: [u8; 32] = [0x22u8; 32];

    #[test]
    fn path_token_is_deterministic_for_same_key_and_path() {
        let a = path_token(&KEY_A, "/ws/clients/smith-v-jones.md");
        let b = path_token(&KEY_A, "/ws/clients/smith-v-jones.md");
        assert_eq!(a, b, "the equality-predicate contract needs determinism");
    }

    #[test]
    fn path_token_is_key_dependent() {
        let a = path_token(&KEY_A, "/ws/clients/smith-v-jones.md");
        let b = path_token(&KEY_B, "/ws/clients/smith-v-jones.md");
        assert_ne!(
            a, b,
            "a different master key must produce a different token"
        );
    }

    #[test]
    fn path_token_is_64_hex_chars() {
        let t = path_token(&KEY_A, "mail:AAMk-abc123");
        assert_eq!(t.len(), 64, "HMAC-SHA256 hex is 64 chars");
        assert!(t
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn path_token_distinct_paths_get_distinct_tokens() {
        let a = path_token(&KEY_A, "/ws/a.md");
        let b = path_token(&KEY_A, "/ws/b.md");
        assert_ne!(a, b);
        // And the token never carries the plaintext path bytes.
        assert!(!path_token(&KEY_A, "/ws/very-identifiable.md").contains("very-identifiable"));
    }
}
