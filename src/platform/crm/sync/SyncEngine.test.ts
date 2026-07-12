import { describe, expect, it, vi } from 'vitest';
import {
  ClientSubscriptionCapError,
  CrmDocumentRouter,
  CrmSyncEngine,
  EpochResealQueue,
  InMemoryCursorStore,
  InMemorySyncMetrics,
  SyncSubscription,
  type EncryptedRelayUpdate,
  type MultiplexedRelay,
} from './index';

const key = (matterId = 'household-1', docId = 'crm:record') => ({ matterId, docId });
const update = (cursor: number, blobId = `blob-${String(cursor)}`): EncryptedRelayUpdate => ({
  ...key(), cursor, blobId, keyEpoch: 1, ciphertext: new Uint8Array([cursor]),
});

class MockRelay implements MultiplexedRelay {
  readonly subscribe = vi.fn(() => Promise.resolve());
  readonly unsubscribe = vi.fn(() => Promise.resolve());
  readonly pullThrough = vi.fn((_key, since: number, through: number) => Promise.resolve(
    Array.from({ length: Math.max(0, through - since) }, (_, index) => update(since + index + 1)),
  ));
  onFrame: ((frame: EncryptedRelayUpdate | { type: 'ready'; matterId: string; docId: string; watermark: number } | { type: 'epoch_rejected'; matterId: string; docId: string; currentEpoch: number }) => void) | null = null;
  readonly start = vi.fn(() => Promise.resolve());
  readonly stop = vi.fn(() => Promise.resolve());
  emit(frame: Parameters<NonNullable<MockRelay['onFrame']>>[0]): void { this.onFrame?.(frame); }
}

describe('SYNC-01 lossless subscription', () => {
  it('verifies and ignores a normal duplicate from the subscribe window', async () => {
    const relay = new MockRelay();
    const store = new InMemoryCursorStore();
    const apply = vi.fn(() => Promise.resolve());
    const subscription = new SyncSubscription({ key: key(), relay, store, authenticateAndApply: apply });

    await subscription.start();
    relay.emit({ type: 'ready', ...key(), watermark: 1 });
    await subscription.whenIdle();
    relay.emit(update(1));
    await subscription.whenIdle();

    expect(await store.cursor(key())).toBe(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(subscription.status()).toBe('live');
  });

  it('repairs a gap before applying the later live frame', async () => {
    const relay = new MockRelay();
    relay.pullThrough.mockResolvedValueOnce([]).mockResolvedValueOnce([update(1), update(2)]);
    const store = new InMemoryCursorStore();
    const applied: number[] = [];
    const subscription = new SyncSubscription({
      key: key(), relay, store,
      authenticateAndApply: (row) => { applied.push(row.cursor); return Promise.resolve(); },
    });

    await subscription.start();
    relay.emit({ type: 'ready', ...key(), watermark: 0 });
    await subscription.whenIdle();
    relay.emit(update(3));
    await subscription.whenIdle();

    expect(relay.pullThrough).toHaveBeenLastCalledWith(key(), 0, 2);
    expect(applied).toEqual([1, 2, 3]);
    expect(await store.cursor(key())).toBe(3);
    expect(subscription.status()).toBe('live');
  });

  it('quarantines an epoch-rejected queued edit when resealing cannot authenticate it', async () => {
    const relay = new MockRelay();
    const queue = new EpochResealQueue({
      reseal: vi.fn(() => Promise.reject(new Error('old key unavailable'))),
      submit: vi.fn(() => Promise.resolve()),
    });
    queue.enqueue({ id: 'draft-1', key: key(), sealedEpoch: 1, encryptedLocalEdit: new Uint8Array([1]) });
    const subscription = new SyncSubscription({
      key: key(), relay, store: new InMemoryCursorStore(), authenticateAndApply: () => Promise.resolve(),
      onEpochRejected: (document, currentEpoch) => queue.handleEpochRejected(document, currentEpoch),
    });

    await subscription.start();
    relay.emit({ type: 'epoch_rejected', ...key(), currentEpoch: 2 });
    await subscription.whenIdle();

    expect(queue.visibleQuarantine()).toEqual([expect.objectContaining({ editId: 'draft-1', currentEpoch: 2 })]);
  });
});

describe('D1 document router and ceiling instrumentation', () => {
  it('provisions firm_home before opening the one device socket and five firm documents', async () => {
    const relay = new MockRelay();
    const steps: string[] = [];
    const metrics = new InMemorySyncMetrics();
    const router = new CrmDocumentRouter({
      startDocument: (doc) => { steps.push(`document:${doc.docId}`); return Promise.resolve(); },
      stopDocument: () => Promise.resolve(),
      metrics,
    });
    const engine = new CrmSyncEngine({
      relay, router, metrics,
      provisioner: {
        registerOrRecoverDevice: () => { steps.push('device'); return Promise.resolve(); },
        provisionFirmHome: (matterId) => { steps.push(matterId); return Promise.resolve(); },
        obtainEligibleMatterKeys: () => { steps.push('keys'); return Promise.resolve(); },
      },
    });

    await engine.bootstrap('2026-Q3');

    expect(steps.slice(0, 3)).toEqual(['device', 'firm_home', 'keys']);
    expect(relay.start).toHaveBeenCalledOnce();
    expect(steps.filter((step) => step.startsWith('document:'))).toHaveLength(5);
    expect(metrics.snapshot().socketCount).toBe(1);
  });

  it('evicts the least-recent unpinned client and its paired task notes for a thirteenth client', async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const router = new CrmDocumentRouter({
      startDocument: (doc) => { starts.push(`${doc.matterId}/${doc.docId}`); return Promise.resolve(); },
      stopDocument: (doc) => { stops.push(`${doc.matterId}/${doc.docId}`); return Promise.resolve(); },
      metrics: new InMemorySyncMetrics(),
    });
    for (let i = 1; i <= 12; i += 1) await router.openClient(`client-${String(i)}`, { taskNotes: true });
    await router.openClient('client-13', { taskNotes: true });

    expect(stops).toContain('client-1/crm:record');
    expect(stops).toContain('client-1/crm:task-notes');
    expect(router.activeClientMatterIds()).not.toContain('client-1');
    expect(router.activeClientMatterIds()).toContain('client-13');
  });

  it('requires an explicit unpin when all twelve client slots are pinned', async () => {
    const router = new CrmDocumentRouter({
      startDocument: () => Promise.resolve(),
      stopDocument: () => Promise.resolve(),
      metrics: new InMemorySyncMetrics(),
    });
    for (let i = 1; i <= 12; i += 1) {
      await router.openClient(`client-${String(i)}`);
      router.setPinned(`client-${String(i)}`, true);
    }

    await expect(router.openClient('client-13')).rejects.toBeInstanceOf(ClientSubscriptionCapError);
  });

  it('records the frozen bootstrap allocation and rejects oversize ciphertext chunks', () => {
    const metrics = new InMemorySyncMetrics();
    metrics.beginBootstrap();
    for (let i = 0; i < 10; i += 1) metrics.recordTransfer('firm', 'checkpoint', 768 * 1024);
    metrics.recordTransfer('firm', 'checkpoint', 512 * 1024);
    expect(metrics.snapshot().bootstrapBytes).toBe(8 * 1024 * 1024);
    expect(() => { metrics.recordTransfer('record', 'tail', 768 * 1024 + 1); }).toThrow('768 KiB');
  });
});
