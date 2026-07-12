export const KIB = 1024;
export const MIB = KIB * KIB;
export const MAX_CIPHERTEXT_CHUNK_BYTES = 768 * KIB;
export const MAX_CLIENT_DOCUMENTS = 12;
export const MAX_BOOTSTRAP_DOCUMENTS = 29;
export const MAX_BOOTSTRAP_BYTES = 64 * MIB;

export type TransferBucket = 'firm' | 'record' | 'task-notes' | 'overhead';
export type TransferKind = 'checkpoint' | 'tail';

export interface SyncMetricsSnapshot {
  socketCount: number;
  activeDocuments: number;
  bootstrapBytes: number;
  bytesByBucket: Record<TransferBucket, number>;
  bytesByKind: Record<TransferKind, number>;
}

/** D1 release-gate counters. Lane 06 can assert this without inspecting UI state. */
export class InMemorySyncMetrics {
  private socketCount = 0;
  private activeDocuments = 0;
  private bootstrapBytes = 0;
  private readonly bytesByBucket: Record<TransferBucket, number> = { firm: 0, record: 0, 'task-notes': 0, overhead: 0 };
  private readonly bytesByKind: Record<TransferKind, number> = { checkpoint: 0, tail: 0 };

  beginSocket(): void {
    if (this.socketCount >= 1) throw new Error('D1 allows one multiplexed WebSocket per device');
    this.socketCount += 1;
  }

  endSocket(): void { this.socketCount = Math.max(0, this.socketCount - 1); }
  setActiveDocuments(count: number): void {
    if (count > MAX_BOOTSTRAP_DOCUMENTS) throw new Error(`D1 document ceiling is ${String(MAX_BOOTSTRAP_DOCUMENTS)}`);
    this.activeDocuments = count;
  }

  beginBootstrap(): void {
    this.bootstrapBytes = 0;
    for (const bucket of Object.keys(this.bytesByBucket) as TransferBucket[]) this.bytesByBucket[bucket] = 0;
    for (const kind of Object.keys(this.bytesByKind) as TransferKind[]) this.bytesByKind[kind] = 0;
  }

  recordTransfer(bucket: TransferBucket, kind: TransferKind, bytes: number): void {
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('transfer bytes must be a non-negative integer');
    if (bytes > MAX_CIPHERTEXT_CHUNK_BYTES) throw new Error('ciphertext chunk exceeds the 768 KiB D1 ceiling');
    if (this.bootstrapBytes + bytes > MAX_BOOTSTRAP_BYTES) throw new Error('bootstrap transfer exceeds the 64 MiB D1 ceiling');
    this.bootstrapBytes += bytes;
    this.bytesByBucket[bucket] += bytes;
    this.bytesByKind[kind] += bytes;
  }

  snapshot(): SyncMetricsSnapshot {
    return {
      socketCount: this.socketCount,
      activeDocuments: this.activeDocuments,
      bootstrapBytes: this.bootstrapBytes,
      bytesByBucket: { ...this.bytesByBucket },
      bytesByKind: { ...this.bytesByKind },
    };
  }
}
