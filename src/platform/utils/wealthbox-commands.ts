// Thin wrappers around the Wealthbox/CRM Tauri commands defined in
// `src-tauri/src/commands/crm/commands.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of mail-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CrmMatterMapEntry } from '@/platform/rag/matterResolver';
import { getEgressOperation } from '@/platform/privacy/egressRegistry';
import { getNetworkPolicyStatus } from '@/platform/privacy/offlineMode';
import { BRAND } from '@/config/brand';
import type { MeetingVisibilitySubject } from '@/platform/meeting-visibility';

export type CrmProvider = 'wealthbox' | 'salesforce' | 'redtail';

type CrmNetworkOperationId =
  | 'crm-auth-wealthbox'
  | 'crm-auth-salesforce'
  | 'crm-auth-redtail'
  | 'crm-sync-wealthbox'
  | 'crm-write-wealthbox'
  | 'crm-sync-salesforce'
  | 'crm-sync-redtail'
  | 'crm-migration-import';

export class CrmNetworkLockdownError extends Error {
  readonly code = 'NETWORK_LOCKDOWN_BLOCKED';

  constructor(action: string, message?: string) {
    super(
      message ??
        `Network lockdown is on. ${action} is paused so nothing can leave this computer. Turn off Network lockdown in Privacy settings to continue.`,
    );
    this.name = 'CrmNetworkLockdownError';
  }
}

function crmOperationForProvider(
  provider: CrmProvider | undefined,
  purpose: 'auth' | 'sync' | 'write' = 'sync',
): CrmNetworkOperationId {
  if (provider === 'salesforce') {
    return purpose === 'auth' ? 'crm-auth-salesforce' : 'crm-sync-salesforce';
  }
  if (provider === 'redtail') {
    return purpose === 'auth' ? 'crm-auth-redtail' : 'crm-sync-redtail';
  }
  if (purpose === 'auth') return 'crm-auth-wealthbox';
  return purpose === 'write' ? 'crm-write-wealthbox' : 'crm-sync-wealthbox';
}

/**
 * The renderer-side CRM choke point. Every CRM action that can reach a remote
 * service must come through here, so the visible error appears before a native
 * command begins. The Rust transport repeats the same check at the socket
 * boundary; this fast check is user feedback, not the security boundary.
 */
async function invokeCrmNetwork<T>(
  command: string,
  args: Record<string, unknown>,
  operationId: CrmNetworkOperationId,
): Promise<T> {
  const operation = getEgressOperation(operationId);
  if (!operation) {
    throw new Error(`CRM network operation "${operationId}" is not registered and was blocked.`);
  }
  let status;
  try {
    // This is the same Rust NetworkPolicy status used by the socket boundary,
    // not a saved setting or connector-local copy. Rust checks again directly
    // before transport, so a change after this friendly UI check still closes.
    status = await getNetworkPolicyStatus();
  } catch {
    throw new CrmNetworkLockdownError(
      operation.title,
      `${BRAND.name} could not confirm the desktop privacy guard. ${operation.title} stays paused until its state can be checked.`,
    );
  }
  if (status.offlineMode) {
    throw new CrmNetworkLockdownError(operation.title);
  }
  return invoke<T>(command, args);
}

// ── CRM event constant ──────────────────────────────────────────────────────

/** Tauri event name emitted by `crm_sync_all` during a household sync. */
export const CRM_SYNC_EVENT = 'crm-sync-progress';

/**
 * Tauri event emitted by `append_crm_audit_best_effort` after a CRM audit
 * entry is successfully written to the encrypted store.  Payload is an
 * `AuditEntryRecord` (camelCase JSON).  The frontend listener in
 * `useWorkspaceLifecycle.ts` uses this to push the entry into the live
 * `auditEntries` React state without requiring a workspace re-open.
 */
export const CRM_AUDIT_APPENDED_EVENT = 'crm-audit-appended';

// ── DTO types ────────────────────────────────────────────────────────────────

/** Information returned by `crm_connect` after a successful connection. */
export interface CrmConnectInfo {
  name: string;
  plan: string;
  email: string;
}

/**
 * Result returned by `crm_disconnect`. Each boolean reflects whether that
 * purge step actually completed. When either is false the corresponding data
 * may still be on disk; `warnings` carries the human-readable reason(s).
 */
export interface CrmDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  crmDbPurged: boolean;
  /**
   * True when imported Wealthbox data could NOT be fully removed and may still be
   * on disk (e.g. no workspace was set, or a purge step failed). The backend's
   * disconnect-hardening keeps the saved key when this is true so the user can
   * retry; the UI surfaces a "Finish deleting local data" action. Optional so a
   * backend that predates the field still parses (treated as derived from the
   * purge booleans).
   */
  dataRemains?: boolean;
  warnings: string[];
}

/** One Wealthbox household, as returned by `crm_list_households`. */
export interface CrmHouseholdDto {
  id: string;
  name: string;
}

/** Aggregate counts returned by `crm_sync_all`. Extra fields are optional for
 *  forward-compatibility. */
export interface CrmSyncReport {
  householdsProcessed: number;
  recordsIndexed: number;
  [key: string]: unknown;
}

// ── Sync progress event payload ──────────────────────────────────────────────

export type CrmSyncEventStatus = 'connecting' | 'syncing' | 'stopping' | 'done' | 'error' | 'cancelled';

/** Payload carried on the `crm-sync-progress` Tauri event. */
export interface CrmSyncProgress {
  /** Identifies the single user-initiated import that produced this event. */
  runId: string;
  status: CrmSyncEventStatus;
  households?: number;
  records?: number;
  message?: string;
}

/** Create an ID that ties every CRM progress event to one user action. */
export function createCrmRunId(): string {
  return crypto.randomUUID();
}

// ── Command wrappers ─────────────────────────────────────────────────────────

/** Set the workspace path for the CRM store. No-op outside Tauri. */
export async function crmSetWorkspace(path: string, provider?: CrmProvider): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_set_workspace', provider ? { path, provider } : { path });
}

/**
 * Validate an API token and connect to Wealthbox. Returns the account info on
 * success. Throws a human-readable string on failure.
 *
 * Only available in the desktop app. Callers should catch and display the error.
 */
export async function crmConnect(token: string, provider?: CrmProvider): Promise<CrmConnectInfo> {
  if (!isTauri()) throw new Error('Wealthbox connect is only available in the desktop app.');
  return invokeCrmNetwork<CrmConnectInfo>(
    'crm_connect',
    provider ? { token, provider } : { token },
    crmOperationForProvider(provider, 'auth'),
  );
}

/**
 * Connect to a username/password CRM provider. Redtail uses this path: the
 * backend exchanges the password for a UserKey and stores only the UserKey.
 */
export async function crmConnectWithCredentials(
  provider: CrmProvider,
  username: string,
  password: string,
): Promise<CrmConnectInfo> {
  if (!isTauri()) throw new Error('CRM connect is only available in the desktop app.');
  return invokeCrmNetwork<CrmConnectInfo>(
    'crm_connect',
    { provider, username, password },
    crmOperationForProvider(provider, 'auth'),
  );
}

/** Run a provider browser OAuth flow. Salesforce uses this path. */
export async function crmOAuthConnect(provider: CrmProvider): Promise<CrmConnectInfo> {
  if (!isTauri()) throw new Error('CRM OAuth connect is only available in the desktop app.');
  return invokeCrmNetwork<CrmConnectInfo>(
    'crm_oauth_connect',
    { provider },
    crmOperationForProvider(provider, 'auth'),
  );
}

/** Abort a pending crmOAuthConnect() sign-in immediately (user clicked
 *  Cancel, or closed the OAuth popup and gave up) instead of leaving it to
 *  hit the 5-minute server-side timeout. No-op outside Tauri. Never touches
 *  an already-working connection. */
export async function crmOAuthConnectCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_oauth_connect_cancel');
}

/** True when a Wealthbox API token is stored in the keychain. */
export async function crmIsConnected(provider?: CrmProvider): Promise<boolean> {
  if (!isTauri()) return false;
  return provider
    ? invoke<boolean>('crm_is_connected', { provider })
    : invoke<boolean>('crm_is_connected');
}

/**
 * Disconnect from Wealthbox: removes the API token from the keychain and
 * purges all imported CRM data (RAG chunks + encrypted CRM object store).
 * Returns a structured result so callers can show an honest status message
 * that only claims deletion when it actually happened.
 *
 * Idempotent — safe to call even when not connected. In non-Tauri
 * environments returns a "nothing done" result rather than throwing.
 */
export async function crmDisconnect(provider?: CrmProvider): Promise<CrmDisconnectResult> {
  if (!isTauri()) {
    return { tokenDeleted: false, ragPurged: false, crmDbPurged: false, dataRemains: true, warnings: [] };
  }
  return provider
    ? invoke<CrmDisconnectResult>('crm_disconnect', { provider })
    : invoke<CrmDisconnectResult>('crm_disconnect');
}

/**
 * Fetch the full list of households this Wealthbox login can see. Returns an
 * empty array outside Tauri.
 */
export async function crmListHouseholds(runId: string, provider?: CrmProvider): Promise<CrmHouseholdDto[]> {
  if (!isTauri()) return [];
  return invokeCrmNetwork<CrmHouseholdDto[]>(
    'crm_list_households',
    provider ? { provider, runId } : { runId },
    crmOperationForProvider(provider),
  );
}

/**
 * Run a full CRM sync, indexing each household's records under its mapped
 * matter. `matterMap` is built from the matter store via `buildCrmMatterMap`.
 *
 * Emits `crm-sync-progress` Tauri events during the sync. Subscribe via
 * `useCrmSync` to display progress. Returns a summary report.
 *
 * Only available in the desktop app.
 */
export async function crmSyncAll(matterMap: CrmMatterMapEntry[], runId: string, provider?: CrmProvider): Promise<CrmSyncReport> {
  if (!isTauri()) throw new Error('Wealthbox sync is only available in the desktop app.');
  return invokeCrmNetwork<CrmSyncReport>(
    'crm_sync_all',
    provider ? { matterMap, provider, runId } : { matterMap, runId },
    crmOperationForProvider(provider),
  );
}

/** Delete only an unreadable local CRM cache. Callers must then refill every
 * connected provider; documents and non-CRM search data are never touched. */
export async function crmRebuildStore(): Promise<void> {
  if (!isTauri()) {
    throw new Error('CRM recovery is only available in the desktop app.');
  }
  await invoke('crm_rebuild_store');
}

/** Poll the current sync state without subscribing to events. */
export async function crmSyncStatus(provider?: CrmProvider): Promise<{ isSyncing: boolean; lastReport: CrmSyncReport | null }> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return provider
    ? invoke<{ isSyncing: boolean; lastReport: CrmSyncReport | null }>('crm_sync_status', { provider })
    : invoke<{ isSyncing: boolean; lastReport: CrmSyncReport | null }>('crm_sync_status');
}

/** Request cancellation of any in-flight CRM sync. No-op outside Tauri. */
export async function crmCancelSync(provider?: CrmProvider): Promise<void> {
  if (!isTauri()) return;
  if (provider) {
    await invoke('crm_cancel_sync', { provider });
  } else {
    await invoke('crm_cancel_sync');
  }
}

// ── Write path (Rust-enforced proposal approval) ─────────────────────────────

/** Receipt for a completed (or deduplicated) CRM write. Mirrors the Rust
 *  `WriteReceipt` (camelCase over the wire). */
export interface CrmWriteReceipt {
  remoteId: string;
  deduped: boolean;
}

export interface CrmWriteProposalAiSource {
  kind: 'meeting' | 'document';
  date?: string;
}

export type CrmWriteProposalKind = 'note' | 'task' | 'field';
export type CrmWriteProposalStatus = 'proposed' | 'sending' | 'sent' | 'failed' | 'verify_pending' | 'stale';

export interface CrmWriteProposalPayload {
  id: string;
  kind: CrmWriteProposalKind;
  matterId: string;
  title: string;
  body: string;
  dueDate?: string;
  sourceRef: string;
  status?: CrmWriteProposalStatus;
  remoteId?: string;
  error?: string;
  requestedAt?: string;
  field?: string;
  existingValue?: string;
  newValue?: string;
  finalValue?: string;
  provenance?: string;
  /** Durable authorization lineage; never encoded into display provenance. */
  meetingVisibility?: MeetingVisibilitySubject;
  aiSource?: CrmWriteProposalAiSource;
  householdKey?: string;
  provider?: CrmProvider;
}

export interface CrmWriteProposalRecord extends CrmWriteProposalPayload {
  status: CrmWriteProposalStatus;
  householdKey: string;
  provider: CrmProvider;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

/** Save/update a proposed CRM write in the encrypted Rust CRM store. This never
 * sends to the provider; it only keeps the review queue restart-safe without
 * plaintext localStorage. */
export async function crmSaveWriteProposal(proposal: CrmWriteProposalPayload): Promise<CrmWriteProposalRecord | null> {
  if (!isTauri()) return null;
  return invoke<CrmWriteProposalRecord>('crm_save_write_proposal', { proposal });
}

/** Attach the selected household + approval timestamp to a saved proposal.
 * This prepares the Rust-side record so the real approve command only needs
 * the proposal id. */
export async function crmPrepareWriteProposal(args: {
  proposalId: string;
  householdKey: string;
  requestedAt: string;
  provenance?: string;
}): Promise<CrmWriteProposalRecord | null> {
  if (!isTauri()) return null;
  const { proposalId, householdKey, requestedAt, provenance } = args;
  return invoke<CrmWriteProposalRecord>('crm_prepare_write_proposal', {
    proposalId,
    householdKey,
    requestedAt,
    ...(provenance ? { provenance } : {}),
  });
}

/** The only provider-writing CRM command the renderer should call. The backend
 * reloads the encrypted proposal by id and verifies its hash before Wealthbox
 * sees anything. */
export async function crmApproveWriteProposal(proposalId: string): Promise<CrmWriteReceipt> {
  if (!isTauri()) throw new Error('CRM write is only available in the desktop app.');
  return invokeCrmNetwork<CrmWriteReceipt>(
    'crm_approve_write_proposal',
    { proposalId },
    crmOperationForProvider('wealthbox', 'write'),
  );
}

export async function crmListWriteProposals(): Promise<CrmWriteProposalRecord[]> {
  if (!isTauri()) return [];
  return invoke<CrmWriteProposalRecord[]>('crm_list_write_proposals');
}

export async function crmDeleteWriteProposal(proposalId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_delete_write_proposal', { proposalId });
}

/** Import prepared CRM migration samples through the same lockdown doorway as
 * live CRM traffic. The Rust transport repeats this check for every page. */
export async function crmMigrationImport<T>(args: {
  baseUrl: string;
  source?: string;
  sourceIdField?: string;
}): Promise<T> {
  if (!isTauri()) throw new Error('CRM migration is only available in the desktop app.');
  return invokeCrmNetwork<T>(
    'crm_migration_import',
    args,
    'crm-migration-import',
  );
}
