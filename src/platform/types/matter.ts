// Matter / Client model (WS-B/C app)
//
// A "matter" is the confidentiality boundary in Keepance 3.0. It groups one
// client's work under one or more workspace folders. Every file or email
// indexed under a matter is tagged with that matter's id; retrieval is then
// scoped to a single matter so one client's data can never surface inside a
// chat about another client's matter.
//
// The simplest real-world model: a matter owns one or more top-level (or
// nested) workspace folders. Any file whose path lives under one of those
// folders belongs to the matter. Files outside every mapped folder fall back
// to the `unassigned` sentinel — the same sentinel the Rust indexer uses when
// no matterId is supplied (see `rag_index_*` in src-tauri/src/commands/rag).

/**
 * The sentinel id used for any chunk that hasn't been mapped to a real
 * matter. Mirrors the Rust-side `"unassigned"` default so the frontend and
 * backend agree on the bucket an unmapped file lands in. Never persist a
 * matter with this id; it is reserved.
 */
export const UNASSIGNED_MATTER_ID = 'unassigned';

/**
 * A single client matter. `folderPaths` are ABSOLUTE workspace paths (the
 * same shape the editor and RAG use), each the root of a folder whose files
 * belong to this matter. A matter may map to several folders (e.g. a client
 * with separate "Litigation" and "Corporate" trees).
 */
export interface Matter {
  /** Stable unique id (uuid-ish). The citation/scope key the backend stores. */
  id: string;
  /** Human-readable matter name, e.g. "Acme v. Beta - Patent". */
  name: string;
  /** The client this matter belongs to, e.g. "Acme Corp". */
  client: string;
  /** Absolute folder paths whose files belong to this matter. */
  folderPaths: string[];
  /**
   * Mail-folder keys whose email belongs to this matter. Each key is a mail
   * folder identifier in the form `provider/account/folderId`, or
   * `provider/account` for an account-level mapping (every folder in that
   * account). Email synced from a mapped folder is indexed under this matter;
   * see `mailFolderKey` / `parseMailFolderKey` in `matterResolver`.
   *
   * Optional so matters created before mail mapping landed still parse from
   * persisted storage (a missing value is treated as an empty list).
   */
  mailFolderPaths?: string[];
  /**
   * Wealthbox household IDs whose CRM records belong to this matter. Each
   * entry is the Wealthbox household id string returned by `crm_list_households`
   * (and stored in `CrmHouseholdDto.id`). CRM objects synced for a matched
   * household are indexed under this matter's scope.
   *
   * Optional so matters created before the Wealthbox connector landed still
   * parse from persisted storage (a missing value is treated as an empty list).
   */
  crmHouseholdKeys?: string[];
  /**
   * OneDrive / SharePoint folder ids whose files belong to this matter.
   * Per-connector mapping rules are added by the connector module; this shared
   * slot lets the matter store persist those links without another schema edit.
   */
  onedriveFolderKeys?: string[];
  /**
   * E-signature record keys whose envelopes / agreements belong to this matter.
   * The first implementation targets DocuSign, but the persisted field is
   * connector-neutral.
   */
  esignKeys?: string[];
  /**
   * Meeting record keys whose scheduled events belong to this matter. The first
   * implementation targets Calendly, but the persisted field is connector-neutral.
   */
  meetingKeys?: string[];
  /**
   * True when this matter's DISPLAY identity (name/client) originated from a CRM
   * connector (e.g. a Wealthbox household), as opposed to user-entered or
   * file-derived. Used at disconnect time to scrub Wealthbox-derived names: a
   * pure-CRM matter is deleted, but a CRM-created matter the user has since added
   * files/mail to keeps its content while its imported name/client are scrubbed.
   * Optional/absent for non-CRM and pre-flag matters (treated as `false`).
   */
  createdFromCrm?: boolean;
  /**
   * Privileged-matter designation. When `true`, this matter holds
   * attorney-client / work-product material and is treated as a confidentiality
   * boundary that must never be exfiltrated through a network-capable extension.
   * When this matter is the ACTIVE matter, Privileged Matter Mode is forced on
   * (network plugins + MCP are disabled). Optional so matters created before
   * this flag landed parse cleanly (a missing value is treated as `false`).
   */
  privileged?: boolean;
  /**
   * Explicit opt-in for external AI tools that connect through Keepance's MCP
   * server. Default is false. This is intentionally separate from the active
   * matter: focusing a matter inside Keepance must never grant an outside AI
   * client access to it.
   */
  mcpAccessGranted?: boolean;
  /** ISO timestamp the matter was created. */
  createdAt: string;

  // ── Firm linkage (Phase 1, Task 3) ────────────────────────────────────────
  // These fields are optional so matters created before firm wiring still parse
  // cleanly. A matter is "shared" when `shared === true && firmMatterId` is set.
  // Runtime sync status is NOT stored here; it lives in matterSyncStore.

  /**
   * The matter ID on the firm backend (UUID from POST /org/matters).
   * Set when the matter has been shared with the firm. Undefined for local-only.
   */
  firmMatterId?: string;
  /**
   * The org ID the shared matter belongs to. Set alongside `firmMatterId`.
   */
  orgId?: string;
  /**
   * The current user's role on this shared matter ('owner' | 'editor' | 'viewer').
   * Undefined for local-only matters.
   */
  role?: 'owner' | 'editor' | 'viewer';
  /**
   * Whether this matter has been shared with the firm. `false` (or undefined)
   * means it is a local-only matter.
   */
  shared?: boolean;

  /**
   * Whether this is the built-in sample matter seeded during onboarding.
   * Sample matters are flagged so the UI can offer the first-run aha-moment
   * flow without confusing them with real client work. Optional so matters
   * created before this field landed parse cleanly (treated as `false`).
   */
  isSample?: boolean;

  /**
   * Whether the matter is archived. Archiving is purely an ORGANIZATIONAL
   * concept — an archived matter is hidden from the active matter list and the
   * chat scope picker so old/closed matters stop cluttering the day-to-day UI.
   * It is NOT deletion: the matter, its folder/mail mappings, and its indexed
   * data are all preserved, so files under an archived matter still resolve to
   * it for RAG, and it can be restored at any time. Optional so matters created
   * before this field landed parse cleanly (a missing value is treated as
   * `false` / not archived).
   */
  archived?: boolean;
}

/**
 * The retrieval scope a chat resolves to. Mirrors `RetrievalScope` in
 * `@/platform/utils/tauri-commands`, re-exported here so UI code can talk about
 * matters without importing the Tauri bindings directly. There is no silent
 * "everything" default — a caller must name a matter or explicitly pick
 * `allMatters` (the audited cross-matter capability).
 */
export type MatterScope =
  | { kind: 'matter'; matterId: string }
  | { kind: 'allMatters' };
