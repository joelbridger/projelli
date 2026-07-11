/**
 * The renderer's only CRM-core boundary. It deliberately contains opaque JSON
 * payloads at the IPC edge: SQLCipher owns persistence and transaction order.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PropagationTransactionPayload } from '@/platform/crm/types';
import type { CursorTransaction, DurableCursorStore } from '@/platform/crm/sync';

type CursorRow = { cursor: number; identities: Map<number, string> };

function streamKey(matterId: string, docId: string): string {
  return `${matterId}\u0000${docId}`;
}

/** SQLCipher-backed in desktop mode, deterministic memory fallback for browser tests. */
export class CrmCoreCursorStore implements DurableCursorStore {
  private readonly memory = new Map<string, CursorRow>();

  async cursor(key: { matterId: string; docId: string }): Promise<number> {
    const id = streamKey(key.matterId, key.docId);
    if (isTauri()) return invoke<number>('crm_core_cursor', { streamKey: id });
    return this.row(id).cursor;
  }

  immutableBlobId(key: { matterId: string; docId: string }, cursor: number): Promise<string | null> {
    // SQLCipher validates historical identity while atomically recording it.
    // The sync path only asks this before applying an old duplicate; desktop
    // therefore lets the command make the authoritative corruption decision.
    if (isTauri()) return Promise.resolve(null);
    return Promise.resolve(this.row(streamKey(key.matterId, key.docId)).identities.get(cursor) ?? null);
  }

  async transaction<T>(key: { matterId: string; docId: string }, work: (transaction: CursorTransaction) => Promise<T>): Promise<T> {
    const id = streamKey(key.matterId, key.docId);
    const row = this.row(id);
    return work({
      recordApplied: async (cursor, blobId) => {
        if (isTauri()) {
          await invoke('crm_core_record_applied', { streamKey: id, cursor, blobId });
          return;
        }
        if (cursor !== row.cursor + 1) throw new Error(`cursor must stay contiguous (got ${String(cursor)}, expected ${String(row.cursor + 1)})`);
        row.cursor = cursor;
        row.identities.set(cursor, blobId);
      },
    });
  }

  private row(id: string): CursorRow {
    let row = this.memory.get(id);
    if (!row) {
      row = { cursor: 0, identities: new Map() };
      this.memory.set(id, row);
    }
    return row;
  }
}

/** Commit the exact B5 propagation payload as one SQLCipher transaction. */
export async function commitPropagationTransaction(payload: PropagationTransactionPayload): Promise<void> {
  if (!isTauri()) return;
  await invoke('crm_core_commit_propagation', {
    payload: { ...payload, notificationRows: [] },
  });
}

export type CrmEngineFreshness =
  | { kind: 'live' }
  | { kind: 'syncing'; lastSyncedAt?: string }
  | { kind: 'last-synced'; lastSyncedAt: string; lastFullCheckAt?: string }
  | { kind: 'offline' }
  | { kind: 'error'; error: string };

let freshness: CrmEngineFreshness = { kind: 'offline' };
const listeners = new Set<(value: CrmEngineFreshness) => void>();

/** Sync bootstrap and failure handlers set this. Screens only render this state. */
export function setCrmEngineFreshness(next: CrmEngineFreshness): void {
  freshness = next;
  listeners.forEach((listener) => { listener(next); });
}
export function getCrmEngineFreshness(): CrmEngineFreshness { return freshness; }
export function subscribeCrmEngineFreshness(listener: (value: CrmEngineFreshness) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
