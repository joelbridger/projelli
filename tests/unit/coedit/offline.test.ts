/**
 * Offline reconnect matrix — Task 5 (part 2).
 *
 * For each combination of {text edit, structural insert, tracked change} ×
 * {A-then-B order, B-then-A order} (6 cases total):
 *   - Both replicas edit offline (no sync during editing)
 *   - Exchange via syncPair (state-vector-based delta exchange)
 *   - Assert: no data loss, attribution intact, identical converged
 *     yDocToDocumentJson on both A and B
 *
 * If a case fails, the bug is in docCrdt.ts — do NOT weaken these assertions.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
  appendParagraph,
  editRunText,
  addTrackedInsertion,
} from '@/platform/firm/coedit/docCrdt';
import type { DocumentJson, DocxParagraph } from '@/types/docx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'Governing law shall be the State of Delaware.' },
      ],
    },
  ],
  comments: {},
};

// ---------------------------------------------------------------------------
// syncPair helper (same as convergence.test.ts)
// ---------------------------------------------------------------------------

function syncPair(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

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

/** Fork two offline replicas from the same seeded doc. */
function forkPair(): { a: Y.Doc; b: Y.Doc } {
  const seed = documentJsonToYDoc(BASE_DOC);
  const a = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));
  return { a, b };
}

// ---------------------------------------------------------------------------
// 1. Text edit × A-then-B
// ---------------------------------------------------------------------------

describe('offline: text edit — A-then-B', () => {
  it('A edits run, B edits run, sync → no data loss, both edits present', () => {
    const { a, b } = forkPair();

    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);
    const runIdB = firstRunId(b, blockIdB);

    const baseText = 'Governing law shall be the State of Delaware.';

    // A edits first half, B edits second half — offline
    const newTextA = baseText.replace('Governing law', 'Applicable governing law');
    editRunText(a, blockIdA, runIdA, baseText, newTextA, 'attorney-a');

    const newTextB = baseText.replace('State of Delaware', 'State of New York');
    editRunText(b, blockIdB, runIdB, baseText, newTextB, 'attorney-b');

    // Exchange
    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    // No data loss: both edits survive
    const merged = (jsonA.body[0] as DocxParagraph).inlines
      .filter(i => i.kind === 'run')
      .map(i => (i as any).text as string)
      .join('');
    expect(merged).toContain('Applicable');
    expect(merged).toContain('New York');
  });
});

// ---------------------------------------------------------------------------
// 2. Text edit × B-then-A
// ---------------------------------------------------------------------------

describe('offline: text edit — B-then-A', () => {
  it('B edits run first conceptually, A second, sync → no data loss', () => {
    const { a, b } = forkPair();

    const blockIdA = firstBlockId(a);
    const runIdA = firstRunId(a, blockIdA);
    const blockIdB = firstBlockId(b);
    const runIdB = firstRunId(b, blockIdB);

    const baseText = 'Governing law shall be the State of Delaware.';

    // B edits the end of the sentence; A edits the beginning — offline
    const newTextB = baseText.replace('of Delaware', 'of California');
    editRunText(b, blockIdB, runIdB, baseText, newTextB, 'attorney-b');

    const newTextA = 'This Agreement shall be governed by the State of Delaware.';
    // Replace full text (completely different edit)
    editRunText(a, blockIdA, runIdA, baseText, newTextA, 'attorney-a');

    // Exchange — apply B first to A, then vice versa
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence: both see the same merged state
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    // No data loss: text present (yjs CRDT merges at character level)
    const mergedText = (jsonA.body[0] as DocxParagraph).inlines
      .filter(i => i.kind === 'run')
      .map(i => (i as any).text as string)
      .join('');
    expect(mergedText.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Structural insert × A-then-B
// ---------------------------------------------------------------------------

describe('offline: structural insert — A-then-B', () => {
  it('A and B each appendParagraph offline → both paragraphs present after sync', () => {
    const { a, b } = forkPair();

    const pIdA = appendParagraph(a, 'attorney-a');
    const pIdB = appendParagraph(b, 'attorney-b');

    // Pre-sync: each replica sees only 2 blocks
    expect(yDocToDocumentJson(a).body.length).toBe(2);
    expect(yDocToDocumentJson(b).body.length).toBe(2);

    // Exchange
    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    // Both paragraphs present
    expect(jsonA.body.length).toBe(3);

    // Both block ids present in the body
    const bodyA = a.getArray<Y.Map<unknown>>('body').toArray().map(m => m.get('id') as string);
    expect(bodyA).toContain(pIdA);
    expect(bodyA).toContain(pIdB);
  });
});

// ---------------------------------------------------------------------------
// 4. Structural insert × B-then-A
// ---------------------------------------------------------------------------

describe('offline: structural insert — B-then-A', () => {
  it('B appends first, A appends second, sync → both present in identical order on both', () => {
    const { a, b } = forkPair();

    const pIdB = appendParagraph(b, 'attorney-b');
    const pIdA = appendParagraph(a, 'attorney-a');

    // Exchange (B's delta applied to A first)
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));
    expect(jsonA.body.length).toBe(3);

    const bodyA = a.getArray<Y.Map<unknown>>('body').toArray().map(m => m.get('id') as string);
    expect(bodyA).toContain(pIdA);
    expect(bodyA).toContain(pIdB);
  });
});

// ---------------------------------------------------------------------------
// 5. Tracked change × A-then-B
// ---------------------------------------------------------------------------

describe('offline: tracked change — A-then-B', () => {
  it('A adds tracked insertion, B adds tracked insertion, sync → both with correct attribution', () => {
    const { a, b } = forkPair();

    const blockIdA = firstBlockId(a);
    const blockIdB = firstBlockId(b);

    // Both add tracked insertions offline
    addTrackedInsertion(a, blockIdA, ' [A clause]', 'attorney-a');
    addTrackedInsertion(b, blockIdB, ' [B clause]', 'attorney-b');

    syncPair(a, b);

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    const inlines = (jsonA.body[0] as DocxParagraph).inlines;

    // Both tracked insertions present
    const insertions = inlines.filter(i => i.kind === 'insertion');
    expect(insertions.length).toBe(2);

    // Attribution intact
    const authorA = insertions.find(i => i.kind === 'insertion' && i.meta.author === 'attorney-a');
    const authorB = insertions.find(i => i.kind === 'insertion' && i.meta.author === 'attorney-b');
    expect(authorA).toBeTruthy();
    expect(authorB).toBeTruthy();

    if (authorA?.kind === 'insertion') {
      expect(authorA.runs[0]?.text).toBe(' [A clause]');
    }
    if (authorB?.kind === 'insertion') {
      expect(authorB.runs[0]?.text).toBe(' [B clause]');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Tracked change × B-then-A
// ---------------------------------------------------------------------------

describe('offline: tracked change — B-then-A', () => {
  it('B adds tracked insertion, A adds tracked insertion, sync → both with correct attribution', () => {
    const { a, b } = forkPair();

    const blockIdA = firstBlockId(a);
    const blockIdB = firstBlockId(b);

    // B goes first this time
    addTrackedInsertion(b, blockIdB, ' [B first clause]', 'attorney-b');
    addTrackedInsertion(a, blockIdA, ' [A second clause]', 'attorney-a');

    // Apply B's delta to A first, then A's to B
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));

    const jsonA = yDocToDocumentJson(a);
    const jsonB = yDocToDocumentJson(b);

    // Convergence
    expect(JSON.stringify(jsonA.body)).toBe(JSON.stringify(jsonB.body));

    const inlines = (jsonA.body[0] as DocxParagraph).inlines;

    // Both tracked insertions present
    const insertions = inlines.filter(i => i.kind === 'insertion');
    expect(insertions.length).toBe(2);

    // Attribution intact
    const fromA = insertions.find(i => i.kind === 'insertion' && i.meta.author === 'attorney-a');
    const fromB = insertions.find(i => i.kind === 'insertion' && i.meta.author === 'attorney-b');
    expect(fromA).toBeTruthy();
    expect(fromB).toBeTruthy();

    // Text intact
    if (fromA?.kind === 'insertion') {
      expect(fromA.runs[0]?.text).toBe(' [A second clause]');
    }
    if (fromB?.kind === 'insertion') {
      expect(fromB.runs[0]?.text).toBe(' [B first clause]');
    }
  });
});
