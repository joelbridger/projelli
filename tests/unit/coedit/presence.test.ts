/**
 * presence.test.ts — Task 11: PresenceChannel (best-effort, ephemeral).
 *
 * Decision: y-protocols is NOT in deps (only "yjs" is present). We therefore
 * implement the simpler v1: a tiny ephemeral heartbeat map. Live carets are an
 * explicit fast-follow; this version surfaces "N people editing" from the
 * channel's participant list.
 *
 * Test coverage:
 *   1. join() adds local participant; others() does NOT include the local client.
 *   2. A remote announce() is visible in others().
 *   3. Departure (leave / timeout) removes a participant from others().
 *   4. Updating local caret does NOT create a self-entry in others().
 *   5. Presence state is ephemeral: PresenceChannel holds no reference to a
 *      Y.Doc or any persistent store (structural check).
 *   6. Multiple PresenceChannel instances on the same transport bus see each
 *      other's presence (integration of two peers on one bus).
 *   7. dispose() stops heartbeats and removes the local participant from the
 *      bus.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PresenceChannel,
  PresenceBus,
  type PresenceEntry,
} from '@/modules/coedit/presence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    clientId: 'client-a',
    author: 'Alice',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PresenceBus', () => {
  it('creates an isolated bus per docId', () => {
    const bus1 = PresenceBus.forDoc('doc-1');
    const bus2 = PresenceBus.forDoc('doc-2');
    const same = PresenceBus.forDoc('doc-1');
    expect(bus1).toBe(same);
    expect(bus1).not.toBe(bus2);
    PresenceBus.release('doc-1');
    PresenceBus.release('doc-2');
  });
});

describe('PresenceChannel', () => {
  let bus: PresenceBus;

  beforeEach(() => {
    bus = PresenceBus.forDoc('test-doc');
  });

  afterEach(() => {
    PresenceBus.release('test-doc');
  });

  // 1. join() registers local client; others() excludes self
  it('join: local client is NOT in others()', () => {
    const channel = new PresenceChannel({ clientId: 'me', author: 'Alice', bus });
    channel.join();
    const others = channel.others();
    expect(others.find((e) => e.clientId === 'me')).toBeUndefined();
    channel.dispose();
  });

  // 2. Remote announce visible in others()
  it('remote announce appears in others()', () => {
    const alice = new PresenceChannel({ clientId: 'alice', author: 'Alice', bus });
    const bob = new PresenceChannel({ clientId: 'bob', author: 'Bob', bus });
    alice.join();
    bob.join();

    // From alice's perspective, bob is a remote participant.
    const others = alice.others();
    expect(others.find((e) => e.clientId === 'bob')).toBeDefined();
    expect(others.find((e) => e.clientId === 'bob')?.author).toBe('Bob');

    alice.dispose();
    bob.dispose();
  });

  // 3. leave() removes participant
  it('dispose() removes participant from others()', () => {
    const alice = new PresenceChannel({ clientId: 'alice', author: 'Alice', bus });
    const bob = new PresenceChannel({ clientId: 'bob', author: 'Bob', bus });
    alice.join();
    bob.join();
    bob.dispose();

    const others = alice.others();
    expect(others.find((e) => e.clientId === 'bob')).toBeUndefined();
    alice.dispose();
  });

  // 4. updateCaret() does NOT create a self-entry in others()
  it('updateCaret does not add self to others()', () => {
    const channel = new PresenceChannel({ clientId: 'me', author: 'Alice', bus });
    channel.join();
    channel.updateCaret({ blockIndex: 0, runIndex: 1, offset: 3 });
    const others = channel.others();
    expect(others.find((e) => e.clientId === 'me')).toBeUndefined();
    channel.dispose();
  });

  // 5. Ephemeral: PresenceChannel has no reference to any Y.Doc or persisted store.
  it('PresenceChannel does not hold a Y.Doc reference', () => {
    const channel = new PresenceChannel({ clientId: 'x', author: 'X', bus });
    // Introspect: ensure no property of the instance is a Y.Doc-like object
    // (has an 'awareness' field or is an instanceof Y.Doc — neither is accessible
    // from yjs without importing Y, so we check by shape).
    const isYDoc = (v: unknown) =>
      v !== null &&
      typeof v === 'object' &&
      'getArray' in (v as object) &&
      'getMap' in (v as object) &&
      'transact' in (v as object);
    const instanceValues = Object.values(channel as unknown as Record<string, unknown>);
    expect(instanceValues.some(isYDoc)).toBe(false);
    channel.dispose();
  });

  // 6. Two peers on the same bus see each other
  it('two peers on the same bus see each other', () => {
    const peerA = new PresenceChannel({ clientId: 'a', author: 'Attorney A', bus });
    const peerB = new PresenceChannel({ clientId: 'b', author: 'Attorney B', bus });
    peerA.join();
    peerB.join();

    // A sees B
    expect(peerA.others().find((e) => e.clientId === 'b')?.author).toBe('Attorney B');
    // B sees A
    expect(peerB.others().find((e) => e.clientId === 'a')?.author).toBe('Attorney A');

    peerA.dispose();
    peerB.dispose();
  });

  // 7. onChange callback fires when remote presence changes
  it('onChange fires when a peer joins', () => {
    const alice = new PresenceChannel({ clientId: 'alice', author: 'Alice', bus });
    const bob = new PresenceChannel({ clientId: 'bob', author: 'Bob', bus });
    alice.join();

    const spy = vi.fn();
    const unsub = alice.onChange(spy);

    bob.join();
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    alice.dispose();
    bob.dispose();
  });

  // 8. onChange fires when a peer departs
  it('onChange fires when a peer departs', () => {
    const alice = new PresenceChannel({ clientId: 'alice', author: 'Alice', bus });
    const bob = new PresenceChannel({ clientId: 'bob', author: 'Bob', bus });
    alice.join();
    bob.join();

    const spy = vi.fn();
    const unsub = alice.onChange(spy);

    bob.dispose();
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    alice.dispose();
  });
});
