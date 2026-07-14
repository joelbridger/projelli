// Audit Types

// The egress event mirrors the egress source of truth. `egress.ts` is a pure,
// dependency-free module, so importing its types here is safe (no cycle).
import type {
  ConfidentialityMode,
  EgressDestination,
} from '@/platform/privacy/egress';

/**
 * App-wide map of registered audit action ids.
 *
 * Feature-owned audit descriptors augment this interface. Deliberately do not
 * add a string index signature: an unregistered or misspelled audit id must
 * fail TypeScript checking before it can reach the durable audit log.
 */
export interface AuditActionMap {
  // Legacy actions are registered by auditActionRegistry.
}

export type AuditActionType = Extract<keyof AuditActionMap, string>;

/**
 * The verdict from citation verification (mirrors `CitationVerdict.verdict`
 * from the RAG store: a cited source either matched, was not found, was filed
 * under a different matter than claimed, or the quoted text did not match).
 */
export type CitationVerdict =
  | 'verified'
  | 'notFound'
  | 'matterMismatch'
  | 'textMismatch';

/**
 * The active confidentiality scope for an AI action: either a single client
 * matter (id + display name) or the deliberate cross-matter ("all matters")
 * scope. There is never a silent "everything" — the all-matters scope is an
 * explicit choice, recorded as such.
 */
export type AuditScope =
  | { kind: 'matter'; matterId: string; matterName?: string }
  | { kind: 'allMatters' };

/**
 * A source identity captured for a retrieval or answer receipt. This records
 * which local source was read without copying the client text itself.
 */
export interface AuditSourceIdentity {
  id: string;
  label: string;
  path: string;
  sourceType?: string;
  matterId?: string;
  locators?: string[];
  chunkCount: number;
}

/**
 * Single audit log entry
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditActionType;
  description: string;
  model: string | undefined;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  userDecision: 'approved' | 'rejected' | 'auto' | undefined;
  metadata: Record<string, unknown>;
  /**
   * Q4 (Wave 1.2) — Optional cost/token fields populated when an entry
   * represents a model call or a workflow/chat completion that triggered
   * one. Pre-v1.5 entries won't have these; the cost dashboard just skips
   * entries where these aren't set. See `src/platform/utils/audit-export.ts` —
   * these keys are also scraped from `outputs`/`metadata` for backward
   * compatibility with entries that stored them there.
   */
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  /**
   * Q4 — Provider ID ('anthropic' | 'openai' | 'google' | 'ollama') if
   * known at log time. Used by CostMetrics for the stacked breakdown. The
   * `model` field alone can't always be attributed to a provider
   * (gpt-4o vs claude-haiku-4-5 is fine, but custom model names may not be).
   */
  provider?: string;
}

/**
 * Discriminated union of structured v2.0 audit events.
 *
 * Each variant carries a `type` discriminant, an ISO `timestamp`, and a
 * strongly-typed `payload`. This is separate from the legacy flat `AuditEntry`
 * interface so that new v2.0 features can log rich structured events while the
 * existing append-only log remains backward compatible.
 *
 * Section 3.6 of the v2.0 mega-release design spec.
 */
export type AuditEvent =
  | {
      type: 'attachment_added';
      timestamp: string;
      payload: { path: string; hash: string; byteSize: number };
    }
  | {
      type: 'prompt_preparation';
      timestamp: string;
      payload: {
        surface: string;
        destination: string;
        categories: Array<{ kind: string; count: number }>;
        decision: 'clean' | 'redacted_by_user' | 'cancelled' | 'blocked';
        attachmentDisposition:
          | 'none'
          | 'text_only'
          | 'redacted_derivative'
          | 'blocked';
      };
    }
  | {
      type: 'attachment_sent_to_provider';
      timestamp: string;
      payload: { path: string; hash: string; provider: string; model: string };
    }
  | {
      type: 'attachment_removed';
      timestamp: string;
      payload: { path: string; hash: string };
    }
  | {
      type: 'pdf_extracted';
      timestamp: string;
      payload: { path: string; pages: number; mode: 'native' | 'text-extract' };
    }
  | {
      type: 'context_compressed';
      timestamp: string;
      payload: {
        messagesBefore: number;
        tokensBefore: number;
        messagesAfter: number;
        tokensAfter: number;
      };
    }
  | {
      type: 'tts_played';
      timestamp: string;
      payload: { textLength: number; voiceId: string };
    }
  | {
      type: 'plugin_installed';
      timestamp: string;
      payload: { id: string; version: string; permissions: string[] };
    }
  | {
      type: 'plugin_enabled';
      timestamp: string;
      payload: { id: string; version: string };
    }
  | {
      type: 'plugin_disabled';
      timestamp: string;
      payload: { id: string; version: string; reason?: string };
    }
  | { type: 'plugin_uninstalled'; timestamp: string; payload: { id: string } }
  | {
      type: 'plugin_executed';
      timestamp: string;
      payload: { id: string; command: string; durationMs: number };
    }
  | {
      type: 'plugin_crashed';
      timestamp: string;
      payload: { id: string; version: string; error: string; stack?: string };
    }
  | {
      type: 'plugin_permission_denied';
      timestamp: string;
      payload: {
        id: string;
        permission: string;
        apiCall?: string;
        reason?: string;
      };
    }
  | {
      type: 'plugin_install_failed';
      timestamp: string;
      payload: { id?: string; source: string; error: string };
    }
  /**
   * An MCP server write was blocked because Privileged Matter Mode is on. MCP
   * servers run inside an external client (e.g. Claude Desktop) and reach the
   * workspace through Lantern's write-approval channel; while the mode is on,
   * every such write is auto-denied instead of prompted. Records the workspace
   * path the MCP client tried to write so there is a defensible record that
   * nothing was exfiltrated or modified by a network-capable MCP server.
   */
  | {
      type: 'mcp_blocked';
      timestamp: string;
      payload: { path: string; reason: string };
    }
  /**
   * Connector-access: the advisor's one-time consent decision on storing and
   * AI-processing exported reports/notes Lantern recognized from outside tools.
   * `tools` lists which were present when the prompt fired (e.g. ["RightCapital"]).
   */
  | {
      type: 'external_export_consent';
      timestamp: string;
      payload: { given: boolean; tools: string[] };
    }
  | {
      type:
        | 'client_map_bullet_added'
        | 'client_map_bullet_edited'
        | 'client_map_bullet_removed';
      timestamp: string;
      payload: {
        matterId: string;
        sectionKey: string;
        sectionTitle: string;
        itemId?: string;
        actor: string;
        beforeText?: string;
        afterText?: string;
        sources: Array<{
          kind: string;
          ref: string;
          snippet: string;
          citationId?: string;
          locator?: string;
        }>;
      };
    }
  | {
      type: 'client_map_section_removed';
      timestamp: string;
      payload: {
        matterId: string;
        sectionKey: string;
        sectionTitle: string;
        actor: string;
        removedBulletCount: number;
        sources: Array<{
          kind: string;
          ref: string;
          snippet: string;
          citationId?: string;
          locator?: string;
        }>;
      };
    }
  | {
      type: 'mcp_matter_access_granted';
      timestamp: string;
      payload: { matterId: string; matterName?: string; detail?: string };
    }
  | {
      type: 'mcp_matter_access_revoked';
      timestamp: string;
      payload: { matterId: string; matterName?: string; detail?: string };
    }
  // ───────────────────────────────────────────────────────────────────────
  // Firm Phase 1 (Task 3) — matter sharing and member governance events.
  //
  // These are first-class variants so the audit log is a legally accurate
  // record of who shared what with whom, who was invited or removed, and
  // when an ethical wall was raised or a key was published to a new epoch.
  // The event payload carries the firm matter id, the org id where
  // applicable, and the target user id so every governance action is
  // unambiguously attributable. The detail field holds a short plain-
  // English summary for display in the audit log detail pane.
  // ───────────────────────────────────────────────────────────────────────
  /**
   * A local matter was linked to a firm matter (shared with the firm).
   * Records the local matter id and the resulting firm matter id.
   */
  | {
      type: 'matter_shared';
      timestamp: string;
      payload: {
        matter_id: string;
        firm_matter_id: string;
        org_id?: string;
        detail?: string;
      };
    }
  /**
   * A matter was unlinked from the firm (unshared / left).
   */
  | {
      type: 'matter_unshared';
      timestamp: string;
      payload: {
        matter_id: string;
        firm_matter_id?: string;
        detail?: string;
      };
    }
  /**
   * A user was invited to a firm matter as a member.
   */
  | {
      type: 'member_invited';
      timestamp: string;
      payload: {
        matter_id: string;
        firm_matter_id: string;
        target_user_id: string;
        org_id?: string;
        detail?: string;
      };
    }
  /**
   * A user was removed from a firm matter.
   */
  | {
      type: 'member_removed';
      timestamp: string;
      payload: {
        matter_id: string;
        firm_matter_id: string;
        target_user_id: string;
        org_id?: string;
        detail?: string;
      };
    }
  /**
   * An ethical wall was set for a user on a matter (via the Matter Manager).
   */
  | {
      type: 'wall_set_from_manager';
      timestamp: string;
      payload: {
        matter_id: string;
        firm_matter_id: string;
        target_user_id: string;
        org_id?: string;
        detail?: string;
      };
    }
  /**
   * The per-matter content key was published to members at the current epoch.
   */
  | {
      type: 'key_published';
      timestamp: string;
      payload: {
        matter_id: string;
        firm_matter_id: string;
        org_id?: string;
        detail?: string;
      };
    }
  /**
   * A seat was revoked by an admin (via the Firm Admin Console's revoke flow).
   * Recorded as a firm governance event so there is an auditable record of
   * which seat was deactivated, on which machine, and when.
   */
  | {
      type: 'seat_revoked';
      timestamp: string;
      payload: {
        seat_id: string;
        org_id?: string;
        reason?: string;
        detail?: string;
      };
    }
  | {
      type: 'template_installed_from_marketplace';
      timestamp: string;
      payload: { templateId: string; version: string; error?: string };
    }
  | {
      type: 'template_uninstalled';
      timestamp: string;
      payload: { templateId: string; version: string; error?: string };
    }
  | {
      type: 'template_updated';
      timestamp: string;
      payload: {
        templateId: string;
        version: string;
        fromVersion?: string;
        toVersion?: string;
        error?: string;
      };
    }
  | {
      type: 'template_install_failed';
      timestamp: string;
      payload: { templateId: string; version: string; error?: string };
    }
  | {
      type: 'language_changed';
      timestamp: string;
      payload: { from: string; to: string };
    }
  // ───────────────────────────────────────────────────────────────────────
  // Lantern 3.0 provenance events.
  //
  // These exist so the audit log is a complete "defense file": for every AI
  // action that reaches into a client's files or out to a provider, the log
  // records WHAT was searched, WHICH matter it was confined to, WHETHER
  // privileged material was excluded, WHETHER each cited source actually
  // checks out, and WHERE the request went. The provenance is for the user's
  // own files and defense, not surveillance — the storage stays append-only
  // and on the user's machine.
  // ───────────────────────────────────────────────────────────────────────
  /**
   * A workspace/RAG retrieval ran for an AI action. Records the query, the
   * confidentiality scope it was confined to (a single matter or the explicit
   * all-matters scope), how many chunks came back, and the best similarity
   * score (so a "nothing relevant" answer is provable after the fact).
   */
  | {
      type: 'retrieval_executed';
      timestamp: string;
      payload: {
        query: string;
        scope: AuditScope;
        hitCount: number;
        /** Highest similarity score across hits, or null when there were none. */
        topScore: number | null;
        /** F-510 — per-source diversity cap applied to this retrieval (the
         *  contradiction finder passes 4). Absent = uncapped. */
        perSourceCap?: number;
        /** B6 — the actual local sources returned by this retrieval. */
        sources?: AuditSourceIdentity[];
      };
    }
  /**
   * A citation in an AI answer was checked against the local store. Records the
   * content-addressed citation id and the verdict, so a misquote / fabricated
   * cite / cross-matter cite is recorded the moment it is caught.
   */
  | {
      type: 'citation_verified';
      timestamp: string;
      payload: { citationId: string; verdict: CitationVerdict };
    }
  /**
   * Privilege was evaluated for a retrieval. `excluded: true` is the default
   * (attorney-client / work-product stays out); `excluded: false` records a
   * deliberate, user-initiated query that opted privileged sources IN.
   */
  | {
      type: 'privilege_evaluated';
      timestamp: string;
      payload: { excluded: boolean };
    }
  /**
   * The active confidentiality scope for an AI action (which client matter, or
   * the explicit all-matters scope). Logged at send time so history shows the
   * boundary the action ran under, even if the matter is later renamed/deleted.
   */
  | {
      type: 'scope_active';
      timestamp: string;
      payload: { scope: AuditScope };
    }
  /**
   * Where an AI send actually went, taken from the egress source of truth
   * (`resolveEgress`): the provider, the active confidentiality mode, and the
   * resolved destination (on-machine local, direct to the provider with the
   * user's key, or the browser-demo relay).
   */
  | {
      type: 'egress';
      timestamp: string;
      payload: {
        provider: string;
        /** The model the request was sent to (BUG-028: so the confidentiality
         * report names the model instead of printing "unknown"). */
        model?: string;
        mode: ConfidentialityMode;
        destination: EgressDestination;
        /** Whether anything actually left the device for this send. */
        dataLeaves: boolean;
        /** The active matter scope at send time (for per-matter report assembly). */
        scope?: AuditScope;
        /** B6 — the local sources actually included in this model request. */
        readSources?: AuditSourceIdentity[];
        /**
         * F2.5 — whether the AI's READ-class file tools (read/list/search) were
         * enabled for this send. `true` only when the advisor granted file
         * access for the conversation under a scope covering this turn. Keeps the
         * trust surface honest: the Data Map can show which sends could pull more
         * files. (Cloud sends only; local sends never register tools.)
         */
        fileToolsEnabled?: boolean;
      };
    }
  /**
   * The advisor dismissed/resolved a beneficiary consistency finding
   * (Wave 4 Track B, estate/beneficiary mismatch detection). `finding` is the
   * gap question text (prefixed `Beneficiary check:`) so the audit log keeps
   * a durable record of exactly what was flagged and cleared.
   */
  | {
      type: 'beneficiary_finding_dismissed';
      timestamp: string;
      payload: { matterId: string; finding: string };
    };

/**
 * Query options for filtering audit log
 */
export interface AuditQueryOptions {
  startDate?: Date;
  endDate?: Date;
  actionTypes?: AuditActionType[];
  model?: string;
  limit?: number;
  offset?: number;
}
