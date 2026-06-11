//! Vault orchestration: open, per-file encrypt/decrypt, resumable walk for migration and the escape-hatch decrypt-all.
//! Implements §7 (VaultFSBackend seam) and §8 (command-layer backing) of the encrypted-workspace-vault design spec.
