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

use crate::identity;

const INTERNAL_EXACT_SERVICES: &[&str] = &[
    // Encrypted database master keys. These are Rust-owned infrastructure
    // secrets; renderer code must never read, write, or delete them through
    // the generic keychain bridge.
    identity::AUDIT_ENC_SERVICE,
    identity::MAIL_ENC_SERVICE,
    identity::VECTORS_ENC_SERVICE,
    // Mail connector tokens/config are managed by Rust mail commands.
    identity::MAIL_MS_SERVICE,
    identity::MAIL_IMAP_SERVICE,
    identity::MAIL_GMAIL_SERVICE,
    // OneDrive connector: the Microsoft refresh token lives under this exact
    // service (it does NOT share the `keepance-onedrive-` prefix below). The
    // connector's SQLCipher master key uses `keepance-onedrive-enc`, covered
    // by the prefix. Both are Rust-owned and read via keyring::Entry directly.
    identity::DOCS_MS_SERVICE,
    // CRM connector legacy Wealthbox token slot (pre-`keepance-crm-` naming).
    // The live slots all use the `keepance-crm-` prefix below.
    identity::WEALTHBOX_LEGACY_SERVICE,
    // Bonus connector token slots (Box / ShareFile / Jotform / Zocks / Addepar).
    // Each connector's API token / access token / dev token lives under its exact
    // service name; the matching SQLCipher master keys (`keepance-<name>-enc`) and
    // any future per-connector secret are covered by the prefixes below. All are
    // Rust-owned and read via keyring::Entry directly — the renderer bridge must
    // never read, write, or delete them.
    identity::BOX_SERVICE,
    identity::SHAREFILE_SERVICE,
    identity::JOTFORM_SERVICE,
    identity::ZOCKS_SERVICE,
    identity::ADDEPAR_SERVICE,
    // Calendly connector API token slot (exact). The SQLCipher master key
    // (`keepance-calendly-enc`) and any future Calendly-scoped secret are
    // covered by CALENDLY_SERVICE_PREFIX below.
    identity::CALENDLY_SERVICE,
];
const INTERNAL_SERVICE_PREFIXES: &[&str] = &[
    // Vault VMKs are Rust-owned. Firm collaboration keys use
    // com.keepance.matter/user/device and intentionally remain renderer-owned.
    identity::VAULT_KEYCHAIN_PREFIX,
    // CRM connector namespace. Covers every per-provider token slot
    // (`keepance-crm-wealthbox` / `-salesforce` / `-redtail`, built as
    // `identity::crm_keychain_service(id)` in crm/provider.rs) and the SQLCipher
    // master key (`keepance-crm-enc`). Prefix-based so a future CRM provider
    // under the same namespace is denied to the renderer by default.
    identity::CRM_SERVICE_PREFIX,
    // OneDrive connector namespace. Covers the SQLCipher master key
    // (`keepance-onedrive-enc`) and any future OneDrive-scoped secret. The
    // refresh token's exact service `keepance-docs-ms` is listed above.
    identity::ONEDRIVE_SERVICE_PREFIX,
    // Bonus connector namespaces. Each covers the connector's SQLCipher master
    // key (`keepance-<name>-enc`) plus any future per-connector secret. The bare
    // token slots (`keepance-<name>`) are listed in the exact set above. These
    // do not collide with renderer-owned services (which use the `com.keepance.*`
    // namespace).
    identity::BOX_SERVICE_PREFIX,
    identity::SHAREFILE_SERVICE_PREFIX,
    identity::JOTFORM_SERVICE_PREFIX,
    identity::ZOCKS_SERVICE_PREFIX,
    identity::ADDEPAR_SERVICE_PREFIX,
    // Calendly connector namespace. Covers the SQLCipher master key
    // (`keepance-calendly-enc`) plus any future per-connector secret. The
    // bare API token slot (`keepance-calendly`) is listed in the exact set
    // above. codex-review flagged (2026-07-02, lantern-plus 381cb64a) that
    // this connector was missing from both denylists, letting any renderer
    // code read Calendly credentials directly through the generic bridge.
    identity::CALENDLY_SERVICE_PREFIX,
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
        .unwrap_or_else(|| identity::DEFAULT_KEYCHAIN_SERVICE.to_string())
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
            "service '{service}' is reserved for Advisor Prep Hero internal storage"
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
    use crate::identity;

    #[test]
    fn resolves_default_service_when_none_or_blank() {
        assert_eq!(resolve_service(None), identity::DEFAULT_KEYCHAIN_SERVICE);
        assert_eq!(resolve_service(Some("".to_string())), identity::DEFAULT_KEYCHAIN_SERVICE);
        assert_eq!(resolve_service(Some("   ".to_string())), identity::DEFAULT_KEYCHAIN_SERVICE);
    }

    #[test]
    fn resolves_custom_service_when_provided() {
        let custom = format!("{}.sync", identity::KC_FIRM_NS);
        assert_eq!(
            resolve_service(Some(custom.clone())),
            custom.as_str()
        );
    }

    #[test]
    fn internal_service_names_are_denied_before_keychain_access() {
        assert!(matches!(
            validate_renderer_service_access(identity::AUDIT_ENC_SERVICE)
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
        assert!(matches!(
            validate_renderer_service_access(identity::MAIL_ENC_SERVICE)
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
        assert!(matches!(
            validate_renderer_service_access(identity::VECTORS_ENC_SERVICE)
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
        assert!(matches!(
            validate_renderer_service_access(&identity::vault_keychain_service("workspace-1"))
                .expect_err("internal service must be denied"),
            KeychainError::Denied(_)
        ));
    }

    /// Connector secrets (OneDrive + CRM) must be denied to the renderer bridge
    /// for get/set/delete. These are Rust-owned token + DB-encryption services;
    /// a compromised renderer must not be able to read them via keychain_get.
    #[test]
    fn connector_secret_services_are_denied() {
        // CRM provider service names are dynamic (prefix + provider id), so build them at runtime.
        let crm_wealthbox = identity::crm_keychain_service("wealthbox");
        let crm_salesforce = identity::crm_keychain_service("salesforce");
        let crm_redtail = identity::crm_keychain_service("redtail");
        // Future connectors under the same namespace prefixes must also be denied.
        let future_crm = identity::crm_keychain_service("newprovider");
        let future_onedrive = format!("{}future-secret", identity::ONEDRIVE_SERVICE_PREFIX);
        let future_box = format!("{}future-secret", identity::BOX_SERVICE_PREFIX);
        // Calendly's DB key is a dynamic prefix + suffix (`keepance-calendly-enc`),
        // so build the future-secret probe the same way as the other connectors.
        let future_calendly = format!("{}future-secret", identity::CALENDLY_SERVICE_PREFIX);
        // Every connector service name that exists in the codebase today.
        let denied: &[&str] = &[
            // OneDrive
            identity::DOCS_MS_SERVICE,      // MS refresh token (exact)
            identity::ONEDRIVE_ENC_SERVICE, // SQLCipher master key (prefix)
            // CRM (Wealthbox / Salesforce / Redtail) + legacy slot
            &crm_wealthbox,
            &crm_salesforce,
            &crm_redtail,
            identity::CRM_ENC_SERVICE,           // SQLCipher master key
            identity::WEALTHBOX_LEGACY_SERVICE,  // legacy Wealthbox slot (exact)
            // Bonus connectors: token slot (exact) + SQLCipher DB key (prefix).
            identity::BOX_SERVICE,
            identity::BOX_ENC_SERVICE,
            identity::SHAREFILE_SERVICE,
            identity::SHAREFILE_ENC_SERVICE,
            identity::JOTFORM_SERVICE,
            identity::JOTFORM_ENC_SERVICE,
            identity::ZOCKS_SERVICE,
            identity::ZOCKS_ENC_SERVICE,
            identity::ADDEPAR_SERVICE,
            // Calendly: API token slot (exact) + SQLCipher DB key (prefix).
            identity::CALENDLY_SERVICE,
            identity::CALENDLY_ENC_SERVICE,
            // Future connectors under the same namespaces must be denied by default.
            &future_crm,
            &future_onedrive,
            &future_box,
            &future_calendly,
            identity::ADDEPAR_ENC_SERVICE,
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
        let nul_docs_ms = format!("{}\0x", identity::DOCS_MS_SERVICE);
        let nul_wealthbox = format!("{}\0", identity::WEALTHBOX_LEGACY_SERVICE);
        let nul_injection = format!("{}\0{}", identity::DEFAULT_KEYCHAIN_SERVICE, identity::DOCS_MS_SERVICE);
        for svc in [
            nul_docs_ms.as_str(),
            nul_wealthbox.as_str(),
            nul_injection.as_str(),
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
        let svc = resolve_service(Some(identity::DEFAULT_KEYCHAIN_SERVICE.to_string()));
        assert_eq!(svc, identity::DEFAULT_KEYCHAIN_SERVICE);
        assert!(!is_internal_service(&svc));
    }

    /// The renderer legitimately owns the firm collaboration namespaces
    /// (user/matter/device) and the default app service. Adding connector
    /// denials must NOT accidentally deny these.
    #[test]
    fn renderer_owned_services_remain_allowed() {
        let allowed = [
            identity::DEFAULT_KEYCHAIN_SERVICE.to_string(),
            format!("{}.user.abc123", identity::KC_FIRM_NS),
            format!("{}.matter.matter-42", identity::KC_FIRM_NS),
            format!("{}.device.dev-9", identity::KC_FIRM_NS),
            format!("{}.device.meta", identity::KC_FIRM_NS),
        ];
        for svc in &allowed {
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
        let svc = format!("{}.test", identity::DEFAULT_KEYCHAIN_SERVICE);
        let key = "phase2-keychain-test";
        let entry = keyring::Entry::new(&svc, key).expect("entry should build on this platform");
        entry
            .set_password("hello")
            .expect("set should succeed with secret-service available");
        assert_eq!(entry.get_password().expect("get"), "hello");
        entry.delete_credential().expect("delete");
    }
}
