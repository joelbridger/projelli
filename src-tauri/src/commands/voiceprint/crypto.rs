//! Master key for voiceprint encryption. Byte-for-byte the audit-store pattern
//! (commands/audit/crypto.rs): one keychain-held 32-byte key, generated on
//! first use, hex-encoded in the OS keychain. Voiceprints are biometric data:
//! the key never leaves the keychain, the blobs never leave the machine.
use crate::identity::VOICEPRINT_ENC_SERVICE;

const KEY_NAME: &str = "master-key-v1";

pub fn get_or_create_master_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(VOICEPRINT_ENC_SERVICE, KEY_NAME).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(hex_key) => {
            let bytes = hex::decode(hex_key.trim()).map_err(|e| format!("bad stored key: {e}"))?;
            bytes.try_into().map_err(|_| "stored key is not 32 bytes".to_string())
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            use rand::RngCore;
            rand::rngs::OsRng.fill_bytes(&mut key);
            entry.set_password(&hex::encode(key)).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}
