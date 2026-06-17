/**
 * Tests for docCrdt mutators (Task 3).
 *
 * Each mutator is tested for:
 *   1. Correct tree mutation (via yDocToDocumentJson)
 *   2. Author stamping: txn.origin === author (via ydoc.on('update', (u, origin) => ...))
 *
 * Tracked-change resolve semantics:
 *   accept-insertion  → kind becomes 'run' (text), subruns collapsed, author/date/metaId dropped
 *   reject-insertion  → run removed entirely
 *   accept-deletion   → run removed entirely
 *   reject-deletion   → kind becomes 'run' (text), text restored from subruns, author/date/metaId dropped
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
  appendParagraph,
  insertRun,
  editRunText,
  deleteBlock,
  splitParagraph,
  addTrackedInsertion,
  addTrackedDeletion,
  resolveRevision,
} from '@/platform/firm/coedit/docCrdt';
import type { DocumentJson, DocxParagraph } from '@/platform/types/docx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'start', preserveSpace: false },
      ],
    },
  ],
  comments: {},
};

const TWO_RUN_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'hello ', preserveSpace: false },
        { kind: 'run', text: 'world', preserveSpace: false },
      ],
    },
  ],
  comments: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture the origin from the first update event emitted. */
function captureOrigin(ydoc: Y.Doc): { origin: unknown } {
  const ref = { origin: undefined as unknown };
  ydoc.on('update', (_u: Uint8Array, o: unknown) => {
    ref.origin = o;
  });
  return ref;
}

/** Get the first block's id from a ydoc. */
function firstBlockId(ydoc: Y.Doc): string {
  return (ydoc.getArray('body').get(0) as Y.Map<unknown>).get('id') as string;
}

/** Get the id of the run at the given index in the first block. */
function runIdAt(ydoc: Y.Doc, blockId: string, index: number): string {
  const body = ydoc.getArray<Y.Map<unknown>>('body');
  const block = body.toArray().find(b => (b as Y.Map<unknown>).get('id') === blockId) as Y.Map<unknown>;
  const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
  return (runs.get(index) as Y.Map<unknown>).get('id') as string;
}

// ---------------------------------------------------------------------------
// appendParagraph
// ---------------------------------------------------------------------------

describe('appendParagraph', () => {
  it('adds a new empty paragraph block', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    appendParagraph(ydoc, 'attorney-a');
    const json = yDocToDocumentJson(ydoc);
    expect(json.body).toHaveLength(2);
    expect(json.body[1].kind).toBe('paragraph');
    expect((json.body[1] as DocxParagraph).inlines).toHaveLength(0);
  });

  it('returns a string id', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const id = appendParagraph(ydoc, 'attorney-a');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    appendParagraph(ydoc, 'attorney-a');
    expect(ref.origin).toBe('attorney-a');
  });
});

// ---------------------------------------------------------------------------
// insertRun
// ---------------------------------------------------------------------------

describe('insertRun', () => {
  it('inserts a plain text run at the given index', () => {
    const ydoc = documentJsonToYDoc(TWO_RUN_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = insertRun(ydoc, blockId, 1, 'INSERTED ', 'attorney-b');
    expect(typeof runId).toBe('string');
    const json = yDocToDocumentJson(ydoc);
    const para = json.body[0] as DocxParagraph;
    expect(para.inlines).toHaveLength(3);
    expect(para.inlines[0]).toMatchObject({ kind: 'run', text: 'hello ' });
    expect(para.inlines[1]).toMatchObject({ kind: 'run', text: 'INSERTED ' });
    expect(para.inlines[2]).toMatchObject({ kind: 'run', text: 'world' });
  });

  it('inserts at index 0 (prepend)', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    insertRun(ydoc, blockId, 0, 'PREFIX ', 'attorney-a');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    expect(para.inlines[0]).toMatchObject({ kind: 'run', text: 'PREFIX ' });
    expect(para.inlines[1]).toMatchObject({ kind: 'run', text: 'start' });
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    const blockId = firstBlockId(ydoc);
    insertRun(ydoc, blockId, 0, 'x', 'attorney-b');
    expect(ref.origin).toBe('attorney-b');
  });
});

// ---------------------------------------------------------------------------
// editRunText
// ---------------------------------------------------------------------------

describe('editRunText', () => {
  it('edits the text of an existing run', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    editRunText(ydoc, blockId, runId, 'start', 'updated', 'attorney-a');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    expect(para.inlines[0]).toMatchObject({ kind: 'run', text: 'updated' });
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    editRunText(ydoc, blockId, runId, 'start', 'changed', 'attorney-c');
    expect(ref.origin).toBe('attorney-c');
  });
});

// ---------------------------------------------------------------------------
// deleteBlock
// ---------------------------------------------------------------------------

describe('deleteBlock', () => {
  it('removes the block from the body', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    deleteBlock(ydoc, blockId, 'attorney-a');
    const json = yDocToDocumentJson(ydoc);
    expect(json.body).toHaveLength(0);
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    const blockId = firstBlockId(ydoc);
    deleteBlock(ydoc, blockId, 'attorney-a');
    expect(ref.origin).toBe('attorney-a');
  });
});

// ---------------------------------------------------------------------------
// splitParagraph
// ---------------------------------------------------------------------------

describe('splitParagraph', () => {
  it('splits at a character offset within a run', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC); // "start" is 5 chars
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    const newId = splitParagraph(ydoc, blockId, runId, 3, 'attorney-a'); // split "sta|rt"
    expect(typeof newId).toBe('string');
    const json = yDocToDocumentJson(ydoc);
    expect(json.body).toHaveLength(2);
    const p1 = json.body[0] as DocxParagraph;
    const p2 = json.body[1] as DocxParagraph;
    // First paragraph has text up to split point
    expect(p1.inlines[0]).toMatchObject({ kind: 'run', text: 'sta' });
    // Second paragraph has text from split point
    expect(p2.inlines[0]).toMatchObject({ kind: 'run', text: 'rt' });
  });

  it('splits at offset 0 — moves all runs to new paragraph', () => {
    const ydoc = documentJsonToYDoc(TWO_RUN_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    splitParagraph(ydoc, blockId, runId, 0, 'attorney-a');
    const json = yDocToDocumentJson(ydoc);
    expect(json.body).toHaveLength(2);
    // First paragraph is empty (split at start of first run, offset 0)
    const p1 = json.body[0] as DocxParagraph;
    expect(p1.inlines).toHaveLength(0);
    // Second paragraph has both original runs
    const p2 = json.body[1] as DocxParagraph;
    expect(p2.inlines).toHaveLength(2);
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    splitParagraph(ydoc, blockId, runId, 2, 'attorney-b');
    expect(ref.origin).toBe('attorney-b');
  });
});

// ---------------------------------------------------------------------------
// addTrackedInsertion
// ---------------------------------------------------------------------------

describe('addTrackedInsertion', () => {
  it('appends a tracked insertion run to the block', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = addTrackedInsertion(ydoc, blockId, 'newtext', 'attorney-a');
    expect(typeof runId).toBe('string');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    const ins = para.inlines.find(i => i.kind === 'insertion');
    expect(ins).toBeTruthy();
    expect(ins).toMatchObject({ kind: 'insertion' });
    if (ins?.kind === 'insertion') {
      expect(ins.meta.author).toBe('attorney-a');
      expect(ins.runs[0].text).toBe('newtext');
    }
  });

  it('sets a date string on the tracked insertion', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    addTrackedInsertion(ydoc, blockId, 'x', 'attorney-a');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    const ins = para.inlines.find(i => i.kind === 'insertion');
    if (ins?.kind === 'insertion') {
      expect(typeof ins.meta.date).toBe('string');
      expect(ins.meta.date.length).toBeGreaterThan(0);
    }
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    const blockId = firstBlockId(ydoc);
    addTrackedInsertion(ydoc, blockId, 'text', 'attorney-a');
    expect(ref.origin).toBe('attorney-a');
  });
});

// ---------------------------------------------------------------------------
// addTrackedDeletion
// ---------------------------------------------------------------------------

describe('addTrackedDeletion', () => {
  it('converts a plain run into a tracked deletion run', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const originalRunId = runIdAt(ydoc, blockId, 0);
    const delRunId = addTrackedDeletion(ydoc, blockId, originalRunId, 'attorney-b');
    expect(typeof delRunId).toBe('string');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    const del = para.inlines.find(i => i.kind === 'deletion');
    expect(del).toBeTruthy();
    if (del?.kind === 'deletion') {
      expect(del.meta.author).toBe('attorney-b');
      expect(del.runs[0].text).toBe('start');
    }
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const ref = captureOrigin(ydoc);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    addTrackedDeletion(ydoc, blockId, runId, 'attorney-b');
    expect(ref.origin).toBe('attorney-b');
  });
});

// ---------------------------------------------------------------------------
// resolveRevision
// ---------------------------------------------------------------------------

describe('resolveRevision — accept-insertion', () => {
  it('converts ins run to plain text run, collapsing subruns', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = addTrackedInsertion(ydoc, blockId, 'newtext', 'attorney-a');
    resolveRevision(ydoc, blockId, runId, 'accept', 'attorney-b');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    const accepted = para.inlines.find(i => i.kind === 'run' && (i as any).text === 'newtext');
    expect(accepted).toBeTruthy();
    // must no longer exist as insertion
    const stillIns = para.inlines.find(i => i.kind === 'insertion');
    expect(stillIns).toBeUndefined();
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = addTrackedInsertion(ydoc, blockId, 'newtext', 'attorney-a');
    const ref = captureOrigin(ydoc);
    resolveRevision(ydoc, blockId, runId, 'accept', 'attorney-b');
    expect(ref.origin).toBe('attorney-b');
  });
});

describe('resolveRevision — reject-insertion', () => {
  it('removes the ins run entirely', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = addTrackedInsertion(ydoc, blockId, 'newtext', 'attorney-a');
    resolveRevision(ydoc, blockId, runId, 'reject', 'attorney-b');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    const ins = para.inlines.find(i => i.kind === 'insertion');
    expect(ins).toBeUndefined();
    // original run should still be there
    expect(para.inlines[0]).toMatchObject({ kind: 'run', text: 'start' });
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = addTrackedInsertion(ydoc, blockId, 'x', 'attorney-a');
    const ref = captureOrigin(ydoc);
    resolveRevision(ydoc, blockId, runId, 'reject', 'attorney-b');
    expect(ref.origin).toBe('attorney-b');
  });
});

describe('resolveRevision — accept-deletion', () => {
  it('removes the del run entirely', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const originalRunId = runIdAt(ydoc, blockId, 0);
    const delRunId = addTrackedDeletion(ydoc, blockId, originalRunId, 'attorney-b');
    resolveRevision(ydoc, blockId, delRunId, 'accept', 'attorney-a');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    const del = para.inlines.find(i => i.kind === 'deletion');
    expect(del).toBeUndefined();
    // paragraph should now be empty (the del run was removed)
    expect(para.inlines).toHaveLength(0);
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    const delRunId = addTrackedDeletion(ydoc, blockId, runId, 'attorney-b');
    const ref = captureOrigin(ydoc);
    resolveRevision(ydoc, blockId, delRunId, 'accept', 'attorney-a');
    expect(ref.origin).toBe('attorney-a');
  });
});

describe('resolveRevision — reject-deletion', () => {
  it('restores text as a plain run, drops author/date', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const originalRunId = runIdAt(ydoc, blockId, 0);
    const delRunId = addTrackedDeletion(ydoc, blockId, originalRunId, 'attorney-b');
    resolveRevision(ydoc, blockId, delRunId, 'reject', 'attorney-a');
    const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
    // deletion should be gone
    const del = para.inlines.find(i => i.kind === 'deletion');
    expect(del).toBeUndefined();
    // text is restored as a plain run
    const restored = para.inlines.find(i => i.kind === 'run' && (i as any).text === 'start');
    expect(restored).toBeTruthy();
  });

  it('stamps the author as txn.origin', () => {
    const ydoc = documentJsonToYDoc(EMPTY_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = runIdAt(ydoc, blockId, 0);
    const delRunId = addTrackedDeletion(ydoc, blockId, runId, 'attorney-b');
    const ref = captureOrigin(ydoc);
    resolveRevision(ydoc, blockId, delRunId, 'reject', 'attorney-a');
    expect(ref.origin).toBe('attorney-a');
  });
});

// ---------------------------------------------------------------------------
// Plan-specified representative tests (from the plan's code snippet)
// ---------------------------------------------------------------------------

it('appendParagraph stamps the author origin and adds a block', () => {
  const ydoc = documentJsonToYDoc(EMPTY_DOC);
  let origin: unknown;
  ydoc.on('update', (_u: Uint8Array, o: unknown) => { origin = o; });
  const id = appendParagraph(ydoc, 'attorney-a');
  expect(typeof id).toBe('string');
  expect(origin).toBe('attorney-a');
  expect(yDocToDocumentJson(ydoc).body.length).toBe(2);
});

it('accept on a tracked insertion converts it to a plain run', () => {
  const ydoc = documentJsonToYDoc(EMPTY_DOC);
  const blockId = (ydoc.getArray('body').get(0) as Y.Map<unknown>).get('id') as string;
  const runId = addTrackedInsertion(ydoc, blockId, 'newtext', 'attorney-a');
  resolveRevision(ydoc, blockId, runId, 'accept', 'attorney-b');
  const para = yDocToDocumentJson(ydoc).body[0] as DocxParagraph;
  const accepted = para.inlines.find((r: DocxParagraph['inlines'][number]) => r.kind === 'run' && (r as any).text === 'newtext');
  expect(accepted).toBeTruthy();
});

// ---------------------------------------------------------------------------
// splitParagraph — mixed tracked-run paragraph
// ---------------------------------------------------------------------------

describe('splitParagraph — mixed tracked-run paragraph', () => {
  it('does not crash when afterRuns contain a tracked insertion and preserves tracked run kind+author', () => {
    // Build a doc: paragraph with [plainRun, trackedInsertionRun]
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [{
        kind: 'paragraph',
        inlines: [
          { kind: 'run', text: 'hello' },
          { kind: 'insertion', meta: { id: '1', author: 'alice', date: '2026-01-01T00:00:00Z' }, runs: [{ text: ' world' }] },
        ],
      }],
      comments: {},
    };
    const ydoc = documentJsonToYDoc(doc);
    const blockId = (ydoc.getArray('body').get(0) as Y.Map<unknown>).get('id') as string;
    const runs = (ydoc.getArray('body').get(0) as Y.Map<unknown>).get('runs') as Y.Array<Y.Map<unknown>>;
    const plainRunId = (runs.get(0) as Y.Map<unknown>).get('id') as string;

    // Split at offset 3 within the plain run (the tracked run is in afterRuns)
    expect(() => splitParagraph(ydoc, blockId, plainRunId, 3, 'attorney-a')).not.toThrow();

    const json = yDocToDocumentJson(ydoc);
    expect(json.body).toHaveLength(2);
    // Second paragraph should contain the tracked insertion with its author intact
    const p2 = json.body[1] as DocxParagraph;
    const trackedRun = p2.inlines.find(i => i.kind === 'insertion');
    expect(trackedRun).toBeTruthy();
    if (trackedRun?.kind === 'insertion') {
      expect(trackedRun.meta.author).toBe('alice');
    }
  });

  it('does not crash when the split-point run itself is a tracked insertion', () => {
    // Build a doc: paragraph with [trackedInsertionRun, plainRun]
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [{
        kind: 'paragraph',
        inlines: [
          { kind: 'insertion', meta: { id: '1', author: 'alice', date: '2026-01-01T00:00:00Z' }, runs: [{ text: 'tracked' }] },
          { kind: 'run', text: ' end' },
        ],
      }],
      comments: {},
    };
    const ydoc = documentJsonToYDoc(doc);
    const blockId = (ydoc.getArray('body').get(0) as Y.Map<unknown>).get('id') as string;
    const runs = (ydoc.getArray('body').get(0) as Y.Map<unknown>).get('runs') as Y.Array<Y.Map<unknown>>;
    // The split-point run is the tracked insertion at index 0
    const trackedRunId = (runs.get(0) as Y.Map<unknown>).get('id') as string;

    // Split at offset 3 of a non-text run — should not crash
    expect(() => splitParagraph(ydoc, blockId, trackedRunId, 3, 'attorney-a')).not.toThrow();

    const json = yDocToDocumentJson(ydoc);
    expect(json.body).toHaveLength(2);
    // The tracked run stays on original block (kept whole)
    const p1 = json.body[0] as DocxParagraph;
    const trackedOnP1 = p1.inlines.find(i => i.kind === 'insertion');
    expect(trackedOnP1).toBeTruthy();
  });
});
