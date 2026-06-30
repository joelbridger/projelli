// identity.rs — the permanent runtime identity constants (Rust side).
//
// Single source of truth for all keychain service names, workspace data-dir
// names, MCP protocol identifiers, and OS-level app-data paths.
//
// Phase 1 (current): still emitting "keepance" identity values — behaviour
// is identical to before. Phase 2 flips APP_NS (and derived constants) to the
// LANTERN identity. Every call site imports from here so the flip propagates
// automatically.
//
// NEVER put brand names here. Identity is permanent plumbing; brand lives in
// brand/brand.config.json on the TS side.

/// Internal application namespace — never a brand name.
pub const APP_NS: &str = "keepance";

// ── Keychain service names (exact matches) ────────────────────────────────────

/// Reverse-DNS namespace for firm/app keychain entries (`com.<APP_NS>`).
pub const KC_FIRM_NS: &str = "com.keepance";

/// Default keychain service — used when no specific service is supplied.
/// Matches the Tauri bundle identifier (`com.keepance.app`).
pub const DEFAULT_KEYCHAIN_SERVICE: &str = "com.keepance.app";

/// Vault VMK (volume master key) keychain service prefix.
/// Full service is `<VAULT_KEYCHAIN_PREFIX><workspace_id>`.
pub const VAULT_KEYCHAIN_PREFIX: &str = "com.keepance.vault.";

/// Build a vault VMK keychain service string for a given workspace id.
pub fn vault_keychain_service(id: &str) -> String {
    format!("{}{}", VAULT_KEYCHAIN_PREFIX, id)
}

/// Audit database encryption key service (Rust-owned; renderer-denied).
pub const AUDIT_ENC_SERVICE: &str = "keepance-audit-enc";

/// Mail database encryption key service (Rust-owned; renderer-denied).
pub const MAIL_ENC_SERVICE: &str = "keepance-mail-enc";

/// RAG/vectors database encryption key service (Rust-owned; renderer-denied).
pub const VECTORS_ENC_SERVICE: &str = "keepance-vectors-enc";

/// Microsoft mail connector OAuth token service.
pub const MAIL_MS_SERVICE: &str = "keepance-mail-ms";

/// IMAP mail connector credentials service.
pub const MAIL_IMAP_SERVICE: &str = "keepance-mail-imap";

/// Gmail connector OAuth token service.
pub const MAIL_GMAIL_SERVICE: &str = "keepance-mail-gmail";

/// OneDrive / SharePoint Microsoft OAuth refresh token service.
pub const DOCS_MS_SERVICE: &str = "keepance-docs-ms";

/// Wealthbox CRM legacy token slot (pre-`keepance-crm-` naming).
pub const WEALTHBOX_LEGACY_SERVICE: &str = "keepance-wealthbox";

/// Box connector API token slot (exact).
pub const BOX_SERVICE: &str = "keepance-box";

/// Box connector DB encryption key service (covered by BOX_SERVICE_PREFIX).
pub const BOX_ENC_SERVICE: &str = "keepance-box-enc";

/// ShareFile connector token slot (exact).
pub const SHAREFILE_SERVICE: &str = "keepance-sharefile";

/// ShareFile connector DB encryption key service.
pub const SHAREFILE_ENC_SERVICE: &str = "keepance-sharefile-enc";

/// Jotform connector token slot (exact).
pub const JOTFORM_SERVICE: &str = "keepance-jotform";

/// Jotform connector DB encryption key service.
pub const JOTFORM_ENC_SERVICE: &str = "keepance-jotform-enc";

/// Zocks connector token slot (exact).
pub const ZOCKS_SERVICE: &str = "keepance-zocks";

/// Zocks connector DB encryption key service.
pub const ZOCKS_ENC_SERVICE: &str = "keepance-zocks-enc";

/// Addepar connector token slot (exact).
pub const ADDEPAR_SERVICE: &str = "keepance-addepar";

/// Addepar connector DB encryption key service (covered by ADDEPAR_SERVICE_PREFIX).
pub const ADDEPAR_ENC_SERVICE: &str = "keepance-addepar-enc";

/// Calendly connector token slot (exact).
pub const CALENDLY_SERVICE: &str = "keepance-calendly";

/// Calendly connector DB encryption key service.
pub const CALENDLY_ENC_SERVICE: &str = "keepance-calendly-enc";

/// DocuSign connector token slot (exact).
pub const DOCUSIGN_SERVICE: &str = "keepance-docusign";

/// DocuSign connector DB encryption key service.
pub const DOCUSIGN_ENC_SERVICE: &str = "keepance-docusign-enc";

/// OneDrive connector DB encryption key service (covered by ONEDRIVE_SERVICE_PREFIX).
pub const ONEDRIVE_ENC_SERVICE: &str = "keepance-onedrive-enc";

/// CRM connector DB encryption key service.
pub const CRM_ENC_SERVICE: &str = "keepance-crm-enc";

// ── Keychain service prefixes ─────────────────────────────────────────────────

/// CRM connector namespace prefix. Covers per-provider token slots and the DB key.
pub const CRM_SERVICE_PREFIX: &str = "keepance-crm-";

/// Build a CRM provider keychain service string.
pub fn crm_keychain_service(provider_id: &str) -> String {
    format!("{}{}", CRM_SERVICE_PREFIX, provider_id)
}

/// OneDrive connector namespace prefix. Covers DB key and future slots.
pub const ONEDRIVE_SERVICE_PREFIX: &str = "keepance-onedrive-";

/// Box connector namespace prefix.
pub const BOX_SERVICE_PREFIX: &str = "keepance-box-";

/// ShareFile connector namespace prefix.
pub const SHAREFILE_SERVICE_PREFIX: &str = "keepance-sharefile-";

/// Jotform connector namespace prefix.
pub const JOTFORM_SERVICE_PREFIX: &str = "keepance-jotform-";

/// Zocks connector namespace prefix.
pub const ZOCKS_SERVICE_PREFIX: &str = "keepance-zocks-";

/// Addepar connector namespace prefix.
pub const ADDEPAR_SERVICE_PREFIX: &str = "keepance-addepar-";

// ── Per-workspace hidden data directory ──────────────────────────────────────

/// Name of the hidden metadata directory inside each workspace root.
pub const WORKSPACE_DATA_DIR: &str = ".keepance";

/// Vault metadata filename (sits directly in the workspace root, not in WORKSPACE_DATA_DIR).
pub const VAULT_META_FILE: &str = ".keepance-vault.json";

/// MCP session scope state file, relative to the workspace root.
pub const MCP_SCOPE_STATE_PATH: &str = ".keepance/mcp-session-scope.json";

/// MCP memory file, relative to the workspace root.
pub const MCP_MEMORY_PATH: &str = ".keepance/memory.json";

// ── OS-level app-data directory ───────────────────────────────────────────────

/// Subdirectory name under `dirs::data_dir()` for OS-level app data:
/// local AI models, reranker weights, TTS voice files, logs, etc.
pub const OS_DATA_SUBDIR: &str = "keepance";

/// OS temp-dir prefix for conversion caches (PPT → PDF).
pub const CACHE_PPT_PREFIX: &str = "keepance-ppt-cache";

/// OS temp-dir prefix for DOCX → PDF conversion caches.
pub const CACHE_DOCX_PDF_PREFIX: &str = "keepance-docx-pdf-cache";

// ── MCP server / protocol identity ───────────────────────────────────────────

/// The MCP server name reported in `initialize` responses.
pub const MCP_SERVER_NAME: &str = "keepance";

/// Temp-dir folder name for the cross-process approval channel.
pub const MCP_APPROVAL_TEMP_PREFIX: &str = "keepance-mcp";

/// Marker string printed to stderr to signal an approval request.
pub const MCP_APPROVAL_MARKER: &str = "keepance/approval_request";
