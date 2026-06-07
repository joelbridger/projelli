// AES-256-GCM encryption for email bodies and metadata.
// Wire format: 12-byte random nonce ‖ ciphertext ‖ 16-byte GCM auth tag.
// The master key (32 bytes) is stored in the OS keychain under
// service = "keepance-mail-enc", key = "master-key-v1".
// All public fns that touch the keychain are async or return Result;
// the core encrypt/decrypt take a key arg so they are unit-testable without a keychain.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "keepance-mail-enc";
const KEYCHAIN_KEY: &str = "master-key-v1";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// ---------------------------------------------------------------------------
// Pure crypto (key passed in — unit-testable without the keychain)
// ---------------------------------------------------------------------------

/// Encrypt `plaintext` under `key` using AES-256-GCM with a random nonce.
/// Returns `nonce ‖ ciphertext ‖ tag` as a heap-allocated blob.
pub fn encrypt_with_key(plaintext: &[u8], key: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).context("init cipher")?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("AES-GCM encrypt: {e}"))?;
    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

/// Decrypt a blob produced by `encrypt_with_key`. Verifies the GCM tag;
/// returns an error if the ciphertext has been tampered with or is truncated.
pub fn decrypt_with_key(blob: &[u8], key: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    if blob.len() < NONCE_LEN {
        anyhow::bail!("blob too short to contain a nonce ({} bytes)", blob.len());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).context("init cipher")?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("AES-GCM decryption failed (tampered or wrong key)"))
}

// ---------------------------------------------------------------------------
// Key management — OS keychain
// ---------------------------------------------------------------------------

/// Get the master key from the OS keychain, creating and storing it on first call.
/// Returns the 32-byte key as a fixed-size array.
pub fn get_or_create_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .context("keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored master key has wrong length: {}", bytes.len());
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
            entry.set_password(&hex).context("store master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("keychain read: {e}")),
    }
}

/// Encrypt `plaintext` using the master key from the OS keychain.
/// This is the public-facing function used by the sync engine.
pub fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>> {
    let key = get_or_create_master_key()?;
    encrypt_with_key(plaintext, &key)
}

/// Decrypt a blob using the master key from the OS keychain.
pub fn decrypt(blob: &[u8]) -> Result<Vec<u8>> {
    let key = get_or_create_master_key()?;
    decrypt_with_key(blob, &key)
}

// ---------------------------------------------------------------------------
// Tests (written before implementation — TDD)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Generates a fresh random 32-byte key for testing, bypassing the keychain.
    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        k
    }

    #[test]
    fn round_trip_plaintext_survives_encrypt_decrypt() {
        let key = test_key();
        let plaintext = b"Confirming May 14. The closing is set for 10am.";
        let blob = encrypt_with_key(plaintext, &key).expect("encrypt");
        let recovered = decrypt_with_key(&blob, &key).expect("decrypt");
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn blob_is_longer_than_plaintext_by_nonce_and_tag() {
        let key = test_key();
        let plaintext = b"hello";
        let blob = encrypt_with_key(plaintext, &key).expect("encrypt");
        // blob = 12-byte nonce + ciphertext (same len as plaintext) + 16-byte GCM tag
        assert_eq!(blob.len(), 12 + plaintext.len() + 16);
    }

    #[test]
    fn two_encryptions_of_same_plaintext_produce_different_blobs() {
        // AEAD with random nonce: ciphertext is non-deterministic.
        let key = test_key();
        let p = b"same text";
        let b1 = encrypt_with_key(p, &key).expect("enc1");
        let b2 = encrypt_with_key(p, &key).expect("enc2");
        assert_ne!(b1, b2, "nonces must differ");
    }

    #[test]
    fn tamper_detection_rejects_modified_ciphertext() {
        let key = test_key();
        let plaintext = b"sensitive data";
        let mut blob = encrypt_with_key(plaintext, &key).expect("encrypt");
        // Flip a byte in the ciphertext body (after the 12-byte nonce).
        blob[12] ^= 0xFF;
        let result = decrypt_with_key(&blob, &key);
        assert!(result.is_err(), "AEAD must reject tampered ciphertext");
    }

    #[test]
    fn tamper_detection_rejects_truncated_blob() {
        let key = test_key();
        let blob = encrypt_with_key(b"data", &key).expect("encrypt");
        // Truncate to just the nonce (no ciphertext or tag).
        let truncated = &blob[..12];
        let result = decrypt_with_key(truncated, &key);
        assert!(result.is_err(), "truncated blob must fail");
    }

    #[test]
    fn wrong_key_is_rejected() {
        let key1 = test_key();
        let key2 = test_key();
        let blob = encrypt_with_key(b"secret", &key1).expect("encrypt");
        let result = decrypt_with_key(&blob, &key2);
        assert!(result.is_err(), "wrong key must fail AEAD auth");
    }

    // Additional coverage: empty plaintext and large plaintext round-trips.

    #[test]
    fn round_trip_empty_plaintext() {
        let key = test_key();
        let plaintext = b"";
        let blob = encrypt_with_key(plaintext, &key).expect("encrypt empty");
        let recovered = decrypt_with_key(&blob, &key).expect("decrypt empty");
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn round_trip_large_plaintext() {
        let key = test_key();
        // 1 MiB of data — exercises buffer handling.
        let plaintext: Vec<u8> = (0..1_048_576).map(|i| (i % 251) as u8).collect();
        let blob = encrypt_with_key(&plaintext, &key).expect("encrypt large");
        let recovered = decrypt_with_key(&blob, &key).expect("decrypt large");
        assert_eq!(recovered, plaintext);
    }
}
