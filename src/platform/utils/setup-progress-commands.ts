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
export type ModelState = 'none' | 'downloading' | 'failed' | 'ready';

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

/** Email import / sync progress. `credentialsAvailable` is machine-wide;
 * `connected` is deliberately narrower and means this workspace has actually
 * received email data. */
export interface EmailProgress {
  connected: boolean;
  credentialsAvailable: boolean;
  accounts: EmailAccount[];
  syncing: boolean;
  /** Cumulative messages imported this session; `null` until the first sync. */
  messagesImported: number | null;
}

/** Wealthbox CRM sync progress. `credentialsAvailable` is machine-wide;
 * `connected` means this workspace has actually received CRM data. */
export interface CrmProgress {
  connected: boolean;
  credentialsAvailable: boolean;
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

/** OneDrive / SharePoint file import progress. */
export interface OneDriveSetupProgress {
  syncing: boolean;
  status: 'idle' | 'syncing' | 'done' | 'cancelled' | 'error';
  /** Cloud items checked this run. */
  itemsChecked: number | null;
  /** Files imported into client folders this run. */
  itemsImported: number | null;
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
  oneDrive: OneDriveSetupProgress;
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
  email: { connected: false, credentialsAvailable: false, accounts: [], syncing: false, messagesImported: null },
  crm: { connected: false, credentialsAvailable: false, syncing: false, householdsProcessed: 0, recordsIndexed: 0 },
  fileIndex: { indexing: false, processed: null, total: null, percent: null },
  oneDrive: { syncing: false, status: 'idle', itemsChecked: null, itemsImported: null },
  clientMap: { total: 0, built: 0, building: 0, pending: 0 },
  overall: 'empty',
};

/**
 * Derive the coarse `overall` headline from a snapshot's fields. Mirrors the
 * Rust `compute_overall` in setup_progress/mod.rs exactly — the frontend needs
 * its own copy so that after overlaying the live Client Map counts (which the
 * backend snapshot may not yet reflect) `overall` stays consistent with the
 * fields, without waiting for a backend round-trip. Keep the two in lockstep.
 */
export function deriveOverall(s: SetupProgress): OverallState {
  const inProgress =
    s.ai.state === 'downloading' ||
    // A cloud key makes `ai.state` "ready", so a still-downloading local model
    // must be checked explicitly or it would be hidden behind "ready".
    s.ai.localLlm.state === 'downloading' ||
    s.ai.searchModel.state === 'downloading' ||
    s.email.syncing ||
    s.crm.syncing ||
    s.fileIndex.indexing ||
    s.oneDrive.syncing ||
    s.clientMap.building > 0;

  const anyConfigured =
    s.ai.cloudKeyPresent ||
    s.ai.localLlm.state !== 'none' ||
    s.ai.searchModel.state !== 'none' ||
    s.email.connected ||
    s.crm.connected ||
    s.clientMap.total > 0 ||
    (s.oneDrive.itemsChecked ?? 0) > 0 ||
    (s.oneDrive.itemsImported ?? 0) > 0 ||
    (s.fileIndex.processed ?? 0) > 0 ||
    (s.fileIndex.total ?? 0) > 0;

  if (inProgress) return 'inProgress';
  if (s.ai.state === 'ready') return 'ready';
  if (anyConfigured) return 'partial';
  return 'empty';
}

/**
 * True while any content source — email, Wealthbox CRM, OneDrive, or workspace
 * file indexing — is actively importing. Excludes AI model downloads: those
 * affect whether the AI can answer at all, not whether an already-working
 * answer might be missing recently-imported content, which is what this
 * signal is for (the Ask "still importing" banner).
 */
export function isImportingContent(s: SetupProgress): boolean {
  return s.email.syncing || s.crm.syncing || s.oneDrive.syncing || s.fileIndex.indexing;
}

/** Read a fresh unified setup-progress snapshot from the native backend. */
export async function getSetupProgress(): Promise<SetupProgress> {
  if (!isTauri()) return EMPTY_SETUP_PROGRESS;
  const snapshot = await invoke<Partial<SetupProgress>>('get_setup_progress');
  return {
    ...EMPTY_SETUP_PROGRESS,
    ...snapshot,
    ai: { ...EMPTY_SETUP_PROGRESS.ai, ...snapshot.ai },
    email: { ...EMPTY_SETUP_PROGRESS.email, ...snapshot.email },
    crm: { ...EMPTY_SETUP_PROGRESS.crm, ...snapshot.crm },
    fileIndex: { ...EMPTY_SETUP_PROGRESS.fileIndex, ...snapshot.fileIndex },
    oneDrive: { ...EMPTY_SETUP_PROGRESS.oneDrive, ...snapshot.oneDrive },
    clientMap: { ...EMPTY_SETUP_PROGRESS.clientMap, ...snapshot.clientMap },
  };
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

/** Retry whichever model downloads are currently failed. No-op in browser. */
export async function retryFailedModelDownloads(progress: SetupProgress): Promise<void> {
  if (!isTauri()) return;
  const jobs: Array<Promise<unknown>> = [];
  if (progress.ai.localLlm.state === 'failed') {
    jobs.push(invoke('local_llm_model_ensure'));
  }
  if (progress.ai.searchModel.state === 'failed') {
    jobs.push(invoke('model_ensure'));
  }
  if (jobs.length === 0) return;
  const results = await Promise.allSettled(jobs);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
}
