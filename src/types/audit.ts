// Audit Types

// The egress event mirrors the egress source of truth. `egress.ts` is a pure,
// dependency-free module, so importing its types here is safe (no cycle).
import type { ConfidentialityMode, EgressDestination } from '@/modules/privacy/egress';

/**
 * Types of audit actions
 */
export type AuditActionType =
  | 'file_create'
  | 'file_update'
  | 'file_delete'
  | 'file_move'
  | 'file_rename'
  | 'workflow_start'
  | 'workflow_complete'
  | 'workflow_fail'
  | 'model_call'
  | 'context_compressed'
  | 'user_action'
  // Keepance 3.0 provenance events. These mirror the new AuditEvent variants
  // below; they are listed here too because `AuditService.append()` stores an
  // event under `action = event.type`, and the audit-log UI keys its icon /
  // label / colour maps off `AuditActionType`. Adding them keeps the log
  // readable for the new events without a separate rendering path.
  | 'retrieval_executed'
  | 'citation_verified'
  | 'privilege_evaluated'
  | 'scope_active'
  | 'egress'
  // Privileged Matter Mode: an MCP server write was blocked while the mode was
  // on. Stored under `action = 'mcp_blocked'` so the audit log can label/filter
  // it as a defensible "nothing exfiltrated" record.
  | 'mcp_blocked';

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
   * entries where these aren't set. See `src/utils/audit-export.ts` —
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
  | { type: 'attachment_added'; timestamp: string; payload: { path: string; hash: string; byteSize: number } }
  | { type: 'attachment_sent_to_provider'; timestamp: string; payload: { path: string; hash: string; provider: string; model: string } }
  | { type: 'attachment_removed'; timestamp: string; payload: { path: string; hash: string } }
  | { type: 'pdf_extracted'; timestamp: string; payload: { path: string; pages: number; mode: 'native' | 'text-extract' } }
  | { type: 'context_compressed'; timestamp: string; payload: { messagesBefore: number; tokensBefore: number; messagesAfter: number; tokensAfter: number } }
  | { type: 'tts_played'; timestamp: string; payload: { textLength: number; voiceId: string } }
  | { type: 'plugin_installed'; timestamp: string; payload: { id: string; version: string; permissions: string[] } }
  | { type: 'plugin_enabled'; timestamp: string; payload: { id: string; version: string } }
  | { type: 'plugin_disabled'; timestamp: string; payload: { id: string; version: string; reason?: string } }
  | { type: 'plugin_uninstalled'; timestamp: string; payload: { id: string } }
  | { type: 'plugin_executed'; timestamp: string; payload: { id: string; command: string; durationMs: number } }
  | { type: 'plugin_crashed'; timestamp: string; payload: { id: string; version: string; error: string; stack?: string } }
  | { type: 'plugin_permission_denied'; timestamp: string; payload: { id: string; permission: string; apiCall?: string; reason?: string } }
  | { type: 'plugin_install_failed'; timestamp: string; payload: { id?: string; source: string; error: string } }
  /**
   * An MCP server write was blocked because Privileged Matter Mode is on. MCP
   * servers run inside an external client (e.g. Claude Desktop) and reach the
   * workspace through Keepance's write-approval channel; while the mode is on,
   * every such write is auto-denied instead of prompted. Records the workspace
   * path the MCP client tried to write so there is a defensible record that
   * nothing was exfiltrated or modified by a network-capable MCP server.
   */
  | { type: 'mcp_blocked'; timestamp: string; payload: { path: string; reason: string } }
  | { type: 'template_installed_from_marketplace'; timestamp: string; payload: { templateId: string; version: string; error?: string } }
  | { type: 'template_uninstalled'; timestamp: string; payload: { templateId: string; version: string; error?: string } }
  | { type: 'template_updated'; timestamp: string; payload: { templateId: string; version: string; fromVersion?: string; toVersion?: string; error?: string } }
  | { type: 'template_install_failed'; timestamp: string; payload: { templateId: string; version: string; error?: string } }
  | { type: 'language_changed'; timestamp: string; payload: { from: string; to: string } }
  // ───────────────────────────────────────────────────────────────────────
  // Keepance 3.0 provenance events.
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
        mode: ConfidentialityMode;
        destination: EgressDestination;
        /** Whether anything actually left the device for this send. */
        dataLeaves: boolean;
      };
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
