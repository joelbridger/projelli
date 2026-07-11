import type { SyncDocumentKey } from './contracts';
import { sameDocument } from './contracts';

export interface QueuedLocalEdit {
  id: string;
  key: SyncDocumentKey;
  sealedEpoch: number;
  /** Local encrypted work; the relay never receives this queue. */
  encryptedLocalEdit: Uint8Array;
}

export interface ResealedEdit {
  id: string;
  key: SyncDocumentKey;
  keyEpoch: number;
  blobId: string;
  ciphertext: Uint8Array;
}

export interface QuarantineEntry {
  editId: string;
  key: SyncDocumentKey;
  currentEpoch: number;
  reason: string;
  encryptedLocalEdit: Uint8Array;
}

export interface EpochResealQueueOptions {
  /** Fetches current key, authenticates/decrypts own edit, then reseals it at currentEpoch. */
  reseal(edit: QueuedLocalEdit, currentEpoch: number): Promise<ResealedEdit>;
  submit(edit: ResealedEdit): Promise<void>;
}

/** SYNC-02: old-epoch writes reseal or become visible export/review work; never disappear. */
export class EpochResealQueue {
  private readonly queued: QueuedLocalEdit[] = [];
  private readonly quarantine: QuarantineEntry[] = [];

  constructor(private readonly options: EpochResealQueueOptions) {}
  enqueue(edit: QueuedLocalEdit): void { this.queued.push(edit); }
  visibleQuarantine(): readonly QuarantineEntry[] { return this.quarantine; }

  async handleEpochRejected(key: SyncDocumentKey, currentEpoch: number): Promise<void> {
    const matching = this.queued.filter((edit) => sameDocument(edit.key, key));
    for (const edit of matching) {
      try {
        const resealed = await this.options.reseal(edit, currentEpoch);
        await this.options.submit(resealed);
        this.remove(edit.id);
      } catch (error: unknown) {
        this.remove(edit.id);
        this.quarantine.push({
          editId: edit.id, key: edit.key, currentEpoch,
          reason: error instanceof Error ? error.message : 'could not reseal queued edit',
          encryptedLocalEdit: edit.encryptedLocalEdit,
        });
      }
    }
  }

  private remove(id: string): void {
    const index = this.queued.findIndex((edit) => edit.id === id);
    if (index >= 0) this.queued.splice(index, 1);
  }
}
