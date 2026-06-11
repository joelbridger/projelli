//! KPV1 on-disk file format: "KPV1" magic + version byte + (12-byte nonce ‖ AES-256-GCM ciphertext ‖ 16-byte tag).
//! Implements §5 of the encrypted-workspace-vault design spec.
