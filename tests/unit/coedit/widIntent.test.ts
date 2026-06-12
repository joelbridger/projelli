/**
 * w:id allocation intent — Task 5 (part 3).
 *
 * Documents and asserts the contract that yDocToDocumentJson emits
 * tracked runs with meta.id === '' (empty string). keepance-docx serialize
 * is the single allocator for w:id (Task 12 verifies and, if needed, adds
 * a pre-save allocation pass using max_revision_id()+1). Downstream code
 * that hands this JSON to docx_save must NOT rely on meta.id being non-empty
 * from the CRDT layer.
 *
 * This test exists to make that contract explicit and regression-proof it.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
  addTrackedInsertion,
  addTrackedDeletion,
} from '@/modules/coedit/docCrdt';
import type { DocumentJson, DocxParagraph, DocxInlineInsertion, DocxInlineDeletion } from '@/types/docx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'Terms and conditions apply.' },
      ],
    },
  ],
  comments: {},
};

/** Fixture with an insertion and deletion already baked in at construction time. */
const TRACKED_FIXTURE: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'Plain run.' },
        {
          kind: 'insertion',
          meta: { id: '42', author: 'counsel-a', date: '2026-06-12T00:00:00Z' },
          runs: [{ text: 'inserted text' }],
        },
        {
          kind: 'deletion',
          meta: { id: '99', author: 'counsel-b', date: '2026-06-12T00:01:00Z' },
          runs: [{ text: 'deleted text' }],
        },
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

// ---------------------------------------------------------------------------
// Contract assertions
// ---------------------------------------------------------------------------

describe('w:id allocation intent — yDocToDocumentJson emits empty meta.id', () => {

  it('tracked insertion created by addTrackedInsertion emits meta.id === ""', () => {
    const ydoc = documentJsonToYDoc(BASE_DOC);
    const blockId = firstBlockId(ydoc);

    addTrackedInsertion(ydoc, blockId, 'new clause text', 'attorney-a');

    const json = yDocToDocumentJson(ydoc);
    const para = json.body[0] as DocxParagraph;
    const ins = para.inlines.find(i => i.kind === 'insertion') as DocxInlineInsertion | undefined;

    expect(ins).toBeTruthy();
    // THE CONTRACT: meta.id must be empty string so keepance-docx is the single allocator
    expect(ins!.meta.id).toBe('');
  });

  it('tracked deletion created by addTrackedDeletion emits meta.id === ""', () => {
    const ydoc = documentJsonToYDoc(BASE_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = firstRunId(ydoc, blockId);

    addTrackedDeletion(ydoc, blockId, runId, 'attorney-b');

    const json = yDocToDocumentJson(ydoc);
    const para = json.body[0] as DocxParagraph;
    const del = para.inlines.find(i => i.kind === 'deletion') as DocxInlineDeletion | undefined;

    expect(del).toBeTruthy();
    // THE CONTRACT: meta.id must be empty string
    expect(del!.meta.id).toBe('');
  });

  it('tracked runs from documentJsonToYDoc round-trip emit meta.id === "" (not the original w:id)', () => {
    // The original fixture has non-empty ids (42, 99) — they must become '' on output
    const ydoc = documentJsonToYDoc(TRACKED_FIXTURE);
    const json = yDocToDocumentJson(ydoc);
    const para = json.body[0] as DocxParagraph;

    const ins = para.inlines.find(i => i.kind === 'insertion') as DocxInlineInsertion | undefined;
    const del = para.inlines.find(i => i.kind === 'deletion') as DocxInlineDeletion | undefined;

    expect(ins).toBeTruthy();
    expect(del).toBeTruthy();

    // THE CONTRACT: original w:id (42, 99) must NOT flow through — keepance-docx re-allocates
    expect(ins!.meta.id).toBe('');
    expect(del!.meta.id).toBe('');
  });

  it('attribution (author + date) is preserved even though meta.id is empty', () => {
    const ydoc = documentJsonToYDoc(TRACKED_FIXTURE);
    const json = yDocToDocumentJson(ydoc);
    const para = json.body[0] as DocxParagraph;

    const ins = para.inlines.find(i => i.kind === 'insertion') as DocxInlineInsertion | undefined;
    const del = para.inlines.find(i => i.kind === 'deletion') as DocxInlineDeletion | undefined;

    // Author and date survive even though id is cleared
    expect(ins!.meta.author).toBe('counsel-a');
    expect(ins!.meta.date).toBe('2026-06-12T00:00:00Z');
    expect(del!.meta.author).toBe('counsel-b');
    expect(del!.meta.date).toBe('2026-06-12T00:01:00Z');
  });

  it('multiple tracked runs from both mutators all emit meta.id === ""', () => {
    const ydoc = documentJsonToYDoc(BASE_DOC);
    const blockId = firstBlockId(ydoc);
    const runId = firstRunId(ydoc, blockId);

    // Add three tracked insertions
    addTrackedInsertion(ydoc, blockId, 'alpha', 'attorney-a');
    addTrackedInsertion(ydoc, blockId, 'beta', 'attorney-b');
    // The run was converted to a deletion — get the run id before converting
    // (the original run: "Terms and conditions apply.")
    addTrackedDeletion(ydoc, blockId, runId, 'attorney-c');

    const json = yDocToDocumentJson(ydoc);
    const para = json.body[0] as DocxParagraph;

    const trackedRuns = para.inlines.filter(i => i.kind === 'insertion' || i.kind === 'deletion');
    expect(trackedRuns.length).toBe(3);

    for (const run of trackedRuns) {
      if (run.kind === 'insertion' || run.kind === 'deletion') {
        expect(run.meta.id, `run by ${run.meta.author} must have empty meta.id`).toBe('');
      }
    }
  });

  it('concurrent tracked insertions from different replicas all emit meta.id === "" after sync', () => {
    const a = documentJsonToYDoc(BASE_DOC);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const blockIdA = firstBlockId(a);
    const blockIdB = firstBlockId(b);

    addTrackedInsertion(a, blockIdA, ' [counsel A]', 'attorney-a');
    addTrackedInsertion(b, blockIdB, ' [counsel B]', 'attorney-b');

    // Sync
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    const json = yDocToDocumentJson(a);
    const para = json.body[0] as DocxParagraph;
    const insertions = para.inlines.filter(i => i.kind === 'insertion') as DocxInlineInsertion[];

    expect(insertions.length).toBe(2);
    for (const ins of insertions) {
      expect(ins.meta.id).toBe('');
    }
  });
});
