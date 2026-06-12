/**
 * Chaos test — Task 5 (part 1).
 *
 * Collects update blobs from concurrent edits on docs A + B via
 * doc.on('update', ...) observers, then applies them to a fresh doc in
 * several EXPLICIT fixed permutations (no Math.random). Also applies with
 * duplicated updates. Asserts:
 *   1. Every permutation converges to the same yDocToDocumentJson as the
 *      in-order/synced result (commutativity).
 *   2. Applying the same update blob twice is a no-op (idempotency).
 *
 * If a case fails, the bug is in docCrdt.ts — do NOT weaken these assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
  appendParagraph,
  editRunText,
  addTrackedInsertion,
  addTrackedDeletion,
} from '@/modules/coedit/docCrdt';
import type { DocumentJson } from '@/types/docx';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BASE_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'Original contract text here.' },
      ],
    },
  ],
  comments: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstBlockId(ydoc: Y.Doc): string {
  return (ydoc.getArray<Y.Map<unknown>>('body').get(0) as Y.Map<unknown>).get('id') as string;
}

function firstRunId(ydoc: Y.Doc, blockId: string): string {
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  const block = body.toArray().find(b => b.get('id') === blockId) as Y.Map<unknown>;
  const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
  return (runs.get(0) as Y.Map<unknown>).get('id') as string;
}

/**
 * Collect all update blobs emitted by a Y.Doc during mutations.
 * Uses doc.on('update', ...) observer so captures every atomic blob.
 */
function collectUpdates(ydoc: Y.Doc, fn: () => void): Uint8Array[] {
  const blobs: Uint8Array[] = [];
  const handler = (update: Uint8Array) => blobs.push(update);
  ydoc.on('update', handler);
  fn();
  ydoc.off('update', handler);
  return blobs;
}

/** Apply an ordered list of update blobs to a target doc. */
function applyAll(target: Y.Doc, blobs: Uint8Array[]): void {
  for (const blob of blobs) {
    Y.applyUpdate(target, blob);
  }
}

// ---------------------------------------------------------------------------
// Core chaos suite: text edit + append vs tracked insertion
// ---------------------------------------------------------------------------

describe('chaos: commutativity and idempotency with text + structural + tracked edits', () => {
  let seedUpdate: Uint8Array;
  let aBlobs: Uint8Array[];
  let bBlobs: Uint8Array[];
  let referenceJson: string;

  beforeEach(() => {
    // Build the seeded document A
    const a = documentJsonToYDoc(BASE_DOC);
    seedUpdate = Y.encodeStateAsUpdate(a);

    // B starts from A's full state (fork at the same point)
    const b = new Y.Doc();
    Y.applyUpdate(b, seedUpdate);

    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);

    // A: edit run text + append a new paragraph (produces 2 blobs)
    aBlobs = collectUpdates(a, () => {
      editRunText(a, blockIdA, runIdA,
        'Original contract text here.',
        '[A] Original contract text here.',
        'attorney-a');
      appendParagraph(a, 'attorney-a');
    });

    // B: add tracked insertion (produces 1 blob)
    bBlobs = collectUpdates(b, () => {
      addTrackedInsertion(b, blockIdB, ' [B inserted]', 'attorney-b');
    });

    // Reference: normal sync by state-vector delta exchange
    const ref = new Y.Doc();
    Y.applyUpdate(ref, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(ref, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    referenceJson = JSON.stringify(yDocToDocumentJson(ref).body);
  });

  // Permutation 1: A blobs then B blobs (forward order)
  it('permutation 1 (A→B): converges to reference', () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, seedUpdate);
    applyAll(c, aBlobs);
    applyAll(c, bBlobs);
    expect(JSON.stringify(yDocToDocumentJson(c).body)).toBe(referenceJson);
  });

  // Permutation 2: B blobs then A blobs (reverse order)
  it('permutation 2 (B→A): converges to reference', () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, seedUpdate);
    applyAll(c, bBlobs);
    applyAll(c, aBlobs);
    expect(JSON.stringify(yDocToDocumentJson(c).body)).toBe(referenceJson);
  });

  // Permutation 3: interleaved — one from A, one from B, etc.
  it('permutation 3 (interleaved A/B): converges to reference', () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, seedUpdate);
    const maxLen = Math.max(aBlobs.length, bBlobs.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < aBlobs.length) Y.applyUpdate(c, aBlobs[i]!);
      if (i < bBlobs.length) Y.applyUpdate(c, bBlobs[i]!);
    }
    expect(JSON.stringify(yDocToDocumentJson(c).body)).toBe(referenceJson);
  });

  // Idempotency: applying every blob twice produces the same result
  it('idempotency: applying every blob twice does not duplicate data', () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, seedUpdate);
    // Apply each blob, then apply it again immediately — must be a no-op
    for (const blob of [...aBlobs, ...bBlobs]) {
      Y.applyUpdate(c, blob);
      Y.applyUpdate(c, blob);
    }
    expect(JSON.stringify(yDocToDocumentJson(c).body)).toBe(referenceJson);
  });

  // Idempotency: full-state snapshots applied repeatedly
  // Uses the SAME a/b docs from beforeEach (via aBlobs/bBlobs) to avoid
  // timestamp drift between independently-created docs.
  it('idempotency: full-state snapshots applied multiple times converge correctly', () => {
    // Rebuild the full-state snapshots from the beforeEach docs' blobs
    // by replaying them into fresh doc to get the full-state update.
    const aFull = new Y.Doc();
    Y.applyUpdate(aFull, seedUpdate);
    for (const b of aBlobs) Y.applyUpdate(aFull, b);
    const aState = Y.encodeStateAsUpdate(aFull);

    const bFull = new Y.Doc();
    Y.applyUpdate(bFull, seedUpdate);
    for (const b of bBlobs) Y.applyUpdate(bFull, b);
    const bState = Y.encodeStateAsUpdate(bFull);

    const c = new Y.Doc();
    Y.applyUpdate(c, aState);
    Y.applyUpdate(c, bState);
    Y.applyUpdate(c, aState); // duplicate
    Y.applyUpdate(c, bState); // duplicate
    Y.applyUpdate(c, aState); // third time

    expect(JSON.stringify(yDocToDocumentJson(c).body)).toBe(referenceJson);
  });

  // Explicit: applying an already-known update emits no new update event
  it('applying an already-known update emits no new update event', () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, seedUpdate);
    applyAll(c, aBlobs);

    let extraUpdates = 0;
    c.on('update', () => { extraUpdates++; });

    // Re-apply the same blobs — must not trigger new update events
    applyAll(c, aBlobs);

    expect(extraUpdates).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Chaos with tracked deletion mixed in
// ---------------------------------------------------------------------------

describe('chaos: tracked deletion + tracked insertion in all permutations', () => {
  it('del-on-A + ins-on-B blobs in 3 permutations converge to the same result', () => {
    const base = documentJsonToYDoc(BASE_DOC);
    const seedState = Y.encodeStateAsUpdate(base);

    const a = new Y.Doc();
    Y.applyUpdate(a, seedState);
    const b = new Y.Doc();
    Y.applyUpdate(b, seedState);

    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);

    const aBlobs2 = collectUpdates(a, () => {
      addTrackedDeletion(a, blockIdA, runIdA, 'attorney-a');
    });

    const bBlobs2 = collectUpdates(b, () => {
      addTrackedInsertion(b, blockIdB, ' [B addition]', 'attorney-b');
    });

    // Reference via normal sync
    const ref = new Y.Doc();
    Y.applyUpdate(ref, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(ref, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    const refJson = JSON.stringify(yDocToDocumentJson(ref).body);

    // Three explicit fixed permutations
    const permutations: Array<[string, Uint8Array[]]> = [
      ['A then B', [...aBlobs2, ...bBlobs2]],
      ['B then A', [...bBlobs2, ...aBlobs2]],
      ['interleaved',
        (() => {
          const result: Uint8Array[] = [];
          const maxLen = Math.max(aBlobs2.length, bBlobs2.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < aBlobs2.length) result.push(aBlobs2[i]!);
            if (i < bBlobs2.length) result.push(bBlobs2[i]!);
          }
          return result;
        })()
      ],
    ];

    for (const [label, perm] of permutations) {
      const c = new Y.Doc();
      Y.applyUpdate(c, seedState);
      applyAll(c, perm);
      expect(
        JSON.stringify(yDocToDocumentJson(c).body),
        `permutation "${label}" should match reference`
      ).toBe(refJson);
    }
  });

  it('del + ins blobs applied twice (idempotent) match the normal sync result', () => {
    const base = documentJsonToYDoc(BASE_DOC);
    const seedState = Y.encodeStateAsUpdate(base);

    const a = new Y.Doc();
    Y.applyUpdate(a, seedState);
    const b = new Y.Doc();
    Y.applyUpdate(b, seedState);

    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);

    const aBlobs2 = collectUpdates(a, () => {
      addTrackedDeletion(a, blockIdA, runIdA, 'attorney-a');
    });
    const bBlobs2 = collectUpdates(b, () => {
      addTrackedInsertion(b, blockIdB, ' [B dup test]', 'attorney-b');
    });

    const ref = new Y.Doc();
    Y.applyUpdate(ref, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(ref, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    const refJson = JSON.stringify(yDocToDocumentJson(ref).body);

    // Apply each blob twice
    const c = new Y.Doc();
    Y.applyUpdate(c, seedState);
    for (const blob of [...aBlobs2, ...bBlobs2]) {
      Y.applyUpdate(c, blob);
      Y.applyUpdate(c, blob);
    }

    expect(JSON.stringify(yDocToDocumentJson(c).body)).toBe(refJson);
  });
});
