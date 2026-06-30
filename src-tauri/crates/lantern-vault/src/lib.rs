//! lantern-vault — at-rest encryption for workspace document files.
//! Pure crate: file format, atomic write, BIP39 recovery, metadata. No Tauri.

pub mod format;
pub mod atomic;
pub mod recovery;
pub mod verifier;
pub mod metadata;
pub mod vault;

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() { assert_eq!(2 + 2, 4); }
}
