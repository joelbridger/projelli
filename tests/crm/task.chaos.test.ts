/** Fixed, seeded permutations only. If this fails, do not weaken the merge assertion. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

function taskUpdate(field: 'title' | 'status' | 'assignee', value: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap<string>('task').set(field, value);
  return Y.encodeStateAsUpdate(doc);
}

function materialize(updates: Uint8Array[]): string {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return JSON.stringify(Object.fromEntries([...doc.getMap<string>('task').entries()].sort(([left], [right]) => left.localeCompare(right))));
}

describe('Task chaos: fixed-permutation commutativity and idempotency', () => {
  it('has no Math.random and converges under fixed generated permutations', () => {
    const updates = [taskUpdate('title', 'Review'), taskUpdate('status', 'in_progress'), taskUpdate('assignee', 'advisor-b')];
    const expected = materialize(updates);
    fc.assert(fc.property(fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }), (permutation) => {
      expect(materialize(permutation.map((index) => updates[index]!))).toBe(expected);
    }), { numRuns: 1000, seed: 31003 });
  });

  it('does not duplicate state when every concurrent blob is replayed twice', () => {
    const updates = [taskUpdate('title', 'Review'), taskUpdate('status', 'done'), taskUpdate('assignee', 'advisor-b')];
    expect(materialize([...updates, ...updates])).toBe(materialize(updates));
  });
});
