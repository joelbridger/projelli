/** Fixed, seeded CRDT merge checks for the workflow-instance document surface. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { InMemoryCursorStore, SyncSubscription, type EncryptedRelayUpdate, type MultiplexedRelay, type RelayFrame } from '@/platform/crm/sync';

function updateStep(field: string, value: string): Uint8Array {
  const doc = new Y.Doc();
  const step = doc.getMap<string>('workflow-step');
  step.set(field, value);
  return Y.encodeStateAsUpdate(doc);
}

function state(updates: Uint8Array[]): string {
  const doc = new Y.Doc();
  updates.forEach((update) => Y.applyUpdate(doc, update));
  return JSON.stringify(Object.fromEntries([...doc.getMap<string>('workflow-step').entries()].sort(([left], [right]) => left.localeCompare(right))));
}

describe('WorkflowInstance CRDT convergence', () => {
  it('converges byte-identically for generated fixed permutations', () => {
    const updates = [updateStep('status', 'in_progress'), updateStep('assignee', 'advisor-b'), updateStep('note', 'Called client')];
    const expected = state(updates);
    fc.assert(fc.property(fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }), (order) => {
      expect(state(order.map((index) => updates[index]!))).toBe(expected);
    }), { numRuns: 1000, seed: 31004 });
  });

  it('is idempotent for duplicate immutable update blobs', () => {
    const updates = [updateStep('status', 'done'), updateStep('outcome', 'approved')];
    expect(state([...updates, ...updates])).toBe(state(updates));
  });

  // EXAM-BLOCKED: workflow CRDT projections and their Field Merge Contract materializer are not exported by B1.
  it.skip('keeps disjoint offline progress and derived-field edits after sync');
  // EXAM-BLOCKED: no exported workflow field conflict resolver exists yet.
  it.skip('uses the deterministic same-field conflict rule regardless of delivery order');
  it('performs watermark duplicate triage without a false gap repair', async () => {
    const key = { matterId: 'firm_home', docId: 'crm:workflows' };
    const row: EncryptedRelayUpdate = { ...key, cursor: 1, blobId: 'workflow-blob-1', keyEpoch: 1, ciphertext: new Uint8Array([1]) };
    const relay: MultiplexedRelay = {
      onFrame: null, start: async () => {}, stop: async () => {}, subscribe: async () => {}, unsubscribe: async () => {},
      pullThrough: async () => [row],
    };
    const applied: string[] = [];
    const subscription = new SyncSubscription({ key, relay, store: new InMemoryCursorStore(), authenticateAndApply: async (update) => { applied.push(update.blobId); } });
    await subscription.start();
    relay.onFrame!({ type: 'ready', ...key, watermark: 1 } satisfies RelayFrame);
    await subscription.whenIdle();
    relay.onFrame!(row);
    await subscription.whenIdle();
    expect(applied).toEqual(['workflow-blob-1']);
    expect(subscription.status()).toBe('live');
  });
});
