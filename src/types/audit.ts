// Audit Types

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
  | 'user_action';

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
  | { type: 'plugin_uninstalled'; timestamp: string; payload: { id: string } }
  | { type: 'plugin_executed'; timestamp: string; payload: { id: string; command: string; durationMs: number } }
  | { type: 'plugin_permission_denied'; timestamp: string; payload: { id: string; permission: string } }
  | { type: 'template_installed_from_marketplace'; timestamp: string; payload: { id: string; version: string; source: string } }
  | { type: 'language_changed'; timestamp: string; payload: { from: string; to: string } };

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
