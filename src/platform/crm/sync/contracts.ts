/** Client-side contract for B2's encrypted, multiplexed relay. */
export interface SyncDocumentKey {
  matterId: string;
  docId: string;
}

export interface EncryptedRelayUpdate extends SyncDocumentKey {
  cursor: number;
  blobId: string;
  keyEpoch: number;
  /** Opaque ciphertext. This layer never reads document content. */
  ciphertext: Uint8Array;
}

export interface ReadyFrame extends SyncDocumentKey {
  type: 'ready';
  watermark: number;
}

export interface EpochRejectedFrame extends SyncDocumentKey {
  type: 'epoch_rejected';
  currentEpoch: number;
}

export type RelayFrame = EncryptedRelayUpdate | ReadyFrame | EpochRejectedFrame;

export interface MultiplexedRelay {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(key: SyncDocumentKey, since: number): Promise<void>;
  unsubscribe(key: SyncDocumentKey): Promise<void>;
  /** Returns rows strictly after since and at or before through, in cursor order. */
  pullThrough(key: SyncDocumentKey, since: number, through: number): Promise<EncryptedRelayUpdate[]>;
  onFrame: ((frame: RelayFrame) => void) | null;
}

export type SyncStatus = 'idle' | 'subscribing' | 'syncing' | 'gap-repairing' | 'live' | 'quarantined';

export function sameDocument(a: SyncDocumentKey, b: SyncDocumentKey): boolean {
  return a.matterId === b.matterId && a.docId === b.docId;
}

export function documentId(key: SyncDocumentKey): string {
  return `${key.matterId}\u0000${key.docId}`;
}
