/**
 * Convergence suite — Task 4.
 *
 * Re-proves the spike's 5 convergence cases (p1–p5) on the production yjs
 * DocumentJson CRDT. Sync is done via Y.encodeStateAsUpdate /
 * Y.encodeStateVector / Y.applyUpdate — the same primitives the relay carries.
 *
 * If a case fails the bug is in docCrdt.ts (Tasks 1–3), NOT the test.
 * Do NOT weaken these assertions.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
  appendParagraph,
  editRunText,
  addTrackedInsertion,
  addTrackedDeletion,
} from '@/platform/firm/coedit/docCrdt';
import type { DocumentJson, DocxParagraph } from '@/types/docx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One paragraph with a single plain run — the base document shared in tests. */
const BASE_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'The term of this Agreement is one year.' },
      ],
    },
  ],
  comments: {},
};

// ---------------------------------------------------------------------------
// syncPair helper
// ---------------------------------------------------------------------------

/**
 * Exchange minimal deltas between a and b (both ways) so they converge.
 * Uses the relay primitives: encodeStateVector / encodeStateAsUpdate / applyUpdate.
 */
function syncPair(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

// ---------------------------------------------------------------------------
// Helper: get the first block id from a ydoc
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

// ---------------------------------------------------------------------------
// P1 — Baseline join
// ---------------------------------------------------------------------------

describe('p1_join_replays_identical_state', () => {
  it('B joins from A full state; yDocToDocumentJson(A) deep-equals yDocToDocumentJson(B)', () => {
    const a = documentJsonToYDoc(BASE_DOC);

    // A makes an edit offline
    const blockId = firstBlockId(a);
    appendParagraph(a, 'attorney-a');
    addTrackedInsertion(a, blockId, ' [annotation]', 'attorney-a');

    // B joins by replaying A's full state
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    expect(jsonB.body.length).toBe(jsonA.body.length);
    expect(JSON.stringify(jsonB.body)).toBe(JSON.stringify(jsonA.body));
  });
});

// ---------------------------------------------------------------------------
// P2 — Concurrent same-run text edit, no data loss
// ---------------------------------------------------------------------------

describe('p2_concurrent_same_run_edit_no_data_loss', () => {
  it('A and B edit the same run at different positions; both edits survive after sync', () => {
    const a = documentJsonToYDoc(BASE_DOC);

    // B gets A's initial state
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Confirm both start from same base text
    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);
    const runIdB = firstRunId(b, blockIdB);

    const baseText = 'The term of this Agreement is one year.';

    // A edits the run: prepend "renewable " before "one year"
    const newTextA = baseText.replace('one year', 'renewable one year');
    editRunText(a, blockIdA, runIdA, baseText, newTextA, 'attorney-a');

    // B edits the same run: append " (initial term)" to the sentence
    const newTextB = baseText.replace('one year.', 'one year (initial term).');
    editRunText(b, blockIdB, runIdB, baseText, newTextB, 'attorney-b');

    // Pre-sync they differ
    const preA = (yDocToDocumentJson(a).body[0] as DocxParagraph).inlines[0];
    const preB = (yDocToDocumentJson(b).body[0] as DocxParagraph).inlines[0];
    expect(preA).not.toEqual(preB);

    // Sync
    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence: identical on both sides
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    // No data loss: both edits present
    const mergedText = (jsonA.body[0] as DocxParagraph).inlines
      .filter(i => i.kind === 'run')
      .map(i => (i as any).text as string)
      .join('');

    expect(mergedText).toContain('renewable');
    expect(mergedText).toContain('initial term');
    // "one year" still present exactly once in some form
    expect(mergedText).toContain('one year');
  });
});

// ---------------------------------------------------------------------------
// P3 — Concurrent structural inserts converge
// ---------------------------------------------------------------------------

describe('p3_concurrent_structural_inserts_converge', () => {
  it('A and B each appendParagraph offline; both paragraphs present on both after sync', () => {
    const a = documentJsonToYDoc(BASE_DOC);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // A and B each append a different paragraph while offline
    appendParagraph(a, 'attorney-a');
    appendParagraph(b, 'attorney-b');

    // Pre-sync: each only sees their own new paragraph (2 blocks each)
    expect(yDocToDocumentJson(a).body.length).toBe(2);
    expect(yDocToDocumentJson(b).body.length).toBe(2);

    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Both present: base paragraph + 2 appended paragraphs
    expect(jsonA.body.length).toBe(3);
    expect(jsonB.body.length).toBe(3);

    // Consistent order on both sides
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));
  });
});

// ---------------------------------------------------------------------------
// P4 — Tracked-change attribution survives concurrent merge
// ---------------------------------------------------------------------------

describe('p4_tracked_changes_attribution_survives', () => {
  it('A adds tracked insertion, B adds tracked deletion; both survive sync with authors intact', () => {
    const a = documentJsonToYDoc(BASE_DOC);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const blockIdA = firstBlockId(a);
    const blockIdB = firstBlockId(b);
    const runIdB = firstRunId(b, blockIdB);

    // A: tracked insertion (offline)
    addTrackedInsertion(a, blockIdA, ' [added by counsel A]', 'attorney-a');

    // B: tracked deletion of the plain run (offline)
    addTrackedDeletion(b, blockIdB, runIdB, 'attorney-b');

    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    const inlines = (jsonA.body[0] as DocxParagraph).inlines;

    const ins = inlines.find(i => i.kind === 'insertion');
    expect(ins).toBeTruthy();
    if (ins?.kind === 'insertion') {
      expect(ins.meta.author).toBe('attorney-a');
      expect(ins.runs[0].text).toBe(' [added by counsel A]');
      expect(ins.meta.date.length).toBeGreaterThan(0);
    }

    const del = inlines.find(i => i.kind === 'deletion');
    expect(del).toBeTruthy();
    if (del?.kind === 'deletion') {
      expect(del.meta.author).toBe('attorney-b');
      expect(del.runs[0].text).toBe('The term of this Agreement is one year.');
      expect(del.meta.date.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// P5 — Commutative and idempotent
// ---------------------------------------------------------------------------

describe('p5_commutative_idempotent', () => {
  it('C merges A and B deltas in shuffled order, twice; converges to the same state as synced A', () => {
    const a = documentJsonToYDoc(BASE_DOC);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);

    // A: edit run text
    editRunText(a, blockIdA, runIdA,
      'The term of this Agreement is one year.',
      '[A] The term of this Agreement is one year.',
      'attorney-a');

    // B: add tracked insertion
    addTrackedInsertion(b, blockIdB, ' [B tracked]', 'attorney-b');

    // Capture deltas before any sync
    const aState = Y.encodeStateAsUpdate(a);
    const bState = Y.encodeStateAsUpdate(b);

    // C bootstraps from A's full state (as the spike does)
    const c = new Y.Doc();
    Y.applyUpdate(c, aState);

    // Apply B's delta, then A's full state again — in "wrong" order; both twice
    Y.applyUpdate(c, bState);
    Y.applyUpdate(c, aState); // duplicate — must be no-op
    Y.applyUpdate(c, bState); // duplicate — must be no-op

    // Bring A and B together the normal way
    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonC = yDocToDocumentJson(c);

    // C converges to the same state as the synced A
    expect(JSON.stringify(jsonC.body)).toBe(JSON.stringify(jsonA.body));

    // Both edits present exactly once (no duplication from double-apply)
    const allText = JSON.stringify(jsonC.body);
    const aCount = (allText.match(/\[A\]/g) ?? []).length;
    const bCount = (allText.match(/\[B tracked\]/g) ?? []).length;
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });
});
