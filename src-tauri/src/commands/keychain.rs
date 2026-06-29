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
// Default service namespace is `com.keepance.app`. Callers may override
// when storing keys for scoped features later (e.g. `com.keepance.sync`).

use serde::{Deserialize, Serialize};

const DEFAULT_SERVICE: &str = "com.keepance.app";
const INTERNAL_EXACT_SERVICES: &[&str] = &[
    // Encrypted database master keys. These are Rust-owned infrastructure
    // secrets; renderer code must never read, write, or delete them through
    // the generic keychain bridge.
    "keepance-audit-enc",
    "keepance-mail-enc",
    "keepance-vectors-enc",
    // Mail connector tokens/config are managed by Rust mail commands.
    "keepance-mail-ms",
    "keepance-mail-imap",
    "keepance-mail-gmail",
    // OneDrive connector: the Microsoft refresh token lives under this exact
    // service (it does NOT share the `keepance-onedrive-` prefix below). The
    // connector's SQLCipher master key uses `keepance-onedrive-enc`, covered
    // by the prefix. Both are Rust-owned and read via keyring::Entry directly.
    "keepance-docs-ms",
    // CRM connector legacy Wealthbox token slot (pre-`keepance-crm-` naming).
    // The live slots all use the `keepance-crm-` prefix below.
    "keepance-wealthbox",
    // Bonus connector token slots (Box / ShareFile / Jotform / Zocks / Addepar).
    // Each connector's API token / access token / dev token lives under its exact
    // service name; the matching SQLCipher master keys (`keepance-<name>-enc`) and
    // any future per-connector secret are covered by the prefixes below. All are
    // Rust-owned and read via keyring::Entry directly — the renderer bridge must
    // never read, write, or delete them.
    "keepance-box",
    "keepance-sharefile",
    "keepance-jotform",
    "keepance-zocks",
    "keepance-addepar",
];
const INTERNAL_SERVICE_PREFIXES: &[&str] = &[
    // Vault VMKs are Rust-owned. Firm collaboration keys use
    // com.keepance.matter/user/device and intentionally remain renderer-owned.
    "com.keepance.vault.",
    // CRM connector namespace. Covers every per-provider token slot
    // (`keepance-crm-wealthbox` / `-salesforce` / `-redtail`, built as
    // `format!("keepance-crm-{}", id)` in crm/provider.rs) and the SQLCipher
    // master key (`keepance-crm-enc`). Prefix-based so a future CRM provider
    // under the same namespace is denied to the renderer by default.
    "keepance-crm-",
    // OneDrive connector namespace. Covers the SQLCipher master key
    // (`keepance-onedrive-enc`) and any future OneDrive-scoped secret. The
    // refresh token's exact service `keepance-docs-ms` is listed above.
    "keepance-onedrive-",
    // Bonus connector namespaces. Each covers the connector's SQLCipher master
    // key (`keepance-<name>-enc`) plus any future per-connector secret. The bare
    // token slots (`keepance-<name>`) are listed in the exact set above. These
    // do not collide with renderer-owned services (which use the `com.keepance.*`
    // namespace).
    "keepance-box-",
    "keepance-sharefile-",
    "keepance-jotform-",
    "keepance-zocks-",
    "keepance-addepar-",
];

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
        KE::NoStorageAccess(e) => KeychainError::Denied(format!("no storage access: {}", e)),
        KE::BadEncoding(_) => {
            KeychainError::Other("keychain returned a non-UTF-8 secret".to_string())
        }
        KE::TooLong(field, max) => {
            KeychainError::Other(format!("{} exceeds max length {}", field, max))
        }
        KE::Invalid(field, msg) => KeychainError::Other(format!("invalid {}: {}", field, msg)),
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

fn is_internal_service(service: &str) -> bool {
    let normalized = service.trim();
    // Fail closed on control characters (NUL especially). Some OS keychain
    // backends truncate a target name at an interior NUL: on Windows, keyring
    // hands a NUL-terminated string to Credential Manager, so a renderer-
    // supplied name like "keepance-docs-ms\0x" would NOT match the exact
    // denylist below in Rust, yet resolve to the real internal entry at the OS
    // layer — a denylist bypass. Any control character makes the name suspect,
    // and no legitimate renderer-owned service (com.keepance.*) contains one,
    // so we treat it as internal (denied).
    if normalized.chars().any(|c| c.is_control()) {
        return true;
    }
    INTERNAL_EXACT_SERVICES.contains(&normalized)
        || INTERNAL_SERVICE_PREFIXES
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
}

fn validate_renderer_service_access(service: &str) -> Result<(), KeychainError> {
    if is_internal_service(service) {
        return Err(KeychainError::Denied(format!(
            "service '{service}' is reserved for Keepance internal storage"
        )));
    }
    Ok(())
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
    validate_renderer_service_access(&svc)?;
    let entry = entry(&svc, &key)?;
    entry
        .set_password(&value)
        .map_err(|e| map_keyring_error(&e))
}

/// Read a secret by (service, key). Returns `NotFound` if no entry exists.
#[tauri::command]
pub async fn keychain_get(service: Option<String>, key: String) -> Result<String, KeychainError> {
    let svc = resolve_service(service);
    validate_renderer_service_access(&svc)?;
    let entry = entry(&svc, &key)?;
    entry.get_password().map_err(|e| map_keyring_error(&e))
}

/// Delete a stored secret. Succeeds silently if the entry didn't exist, so
/// "remove my Anthropic key" is idempotent on the frontend.
#[tauri::command]
pub async fn keychain_delete(service: Option<String>, key: String) -> Result<(), KeychainError> {
    let svc = resolve_service(service);
    validate_renderer_service_access(&svc)?;
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
            resolve_service(Some("com.keepance.sync".to_string())),
            "com.keepance.sync"
        );
    }

    #[test]
    fn internal_service_names_are_denied_before_keychain_access() {
        assert!(matches!(
            validate_renderer_service_access("keepance-audit-enc")
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
        assert!(matches!(
            validate_renderer_service_access("keepance-mail-enc")
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
        assert!(matches!(
            validate_renderer_service_access("keepance-vectors-enc")
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
        assert!(matches!(
            validate_renderer_service_access("com.keepance.vault.workspace-1")
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
    }

    /// Connector secrets (OneDrive + CRM) must be denied to the renderer bridge
    /// for get/set/delete. These are Rust-owned token + DB-encryption services;
    /// a compromised renderer must not be able to read them via keychain_get.
    #[test]
    fn connector_secret_services_are_denied() {
        // Every connector service name that exists in the codebase today.
        let denied = [
            // OneDrive
            "keepance-docs-ms",      // MS refresh token (exact)
            "keepance-onedrive-enc", // SQLCipher master key (prefix)
            // CRM (Wealthbox / Salesforce / Redtail) + legacy slot
            "keepance-crm-wealthbox",
            "keepance-crm-salesforce",
            "keepance-crm-redtail",
            "keepance-crm-enc", // SQLCipher master key
            "keepance-wealthbox", // legacy Wealthbox slot (exact)
            // Bonus connectors: token slot (exact) + SQLCipher DB key (prefix).
            "keepance-box",
            "keepance-box-enc",
            "keepance-sharefile",
            "keepance-sharefile-enc",
            "keepance-jotform",
            "keepance-jotform-enc",
            "keepance-zocks",
            "keepance-zocks-enc",
            "keepance-addepar",
            // Future connectors under the same namespaces must be denied by default.
            "keepance-crm-newprovider",
            "keepance-onedrive-future-secret",
            "keepance-box-future-secret",
            "keepance-addepar-enc",
        ];
        for svc in denied {
            assert!(
                is_internal_service(svc),
                "service '{svc}' must be classified internal"
            );
            // The renderer bridge denies all three operations equally because
            // every command calls validate_renderer_service_access first.
            assert!(
                matches!(
                    validate_renderer_service_access(svc)
                        .expect_err("connector service must be denied"),
                    KeychainError::Denied(_)
                ),
                "service '{svc}' must be denied to the renderer"
            );
            // Trimmed/padded input must not bypass the check.
            assert!(
                is_internal_service(&format!("  {svc}  ")),
                "padded service '{svc}' must still be denied"
            );
        }
    }

    /// Regression: a control character (e.g. an interior NUL) must not let a
    /// renderer alias an exact-denied connector service. Some OS keychains
    /// truncate the target name at NUL, so this would otherwise resolve to the
    /// real secret. Fail closed: any control char => denied.
    #[test]
    fn control_chars_in_service_are_denied() {
        for svc in [
            "keepance-docs-ms\0x",
            "keepance-wealthbox\0",
            "com.keepance.app\0keepance-docs-ms",
            "normal\u{007f}name",
            "tab\tname",
        ] {
            assert!(
                is_internal_service(svc),
                "service with control char must be denied: {svc:?}"
            );
            assert!(matches!(
                validate_renderer_service_access(svc).expect_err("must deny"),
                KeychainError::Denied(_)
            ));
        }
    }

    #[test]
    fn user_key_service_is_not_denied() {
        let svc = resolve_service(Some("com.keepance.app".to_string()));
        assert_eq!(svc, "com.keepance.app");
        assert!(!is_internal_service(&svc));
    }

    /// The renderer legitimately owns the firm collaboration namespaces
    /// (user/matter/device) and the default app service. Adding connector
    /// denials must NOT accidentally deny these.
    #[test]
    fn renderer_owned_services_remain_allowed() {
        for svc in [
            "com.keepance.app",
            "com.keepance.user.abc123",
            "com.keepance.matter.matter-42",
            "com.keepance.device.dev-9",
            "com.keepance.device.meta",
        ] {
            assert!(
                !is_internal_service(svc),
                "renderer-owned service '{svc}' must stay allowed"
            );
            assert!(validate_renderer_service_access(svc).is_ok());
        }
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

    /// Live keychain test. Gated behind `KEEPANCE_TEST_KEYCHAIN=1` at runtime
    /// so CI (which typically has no secret service daemon running) doesn't
    /// fail. Run locally with `KEEPANCE_TEST_KEYCHAIN=1 cargo test -- --test-threads=1`.
    #[test]
    fn live_roundtrip_set_get_delete() {
        if std::env::var_os("KEEPANCE_TEST_KEYCHAIN").is_none() {
            return;
        }
        let svc = "com.keepance.app.test";
        let key = "phase2-keychain-test";
        let entry = keyring::Entry::new(svc, key).expect("entry should build on this platform");
        entry
            .set_password("hello")
            .expect("set should succeed with secret-service available");
        assert_eq!(entry.get_password().expect("get"), "hello");
        entry.delete_credential().expect("delete");
    }
}
