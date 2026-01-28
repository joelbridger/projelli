// Run Record Service
// Persists and manages workflow run records

import type { RunRecord, RunRecordStatus } from '@/types/workflow';

export interface RunRecordQuery {
  /** Filter by workflow ID */
  workflowId?: string;
  /** Filter by model */
  model?: string;
  /** Filter by status */
  status?: RunRecordStatus;
  /** Filter by date range - start */
  startDate?: Date;
  /** Filter by date range - end */
  endDate?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface RunRecordDiff {
  /** Fields that changed */
  changedInputs: string[];
  changedOutputs: string[];
  /** Input value differences */
  inputDiffs: Record<string, { old: unknown; new: unknown }>;
  /** Output value differences */
  outputDiffs: Record<string, { old: unknown; new: unknown }>;
}

/**
 * RunRecordService manages workflow run records
 */
export class RunRecordService {
  private records: Map<string, RunRecord> = new Map();
  private readonly storageKey: string;

  constructor(workspaceId: string = 'default') {
    this.storageKey = `run_records_${workspaceId}`;
    this.load();
  }

  /**
   * Save a new run record
   */
  save(record: RunRecord): void {
    this.records.set(record.run_id, record);
    this.persist();
  }

  /**
   * Get a run record by ID
   */
  get(runId: string): RunRecord | undefined {
    return this.records.get(runId);
  }

  /**
   * Update an existing run record
   */
  update(runId: string, updates: Partial<RunRecord>): RunRecord | undefined {
    const existing = this.records.get(runId);
    if (!existing) return undefined;

    const updated: RunRecord = { ...existing, ...updates };
    this.records.set(runId, updated);
    this.persist();
    return updated;
  }

  /**
   * Delete a run record
   */
  delete(runId: string): boolean {
    const deleted = this.records.delete(runId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  /**
   * Query run records with filters
   */
  query(options: RunRecordQuery = {}): RunRecord[] {
    let results = Array.from(this.records.values());

    // Filter by workflow ID
    if (options.workflowId) {
      results = results.filter((r) => r.workflow === options.workflowId);
    }

    // Filter by model
    if (options.model) {
      results = results.filter((r) => r.model === options.model);
    }

    // Filter by status
    if (options.status) {
      results = results.filter((r) => r.status === options.status);
    }

    // Filter by date range
    if (options.startDate) {
      const startTime = options.startDate.getTime();
      results = results.filter(
        (r) => new Date(r.start_time).getTime() >= startTime
      );
    }
    if (options.endDate) {
      const endTime = options.endDate.getTime();
      results = results.filter(
        (r) => new Date(r.start_time).getTime() <= endTime
      );
    }

    // Sort by start time descending (most recent first)
    results.sort(
      (a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get all records for a workflow
   */
  getByWorkflow(workflowId: string): RunRecord[] {
    return this.query({ workflowId });
  }

  /**
   * Get the most recent run for a workflow
   */
  getMostRecent(workflowId: string): RunRecord | undefined {
    const records = this.getByWorkflow(workflowId);
    return records[0];
  }

  /**
   * Compare two run records and return differences
   */
  diff(runId1: string, runId2: string): RunRecordDiff | undefined {
    const record1 = this.get(runId1);
    const record2 = this.get(runId2);

    if (!record1 || !record2) {
      return undefined;
    }

    const changedInputs: string[] = [];
    const changedOutputs: string[] = [];
    const inputDiffs: Record<string, { old: unknown; new: unknown }> = {};
    const outputDiffs: Record<string, { old: unknown; new: unknown }> = {};

    // Compare inputs
    const allInputKeys = new Set([
      ...Object.keys(record1.inputs),
      ...Object.keys(record2.inputs),
    ]);

    for (const key of allInputKeys) {
      const val1 = record1.inputs[key];
      const val2 = record2.inputs[key];

      if (!this.deepEqual(val1, val2)) {
        changedInputs.push(key);
        inputDiffs[key] = { old: val1, new: val2 };
      }
    }

    // Compare outputs
    const allOutputKeys = new Set([
      ...Object.keys(record1.outputs),
      ...Object.keys(record2.outputs),
    ]);

    for (const key of allOutputKeys) {
      const val1 = record1.outputs[key];
      const val2 = record2.outputs[key];

      if (!this.deepEqual(val1, val2)) {
        changedOutputs.push(key);
        outputDiffs[key] = { old: val1, new: val2 };
      }
    }

    return {
      changedInputs,
      changedOutputs,
      inputDiffs,
      outputDiffs,
    };
  }

  /**
   * Get run count
   */
  getCount(): number {
    return this.records.size;
  }

  /**
   * Get all run IDs
   */
  getAllIds(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    totalCost: number;
    averageDuration: number;
  } {
    const records = Array.from(this.records.values());
    let totalCost = 0;
    let totalDuration = 0;
    let completedRuns = 0;
    let failedRuns = 0;

    for (const record of records) {
      if (record.status === 'completed') completedRuns++;
      if (record.status === 'failed') failedRuns++;

      // Calculate cost from outputs
      for (const [key, value] of Object.entries(record.outputs)) {
        if (key.endsWith('_cost') && typeof value === 'number') {
          totalCost += value;
        }
      }

      // Calculate duration
      const start = new Date(record.start_time).getTime();
      const end = new Date(record.end_time).getTime();
      totalDuration += end - start;
    }

    return {
      totalRuns: records.length,
      completedRuns,
      failedRuns,
      totalCost,
      averageDuration: records.length > 0 ? totalDuration / records.length : 0,
    };
  }

  /**
   * Export all records as JSON
   */
  exportJSON(): string {
    return JSON.stringify(Array.from(this.records.values()), null, 2);
  }

  /**
   * Import records from JSON
   */
  importJSON(json: string): number {
    const data = JSON.parse(json) as RunRecord[];
    let imported = 0;

    for (const record of data) {
      if (record.run_id && !this.records.has(record.run_id)) {
        this.records.set(record.run_id, record);
        imported++;
      }
    }

    this.persist();
    return imported;
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records.clear();
    this.persist();
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as Record<string, unknown>);
      const bKeys = Object.keys(b as Record<string, unknown>);

      if (aKeys.length !== bKeys.length) return false;

      for (const key of aKeys) {
        if (
          !this.deepEqual(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key]
          )
        ) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Load from localStorage
   */
  private load(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const records = JSON.parse(data) as RunRecord[];
        this.records.clear();
        for (const record of records) {
          this.records.set(record.run_id, record);
        }
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
      const data = Array.from(this.records.values());
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Create a run record service instance
 */
export function createRunRecordService(workspaceId?: string): RunRecordService {
  return new RunRecordService(workspaceId);
}
