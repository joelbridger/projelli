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
// Default service namespace is `com.lantern.app`. Callers may override
// when storing keys for scoped features later (e.g. `com.lantern.sync`).

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::identity;

/// Every keychain op hits a blocking OS call (Windows Credential Manager,
/// macOS Keychain Services, Linux Secret Service over D-Bus). If the
/// underlying service is stopped/disabled/unreachable (e.g. Windows'
/// `VaultSvc`), that call can hang far longer than any UI should wait instead
/// of erroring quickly — QA-33: a stopped `VaultSvc` left workspace-open
/// silently hung for the full 30s frontend timeout with zero user feedback.
///
/// Used to bound READS only (`keychain_get` below, and `vault_status`'s VMK
/// read in `commands/vault/mod.rs`) — classifying a hang as
/// `ServiceUnavailable` within this window rather than riding whatever
/// timeout a caller layers on top. Kept well below the frontend's own
/// 10s-per-key backstop (`useApiKeys.ts`) so that backstop is normally never
/// needed. Deliberately NOT applied to `keychain_set`/`keychain_delete`
/// (codex-review, 2026-07-04): a timeout can only stop *waiting* on the
/// spawned blocking task, not cancel the underlying OS write/delete, so a
/// "timed out" mutation could still complete afterward — leaving the
/// frontend believing an op failed while the OS keychain's real state has
/// already changed. That divergence risk doesn't exist for a read.
pub(crate) const KEYCHAIN_OP_TIMEOUT: Duration = Duration::from_secs(3);

const INTERNAL_EXACT_SERVICES: &[&str] = &[
    // Encrypted database master keys. These are Rust-owned infrastructure
    // secrets; renderer code must never read, write, or delete them through
    // the generic keychain bridge.
    identity::AUDIT_ENC_SERVICE,
    identity::MAIL_ENC_SERVICE,
    identity::VECTORS_ENC_SERVICE,
    identity::LEGACY_CRM_ENC_SERVICE,
    identity::INTAKE_FACTS_ENC_SERVICE,
    // Voiceprint store master key (Wave 4 Track A). Biometric data — the
    // renderer's generic keychain bridge must never read, write, or delete it.
    identity::VOICEPRINT_ENC_SERVICE,
    // Mail connector tokens/config are managed by Rust mail commands.
    identity::MAIL_MS_SERVICE,
    identity::MAIL_IMAP_SERVICE,
    identity::MAIL_GMAIL_SERVICE,
    // OneDrive connector: the Microsoft refresh token lives under this exact
    // service (it does NOT share the `lantern-onedrive-` prefix below). The
    // connector's SQLCipher master key uses `lantern-onedrive-enc`, covered
    // by the prefix. Both are Rust-owned and read via keyring::Entry directly.
    identity::DOCS_MS_SERVICE,
    // CRM connector legacy Wealthbox token slot (pre-`lantern-crm-` naming).
    // The live slots all use the `lantern-crm-` prefix below.
    identity::WEALTHBOX_LEGACY_SERVICE,
    // Bonus connector token slots (Box / ShareFile / Jotform / Zocks / Addepar).
    // Each connector's API token / access token / dev token lives under its exact
    // service name; the matching SQLCipher master keys (`lantern-<name>-enc`) and
    // any future per-connector secret are covered by the prefixes below. All are
    // Rust-owned and read via keyring::Entry directly — the renderer bridge must
    // never read, write, or delete them.
    identity::BOX_SERVICE,
    identity::SHAREFILE_SERVICE,
    identity::JOTFORM_SERVICE,
    identity::ZOCKS_SERVICE,
    identity::ADDEPAR_SERVICE,
    // Calendly connector API token slot (exact). The SQLCipher master key
    // (`lantern-calendly-enc`) and any future Calendly-scoped secret are
    // covered by CALENDLY_SERVICE_PREFIX below.
    identity::CALENDLY_SERVICE,
    // External write-back ledger (RightCapital/Holistiplan planning sockets,
    // Wave 1) SQLCipher master key. codex-review flagged (2026-07-10) that
    // this new service was missing from the denylist, letting any renderer
    // code read or delete the ledger's encryption key directly through the
    // generic keychain bridge.
    identity::WRITEBACK_ENC_SERVICE,
];
const INTERNAL_SERVICE_PREFIXES: &[&str] = &[
    // Vault VMKs are Rust-owned. Firm collaboration keys use
    // com.lantern.matter/user/device and intentionally remain renderer-owned.
    identity::VAULT_KEYCHAIN_PREFIX,
    // CRM connector namespace. Covers every per-provider token slot
    // (`lantern-crm-wealthbox` / `-salesforce` / `-redtail`, built as
    // `identity::crm_keychain_service(id)` in crm/provider.rs) and the SQLCipher
    // master key (`lantern-crm-enc`). Prefix-based so a future CRM provider
    // under the same namespace is denied to the renderer by default.
    identity::CRM_SERVICE_PREFIX,
    // OneDrive connector namespace. Covers the SQLCipher master key
    // (`lantern-onedrive-enc`) and any future OneDrive-scoped secret. The
    // refresh token's exact service `lantern-docs-ms` is listed above.
    identity::ONEDRIVE_SERVICE_PREFIX,
    // Bonus connector namespaces. Each covers the connector's SQLCipher master
    // key (`lantern-<name>-enc`) plus any future per-connector secret. The bare
    // token slots (`lantern-<name>`) are listed in the exact set above. These
    // do not collide with renderer-owned services (which use the `com.lantern.*`
    // namespace).
    identity::BOX_SERVICE_PREFIX,
    identity::SHAREFILE_SERVICE_PREFIX,
    identity::JOTFORM_SERVICE_PREFIX,
    identity::ZOCKS_SERVICE_PREFIX,
    identity::ADDEPAR_SERVICE_PREFIX,
    // Calendar connector namespace. Covers the per-provider OAuth refresh
    // token slots (`lantern-calendar-ms` / `-google`), the secret ICS feed
    // URL (`lantern-calendar-ics` — the URL itself commonly embeds an
    // access token), and the SQLCipher master key (`lantern-calendar-enc`).
    // codex-review P1 (2026-07-02): without this the generic keychain
    // bridge would let any renderer code read these directly.
    identity::CALENDAR_SERVICE_PREFIX,
    // Calendly connector namespace. Covers the SQLCipher master key
    // (`lantern-calendly-enc`) plus any future per-connector secret. The
    // bare API token slot (`lantern-calendly`) is listed in the exact set
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
    /// The OS credential service itself didn't respond within
    /// `KEYCHAIN_OP_TIMEOUT` — distinguishable from `NotFound` (a healthy
    /// backend answering "no such secret") so the frontend can tell a real
    /// service outage (e.g. Windows' Credential Manager / `VaultSvc` stopped)
    /// apart from "key not configured" and show an honest, actionable message
    /// instead of silently treating both the same way.
    ServiceUnavailable(String),
}

impl std::fmt::Display for KeychainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeychainError::NotFound(m) => write!(f, "not found: {}", m),
            KeychainError::NoBackend(m) => write!(f, "no backend: {}", m),
            KeychainError::Denied(m) => write!(f, "denied: {}", m),
            KeychainError::Other(m) => write!(f, "other: {}", m),
            KeychainError::ServiceUnavailable(m) => write!(f, "service unavailable: {}", m),
        }
    }
}

/// Human-readable message used for every `ServiceUnavailable` classification.
/// Kept as one constant so the wording only needs to change in one place.
const SERVICE_UNAVAILABLE_MESSAGE: &str =
    "the OS credential storage service did not respond in time — it may be stopped, disabled, or unreachable";

/// Run a blocking keyring operation off the async runtime thread, bounded by
/// `timeout`. A timeout here means the OS credential service itself didn't
/// respond in time (down/disabled/unreachable) — not that the secret is
/// missing (a healthy backend still returns `NotFound` promptly).
pub(crate) async fn run_keychain_bounded<T, F>(timeout: Duration, op: F) -> Result<T, KeychainError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, KeychainError> + Send + 'static,
{
    match tokio::time::timeout(timeout, tokio::task::spawn_blocking(op)).await {
        Ok(Ok(result)) => result,
        Ok(Err(_join_err)) => Err(KeychainError::Other(
            "keychain worker task panicked".to_string(),
        )),
        Err(_elapsed) => Err(KeychainError::ServiceUnavailable(
            SERVICE_UNAVAILABLE_MESSAGE.to_string(),
        )),
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
    // supplied name like "lantern-docs-ms\0x" would NOT match the exact
    // denylist below in Rust, yet resolve to the real internal entry at the OS
    // layer — a denylist bypass. Any control character makes the name suspect,
    // and no legitimate renderer-owned service (com.lantern.*) contains one,
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
///
/// Deliberately NOT run through `run_keychain_bounded` (codex-review,
/// 2026-07-04): a timeout can only stop *waiting* on the spawned blocking
/// task — it cannot cancel the underlying OS keyring write, which keeps
/// running to completion in the background. For a mutating op, that means a
/// "timed out" `ServiceUnavailable` could be followed moments later by the
/// write actually succeeding, leaving the frontend believing the save failed
/// while the OS keychain silently now holds the new value. QA-33's fast-fail
/// requirement was specifically about READS (`keychain_get`, which this
/// hazard doesn't apply to — nothing is mutated if a read times out).
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
    run_keychain_bounded(KEYCHAIN_OP_TIMEOUT, move || {
        let entry = entry(&svc, &key)?;
        entry.get_password().map_err(|e| map_keyring_error(&e))
    })
    .await
}

/// Delete a stored secret. Succeeds silently if the entry didn't exist, so
/// "remove my Anthropic key" is idempotent on the frontend.
///
/// Deliberately NOT bounded — same reasoning as `keychain_set` above: a
/// timeout can't cancel the underlying OS delete, so a "timed out" result
/// here could be followed by the delete actually completing afterward,
/// leaving the frontend's belief about whether the credential still exists
/// out of sync with the OS keychain's real state.
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
        // Calendar provider services are dynamic (prefix + provider id) too.
        let calendar_ms = identity::calendar_keychain_service("ms");
        let calendar_google = identity::calendar_keychain_service("google");
        let calendar_ics = identity::calendar_keychain_service("ics");
        let future_calendar = format!("{}future-secret", identity::CALENDAR_SERVICE_PREFIX);
        // Calendly's DB key is a dynamic prefix + suffix (`lantern-calendly-enc`),
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
            identity::LEGACY_CRM_ENC_SERVICE,    // pre-Lantern DB key retained for migration
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
            // Calendar connector: per-provider refresh tokens / ICS URL
            // (dynamic, prefix) + SQLCipher master key (exact).
            &calendar_ms,
            &calendar_google,
            &calendar_ics,
            identity::CALENDAR_ENC_SERVICE,
            // Calendly: API token slot (exact) + SQLCipher DB key (prefix).
            identity::CALENDLY_SERVICE,
            identity::CALENDLY_ENC_SERVICE,
            // External write-back ledger (RightCapital/Holistiplan planning
            // sockets, Wave 1) SQLCipher master key.
            identity::WRITEBACK_ENC_SERVICE,
            // Future connectors under the same namespaces must be denied by default.
            &future_crm,
            &future_onedrive,
            &future_box,
            &future_calendar,
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

    #[test]
    fn service_unavailable_serialization_is_stable_for_frontend() {
        let e = KeychainError::ServiceUnavailable("stopped".to_string());
        let s = serde_json::to_string(&e).expect("serialize");
        assert!(s.contains("\"kind\":\"serviceUnavailable\""));
        assert!(s.contains("\"message\":\"stopped\""));
    }

    #[test]
    fn service_unavailable_display_includes_message() {
        let e = KeychainError::ServiceUnavailable("stopped".to_string());
        assert_eq!(format!("{}", e), "service unavailable: stopped");
    }

    /// QA-33: a hung keyring call (e.g. Windows' `VaultSvc` stopped) must be
    /// classified as `ServiceUnavailable` and returned quickly — not left to
    /// whatever timeout a caller happens to layer on top.
    #[tokio::test]
    async fn run_keychain_bounded_classifies_a_hang_as_service_unavailable() {
        let started = std::time::Instant::now();
        let result: Result<String, KeychainError> = run_keychain_bounded(
            Duration::from_millis(50),
            || {
                std::thread::sleep(Duration::from_millis(500));
                Ok("too late".to_string())
            },
        )
        .await;
        assert!(
            matches!(result, Err(KeychainError::ServiceUnavailable(_))),
            "expected ServiceUnavailable, got {:?}",
            result
        );
        assert!(
            started.elapsed() < Duration::from_millis(400),
            "run_keychain_bounded must return near the bound, not wait out the hang"
        );
    }

    #[tokio::test]
    async fn run_keychain_bounded_returns_fast_results_untouched() {
        let result: Result<String, KeychainError> =
            run_keychain_bounded(KEYCHAIN_OP_TIMEOUT, || Ok("hello".to_string())).await;
        assert_eq!(result.unwrap(), "hello");
    }

    #[tokio::test]
    async fn run_keychain_bounded_propagates_a_fast_error_untouched() {
        let result: Result<String, KeychainError> = run_keychain_bounded(KEYCHAIN_OP_TIMEOUT, || {
            Err(KeychainError::NotFound("no matching entry".to_string()))
        })
        .await;
        assert_eq!(
            result,
            Err(KeychainError::NotFound("no matching entry".to_string()))
        );
    }

    /// Live keychain test. Gated behind `LANTERN_TEST_KEYCHAIN=1` at runtime
    /// so CI (which typically has no secret service daemon running) doesn't
    /// fail. Run locally with `LANTERN_TEST_KEYCHAIN=1 cargo test -- --test-threads=1`.
    #[test]
    fn live_roundtrip_set_get_delete() {
        if std::env::var_os("LANTERN_TEST_KEYCHAIN").is_none() {
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
