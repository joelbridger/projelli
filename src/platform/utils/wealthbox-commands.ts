// Thin wrappers around the Wealthbox/CRM Tauri commands defined in
// `src-tauri/src/commands/crm/commands.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of mail-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CrmMatterMapEntry } from '@/platform/rag/matterResolver';

export type CrmProvider = 'wealthbox' | 'salesforce';

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

/** Run a provider browser OAuth flow. Salesforce uses this path. */
export async function crmOAuthConnect(provider: CrmProvider): Promise<CrmConnectInfo> {
  if (!isTauri()) throw new Error('CRM OAuth connect is only available in the desktop app.');
  return invoke<CrmConnectInfo>('crm_oauth_connect', { provider });
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
