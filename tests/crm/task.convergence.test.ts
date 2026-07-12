/** If a case fails, the bug is in Task sync handling — do NOT weaken it. */
import { describe, expect, it } from 'vitest';
import { InMemoryCursorStore, ImmutableIdentityMismatchError, SyncSubscription, type EncryptedRelayUpdate, type MultiplexedRelay, type RelayFrame } from '@/platform/crm/sync';

const key = { matterId: 'firm_home', docId: 'crm:tasks' };
const update = (cursor: number, blobId = `blob-${String(cursor)}`): EncryptedRelayUpdate => ({ ...key, cursor, blobId, keyEpoch: 1, ciphertext: new Uint8Array([cursor]) });

class ScriptedRelay implements MultiplexedRelay {
  onFrame: ((frame: RelayFrame) => void) | null = null;
  readonly pulls: EncryptedRelayUpdate[][] = [];
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async subscribe(): Promise<void> {}
  async unsubscribe(): Promise<void> {}
  async pullThrough(): Promise<EncryptedRelayUpdate[]> { return this.pulls.shift() ?? []; }
  emit(frame: RelayFrame): void { this.onFrame?.(frame); }
}

describe('Task CRDT convergence', () => {
  it('ignores a matching subscribe-to-watermark duplicate and reaches Live', async () => {
    const relay = new ScriptedRelay();
    relay.pulls.push([update(1)]);
    const store = new InMemoryCursorStore();
    const applied: string[] = [];
    const subscription = new SyncSubscription({ key, relay, store, authenticateAndApply: async (row) => { applied.push(row.blobId); } });
    await subscription.start();
    relay.emit({ type: 'ready', ...key, watermark: 1 });
    await subscription.whenIdle();
    relay.emit(update(1));
    await subscription.whenIdle();
    expect(applied).toEqual(['blob-1']);
    expect(subscription.status()).toBe('live');
  });

  it('treats an old cursor with a mismatched immutable blob identity as corruption', async () => {
    const relay = new ScriptedRelay();
    relay.pulls.push([update(1)]);
    const subscription = new SyncSubscription({ key, relay, store: new InMemoryCursorStore(), authenticateAndApply: async () => {} });
    await subscription.start();
    relay.emit({ type: 'ready', ...key, watermark: 1 });
    await subscription.whenIdle();
    relay.emit(update(1, 'tampered-id'));
    await subscription.whenIdle();
    expect(subscription.status()).toBe('quarantined');
    expect(subscription.error()).toBeInstanceOf(ImmutableIdentityMismatchError);
  });

  it('repairs a missing row before applying a later row', async () => {
    const relay = new ScriptedRelay();
    relay.pulls.push([], [update(1), update(2)]);
    const applied: number[] = [];
    const store = new InMemoryCursorStore();
    const subscription = new SyncSubscription({ key, relay, store, authenticateAndApply: async (row) => { applied.push(row.cursor); } });
    await subscription.start();
    relay.emit({ type: 'ready', ...key, watermark: 0 });
    await subscription.whenIdle();
    relay.emit(update(3));
    await subscription.whenIdle();
    expect(applied).toEqual([1, 2, 3]);
    expect(await store.cursor(key)).toBe(3);
  });

  // EXAM-BLOCKED: B1 has not exported a Task Yjs document shape or materializer; raw merge tests would only retest Yjs.
  it.skip('preserves disjoint offline Task field edits after bidirectional sync');
  // EXAM-BLOCKED: B1 has not exported a Task field-merge materializer.
  it.skip('resolves same-field offline edits deterministically regardless of sync order');
});
