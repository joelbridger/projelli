// Audit Service
// Append-only log of all AI actions and significant user operations

import type { AuditEntry, AuditActionType, AuditQueryOptions } from '@/types/audit';

/**
 * AuditService provides append-only logging of actions
 */
export class AuditService {
  private entries: AuditEntry[] = [];
  private readonly storageKey: string;

  constructor(workspaceId: string = 'default') {
    this.storageKey = `audit_log_${workspaceId}`;
    this.load();
  }

  /**
   * Log an action (append-only)
   */
  log(
    action: AuditActionType,
    description: string,
    options: {
      model?: string;
      inputs?: Record<string, unknown>;
      outputs?: Record<string, unknown>;
      userDecision?: 'approved' | 'rejected' | 'auto';
      metadata?: Record<string, unknown>;
    } = {}
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      action,
      description,
      model: options.model,
      inputs: options.inputs ?? {},
      outputs: options.outputs ?? {},
      userDecision: options.userDecision,
      metadata: options.metadata ?? {},
    };

    this.entries.push(entry);
    this.persist();

    return entry;
  }

  /**
   * Log a file creation
   */
  logFileCreate(path: string, byModel?: string): AuditEntry {
    const options: {
      model?: string;
      outputs: { path: string };
      userDecision: 'approved' | 'auto';
    } = {
      outputs: { path },
      userDecision: byModel ? 'approved' : 'auto',
    };
    if (byModel) {
      options.model = byModel;
    }
    return this.log('file_create', `Created file: ${path}`, options);
  }

  /**
   * Log a file update
   */
  logFileUpdate(path: string, byModel?: string): AuditEntry {
    const options: {
      model?: string;
      outputs: { path: string };
      userDecision: 'approved' | 'auto';
    } = {
      outputs: { path },
      userDecision: byModel ? 'approved' : 'auto',
    };
    if (byModel) {
      options.model = byModel;
    }
    return this.log('file_update', `Updated file: ${path}`, options);
  }

  /**
   * Log a file deletion
   */
  logFileDelete(path: string, byModel?: string): AuditEntry {
    const options: {
      model?: string;
      outputs: { path: string };
      userDecision: 'approved' | 'auto';
    } = {
      outputs: { path },
      userDecision: byModel ? 'approved' : 'auto',
    };
    if (byModel) {
      options.model = byModel;
    }
    return this.log('file_delete', `Deleted file: ${path}`, options);
  }

  /**
   * Log a workflow start
   */
  logWorkflowStart(
    workflowId: string,
    workflowName: string,
    inputs: Record<string, unknown>
  ): AuditEntry {
    return this.log('workflow_start', `Started workflow: ${workflowName}`, {
      inputs,
      metadata: { workflowId },
    });
  }

  /**
   * Log a workflow completion
   */
  logWorkflowComplete(
    workflowId: string,
    workflowName: string,
    outputs: Record<string, unknown>
  ): AuditEntry {
    return this.log('workflow_complete', `Completed workflow: ${workflowName}`, {
      outputs,
      metadata: { workflowId },
    });
  }

  /**
   * Log a workflow failure
   */
  logWorkflowFail(
    workflowId: string,
    workflowName: string,
    error: string
  ): AuditEntry {
    return this.log('workflow_fail', `Failed workflow: ${workflowName}`, {
      outputs: { error },
      metadata: { workflowId },
    });
  }

  /**
   * Log a model API call
   */
  logModelCall(
    model: string,
    prompt: string,
    response: string,
    tokens: number,
    cost: number
  ): AuditEntry {
    return this.log('model_call', `Model call to ${model}`, {
      model,
      inputs: { prompt: prompt.slice(0, 500) + (prompt.length > 500 ? '...' : '') },
      outputs: {
        response: response.slice(0, 500) + (response.length > 500 ? '...' : ''),
        tokens,
        cost,
      },
    });
  }

  /**
   * Query audit entries
   */
  query(options: AuditQueryOptions = {}): AuditEntry[] {
    let results = [...this.entries];

    // Filter by date range
    if (options.startDate) {
      const startTime = options.startDate.getTime();
      results = results.filter(
        (e) => new Date(e.timestamp).getTime() >= startTime
      );
    }
    if (options.endDate) {
      const endTime = options.endDate.getTime();
      results = results.filter(
        (e) => new Date(e.timestamp).getTime() <= endTime
      );
    }

    // Filter by action types
    if (options.actionTypes && options.actionTypes.length > 0) {
      results = results.filter((e) => options.actionTypes!.includes(e.action));
    }

    // Filter by model
    if (options.model) {
      results = results.filter((e) => e.model === options.model);
    }

    // Sort by timestamp descending (most recent first)
    results.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get all entries (for export)
   */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get entry count
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Export to JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Export to CSV
   */
  exportCSV(): string {
    const headers = [
      'id',
      'timestamp',
      'action',
      'description',
      'model',
      'userDecision',
    ];
    const rows = this.entries.map((e) =>
      [
        e.id,
        e.timestamp,
        e.action,
        `"${e.description.replace(/"/g, '""')}"`,
        e.model ?? '',
        e.userDecision ?? '',
      ].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Load from localStorage
   */
  private load(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        this.entries = JSON.parse(data);
      }
    } catch {
      // Ignore load errors
    }
  }

  /**
   * Persist to localStorage
   */
  private persist(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Create an audit service instance
 */
export function createAuditService(workspaceId?: string): AuditService {
  return new AuditService(workspaceId);
}
