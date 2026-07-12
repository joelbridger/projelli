// identity.rs — the permanent runtime identity constants (Rust side).
//
// Single source of truth for all keychain service names, workspace data-dir
// names, MCP protocol identifiers, and OS-level app-data paths.
//
// Phase 2: APP_NS is "lantern" — the permanent LANTERN identity.
// All derived constants emit "lantern-*" values automatically.
// To rename in a future rebrand, change ONE place: the macro below.
//
// NEVER put brand names here. Identity is permanent plumbing; brand lives in
// brand/brand.config.json on the TS side.

/// The one and only place to change the internal namespace.
/// Expand with app_ns!() anywhere a string literal is needed.
/// concat!() can inline this — DO NOT also use APP_NS in concat!() calls.
macro_rules! app_ns {
    () => {
        "lantern"
    };
}

/// Internal application namespace — never a brand name.
pub const APP_NS: &str = app_ns!();

// ── Keychain service names (exact matches) ────────────────────────────────────

/// Reverse-DNS namespace for firm/app keychain entries (`com.<APP_NS>`).
pub const KC_FIRM_NS: &str = concat!("com.", app_ns!());

/// Default keychain service — used when no specific service is supplied.
/// Matches the Tauri bundle identifier (`com.<APP_NS>.app`).
pub const DEFAULT_KEYCHAIN_SERVICE: &str = concat!("com.", app_ns!(), ".app");

/// Vault VMK (volume master key) keychain service prefix.
/// Full service is `<VAULT_KEYCHAIN_PREFIX><workspace_id>`.
pub const VAULT_KEYCHAIN_PREFIX: &str = concat!("com.", app_ns!(), ".vault.");

/// Build a vault VMK keychain service string for a given workspace id.
pub fn vault_keychain_service(id: &str) -> String {
    format!("{}{}", VAULT_KEYCHAIN_PREFIX, id)
}

/// Audit database encryption key service (Rust-owned; renderer-denied).
pub const AUDIT_ENC_SERVICE: &str = concat!(app_ns!(), "-audit-enc");

/// Mail database encryption key service (Rust-owned; renderer-denied).
pub const MAIL_ENC_SERVICE: &str = concat!(app_ns!(), "-mail-enc");

/// RAG/vectors database encryption key service (Rust-owned; renderer-denied).
pub const VECTORS_ENC_SERVICE: &str = concat!(app_ns!(), "-vectors-enc");

/// Microsoft mail connector OAuth token service.
pub const MAIL_MS_SERVICE: &str = concat!(app_ns!(), "-mail-ms");

/// IMAP mail connector credentials service.
pub const MAIL_IMAP_SERVICE: &str = concat!(app_ns!(), "-mail-imap");

/// Gmail connector OAuth token service.
pub const MAIL_GMAIL_SERVICE: &str = concat!(app_ns!(), "-mail-gmail");

/// OneDrive / SharePoint Microsoft OAuth refresh token service.
pub const DOCS_MS_SERVICE: &str = concat!(app_ns!(), "-docs-ms");

/// Wealthbox CRM legacy token slot (pre-CRM-prefix naming).
pub const WEALTHBOX_LEGACY_SERVICE: &str = concat!(app_ns!(), "-wealthbox");

/// Box connector API token slot (exact).
pub const BOX_SERVICE: &str = concat!(app_ns!(), "-box");

/// Box connector DB encryption key service (covered by BOX_SERVICE_PREFIX).
pub const BOX_ENC_SERVICE: &str = concat!(app_ns!(), "-box-enc");

/// ShareFile connector token slot (exact).
pub const SHAREFILE_SERVICE: &str = concat!(app_ns!(), "-sharefile");

/// ShareFile connector DB encryption key service.
pub const SHAREFILE_ENC_SERVICE: &str = concat!(app_ns!(), "-sharefile-enc");

/// Jotform connector token slot (exact).
pub const JOTFORM_SERVICE: &str = concat!(app_ns!(), "-jotform");

/// Jotform connector DB encryption key service.
pub const JOTFORM_ENC_SERVICE: &str = concat!(app_ns!(), "-jotform-enc");

/// Zocks connector token slot (exact).
pub const ZOCKS_SERVICE: &str = concat!(app_ns!(), "-zocks");

/// Zocks connector DB encryption key service.
pub const ZOCKS_ENC_SERVICE: &str = concat!(app_ns!(), "-zocks-enc");

/// Addepar connector token slot (exact).
pub const ADDEPAR_SERVICE: &str = concat!(app_ns!(), "-addepar");

/// Addepar connector DB encryption key service (covered by ADDEPAR_SERVICE_PREFIX).
pub const ADDEPAR_ENC_SERVICE: &str = concat!(app_ns!(), "-addepar-enc");

/// Calendly connector token slot (exact).
pub const CALENDLY_SERVICE: &str = concat!(app_ns!(), "-calendly");

/// Calendly connector DB encryption key service.
pub const CALENDLY_ENC_SERVICE: &str = concat!(app_ns!(), "-calendly-enc");

/// Calendar connector DB encryption key service.
pub const CALENDAR_ENC_SERVICE: &str = concat!(app_ns!(), "-calendar-enc");

/// DocuSign connector token slot (exact).
pub const DOCUSIGN_SERVICE: &str = concat!(app_ns!(), "-docusign");

/// DocuSign connector DB encryption key service.
pub const DOCUSIGN_ENC_SERVICE: &str = concat!(app_ns!(), "-docusign-enc");

/// OneDrive connector DB encryption key service (covered by ONEDRIVE_SERVICE_PREFIX).
pub const ONEDRIVE_ENC_SERVICE: &str = concat!(app_ns!(), "-onedrive-enc");

/// CRM connector DB encryption key service.
pub const CRM_ENC_SERVICE: &str = concat!(app_ns!(), "-crm-enc");
/// Pre-Lantern CRM database key. Read only to migrate encrypted upgrade data;
/// never use for new writes once the current service has been repaired.
pub const LEGACY_CRM_ENC_SERVICE: &str = "keepance-crm-enc";

/// Intake facts SQLCipher database encryption key service.
pub const INTAKE_FACTS_ENC_SERVICE: &str = concat!(app_ns!(), "-intake-facts-enc");
/// Master-key service for large encrypted PDF template artifacts.
pub const INTAKE_PDF_TEMPLATES_ENC_SERVICE: &str = concat!(app_ns!(), "-intake-pdf-templates-enc");
/// External write-back ledger DB encryption key service.
pub const WRITEBACK_ENC_SERVICE: &str = concat!(app_ns!(), "-writeback-enc");

/// Keychain service holding the voiceprint-store master key (Wave 4).
pub const VOICEPRINT_ENC_SERVICE: &str = concat!(app_ns!(), "-voiceprint-enc");

// ── Keychain service prefixes ─────────────────────────────────────────────────

/// CRM connector namespace prefix. Covers per-provider token slots and the DB key.
pub const CRM_SERVICE_PREFIX: &str = concat!(app_ns!(), "-crm-");

/// Build a CRM provider keychain service string.
pub fn crm_keychain_service(provider_id: &str) -> String {
    format!("{}{}", CRM_SERVICE_PREFIX, provider_id)
}

/// OneDrive connector namespace prefix. Covers DB key and future slots.
pub const ONEDRIVE_SERVICE_PREFIX: &str = concat!(app_ns!(), "-onedrive-");

/// Box connector namespace prefix.
pub const BOX_SERVICE_PREFIX: &str = concat!(app_ns!(), "-box-");

/// ShareFile connector namespace prefix.
pub const SHAREFILE_SERVICE_PREFIX: &str = concat!(app_ns!(), "-sharefile-");

/// Jotform connector namespace prefix.
pub const JOTFORM_SERVICE_PREFIX: &str = concat!(app_ns!(), "-jotform-");

/// Zocks connector namespace prefix.
pub const ZOCKS_SERVICE_PREFIX: &str = concat!(app_ns!(), "-zocks-");

/// Addepar connector namespace prefix.
pub const ADDEPAR_SERVICE_PREFIX: &str = concat!(app_ns!(), "-addepar-");

/// Calendar connector namespace prefix. Covers per-provider token slots
/// (`-calendar-ms`, `-calendar-google`, `-calendar-ics`) and the DB key.
pub const CALENDAR_SERVICE_PREFIX: &str = concat!(app_ns!(), "-calendar-");

/// Build a calendar provider keychain service string.
pub fn calendar_keychain_service(provider_id: &str) -> String {
    format!("{}{}", CALENDAR_SERVICE_PREFIX, provider_id)
}

/// Calendly connector namespace prefix. Covers the SQLCipher master key
/// (`lantern-calendly-enc`) and any future Calendly-scoped secret. The bare
/// API token slot (`lantern-calendly`) is the exact `CALENDLY_SERVICE` above.
pub const CALENDLY_SERVICE_PREFIX: &str = concat!(app_ns!(), "-calendly-");

// ── Per-workspace hidden data directory ──────────────────────────────────────

/// Name of the hidden metadata directory inside each workspace root.
pub const WORKSPACE_DATA_DIR: &str = concat!(".", app_ns!());

/// Vault metadata filename (sits directly in the workspace root, not in WORKSPACE_DATA_DIR).
pub const VAULT_META_FILE: &str = concat!(".", app_ns!(), "-vault.json");

/// MCP session scope state file, relative to the workspace root.
pub const MCP_SCOPE_STATE_PATH: &str = concat!(".", app_ns!(), "/mcp-session-scope.json");

/// MCP memory file, relative to the workspace root.
pub const MCP_MEMORY_PATH: &str = concat!(".", app_ns!(), "/memory.json");

// ── OS-level app-data directory ───────────────────────────────────────────────

/// Subdirectory name under `dirs::data_dir()` for OS-level app data:
/// local AI models, reranker weights, TTS voice files, logs, etc.
pub const OS_DATA_SUBDIR: &str = app_ns!();

/// OS temp-dir prefix for conversion caches (PPT → PDF).
pub const CACHE_PPT_PREFIX: &str = concat!(app_ns!(), "-ppt-cache");

/// OS temp-dir prefix for DOCX → PDF conversion caches.
pub const CACHE_DOCX_PDF_PREFIX: &str = concat!(app_ns!(), "-docx-pdf-cache");

// ── MCP server / protocol identity ───────────────────────────────────────────

/// The MCP server name reported in `initialize` responses.
pub const MCP_SERVER_NAME: &str = app_ns!();

/// Temp-dir folder name for the cross-process approval channel.
pub const MCP_APPROVAL_TEMP_PREFIX: &str = concat!(app_ns!(), "-mcp");

/// Marker string printed to stderr to signal an approval request.
pub const MCP_APPROVAL_MARKER: &str = concat!(app_ns!(), "/approval_request");
