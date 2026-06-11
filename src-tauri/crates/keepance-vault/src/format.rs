//! KPV1 on-disk file format: "KPV1" magic + version byte + (12-byte nonce ‖ AES-256-GCM ciphertext ‖ 16-byte tag).
//! Implements §5 of the encrypted-workspace-vault design spec.
//!
//! Wire format (on disk):
//!   [0..4]   = b"KPV1"      — magic bytes
//!   [4]      = 0x01         — version byte
//!   [5..17]  = 12-byte random nonce
//!   [17..]   = AES-256-GCM ciphertext ‖ 16-byte GCM auth tag
//!
//! This is the same AES-256-GCM scheme used by mail/crypto.rs::encrypt_with_key
//! (12-byte nonce ‖ ct ‖ 16-byte tag), wrapped with the 5-byte KPV1 header.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Key, Nonce,
};

pub const MAGIC: &[u8; 4] = b"KPV1";
pub const VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const HEADER_LEN: usize = 5; // magic(4) + version(1)

#[derive(Debug, thiserror::Error)]
pub enum VaultFormatError {
    #[error("not a vaulted file (no KPV1 magic)")]
    NotVaulted,
    #[error("malformed vault file")]
    Malformed,
    #[error("decryption failed")]
    DecryptFailed,
    #[error("crypto error")]
    Crypto,
}

/// Returns true if `bytes` starts with the KPV1 magic marker.
pub fn has_vault_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && &bytes[..4] == MAGIC
}

/// Encrypt `plaintext` with `key` (AES-256-GCM) and return a KPV1-formatted blob.
///
/// On-disk layout: `"KPV1"(4) + version(1) + nonce(12) + ciphertext+tag(n+16)`.
/// A fresh random nonce is generated for every call via `OsRng`.
pub fn encrypt_file(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, VaultFormatError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| VaultFormatError::Crypto)?;

    let mut out = Vec::with_capacity(HEADER_LEN + NONCE_LEN + ct.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decrypt a KPV1 blob using `key` (AES-256-GCM).
///
/// Errors:
/// - `NotVaulted`    — blob does not start with `KPV1`
/// - `Malformed`     — blob is too short to contain header + nonce + tag, or version mismatch
/// - `DecryptFailed` — GCM tag verification failed (wrong key or tampered ciphertext)
pub fn decrypt_file(blob: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, VaultFormatError> {
    if !has_vault_magic(blob) {
        return Err(VaultFormatError::NotVaulted);
    }
    // Minimum: header(5) + nonce(12) + tag(16) = 33 bytes
    if blob.len() < HEADER_LEN + NONCE_LEN + TAG_LEN {
        return Err(VaultFormatError::Malformed);
    }
    if blob[4] != VERSION {
        return Err(VaultFormatError::Malformed);
    }
    let nonce = Nonce::from_slice(&blob[HEADER_LEN..HEADER_LEN + NONCE_LEN]);
    let ct = &blob[HEADER_LEN + NONCE_LEN..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(nonce, ct)
        .map_err(|_| VaultFormatError::DecryptFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY_A: [u8; 32] = [1u8; 32];
    const KEY_B: [u8; 32] = [2u8; 32];

    #[test]
    fn roundtrip_text_and_binary() {
        for pt in [b"".to_vec(), b"hello world".to_vec(), vec![0u8; 100_000]] {
            let blob = encrypt_file(&pt, &KEY_A).unwrap();
            assert_eq!(&blob[..4], b"KPV1");
            // Guard: only check ciphertext differs from plaintext for non-empty plaintext.
            // An empty plaintext's AES-GCM output is just the 16-byte tag (no plaintext bytes),
            // so a slice-compare of blob[5..] vs pt[..] is meaningless for empty input.
            if !pt.is_empty() {
                assert_ne!(blob[5..], pt[..], "ciphertext must differ from plaintext");
            }
            assert_eq!(decrypt_file(&blob, &KEY_A).unwrap(), pt);
        }
    }

    #[test]
    fn wrong_key_fails_without_garbage() {
        let blob = encrypt_file(b"secret", &KEY_A).unwrap();
        match decrypt_file(&blob, &KEY_B) {
            Err(VaultFormatError::DecryptFailed) => {}
            other => panic!("expected DecryptFailed, got {other:?}"),
        }
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let mut blob = encrypt_file(b"secret message", &KEY_A).unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xFF;
        assert!(matches!(decrypt_file(&blob, &KEY_A), Err(VaultFormatError::DecryptFailed)));
    }

    #[test]
    fn fresh_nonce_each_write() {
        let a = encrypt_file(b"x", &KEY_A).unwrap();
        let b = encrypt_file(b"x", &KEY_A).unwrap();
        assert_ne!(a, b, "two encryptions of the same plaintext must differ (random nonce)");
    }

    #[test]
    fn magic_detection_and_truncation() {
        assert!(!has_vault_magic(b"plain text file"));
        let blob = encrypt_file(b"x", &KEY_A).unwrap();
        assert!(has_vault_magic(&blob));
        assert!(matches!(decrypt_file(&blob[..6], &KEY_A), Err(VaultFormatError::Malformed)));
        assert!(matches!(decrypt_file(b"KPV1\x01ab", &KEY_A), Err(VaultFormatError::Malformed)));
        assert!(matches!(decrypt_file(b"no magic here", &KEY_A), Err(VaultFormatError::NotVaulted)));
    }
}
