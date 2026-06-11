//! Recovery phrase: a BIP39 24-word mnemonic IS the 256-bit entropy. Derive a KEK
//! via HKDF over that entropy and AES-256-GCM-wrap the VMK. (No memory-hard KDF:
//! the input is full 256-bit entropy, so HKDF is sufficient — see the design spec §4.3.)
//!
//! Implements §4.3 of the encrypted-workspace-vault design spec.
//!
//! Wrap blob layout (stored in RecoveryWrap.wrapped):
//!   nonce(12) ‖ ciphertext(32) ‖ tag(16) = 60 bytes total
//!
//! RecoveryWrap also stores:
//!   salt(16) — the HKDF salt (random, stored in metadata)

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};
use bip39::Mnemonic;
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroize;

/// HKDF info string — identifies this key derivation purpose. Versioned so a
/// future change to the derivation parameters doesn't silently break old wraps.
const INFO: &[u8] = b"keepance-vault-recovery-kek:v1";

/// AAD bound to every recovery-wrap ciphertext. A forged or reused nonce cannot
/// produce a valid tag without this AAD matching exactly.
const AAD: &[u8] = b"keepance-vault-recovery:v1";

/// Errors that can occur during recovery-phrase operations.
#[derive(Debug, thiserror::Error)]
pub enum RecoveryError {
    /// The phrase failed BIP39 checksum validation. Rejected before any crypto.
    #[error("invalid recovery phrase (BIP39 checksum failed)")]
    InvalidPhrase,
    /// The GCM tag did not authenticate. The phrase was checksum-valid but does
    /// not match the vault this wrap was created for.
    #[error("decryption failed (wrong recovery phrase or corrupted wrap)")]
    DecryptFailed,
    /// An internal crypto operation failed (entropy generation, HKDF expand, etc.).
    #[error("crypto error")]
    Crypto,
}

/// The persisted blob that allows the VMK to be recovered from the phrase.
///
/// Stored in `.keepance-vault.json`. Neither field is secret on its own;
/// the combination of (salt, wrapped) plus the recovery phrase is what recovers the VMK.
#[derive(Clone, Serialize, Deserialize)]
pub struct RecoveryWrap {
    /// 16-byte random HKDF salt. Stored alongside the wrap so we can re-derive the KEK.
    pub salt: Vec<u8>,
    /// AES-256-GCM output: nonce(12) ‖ ciphertext(32) ‖ tag(16) = 60 bytes.
    pub wrapped: Vec<u8>,
}

/// Derive the 256-bit Recovery KEK from the BIP39 entropy and the stored salt.
///
/// HKDF-SHA256(ikm = entropy, salt = salt, info = INFO) → 32 bytes.
///
/// No memory-hard KDF is used because the IKM carries the full 256-bit entropy
/// of the mnemonic, making brute force computationally infeasible regardless of
/// iteration count (see design spec §4.3).
fn derive_kek(entropy: &[u8], salt: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(salt), entropy);
    let mut kek = [0u8; 32];
    hk.expand(INFO, &mut kek).expect("HKDF-SHA256 expand to 32 bytes is always valid");
    kek
}

/// Generate a 24-word recovery phrase and wrap `vmk` under a KEK derived from it.
///
/// Returns `(phrase_string, RecoveryWrap)`. The phrase is the ONLY way to recover
/// the VMK if the keychain is lost. It must be shown to the user once and never
/// stored by Keepance.
///
/// Security guarantees:
/// - The 256-bit entropy and the derived KEK are zeroized after use.
/// - A fresh random 16-byte HKDF salt and 12-byte AES-GCM nonce are generated
///   on every call so no two wraps ever share key material.
pub fn create_recovery(vmk: &[u8; 32]) -> Result<(String, RecoveryWrap), RecoveryError> {
    // 1. Generate 256 bits of fresh entropy and derive the 24-word mnemonic from it.
    let mut entropy = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy(&entropy).map_err(|_| RecoveryError::Crypto)?;
    let phrase = mnemonic.to_string();

    // 2. Derive the Recovery KEK from the entropy + a fresh random salt.
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut kek = derive_kek(&entropy, &salt);

    // 3. AES-256-GCM-wrap the VMK under the KEK with AAD.
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload { msg: vmk.as_slice(), aad: AAD },
        )
        .map_err(|_| {
            // Zeroize before returning the error so key material is not left in memory.
            entropy.zeroize();
            kek.zeroize();
            RecoveryError::Crypto
        })?;

    // 4. Zeroize sensitive intermediate material now that we're done with it.
    //    The phrase (a string derived from `entropy`) was already cloned above;
    //    `entropy` itself is no longer needed.
    entropy.zeroize();
    kek.zeroize();

    // 5. Build the wrap: nonce(12) ‖ ciphertext(32) ‖ tag(16).
    //    The AES-GCM crate appends the 16-byte tag to the ciphertext, so ct.len() = 32 + 16 = 48.
    let mut wrapped = Vec::with_capacity(12 + ct.len());
    wrapped.extend_from_slice(&nonce_bytes);
    wrapped.extend_from_slice(&ct);

    Ok((phrase, RecoveryWrap { salt: salt.to_vec(), wrapped }))
}

/// Recover the VMK from a 24-word phrase + the stored [`RecoveryWrap`].
///
/// Returns the exact 32-byte VMK on success.
///
/// Error semantics (strict — never weakened):
/// - [`RecoveryError::InvalidPhrase`]  — the phrase failed the BIP39 checksum; rejected
///   **before** any cryptographic operation (no timing oracle, no partial state).
/// - [`RecoveryError::DecryptFailed`]  — the phrase is checksum-valid but the GCM tag
///   did not authenticate (wrong phrase, wrong vault, or corrupted wrap). The keychain
///   is never touched on this path.
pub fn recover_vmk(phrase: &str, wrap: &RecoveryWrap) -> Result<[u8; 32], RecoveryError> {
    // 1. Validate BIP39 checksum BEFORE any crypto. An invalid checksum means the
    //    user made a typo or the phrase is not a BIP39 mnemonic at all.
    let mnemonic =
        Mnemonic::parse_normalized(phrase.trim()).map_err(|_| RecoveryError::InvalidPhrase)?;

    // 2. Extract the 32-byte entropy that the mnemonic encodes.
    //    to_entropy() returns Vec<u8>; for a 24-word mnemonic this is always 32 bytes.
    let entropy = mnemonic.to_entropy();
    debug_assert_eq!(entropy.len(), 32, "24-word BIP39 mnemonic must encode exactly 32 bytes");

    // 3. Re-derive the Recovery KEK from the entropy + stored salt.
    let mut kek = derive_kek(&entropy, &wrap.salt);

    // 4. Split the wrapped blob into nonce and ciphertext+tag.
    if wrap.wrapped.len() < 12 + 16 {
        kek.zeroize();
        return Err(RecoveryError::DecryptFailed);
    }
    let (nonce_bytes, ct) = wrap.wrapped.split_at(12);

    // 5. AES-256-GCM-decrypt. A wrong phrase or tampered wrap will fail the GCM tag here,
    //    returning DecryptFailed (not InvalidPhrase — the phrase was checksum-valid).
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
    let pt = cipher
        .decrypt(
            Nonce::from_slice(nonce_bytes),
            Payload { msg: ct, aad: AAD },
        )
        .map_err(|_| {
            kek.zeroize();
            RecoveryError::DecryptFailed
        })?;

    // 6. Zeroize the KEK now that decryption is done.
    kek.zeroize();

    // 7. Copy the decrypted VMK into a fixed-size array and return it.
    if pt.len() != 32 {
        return Err(RecoveryError::DecryptFailed);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&pt);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_roundtrip_recovers_exact_vmk() {
        let vmk = [7u8; 32];
        let (phrase, wrap) = create_recovery(&vmk).unwrap();
        assert_eq!(phrase.split_whitespace().count(), 24);
        let recovered = recover_vmk(&phrase, &wrap).unwrap();
        assert_eq!(recovered, vmk);
    }

    #[test]
    fn invalid_phrase_checksum_rejected_before_crypto() {
        let vmk = [7u8; 32];
        let (_phrase, wrap) = create_recovery(&vmk).unwrap();
        // This 24-word phrase ends with "zoo" which produces a checksum mismatch.
        let bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo";
        assert!(matches!(recover_vmk(bad, &wrap), Err(RecoveryError::InvalidPhrase)));
    }

    #[test]
    fn correct_checksum_but_wrong_phrase_fails_auth() {
        let vmk = [7u8; 32];
        let (_phrase, wrap) = create_recovery(&vmk).unwrap();
        // A different but checksum-VALID 24-word phrase (different entropy).
        let (other_phrase, _) = create_recovery(&[9u8; 32]).unwrap();
        assert!(matches!(recover_vmk(&other_phrase, &wrap), Err(RecoveryError::DecryptFailed)));
    }

    #[test]
    fn wrap_blob_is_self_describing_and_stable_size() {
        let (_p, wrap) = create_recovery(&[1u8; 32]).unwrap();
        // salt(16) + nonce(12) + ct(32) + tag(16) = 76
        assert_eq!(wrap.salt.len(), 16);
        assert_eq!(wrap.wrapped.len(), 12 + 32 + 16);
    }
}
