// Native keychain commands - Phase 2 Rust foundation for v1.5.
//
// The frontend already has a `KeychainService` abstraction that today
// falls back to an encrypted file on disk. These commands let the desktop
// build use the real OS keychain instead:
//
//   - macOS   : Keychain Services
//   - Windows : Credential Manager
//   - Linux   : Secret Service (gnome-keyring / KWallet via D-Bus)
//
// Default service namespace is `com.projelli.app`. Callers may override
// when storing keys for scoped features later (e.g. `com.projelli.sync`).

use serde::{Deserialize, Serialize};

const DEFAULT_SERVICE: &str = "com.projelli.app";

/// Structured error returned to the frontend. Separating "not found" from
/// "unsupported platform" from "generic backend error" lets the frontend
/// show useful hints (e.g. "Install gnome-keyring" on Linux desktop without
/// a secret service daemon running).
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase", tag = "kind", content = "message")]
pub enum KeychainError {
    NotFound(String),
    NoBackend(String),
    Denied(String),
    Other(String),
}

impl std::fmt::Display for KeychainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeychainError::NotFound(m) => write!(f, "not found: {}", m),
            KeychainError::NoBackend(m) => write!(f, "no backend: {}", m),
            KeychainError::Denied(m) => write!(f, "denied: {}", m),
            KeychainError::Other(m) => write!(f, "other: {}", m),
        }
    }
}

/// Map a `keyring::Error` into our structured `KeychainError`. Kept as a
/// pure function so it can be unit-tested without touching a real keyring.
pub fn map_keyring_error(err: &keyring::Error) -> KeychainError {
    use keyring::Error as KE;
    match err {
        KE::NoEntry => KeychainError::NotFound("no matching entry".to_string()),
        KE::PlatformFailure(e) => KeychainError::Other(format!("platform failure: {}", e)),
        KE::NoStorageAccess(e) => {
            KeychainError::Denied(format!("no storage access: {}", e))
        }
        KE::BadEncoding(_) => {
            KeychainError::Other("keychain returned a non-UTF-8 secret".to_string())
        }
        KE::TooLong(field, max) => {
            KeychainError::Other(format!("{} exceeds max length {}", field, max))
        }
        KE::Invalid(field, msg) => {
            KeychainError::Other(format!("invalid {}: {}", field, msg))
        }
        KE::Ambiguous(_) => {
            KeychainError::Other("more than one matching keychain entry".to_string())
        }
        other => KeychainError::Other(format!("{}", other)),
    }
}

fn resolve_service(service: Option<String>) -> String {
    service
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SERVICE.to_string())
}

fn entry(service: &str, key: &str) -> Result<keyring::Entry, KeychainError> {
    keyring::Entry::new(service, key).map_err(|e| map_keyring_error(&e))
}

/// Store a secret under (service, key). Overwrites any existing value.
#[tauri::command]
pub async fn keychain_set(
    service: Option<String>,
    key: String,
    value: String,
) -> Result<(), KeychainError> {
    let svc = resolve_service(service);
    let entry = entry(&svc, &key)?;
    entry
        .set_password(&value)
        .map_err(|e| map_keyring_error(&e))
}

/// Read a secret by (service, key). Returns `NotFound` if no entry exists.
#[tauri::command]
pub async fn keychain_get(
    service: Option<String>,
    key: String,
) -> Result<String, KeychainError> {
    let svc = resolve_service(service);
    let entry = entry(&svc, &key)?;
    entry.get_password().map_err(|e| map_keyring_error(&e))
}

/// Delete a stored secret. Succeeds silently if the entry didn't exist, so
/// "remove my Anthropic key" is idempotent on the frontend.
#[tauri::command]
pub async fn keychain_delete(
    service: Option<String>,
    key: String,
) -> Result<(), KeychainError> {
    let svc = resolve_service(service);
    let entry = entry(&svc, &key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(map_keyring_error(&e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_default_service_when_none_or_blank() {
        assert_eq!(resolve_service(None), DEFAULT_SERVICE);
        assert_eq!(resolve_service(Some("".to_string())), DEFAULT_SERVICE);
        assert_eq!(resolve_service(Some("   ".to_string())), DEFAULT_SERVICE);
    }

    #[test]
    fn resolves_custom_service_when_provided() {
        assert_eq!(
            resolve_service(Some("com.projelli.sync".to_string())),
            "com.projelli.sync"
        );
    }

    #[test]
    fn error_serialization_is_stable_for_frontend() {
        // Frontend pattern-matches on the `kind` tag. Freeze that contract.
        let not_found = KeychainError::NotFound("x".to_string());
        let s = serde_json::to_string(&not_found).expect("serialize");
        assert!(s.contains("\"kind\":\"notFound\""));
        assert!(s.contains("\"message\":\"x\""));

        let no_backend = KeychainError::NoBackend("y".to_string());
        let s = serde_json::to_string(&no_backend).expect("serialize");
        assert!(s.contains("\"kind\":\"noBackend\""));

        let denied = KeychainError::Denied("z".to_string());
        let s = serde_json::to_string(&denied).expect("serialize");
        assert!(s.contains("\"kind\":\"denied\""));

        let other = KeychainError::Other("w".to_string());
        let s = serde_json::to_string(&other).expect("serialize");
        assert!(s.contains("\"kind\":\"other\""));
    }

    #[test]
    fn no_entry_maps_to_not_found() {
        let mapped = map_keyring_error(&keyring::Error::NoEntry);
        assert_eq!(
            mapped,
            KeychainError::NotFound("no matching entry".to_string())
        );
    }

    #[test]
    fn too_long_maps_to_other_with_details() {
        let mapped = map_keyring_error(&keyring::Error::TooLong("password".into(), 512));
        match mapped {
            KeychainError::Other(m) => {
                assert!(m.contains("password"));
                assert!(m.contains("512"));
            }
            other => panic!("expected Other, got {:?}", other),
        }
    }

    #[test]
    fn error_display_includes_message() {
        let e = KeychainError::Denied("no access".to_string());
        assert_eq!(format!("{}", e), "denied: no access");
    }

    /// Live keychain test. Gated behind `PROJELLI_TEST_KEYCHAIN=1` at runtime
    /// so CI (which typically has no secret service daemon running) doesn't
    /// fail. Run locally with `PROJELLI_TEST_KEYCHAIN=1 cargo test -- --test-threads=1`.
    #[test]
    fn live_roundtrip_set_get_delete() {
        if std::env::var_os("PROJELLI_TEST_KEYCHAIN").is_none() {
            return;
        }
        let svc = "com.projelli.app.test";
        let key = "phase2-keychain-test";
        let entry =
            keyring::Entry::new(svc, key).expect("entry should build on this platform");
        entry
            .set_password("hello")
            .expect("set should succeed with secret-service available");
        assert_eq!(entry.get_password().expect("get"), "hello");
        entry.delete_credential().expect("delete");
    }
}
