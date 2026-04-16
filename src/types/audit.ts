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
