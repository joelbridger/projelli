import type { SyncDocumentKey } from './contracts';
import { documentId } from './contracts';

/**
 * B1-PENDING: B1 owns the SQLCipher store and will supply this adapter over its
 * transaction API. Keeping the atomic boundary explicit prevents a cursor from
 * advancing separately from CRDT application.
 */
export interface DurableCursorStore {
  cursor(key: SyncDocumentKey): Promise<number>;
  immutableBlobId(key: SyncDocumentKey, cursor: number): Promise<string | null>;
  transaction<T>(key: SyncDocumentKey, work: (transaction: CursorTransaction) => Promise<T>): Promise<T>;
}

export interface CursorTransaction {
  recordApplied(cursor: number, blobId: string): Promise<void>;
}

interface CursorRow {
  cursor: number;
  identities: Map<number, string>;
}

/** Test-only implementation; production injects B1's SQLCipher-backed adapter. */
export class InMemoryCursorStore implements DurableCursorStore {
  private readonly rows = new Map<string, CursorRow>();

  cursor(key: SyncDocumentKey): Promise<number> {
    return Promise.resolve(this.row(key).cursor);
  }

  immutableBlobId(key: SyncDocumentKey, cursor: number): Promise<string | null> {
    return Promise.resolve(this.row(key).identities.get(cursor) ?? null);
  }

  async transaction<T>(key: SyncDocumentKey, work: (transaction: CursorTransaction) => Promise<T>): Promise<T> {
    const row = this.row(key);
    return work({
      recordApplied: (cursor, blobId) => {
        if (cursor !== row.cursor + 1) throw new Error(`cursor must stay contiguous (got ${String(cursor)}, expected ${String(row.cursor + 1)})`);
        row.cursor = cursor;
        row.identities.set(cursor, blobId);
        return Promise.resolve();
      },
    });
  }

  private row(key: SyncDocumentKey): CursorRow {
    const id = documentId(key);
    let row = this.rows.get(id);
    if (!row) {
      row = { cursor: 0, identities: new Map() };
      this.rows.set(id, row);
    }
    return row;
  }
}
