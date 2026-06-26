// Thin wrappers around the Wealthbox/CRM Tauri commands defined in
// `src-tauri/src/commands/crm/commands.rs`. Each wrapper guards with isTauri()
// so callers work in browser/test mode without throwing.
//
// Mirror of mail-commands.ts conventions: import invoke + isTauri from
// @tauri-apps/api/core, guard every call site.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CrmMatterMapEntry } from '@/platform/rag/matterResolver';

// ── CRM event constant ──────────────────────────────────────────────────────

/** Tauri event name emitted by `crm_sync_all` during a household sync. */
export const CRM_SYNC_EVENT = 'crm-sync-progress';

// ── DTO types ────────────────────────────────────────────────────────────────

/** Information returned by `crm_connect` after a successful connection. */
export interface CrmConnectInfo {
  name: string;
  plan: string;
  email: string;
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

export type CrmSyncEventStatus = 'syncing' | 'done' | 'error';

/** Payload carried on the `crm-sync-progress` Tauri event. */
export interface CrmSyncProgress {
  status: CrmSyncEventStatus;
  households?: number;
  records?: number;
}

// ── Command wrappers ─────────────────────────────────────────────────────────

/** Set the workspace path for the CRM store. No-op outside Tauri. */
export async function crmSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_set_workspace', { path });
}

/**
 * Validate an API token and connect to Wealthbox. Returns the account info on
 * success. Throws a human-readable string on failure.
 *
 * Only available in the desktop app. Callers should catch and display the error.
 */
export async function crmConnect(token: string): Promise<CrmConnectInfo> {
  if (!isTauri()) throw new Error('Wealthbox connect is only available in the desktop app.');
  return invoke<CrmConnectInfo>('crm_connect', { token });
}

/** True when a Wealthbox API token is stored in the keychain. */
export async function crmIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('crm_is_connected');
}

/**
 * Remove the stored Wealthbox API token from the keychain. Idempotent — safe to
 * call even when not connected. No-op outside Tauri.
 */
export async function crmDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_disconnect');
}

/**
 * Fetch the full list of households this Wealthbox login can see. Returns an
 * empty array outside Tauri.
 */
export async function crmListHouseholds(): Promise<CrmHouseholdDto[]> {
  if (!isTauri()) return [];
  return invoke<CrmHouseholdDto[]>('crm_list_households');
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
export async function crmSyncAll(matterMap: CrmMatterMapEntry[]): Promise<CrmSyncReport> {
  if (!isTauri()) throw new Error('Wealthbox sync is only available in the desktop app.');
  return invoke<CrmSyncReport>('crm_sync_all', { matterMap });
}

/** Poll the current sync state without subscribing to events. */
export async function crmSyncStatus(): Promise<{ isSyncing: boolean; lastReport: CrmSyncReport | null }> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: CrmSyncReport | null }>('crm_sync_status');
}

/** Request cancellation of any in-flight CRM sync. No-op outside Tauri. */
export async function crmCancelSync(): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_cancel_sync');
}
