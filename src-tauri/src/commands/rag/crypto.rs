// Master-key management for the encrypted vector store (chunk text at rest).
//
// The vector store gets its OWN 32-byte master key, stored in the OS keychain
// under service = "keepance-vectors-enc", key = "master-key-v1". It is kept
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
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "keepance-vectors-enc";
const KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

/// Get the vector-store master key from the OS keychain, creating and storing it
/// on first call. Returns the 32-byte key as a fixed-size array.
pub fn get_or_create_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .context("vectors keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode vectors master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored vectors master key has wrong length: {}", bytes.len());
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
            entry.set_password(&hex).context("store vectors master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("vectors keychain read: {e}")),
    }
}
