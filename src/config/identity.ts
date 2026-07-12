/**
 * identity.ts — the permanent runtime identity constants (TypeScript side).
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SINGLE SOURCE OF TRUTH for all storage-key prefixes, CustomEvent        ║
 * ║  namespaces, and renderer-owned keychain service strings.                 ║
 * ║                                                                           ║
 * ║  Phase 2 (current): APP_NS is "lantern" — the permanent LANTERN identity.  ║
 * ║  All derived constants emit "lantern-*" values automatically.             ║
 * ║  DO NOT change APP_NS to a brand name. Identity ≠ brand.                  ║
 * ║                                                                           ║
 * ║  DO NOT import brand.ts here. Identity is permanent plumbing; brand is   ║
 * ║  a swappable surface. They must never share a dependency.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/** The permanent internal application namespace. Never a brand name. */
const APP_NS = 'lantern';

// ── Renderer-owned keychain service names / namespaces ────────────────────────
// These are service strings the renderer legitimately reads and writes via the
// keychain bridge. Rust-owned (internal) services live in identity.rs.

/** Reverse-DNS namespace for all firm collaboration keychain entries. */
export const KC_FIRM_NS = `com.${APP_NS}`;

/** Build a firm-user keychain service string. */
export const kcUserService = (userId: string): string =>
  `${KC_FIRM_NS}.user.${userId}`;

/** Build a firm-matter keychain service string. */
export const kcMatterService = (matterId: string): string =>
  `${KC_FIRM_NS}.matter.${matterId}`;

/** Device key service prefix (before the device_id). */
export const KC_DEVICE_PREFIX = `${KC_FIRM_NS}.device.`;

/** Device metadata keychain service (stores the device_id itself). */
export const KC_DEVICE_META_SERVICE = `${KC_DEVICE_PREFIX}meta`;

// ── localStorage / Zustand persist names ─────────────────────────────────────

export const SK_SETTINGS                     = `${APP_NS}:settings`;
/** QA-15 browser-build single-writer tab lock (src/platform/browserGuard/). Not a
 *  zustand persist key — a heartbeat record `{tabId, heartbeatAt}` written by
 *  whichever tab currently owns write access to this origin's localStorage. */
export const SK_TAB_LOCK                     = `${APP_NS}:tab-lock`;
export const SK_TAB_OVERFLOW                 = `${APP_NS}:tabOverflow`;
export const SK_FIRM_SESSION                 = `${APP_NS}:firm-session`;
export const SK_PRIVILEGE                    = `${APP_NS}:privilege`;
export const SK_PROFILE                      = `${APP_NS}:profile`;
export const SK_MATTERS                      = `${APP_NS}:matters`;
export const SK_MATTER_UI_SNAPSHOTS          = `${APP_NS}:matter-ui-snapshots`;
export const SK_MATTER_AT_A_GLANCE           = `${APP_NS}:matter-at-a-glance`;
export const SK_MEETING_BRIEFS               = `${APP_NS}:meeting-briefs`;
export const SK_CLIENT_MAPS                  = `${APP_NS}:client-maps`;
export const SK_CLIENT_MAP_TEMPLATES         = `${APP_NS}:client-map-templates`;
export const SK_INTAKES                      = `${APP_NS}:intakes`;
export const SK_RETENTION_POLICIES           = `${APP_NS}:retention-policies`;
export const SK_WORKFLOW_CHAINS              = `${APP_NS}:workflowChains`;
export const SK_USER_WORKFLOW_TEMPLATES      = `${APP_NS}:userWorkflowTemplates`;
export const SK_SETUP_CARD_DISMISSED         = `${APP_NS}:setup-card-dismissed`;
export const SK_CLIENT_GROUPS                = `${APP_NS}:client-groups`;
export const SK_WORKFLOWS_FILTER             = `${APP_NS}:workflows-filter`;
export const SK_WORKFLOWS_COLLAPSED          = `${APP_NS}:workflows-collapsed`;
export const SK_API_KEY_CARD_DISMISSED       = `${APP_NS}:apiKeyCardDismissed`;
export const SK_SAMPLE_BRIDGE_DISMISSED      = `${APP_NS}:sample-bridge-dismissed`;
export const SK_LAST_SEEN_VERSION            = `${APP_NS}:lastSeenVersion`;
export const SK_ASK_RAIL_COLLAPSED           = `${APP_NS}:ask-rail-collapsed`;
export const SK_ASK_FILES_ONLY               = `${APP_NS}:ask-files-only`;
export const SK_FIRST_FILE_TRUST_SHOWN       = `${APP_NS}:first-file-trust-shown`;
export const SK_DOCS_VIEW                    = `${APP_NS}:docs-view`;
export const SK_CLIENTS_HOME_VIEW            = `${APP_NS}:clients-home-view`;
export const SK_EMAIL_FIRST_CONNECT_CALLOUT  = `${APP_NS}:email:firstConnectCalloutSeen`;
export const SK_DEMO_MESSAGE_COUNT           = `${APP_NS}:demo:messageCount`;
export const SK_DEMO_FIRST_MESSAGE_FLAG      = `${APP_NS}:demo:firstMessageReported`;
export const SK_DEMO_BYOK_REPORTED_FLAG      = `${APP_NS}:demo:byokReported`;

/** Build a per-matter client-map tab storage key. */
export const skClientMapTab = (matterId: string): string =>
  `${APP_NS}:clientmap-tab:${matterId}`;

/** Build a per-matter client-map sources pane collapsed-state storage key. */
export const skClientMapSourcesCollapsed = (matterId: string): string =>
  `${APP_NS}:clientmap-sources-collapsed:${matterId}`;

// ── localStorage / sessionStorage flag keys (underscore family) ───────────────
// A second naming family alongside the colon-style SK_ keys above: single
// scalar flags/markers written with `${APP_NS}_snake_case` instead of
// `${APP_NS}:kebab-case`. New keys in this family should still prefer the colon
// style above; this section exists to give every key one owner instead of
// duplicated string literals.

export const SK_ONBOARDING_COMPLETE        = `${APP_NS}_onboarding_complete`;
export const SK_PROFESSION                 = `${APP_NS}_profession`;
export const SK_ONBOARDING_PROGRESS        = `${APP_NS}_onboarding_progress`;
export const SK_ONBOARDING_COMPLETED_AT    = `${APP_NS}_onboarding_completed_at`;
export const SK_AI_SETUP_DEFERRED          = `${APP_NS}_ai_setup_deferred`;
/** sessionStorage, not localStorage. */
export const SK_AI_SETUP_REMINDER_DISMISSED = `${APP_NS}_ai_setup_reminder_dismissed`;
export const SK_DEFAULT_PROVIDER           = `${APP_NS}_default_provider`;
export const SK_DEFAULT_MODEL              = `${APP_NS}_default_model`;
export const SK_RECENT_WORKSPACES          = `${APP_NS}_recent_workspaces`;
export const SK_FIRM_NAME                  = `${APP_NS}_firm_name`;
export const SK_FIRM_KEY_PUBLISH_FP        = `${APP_NS}_firm_key_publish_fp`;
export const SK_MACHINE_ID                 = `${APP_NS}_machine_id`;
export const SK_LICENSE_TOKEN              = `${APP_NS}_license_token`;
export const SK_LICENSE_LAST_GOOD_AT       = `${APP_NS}_license_last_good_at`;
export const SK_INSTALL_ID                 = `${APP_NS}_install_id`;
export const SK_DESIGN_PARTNER_CONSENT     = `${APP_NS}_design_partner_consent`;
export const SK_TELEMETRY_CONSENT          = `${APP_NS}_telemetry_consent`;
export const SK_TELEMETRY_SENT_EVENTS      = `${APP_NS}_telemetry_sent_events`;
export const SK_FIRST_LAUNCH_AT            = `${APP_NS}_first_launch_at`;
/** sessionStorage, not localStorage. */
export const SK_TRIAL_BANNER_DISMISSED_AT  = `${APP_NS}_trial_banner_dismissed_at`;
/** Sentinels for the legacy `apiKey_<provider>` -> keychain migration (KeychainService.ts). */
export const SK_APIKEYS_MIGRATED_V1        = `${APP_NS}_apikeys_migrated_v1`;
export const SK_APIKEYS_MIGRATED_V2        = `${APP_NS}_apikeys_migrated_v2`;

/** Build a per-provider "key passed a live check" storage key. */
export const skKeyVerified = (provider: string): string =>
  `${APP_NS}_key_verified_${provider}`;
/** Build a per-provider "key failed a live check" storage key. */
export const skKeyInvalid = (provider: string): string =>
  `${APP_NS}_key_invalid_${provider}`;
/** Build a per-provider model-list cache storage key. */
export const skModelsCache = (provider: string): string =>
  `${APP_NS}_models_${provider}`;

/**
 * Prefix for the localStorage fallback used by the firm keychain bridge when
 * the OS keychain is unavailable. Full key shape:
 * `${KC_FALLBACK_PREFIX}${service}::${key}`, where `service` already embeds
 * `KC_FIRM_NS` (e.g. `com.lantern.user.<id>`). The suffix space is unbounded
 * (arbitrary user/matter/device ids), so the migration rewrites this family by
 * scanning for the prefix rather than enumerating keys.
 */
export const KC_FALLBACK_PREFIX = `${APP_NS}_kc_fallback::`;

// ── CustomEvent names ─────────────────────────────────────────────────────────

export const EV_OPEN_MATTER_MANAGER              = `${APP_NS}:open-matter-manager`;
export const EV_OPEN_CLIENT_SETTINGS             = `${APP_NS}:open-client-settings`;
export const EV_OPEN_NEW_GROUP                   = `${APP_NS}:open-new-group`;
export const EV_OPEN_SETTINGS                    = `${APP_NS}:open-settings`;
export const EV_OPEN_ACCOUNT                     = `${APP_NS}:open-account`;
export const EV_OPEN_PRIVACY_CENTER              = `${APP_NS}:open-privacy-center`;
export const EV_OPEN_AUDIT_LOG                   = `${APP_NS}:open-audit-log`;
export const EV_MATTER_LAUNCH                    = `${APP_NS}:matter-launch`;
export const EV_OPEN_EMAIL                       = `${APP_NS}:open-email`;
export const EV_OPEN_CRM                         = `${APP_NS}:open-crm`;
export const EV_OPEN_ONEDRIVE                    = `${APP_NS}:open-onedrive`;
export const EV_OPEN_ESIGN                       = `${APP_NS}:open-esign`;
export const EV_OPEN_MEETING                     = `${APP_NS}:open-meeting`;
export const EV_OPEN_BOX                         = `${APP_NS}:open-box`;
export const EV_OPEN_JOTFORM                     = `${APP_NS}:open-jotform`;
export const EV_OPEN_SHAREFILE                   = `${APP_NS}:open-sharefile`;
export const EV_OPEN_ZOCKS                       = `${APP_NS}:open-zocks`;
export const EV_OPEN_ADDEPAR                     = `${APP_NS}:open-addepar`;
export const EV_TRASH_CHANGED                    = `${APP_NS}:trash-changed`;
export const EV_SCROLL_TO_PARAGRAPH              = `${APP_NS}:scroll-to-paragraph`;
export const EV_EGRESS_CONFIG_CHANGE             = `${APP_NS}:egress-config-change`;
export const EV_DESIGN_PARTNER_CONSENT_CHANGE    = `${APP_NS}:design-partner-consent-change`;
export const EV_TELEMETRY_CONSENT_CHANGE         = `${APP_NS}:telemetry-consent-change`;
export const EV_DEMO_LIMIT_HIT                   = `${APP_NS}:demo-limit-hit`;
export const EV_DEMO_MESSAGE_SENT                = `${APP_NS}:demo-message-sent`;

// ── Workspace filesystem ───────────────────────────────────────────────────────

/** Hidden directory inside a workspace root where app-internal stores live. */
export const WORKSPACE_DATA_DIR = `.${APP_NS}`;

/** Vault metadata filename hidden from file-tree listings. */
export const VAULT_METADATA_FILENAME = `.${APP_NS}-vault.json`;

/** Relative path of the MCP session scope file inside a workspace. */
export const MCP_SESSION_SCOPE_REL_PATH = `${WORKSPACE_DATA_DIR}/mcp-session-scope.json`;

/** Relative path of the durable matter/client-organization file inside a
 *  workspace. The workspace folder is the SOURCE OF TRUTH for matter records
 *  (localStorage is only a fast cache) — see `matterWorkspaceFile.ts`. */
export const MATTERS_WORKSPACE_REL_PATH = `${WORKSPACE_DATA_DIR}/matters.json`;
