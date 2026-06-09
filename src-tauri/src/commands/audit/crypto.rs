// Master-key management for the encrypted audit store.
//
// The audit store gets its OWN 32-byte master key, stored in the OS keychain
// under service = "keepance-audit-enc", key = "master-key-v1". It is kept
// separate from the mail key so the two encrypted stores are cryptographically
// independent (compromise/rotation of one does not touch the other). The
// generate-store-return-on-first-use flow mirrors
// `commands/mail/crypto.rs::get_or_create_master_key`.

use anyhow::{Context, Result};
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "keepance-audit-enc";
const KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

/// Get the audit master key from the OS keychain, creating and storing it on
/// first call. Returns the 32-byte key as a fixed-size array.
pub fn get_or_create_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .context("audit keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode audit master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored audit master key has wrong length: {}", bytes.len());
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
            entry.set_password(&hex).context("store audit master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("audit keychain read: {e}")),
    }
}
