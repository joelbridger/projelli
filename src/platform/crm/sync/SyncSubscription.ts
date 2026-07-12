import type { DurableCursorStore } from './CursorStore';
import type { EncryptedRelayUpdate, MultiplexedRelay, RelayFrame, SyncDocumentKey, SyncStatus } from './contracts';
import { sameDocument } from './contracts';

export class ImmutableIdentityMismatchError extends Error {
  constructor(cursor: number) { super(`relay cursor ${String(cursor)} changed immutable blob identity`); }
}

export class GapRepairError extends Error {
  constructor() { super('bounded gap repair did not restore a contiguous relay cursor'); }
}

export interface SyncSubscriptionOptions {
  key: SyncDocumentKey;
  relay: MultiplexedRelay;
  store: DurableCursorStore;
  /** Authenticates/decrypts and applies ciphertext; rejection leaves cursor unchanged. */
  authenticateAndApply(update: EncryptedRelayUpdate): Promise<void>;
  /** SYNC-02 hook for a relay rejection of old-epoch queued work. */
  onEpochRejected?: (key: SyncDocumentKey, currentEpoch: number) => Promise<void>;
  maxGapRepairs?: number;
  /** The subscription manager owns the single relay listener when false. */
  listenDirectly?: boolean;
}

/** Implements D15 exactly: immutable duplicate check, atomic next-row apply, bounded repair. */
export class SyncSubscription {
  private readonly maxGapRepairs: number;
  private readonly preReadyFrames: EncryptedRelayUpdate[] = [];
  private work: Promise<void> = Promise.resolve();
  private state: SyncStatus = 'idle';
  private ready = false;
  private watermark = 0;
  private lastError: Error | null = null;

  constructor(private readonly options: SyncSubscriptionOptions) {
    this.maxGapRepairs = options.maxGapRepairs ?? 3;
    if (options.listenDirectly !== false) {
      options.relay.onFrame = (frame) => { if (this.matches(frame)) this.receive(frame); };
    }
  }

  status(): SyncStatus { return this.state; }
  error(): Error | null { return this.lastError; }

  async start(): Promise<void> {
    const since = await this.options.store.cursor(this.options.key);
    this.state = 'subscribing';
    await this.options.relay.subscribe(this.options.key, since);
  }

  receive(frame: RelayFrame): void {
    this.work = this.work.then(async () => {
      try {
        await this.handle(frame);
      } catch (error: unknown) {
        this.lastError = error instanceof Error ? error : new Error('unknown sync failure');
        this.state = 'quarantined';
      }
    });
  }

  whenIdle(): Promise<void> { return this.work; }

  private matches(frame: RelayFrame): boolean { return sameDocument(this.options.key, frame); }

  private async handle(frame: RelayFrame): Promise<void> {
    if (!this.matches(frame)) return;
    if ('type' in frame) {
      if (frame.type === 'ready') await this.handleReady(frame.watermark);
      if (frame.type === 'epoch_rejected') await this.options.onEpochRejected?.(this.options.key, frame.currentEpoch);
      return;
    }
    if (!this.ready) {
      this.preReadyFrames.push(frame);
      return;
    }
    await this.triage(frame);
    await this.markLiveIfCaughtUp();
  }

  private async handleReady(watermark: number): Promise<void> {
    this.ready = true;
    this.watermark = watermark;
    this.state = 'syncing';
    let durable = await this.options.store.cursor(this.options.key);
    while (durable < watermark) {
      const page = await this.options.relay.pullThrough(this.options.key, durable, watermark);
      if (page.length === 0) throw new GapRepairError();
      for (const row of page) await this.triage(row);
      const next = await this.options.store.cursor(this.options.key);
      if (next <= durable) throw new GapRepairError();
      durable = next;
    }
    for (const frame of this.preReadyFrames.splice(0)) await this.triage(frame);
    await this.markLiveIfCaughtUp();
  }

  private async triage(row: EncryptedRelayUpdate): Promise<void> {
    const durable = await this.options.store.cursor(this.options.key);
    if (row.cursor <= durable) {
      const identity = await this.options.store.immutableBlobId(this.options.key, row.cursor);
      if (identity !== row.blobId) throw new ImmutableIdentityMismatchError(row.cursor);
      return;
    }
    if (row.cursor === durable + 1) {
      await this.options.store.transaction(this.options.key, async (transaction) => {
        // Apply and cursor write share the SQLCipher transaction supplied by B1.
        await this.options.authenticateAndApply(row);
        await transaction.recordApplied(row.cursor, row.blobId);
      });
      return;
    }
    await this.repairGap(row);
  }

  private async repairGap(laterRow: EncryptedRelayUpdate): Promise<void> {
    this.state = 'gap-repairing';
    for (let attempt = 0; attempt < this.maxGapRepairs; attempt += 1) {
      const durable = await this.options.store.cursor(this.options.key);
      const missing = await this.options.relay.pullThrough(this.options.key, durable, laterRow.cursor - 1);
      for (const row of missing) {
        const cursor = await this.options.store.cursor(this.options.key);
        if (row.cursor <= cursor) {
          const identity = await this.options.store.immutableBlobId(this.options.key, row.cursor);
          if (identity !== row.blobId) throw new ImmutableIdentityMismatchError(row.cursor);
        } else if (row.cursor === cursor + 1) {
          await this.options.store.transaction(this.options.key, async (transaction) => {
            await this.options.authenticateAndApply(row);
            await transaction.recordApplied(row.cursor, row.blobId);
          });
        }
      }
      if ((await this.options.store.cursor(this.options.key)) === laterRow.cursor - 1) {
        await this.triage(laterRow);
        return;
      }
    }
    throw new GapRepairError();
  }

  private async markLiveIfCaughtUp(): Promise<void> {
    const cursor = await this.options.store.cursor(this.options.key);
    if (this.ready && cursor >= this.watermark && this.state !== 'quarantined') this.state = 'live';
  }
}

export class SyncSubscriptionManager {
  private readonly subscriptions = new Map<string, SyncSubscription>();

  constructor(relay: MultiplexedRelay) {
    relay.onFrame = (frame) => {
      const subscription = this.subscriptions.get(`${frame.matterId}\u0000${frame.docId}`);
      subscription?.receive(frame);
    };
  }

  add(subscription: SyncSubscription, key: SyncDocumentKey): void {
    this.subscriptions.set(`${key.matterId}\u0000${key.docId}`, subscription);
  }

  remove(key: SyncDocumentKey): void { this.subscriptions.delete(`${key.matterId}\u0000${key.docId}`); }
}
