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
