//! VMK verifier: a small encrypted blob that can confirm a candidate key is correct
//! without decrypting real document data.
//!
//! Implements §4.5 of the encrypted-workspace-vault design spec.
//!
//! The verifier is produced by encrypting a fixed well-known constant
//! (`VERIFIER_PLAINTEXT`) under the VMK using the standard KPV1 format.
//! Checking the verifier decrypts the blob and compares the plaintext to the
//! constant in constant-time-safe manner (no short-circuit on mismatch).
//!
//! Properties:
//! - A wrong key produces a GCM tag failure → `check_verifier` returns false.
//! - A tampered blob produces a GCM tag failure → false.
//! - A malformed blob (not KPV1 or too short) → false.
//! - No panics, no leaking of key material. All failures return false.

use crate::format::{decrypt_file, encrypt_file, VaultFormatError};

/// The fixed plaintext encrypted to form the verifier blob.
/// Must be treated as a public constant — its secrecy provides no security;
/// only the GCM auth tag does.
const VERIFIER_PLAINTEXT: &[u8] = b"lantern-vault-verifier:v1";

/// Produce a verifier blob by encrypting `VERIFIER_PLAINTEXT` under `vmk`.
///
/// The returned blob is in KPV1 format and is safe to store in plain text in
/// `.lantern-vault.json` (base64-encoded). Its secrecy is not required;
/// only `vmk` needs to be secret.
pub fn make_verifier(vmk: &[u8; 32]) -> Result<Vec<u8>, VaultFormatError> {
    encrypt_file(VERIFIER_PLAINTEXT, vmk)
}

/// Return `true` if and only if `blob` is a valid verifier for `vmk`.
///
/// Specifically: the blob must be a well-formed KPV1 ciphertext that decrypts
/// under `vmk` to exactly `VERIFIER_PLAINTEXT`. Any other outcome — wrong key,
/// tampered ciphertext, malformed header, wrong plaintext — returns `false`.
///
/// This function never panics and never returns `true` on failure.
pub fn check_verifier(blob: &[u8], vmk: &[u8; 32]) -> bool {
    match decrypt_file(blob, vmk) {
        Ok(pt) => pt == VERIFIER_PLAINTEXT,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_accepts_correct_key_rejects_wrong() {
        let vmk = [3u8; 32];
        let v = make_verifier(&vmk).unwrap();
        assert!(check_verifier(&v, &vmk), "correct VMK must pass the verifier");
        assert!(!check_verifier(&v, &[4u8; 32]), "wrong VMK must fail the verifier");
    }

    #[test]
    fn check_verifier_returns_false_on_tampered_blob() {
        let vmk = [3u8; 32];
        let mut v = make_verifier(&vmk).unwrap();
        // Flip the last byte (part of the GCM tag).
        let last = v.len() - 1;
        v[last] ^= 0xFF;
        assert!(!check_verifier(&v, &vmk), "tampered blob must fail the verifier");
    }

    #[test]
    fn check_verifier_returns_false_on_malformed_blob() {
        let vmk = [3u8; 32];
        // Not a KPV1 blob at all.
        assert!(!check_verifier(b"not a vault blob", &vmk));
        // KPV1 magic but too short to contain nonce + tag.
        assert!(!check_verifier(b"KPV1\x01short", &vmk));
        // Empty slice.
        assert!(!check_verifier(b"", &vmk));
    }

    #[test]
    fn check_verifier_never_panics_on_garbage() {
        let vmk = [0u8; 32];
        // Throw a variety of garbage at check_verifier — all must return false, not panic.
        for garbage in [
            vec![],
            vec![0u8; 1],
            vec![0xFF; 100],
            b"KPV1\x01".to_vec(),
            b"KPV1\x02".repeat(10),
        ] {
            assert!(!check_verifier(&garbage, &vmk));
        }
    }
}
