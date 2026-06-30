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
export const SK_TAB_OVERFLOW                 = `${APP_NS}:tabOverflow`;
export const SK_FIRM_SESSION                 = `${APP_NS}:firm-session`;
export const SK_PRIVILEGE                    = `${APP_NS}:privilege`;
export const SK_PROFILE                      = `${APP_NS}:profile`;
export const SK_ONBOARDING_V2                = `${APP_NS}:onboardingV2`;
export const SK_MATTERS                      = `${APP_NS}:matters`;
export const SK_MATTER_UI_SNAPSHOTS          = `${APP_NS}:matter-ui-snapshots`;
export const SK_MATTER_AT_A_GLANCE           = `${APP_NS}:matter-at-a-glance`;
export const SK_CLIENT_MAPS                  = `${APP_NS}:client-maps`;
export const SK_CLIENT_MAP_TEMPLATES         = `${APP_NS}:client-map-templates`;
export const SK_WORKFLOW_CHAINS              = `${APP_NS}:workflowChains`;
export const SK_USER_WORKFLOW_TEMPLATES      = `${APP_NS}:userWorkflowTemplates`;
export const SK_SETUP_CARD_DISMISSED         = `${APP_NS}:setup-card-dismissed`;
export const SK_WORKFLOWS_FILTER             = `${APP_NS}:workflows-filter`;
export const SK_WORKFLOWS_COLLAPSED          = `${APP_NS}:workflows-collapsed`;
export const SK_API_KEY_CARD_DISMISSED       = `${APP_NS}:apiKeyCardDismissed`;
export const SK_SAMPLE_BRIDGE_DISMISSED      = `${APP_NS}:sample-bridge-dismissed`;
export const SK_LAST_SEEN_VERSION            = `${APP_NS}:lastSeenVersion`;
export const SK_ASK_RAIL_COLLAPSED           = `${APP_NS}:ask-rail-collapsed`;
export const SK_ASK_FILES_ONLY               = `${APP_NS}:ask-files-only`;
export const SK_FIRST_FILE_TRUST_SHOWN       = `${APP_NS}:first-file-trust-shown`;
export const SK_DOCS_VIEW                    = `${APP_NS}:docs-view`;
export const SK_EMAIL_FIRST_CONNECT_CALLOUT  = `${APP_NS}:email:firstConnectCalloutSeen`;
export const SK_DEMO_MESSAGE_COUNT           = `${APP_NS}:demo:messageCount`;
export const SK_DEMO_FIRST_MESSAGE_FLAG      = `${APP_NS}:demo:firstMessageReported`;
export const SK_DEMO_BYOK_REPORTED_FLAG      = `${APP_NS}:demo:byokReported`;

/** Build a per-matter client-map tab storage key. */
export const skClientMapTab = (matterId: string): string =>
  `${APP_NS}:clientmap-tab:${matterId}`;

// ── CustomEvent names ─────────────────────────────────────────────────────────

export const EV_OPEN_MATTER_MANAGER              = `${APP_NS}:open-matter-manager`;
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
