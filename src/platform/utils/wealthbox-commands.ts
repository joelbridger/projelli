// Thin wrappers around the Wealthbox/CRM Tauri commands defined in
// `src-tauri/src/commands/crm/commands.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of mail-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CrmMatterMapEntry } from '@/platform/rag/matterResolver';

export type CrmProvider = 'wealthbox' | 'salesforce' | 'redtail';

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

export type CrmSyncEventStatus = 'syncing' | 'done' | 'error' | 'cancelled';

/** Payload carried on the `crm-sync-progress` Tauri event. */
export interface CrmSyncProgress {
  status: CrmSyncEventStatus;
  households?: number;
  records?: number;
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
  return invoke<CrmConnectInfo>('crm_connect', provider ? { token, provider } : { token });
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
  return invoke<CrmConnectInfo>('crm_connect', { provider, username, password });
}

/** Run a provider browser OAuth flow. Salesforce uses this path. */
export async function crmOAuthConnect(provider: CrmProvider): Promise<CrmConnectInfo> {
  if (!isTauri()) throw new Error('CRM OAuth connect is only available in the desktop app.');
  return invoke<CrmConnectInfo>('crm_oauth_connect', { provider });
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
export async function crmListHouseholds(provider?: CrmProvider): Promise<CrmHouseholdDto[]> {
  if (!isTauri()) return [];
  return provider
    ? invoke<CrmHouseholdDto[]>('crm_list_households', { provider })
    : invoke<CrmHouseholdDto[]>('crm_list_households');
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
export async function crmSyncAll(matterMap: CrmMatterMapEntry[], provider?: CrmProvider): Promise<CrmSyncReport> {
  if (!isTauri()) throw new Error('Wealthbox sync is only available in the desktop app.');
  return invoke<CrmSyncReport>('crm_sync_all', provider ? { matterMap, provider } : { matterMap });
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

// ── Write path (approval-gated) ──────────────────────────────────────────────

/** Receipt for a completed (or deduplicated) CRM write. Mirrors the Rust
 *  `WriteReceipt` (camelCase over the wire). */
export interface CrmWriteReceipt {
  remoteId: string;
  deduped: boolean;
}

/**
 * Push one approval-gated note to the connected CRM. `householdKey` is the
 * provider-side household/contact id, resolved on the TS side via
 * `buildInverseCrmMap` — the backend does not persist the matter map.
 *
 * The ONLY legitimate call site is the review card's Approve handler — never
 * call this from a background effect or on enqueue.
 */
export async function crmCreateNote(args: {
  matterId: string;
  title: string;
  body: string;
  sourceRef: string;
  householdKey: string;
  /** Identifies the approval event — see `ProposedCrmWrite.requestedAt`'s doc
   *  comment. Reuse the SAME value for a retry of this exact approval; a
   *  fresh approval (even of identical content) must pass a new one. */
  requestedAt: string;
  provider?: CrmProvider;
}): Promise<CrmWriteReceipt> {
  if (!isTauri()) throw new Error('CRM write is only available in the desktop app.');
  const { matterId, title, body, sourceRef, householdKey, requestedAt, provider } = args;
  return invoke<CrmWriteReceipt>('crm_create_note', {
    matterId,
    title,
    body,
    sourceRef,
    householdKey,
    requestedAt,
    ...(provider ? { provider } : {}),
  });
}

/**
 * Push one approval-gated task to the connected CRM. See {@link crmCreateNote}
 * for the shared approval-gating contract.
 */
export async function crmCreateTask(args: {
  matterId: string;
  title: string;
  description: string;
  dueDate?: string;
  sourceRef: string;
  householdKey: string;
  /** See {@link crmCreateNote}'s `requestedAt` doc comment. */
  requestedAt: string;
  provider?: CrmProvider;
}): Promise<CrmWriteReceipt> {
  if (!isTauri()) throw new Error('CRM write is only available in the desktop app.');
  const { matterId, title, description, dueDate, sourceRef, householdKey, requestedAt, provider } = args;
  return invoke<CrmWriteReceipt>('crm_create_task', {
    matterId,
    title,
    description,
    dueDate: dueDate ?? null,
    sourceRef,
    householdKey,
    requestedAt,
    ...(provider ? { provider } : {}),
  });
}
