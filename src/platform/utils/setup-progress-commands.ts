// Setup / import progress — TypeScript contract + Tauri command wrappers.
//
// Mirrors the Rust `SetupProgress` types in
// `src-tauri/src/commands/setup_progress/mod.rs`. One unified, queryable view of
// first-run setup progress across all five sources (AI/models, email, Wealthbox
// CRM, file indexing, Client Map) for the onboarding progress screen and a
// future in-app setup/import-status view.
//
// Consume via the `useSetupProgress()` hook (`@/platform/hooks/useSetupProgress`)
// rather than calling these directly.

import { invoke, isTauri } from '@tauri-apps/api/core';

/** Tauri event: emitted whenever any source updates; the hook refetches.
 *  Mirror of `CHANGED_EVENT` in setup_progress/mod.rs. */
export const SETUP_PROGRESS_CHANGED_EVENT = 'setup-progress-changed';

/** A single model's download/readiness state. */
export type ModelState = 'none' | 'downloading' | 'ready';

/** Which "brain" the user is set up to use. */
export type AiMode = 'cloud' | 'local' | 'none';

/** Coarse headline for the whole setup. `partial` = some setup done but the AI
 *  brain isn't ready yet and nothing is mid-flight. */
export type OverallState = 'empty' | 'inProgress' | 'partial' | 'ready';

/** A model's state plus optional whole-number download percent (0..=100). */
export interface ModelSlot {
  state: ModelState;
  percent: number | null;
}

/** AI / model readiness. `state`/`percent` describe the CHAT brain (cloud key or
 *  local LLM); `localLlm`/`searchModel` expose the two models individually. */
export interface AiProgress {
  mode: AiMode;
  state: ModelState;
  percent: number | null;
  cloudKeyPresent: boolean;
  localLlm: ModelSlot;
  searchModel: ModelSlot;
}

/** A connected email account (provider id + human label). */
export interface EmailAccount {
  provider: string;
  label: string;
}

/** Email import / sync progress. */
export interface EmailProgress {
  connected: boolean;
  accounts: EmailAccount[];
  syncing: boolean;
  /** Cumulative messages imported this session; `null` until the first sync. */
  messagesImported: number | null;
}

/** Wealthbox CRM sync progress. */
export interface CrmProgress {
  connected: boolean;
  syncing: boolean;
  householdsProcessed: number;
  recordsIndexed: number;
}

/** Workspace file-indexing (RAG backfill) progress. */
export interface FileIndexProgress {
  indexing: boolean;
  processed: number | null;
  total: number | null;
  percent: number | null;
}

/** Client Map build progress (truth lives in the frontend stores). */
export interface ClientMapProgress {
  total: number;
  built: number;
  building: number;
  pending: number;
}

/** The unified setup-progress snapshot. */
export interface SetupProgress {
  ai: AiProgress;
  email: EmailProgress;
  crm: CrmProgress;
  fileIndex: FileIndexProgress;
  clientMap: ClientMapProgress;
  overall: OverallState;
}

/** A fully-empty snapshot — returned in browser/test mode where the native
 *  backend is unavailable, so callers always get a well-formed shape. */
export const EMPTY_SETUP_PROGRESS: SetupProgress = {
  ai: {
    mode: 'none',
    state: 'none',
    percent: null,
    cloudKeyPresent: false,
    localLlm: { state: 'none', percent: null },
    searchModel: { state: 'none', percent: null },
  },
  email: { connected: false, accounts: [], syncing: false, messagesImported: null },
  crm: { connected: false, syncing: false, householdsProcessed: 0, recordsIndexed: 0 },
  fileIndex: { indexing: false, processed: null, total: null, percent: null },
  clientMap: { total: 0, built: 0, building: 0, pending: 0 },
  overall: 'empty',
};

/** Read a fresh unified setup-progress snapshot from the native backend. */
export async function getSetupProgress(): Promise<SetupProgress> {
  if (!isTauri()) return EMPTY_SETUP_PROGRESS;
  return invoke<SetupProgress>('get_setup_progress');
}

/** Report the frontend-only Client Map build counts down to the backend so a
 *  `get_setup_progress` snapshot reflects all five sources. No-op in browser. */
export async function reportClientMap(
  total: number,
  built: number,
  building: number,
): Promise<void> {
  if (!isTauri()) return;
  await invoke('setup_report_client_map', { total, built, building });
}
