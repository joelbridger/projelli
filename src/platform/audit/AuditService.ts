// Audit Service
// Append-only log of all AI actions and significant user operations
//
// PERSISTENCE (Lantern 3.0):
//   - Desktop (Tauri): entries are persisted to a SQLCipher-ENCRYPTED,
//     append-only store on disk (`src-tauri/src/commands/audit/`), keyed by a
//     master key in the OS keychain. This is the audit "defense file" at rest.
//     Each append pushes a single row to the encrypted store (best-effort,
//     non-blocking); the in-memory array stays the synchronous read model.
//   - Browser: there is no native keychain or SQLCipher, so entries persist to
//     localStorage UNENCRYPTED. The audit UI says so plainly and points the
//     user at the desktop app for confidential work. (See `isAuditEncrypted`.)
//
// The public API stays synchronous and append-only so every existing caller
// (plugins, TTS, marketplace) is unchanged; desktop encryption is transparent.

import type { AuditEntry, AuditActionType, AuditEvent, AuditQueryOptions } from '@/platform/types/audit';
import { csvDocument, csvGuardedRow } from '@/platform/export/csvSafe';
import {
  auditAppend,
  auditList,
  auditRepairSeal,
  auditSetWorkspace,
  auditVerifyIntegrity,
  type AuditEntryRecord,
  type AuditIntegrityVerdict,
} from '@/platform/utils/tauri-commands';
// Tauri presence is detected via the injected window global in
// isAuditEncrypted(), not the SDK's isTauri export: vitest throws when code
// accesses a named export a partial mock omits, so importing isTauri here would
// break any test that mocks @tauri-apps/api/core without it.

/**
 * True when the audit log is encrypted at rest (the desktop app). False in the
 * browser, where it lives in localStorage unencrypted. The UI uses this to show
 * an honest at-rest note.
 */
export function isAuditEncrypted(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

type AuditLogOptions = {
  model?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  userDecision?: 'approved' | 'rejected' | 'auto';
  metadata?: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  provider?: string;
};

export class AuditPersistenceError extends Error {
  readonly entry: AuditEntry;
  override readonly cause: unknown;

  constructor(entry: AuditEntry, cause: unknown) {
    super(`Audit entry could not be saved durably: ${errorMessage(cause)}`);
    this.name = 'AuditPersistenceError';
    this.entry = entry;
    this.cause = cause;
  }
}

const CRITICAL_ACTIONS = new Set<AuditActionType>([
  'egress',
  'model_call',
  'file_export',
  'file_create',
  'file_update',
  'file_delete',
  'file_move',
  'file_rename',
  'mcp_blocked',
  'mcp_list',
  'mcp_read',
  'mcp_search',
  'mcp_write_requested',
  'mcp_write_approved',
  'mcp_write_denied',
  'mcp_matter_access_granted',
  'mcp_matter_access_revoked',
  'matter_shared',
  'matter_unshared',
  'member_invited',
  'member_removed',
  'wall_set_from_manager',
  'key_published',
  'seat_revoked',
  'wealthbox.create_note',
  'wealthbox.create_task',
  'wealthbox.field_updated',
  'acats.approve',
  'acats.export',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serialize a flat entry to the encrypted-store record shape. The full entry
 *  is preserved verbatim in `payloadJson` so it round-trips losslessly. */
function entryToRecord(entry: AuditEntry): AuditEntryRecord {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    action: entry.action,
    description: entry.description,
    payloadJson: JSON.stringify(entry),
  };
}

/** Parse an encrypted-store record back into a flat entry. Falls back to a
 *  minimal entry if the JSON payload is somehow unreadable (never throws).
 *  Exported for unit testing the load-source normalization. */
export function recordToEntry(rec: AuditEntryRecord): AuditEntry {
  try {
    const parsed = JSON.parse(rec.payloadJson) as Partial<AuditEntry>;
    // Trust the summary columns for the indexed fields in case the payload is
    // an older/partial shape. Normalize inputs/outputs/metadata to OBJECTS at the
    // LOAD source so an OLD thin persisted row (e.g. {"auditEventType":"..."} with
    // no metadata) loads with {} rather than undefined — the Activity Log reads
    // `metadata['scope']` / `Object.keys(inputs)` directly. The display layer's
    // asRecord() also guards this, but normalizing here closes it at the source.
    // Mirrors the live-event guard in useWorkspaceLifecycle.ts.
    return {
      ...(parsed as AuditEntry),
      id: rec.id,
      timestamp: rec.timestamp,
      action: rec.action as AuditActionType,
      description: rec.description,
      inputs: parsed.inputs && typeof parsed.inputs === 'object' ? parsed.inputs : {},
      outputs: parsed.outputs && typeof parsed.outputs === 'object' ? parsed.outputs : {},
      metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {},
    };
  } catch {
    return {
      id: rec.id,
      timestamp: rec.timestamp,
      action: rec.action as AuditActionType,
      description: rec.description,
      model: undefined,
      inputs: {},
      outputs: {},
      userDecision: undefined,
      metadata: {},
    };
  }
}

/**
 * AuditService provides append-only logging of actions
 */
export class AuditService {
  private entries: AuditEntry[] = [];
  private readonly storageKey: string;
  /** Desktop only: persist appends to the encrypted Tauri store. */
  private readonly encrypted: boolean;

  constructor(workspaceId: string = 'default') {
    this.storageKey = `audit_log_${workspaceId}`;
    this.encrypted = isAuditEncrypted();
    // Browser: hydrate synchronously from localStorage (unchanged behaviour).
    // Desktop: the in-memory list starts empty and is hydrated via the async
    // `hydrate()` once the workspace is set (the encrypted store needs a path).
    if (!this.encrypted) {
      this.load();
    }
  }

  /**
   * Desktop: point the encrypted audit store at the active workspace, then load
   * any persisted entries into memory. No-op-safe in the browser (resolves
   * after the synchronous localStorage load already done in the constructor).
   * Call this when the workspace is opened/changed.
   */
  async hydrate(workspacePath?: string): Promise<boolean> {
    if (!this.encrypted) return true; // browser already loaded from localStorage
    if (workspacePath) {
      try {
        await auditSetWorkspace(workspacePath);
      } catch {
        // If we can't set the workspace, leave the in-memory log as-is.
        return false;
      }
    }
    try {
      const records = await auditList();
      this.entries = records.map(recordToEntry);
    } catch {
      // Best-effort hydrate; an unreadable store leaves the session log empty
      // rather than crashing the app.
    }
    return true;
  }

  async verifyIntegrity(): Promise<AuditIntegrityVerdict | undefined> {
    if (!this.encrypted) {
      return undefined;
    }
    return auditVerifyIntegrity();
  }

  /**
   * Desktop only: repair a seal-missing encrypted audit log. The Rust
   * `audit_repair_seal` command re-seals the surviving prefix AFTER writing a
   * permanent anomaly record into the new chain (recording that the seal was
   * missing and that prior completeness can no longer be verified). We then
   * re-hydrate so the new anomaly entry appears in the live view. No-op in the
   * browser (no encrypted chain there). Throws if the store is not seal-missing.
   */
  async repairSeal(): Promise<void> {
    if (!this.encrypted) return;
    await auditRepairSeal();
    await this.hydrate();
  }

  /**
   * Append a structured v2.0 AuditEvent.
   *
   * This is the preferred API for new v2.0 features. Each event is persisted
   * to localStorage alongside the legacy flat entries. The event is stored
   * using the legacy AuditEntry shape (action = event.type, metadata = payload)
   * so queries still work across old and new events.
   */
  append(event: AuditEvent): void {
    const entry: AuditEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: event.timestamp,
      action: event.type as AuditActionType,
      description: event.type,
      model: undefined,
      inputs: {},
      outputs: {},
      userDecision: undefined,
      metadata: event.payload as Record<string, unknown>,
    };
    this.entries.push(entry);
    this.record(entry);
  }

  /**
   * Log an action (append-only)
   */
  log(
    action: AuditActionType,
    description: string,
    options: AuditLogOptions = {}
  ): AuditEntry {
    const entry = this.buildEntry(action, description, options);
    this.entries.push(entry);
    this.record(entry);

    return entry;
  }

  /**
   * Log an action and await persistence when the action is critical. This never
   * throws; failures are stamped onto the returned in-memory entry so the UI
   * can show that the row is not durably saved.
   */
  async logDurable(
    action: AuditActionType,
    description: string,
    options: AuditLogOptions = {}
  ): Promise<AuditEntry> {
    const { persisted } = this.logDurablePending(action, description, options);
    return persisted;
  }

  /**
   * Log a compliance-critical action and require durable persistence.
   *
   * Use this before actions that must not happen without a saved audit row
   * (cloud egress, model calls, CRM writes, exports). Unlike `logDurable()`,
   * this throws when the encrypted store/localStorage write fails so callers can
   * block the action.
   */
  async mustLogDurable(
    action: AuditActionType,
    description: string,
    options: AuditLogOptions = {}
  ): Promise<AuditEntry> {
    const entry = this.buildEntry(action, description, options);
    entry.metadata = { ...entry.metadata, auditPersistenceStatus: 'pending' };
    this.entries.push(entry);
    return this.recordDurableOrThrow(entry);
  }

  /**
   * Log a critical action immediately and persist it in the background.
   * The returned `entry` is safe to show in live UI right away with
   * `auditPersistenceStatus: "pending"`. Await `persisted` only when a caller
   * needs the final saved/failed status.
   */
  logDurablePending(
    action: AuditActionType,
    description: string,
    options: AuditLogOptions = {}
  ): { entry: AuditEntry; persisted: Promise<AuditEntry> } {
    const entry = this.buildEntry(action, description, options);
    entry.metadata = { ...entry.metadata, auditPersistenceStatus: 'pending' };
    this.entries.push(entry);
    return { entry, persisted: this.recordDurable(entry) };
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
   * Export to CSV.
   *
   * A NINTH CSV writer, and the one that makes the point of this whole class.
   * Five were found by hand, R-16 was the sixth, the derivation added a
   * seventh (the native migration rollback CSV) — and this one stayed hidden
   * one round longer because the FIRST version of the derived-set checker
   * stripped comments before matching, and stripping ate the block that made
   * this file visible. A detection mechanism's shape decides what it can find,
   * including a mechanism written to end exactly this failure.
   *
   * It escaped the quote in ONE column and nothing else: a description of
   * `=cmd|'/c calc'!A1` was written straight into the cell, and an id or an
   * action containing a comma silently split the row.
   */
  exportCSV(): string {
    const headers = ['id', 'timestamp', 'action', 'description', 'model', 'userDecision'];
    const rows = this.entries.map((e) =>
      csvGuardedRow([e.id, e.timestamp, e.action, e.description, e.model ?? '', e.userDecision ?? ''])
    );
    return csvDocument([csvGuardedRow(headers), ...rows], { lineEnding: '\n' });
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
   * Persist ONE newly-appended entry to the active backend.
   *   - Desktop: append the single row to the SQLCipher-encrypted store
   *     (append-only; fire-and-forget so the synchronous API stays sync).
   *   - Browser: rewrite the localStorage blob (unencrypted; the only option
   *     the web platform offers without a native keychain).
   * Append-only is preserved either way: we only ever add entries, never
   * mutate or remove existing ones.
   */
  private buildEntry(
    action: AuditActionType,
    description: string,
    options: AuditLogOptions,
  ): AuditEntry {
    return {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      action,
      description,
      model: options.model,
      inputs: options.inputs ?? {},
      outputs: options.outputs ?? {},
      userDecision: options.userDecision,
      metadata: options.metadata ?? {},
      ...(options.tokensIn !== undefined ? { tokensIn: options.tokensIn } : {}),
      ...(options.tokensOut !== undefined ? { tokensOut: options.tokensOut } : {}),
      ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
    };
  }

  private record(entry: AuditEntry): void {
    if (CRITICAL_ACTIONS.has(entry.action)) {
      entry.metadata = { ...entry.metadata, auditPersistenceStatus: 'pending' };
      void this.recordDurable(entry);
      return;
    }
    if (this.encrypted) {
      // Fire-and-forget; a transient backend error must not break logging. The
      // in-memory list already holds the entry for this session, and a reopen
      // re-hydrates from the store.
      void auditAppend(entryToRecord(entry)).catch(() => {
        /* best-effort: encrypted-store append failed; entry stays in memory */
      });
      return;
    }
    this.persist();
  }

  private async recordDurable(entry: AuditEntry): Promise<AuditEntry> {
    try {
      return await this.recordDurableOrThrow(entry);
    } catch (error) {
      console.error('Audit persistence failed:', error);
      return entry;
    }
  }

  private async recordDurableOrThrow(entry: AuditEntry): Promise<AuditEntry> {
    entry.metadata = { ...entry.metadata, auditPersistenceStatus: 'pending' };
    try {
      const savedEntry: AuditEntry = {
        ...entry,
        metadata: { ...entry.metadata, auditPersistenceStatus: 'saved' },
      };
      if (this.encrypted) {
        await auditAppend(entryToRecord(savedEntry));
      } else {
        entry.metadata = savedEntry.metadata;
        this.persistOrThrow();
        return entry;
      }
      entry.metadata = savedEntry.metadata;
    } catch (error) {
      entry.metadata = {
        ...entry.metadata,
        auditPersistenceStatus: 'failed',
        auditPersistenceError: errorMessage(error),
      };
      throw new AuditPersistenceError(entry, error);
    }
    return entry;
  }

  /**
   * Persist the full in-memory log to localStorage (browser only). Unencrypted
   * by necessity on the web platform; the desktop app uses the encrypted store.
   */
  private persist(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      this.persistOrThrow();
    } catch {
      // Ignore storage errors
    }
  }

  private persistOrThrow(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(this.storageKey, JSON.stringify(this.entries));
  }
}

/**
 * Convert a structured {@link AuditEvent} into the flat
 * `Omit<AuditEntry, 'id' | 'timestamp'>` shape expected by the `onAuditLog`
 * callback used throughout the UI (which appends to React state + the encrypted
 * store). This is the single place that maps an event's `type`/`payload` onto
 * the legacy entry fields, so every 3.0 provenance event renders consistently
 * in the audit log and stays append-only.
 *
 * The event `type` is stamped into `metadata.auditEventType` (matching the
 * existing attachment events), and the full `payload` is preserved under
 * `metadata` so nothing is lost. Where a payload has a natural
 * input/output/model split, we surface it so the log row + detail view read
 * well without bespoke per-event code.
 */
export function auditEventToEntry(
  event: AuditEvent
): Omit<AuditEntry, 'id' | 'timestamp'> {
  const payload = event.payload as Record<string, unknown>;
  const base: Omit<AuditEntry, 'id' | 'timestamp'> = {
    action: event.type as AuditActionType,
    description: describeAuditEvent(event),
    model: typeof payload['model'] === 'string' ? payload['model'] : undefined,
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    metadata: { auditEventType: event.type, ...payload },
  };
  return base;
}

/**
 * Human-readable one-liner for a structured event, used as the audit-row
 * description. Kept protective and plain (no jargon, no em dashes).
 */
function describeAuditEvent(event: AuditEvent): string {
  switch (event.type) {
    case 'retrieval_executed': {
      const scope =
        event.payload.scope.kind === 'matter'
          ? `matter ${event.payload.scope.matterName ?? event.payload.scope.matterId}`
          : 'all matters';
      return `Searched your files (${scope}): ${event.payload.hitCount} result${event.payload.hitCount === 1 ? '' : 's'}`;
    }
    case 'citation_verified':
      return `Citation checked against your files: ${event.payload.verdict}`;
    case 'privilege_evaluated':
      return event.payload.excluded
        ? 'Privileged material excluded from this search'
        : 'Privileged material explicitly included for this search';
    case 'scope_active':
      return event.payload.scope.kind === 'matter'
        ? `Active matter: ${event.payload.scope.matterName ?? event.payload.scope.matterId}`
        : 'Active scope: all matters';
    case 'egress': {
      // Independent reviewer catch: 'assured-proxy' used to fall into the
      // generic "with your key" branch below, so an Assured-only firm user
      // (no personal key at all) got an Activity Log row that falsely claimed
      // they'd used their own key — every surface that logs assured egress
      // (Ask, redline, matter-at-a-glance, email) shares this description.
      const where =
        event.payload.destination === 'local'
          ? 'on your machine (nothing left)'
          : event.payload.destination === 'demo-proxy'
            ? 'the browser demo relay'
            : event.payload.destination === 'assured-proxy'
              ? `${event.payload.provider} via your firm's zero-retention proxy`
              : `${event.payload.provider} with your key`;
      return `AI request sent to ${where}`;
    }
    case 'mcp_blocked':
      return `External AI write blocked by Privileged Matter Mode: ${event.payload.path}`;
    case 'mcp_matter_access_granted':
      return `External AI access granted to matter: ${event.payload.matterName ?? event.payload.matterId}`;
    case 'mcp_matter_access_revoked':
      return `External AI access revoked from matter: ${event.payload.matterName ?? event.payload.matterId}`;
    case 'matter_shared':
      return `Matter shared with firm${event.payload.detail ? `: ${event.payload.detail}` : ''}`;
    case 'matter_unshared':
      return `Matter unshared from firm${event.payload.detail ? `: ${event.payload.detail}` : ''}`;
    case 'member_invited':
      return `Member invited to matter${event.payload.detail ? `: ${event.payload.detail}` : ` (user ${event.payload.target_user_id.slice(0, 8)})`}`;
    case 'member_removed':
      return `Member removed from matter${event.payload.detail ? `: ${event.payload.detail}` : ` (user ${event.payload.target_user_id.slice(0, 8)})`}`;
    case 'wall_set_from_manager':
      return `Information barrier set${event.payload.detail ? `: ${event.payload.detail}` : ` for user ${event.payload.target_user_id.slice(0, 8)}`}`;
    case 'key_published':
      return `Matter key published to members${event.payload.detail ? `: ${event.payload.detail}` : ''}`;
    case 'seat_revoked':
      return `Seat revoked by admin${event.payload.detail ? `: ${event.payload.detail}` : ` (seat ${event.payload.seat_id.slice(0, 12)})`}`;
    case 'external_export_consent': {
      const tools = event.payload.tools.length > 0 ? event.payload.tools.join(', ') : 'outside tools';
      return event.payload.given
        ? `Allowed storing and using exported reports from ${tools}`
        : `Declined storing exported reports from ${tools} for this answer`;
    }
    case 'beneficiary_finding_dismissed':
      return `Beneficiary check dismissed: ${event.payload.finding}`;
    case 'client_map_bullet_added':
      return `Client Map bullet added in ${event.payload.sectionTitle} by ${event.payload.actor}`;
    case 'client_map_bullet_edited':
      return `Client Map bullet edited in ${event.payload.sectionTitle} by ${event.payload.actor}`;
    case 'client_map_bullet_removed':
      return `Client Map bullet removed from ${event.payload.sectionTitle} by ${event.payload.actor}`;
    case 'client_map_section_removed':
      return `Client Map section removed: ${event.payload.sectionTitle}`;
    default:
      return event.type;
  }
}

/**
 * Create an audit service instance
 */
export function createAuditService(workspaceId?: string): AuditService {
  return new AuditService(workspaceId);
}
