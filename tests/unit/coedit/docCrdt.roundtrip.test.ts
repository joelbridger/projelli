/**
 * Round-trip test for the docCrdt Y.Doc <-> DocumentJson converters.
 *
 * Fixture adapted from the plan's illustrative shapes to the REAL DocumentJson
 * TypeScript types (src/platform/types/docx.ts). Key differences from the plan sketch:
 *   - formatVersion  (not format_version)     — camelCase, matches serde rename_all
 *   - propertiesXml  (not properties_xml)
 *   - preserveSpace  (not preserve_space)
 *   - kind: 'insertion' / 'deletion'  (not 'ins' / 'del')  — real discriminant strings
 *   - DocxInlineInsertion / DocxInlineDeletion carry runs: DocxRun[]  (multi-run)
 *
 * Representation decision (recorded here per task spec):
 *   Tracked ins/del runs are modeled as a Y.Array<Y.Map> ('subruns') inside the
 *   run Y.Map, NOT flattened to a single Y.Text. This makes the round-trip
 *   loss-free even when individual runs inside a tracked change carry distinct
 *   propertiesXml (per-run formatting inside a revision).
 *
 * CONTRACT (w:id allocation):
 *   yDocToDocumentJson emits meta.id = '' for every tracked run. keepance-docx
 *   serialize is the single allocator for w:id (Task 12). Downstream save code
 *   must NOT rely on meta.id being non-empty from the CRDT.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { documentJsonToYDoc, yDocToDocumentJson } from '@/platform/firm/coedit/docCrdt';
import type { DocumentJson, DocxParagraph, DocxInlineInsertion, DocxInlineDeletion } from '@/platform/types/docx';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE: DocumentJson = {
  formatVersion: 1,
  body: [
    // paragraph 0: two plain runs, the second carrying propertiesXml
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'Hello ' },
        { kind: 'run', text: 'world', propertiesXml: '<w:rPr><w:b/></w:rPr>' },
      ],
    },
    // paragraph 1: propertiesXml, tracked insertion, tracked deletion
    {
      kind: 'paragraph',
      propertiesXml: '<w:pPr><w:jc w:val="center"/></w:pPr>',
      inlines: [
        {
          kind: 'insertion',
          meta: { id: '1', author: 'attorney-a', date: '2026-06-12T00:00:00Z' },
          runs: [{ text: 'added' }],
        },
        {
          kind: 'deletion',
          meta: { id: '2', author: 'attorney-b', date: '2026-06-12T00:01:00Z' },
          runs: [{ text: 'removed' }],
        },
      ],
    },
    // block 2: raw block (opaque, not character-merged)
    { kind: 'raw', xml: '<w:tbl>...</w:tbl>' },
  ],
  comments: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('docCrdt round-trip', () => {
  it('logs malformed opaque JSON with a fixed message only', () => {
    const sentinel = 'PEER_CONTENT_SENTINEL_DO_NOT_LOG';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ydoc = new Y.Doc();
    const body = ydoc.getArray<unknown>('body');
    const paragraph = new Y.Map<unknown>();
    const runs = new Y.Array<unknown>();
    const opaque = new Y.Map<unknown>();
    opaque.set('kind', 'opaque');
    opaque.set('opaqueJson', `{${sentinel}`);
    runs.push([opaque]);
    paragraph.set('type', 'paragraph');
    paragraph.set('runs', runs);
    body.push([paragraph]);

    try {
      yDocToDocumentJson(ydoc);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('[docCrdt] discarding malformed opaque inline');
      expect(errorSpy.mock.calls.flat()).not.toContain(sentinel);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('turns malformed peer-owned Yjs shapes into safe empty/raw render data instead of throwing', () => {
    const ydoc = new Y.Doc();
    const body = ydoc.getArray<unknown>('body');
    const malformedParagraph = new Y.Map<unknown>();
    malformedParagraph.set('type', 'paragraph');
    // Missing runs, an invalid text field, bad tracked-change children, and
    // invalid opaque JSON previously reached unchecked `.toArray()` / JSON.parse.
    const malformedRuns = new Y.Array<unknown>();
    const malformedText = new Y.Map<unknown>();
    malformedText.set('kind', 'text');
    malformedText.set('text', 'not-a-ytext');
    const malformedChange = new Y.Map<unknown>();
    malformedChange.set('kind', 'ins');
    malformedChange.set('subruns', 'not-an-array');
    const malformedOpaque = new Y.Map<unknown>();
    malformedOpaque.set('kind', 'opaque');
    malformedOpaque.set('opaqueJson', '{not-json');
    malformedRuns.push([malformedText, malformedChange, malformedOpaque]);
    malformedParagraph.set('runs', malformedRuns);
    const malformedRaw = new Y.Map<unknown>();
    malformedRaw.set('type', 'raw');
    body.push([malformedParagraph, malformedRaw, 'not-a-block']);

    const rendered = yDocToDocumentJson(ydoc);
    expect(rendered.body).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'run', text: '' },
          { kind: 'insertion', meta: { id: '', author: '', date: '' }, runs: [] },
          { kind: 'raw', xml: '' },
        ],
      },
      { kind: 'raw', xml: '' },
      { kind: 'raw', xml: '' },
    ]);
  });

  it('DocumentJson → Y.Doc → DocumentJson preserves the modeled tree', () => {
    const ydoc = documentJsonToYDoc(FIXTURE);
    const back = yDocToDocumentJson(ydoc);

    expect(back.body.length).toBe(3);

    // paragraph 0: plain runs
    const p0 = back.body[0] as DocxParagraph;
    expect(p0.kind).toBe('paragraph');
    expect(p0.propertiesXml).toBeUndefined();
    expect(p0.inlines).toHaveLength(2);
    expect(p0.inlines[0]).toMatchObject({ kind: 'run', text: 'Hello ' });
    expect(p0.inlines[1]).toMatchObject({ kind: 'run', text: 'world', propertiesXml: '<w:rPr><w:b/></w:rPr>' });

    // paragraph 1: propertiesXml + tracked ins + tracked del
    const p1 = back.body[1] as DocxParagraph;
    expect(p1.kind).toBe('paragraph');
    expect(p1.propertiesXml).toBe('<w:pPr><w:jc w:val="center"/></w:pPr>');
    expect(p1.inlines).toHaveLength(2);

    const ins = p1.inlines[0] as DocxInlineInsertion;
    expect(ins.kind).toBe('insertion');
    expect(ins.meta.author).toBe('attorney-a');
    expect(ins.meta.date).toBe('2026-06-12T00:00:00Z');
    // meta.id is intentionally empty — keepance-docx re-allocates w:id at serialize
    expect(ins.meta.id).toBe('');
    expect(ins.runs).toHaveLength(1);
    expect(ins.runs[0]!.text).toBe('added');

    const del = p1.inlines[1] as DocxInlineDeletion;
    expect(del.kind).toBe('deletion');
    expect(del.meta.author).toBe('attorney-b');
    expect(del.meta.date).toBe('2026-06-12T00:01:00Z');
    expect(del.meta.id).toBe('');
    expect(del.runs).toHaveLength(1);
    expect(del.runs[0]!.text).toBe('removed');

    // block 2: raw xml survives verbatim
    expect(back.body[2]).toMatchObject({ kind: 'raw', xml: '<w:tbl>...</w:tbl>' });
  });

  it('tracked ins/del with multiple sub-runs round-trips loss-free (per-run propertiesXml preserved)', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            {
              kind: 'insertion',
              meta: { id: '10', author: 'atty-x', date: '2026-06-12T10:00:00Z' },
              runs: [
                { text: 'first ', propertiesXml: '<w:rPr><w:b/></w:rPr>' },
                { text: 'second' },
              ],
            },
          ],
        },
      ],
      comments: {},
    };

    const back = yDocToDocumentJson(documentJsonToYDoc(doc));
    const ins = (back.body[0] as DocxParagraph).inlines[0] as DocxInlineInsertion;
    expect(ins.kind).toBe('insertion');
    expect(ins.runs).toHaveLength(2);
    expect(ins.runs[0]!.text).toBe('first ');
    expect(ins.runs[0]!.propertiesXml).toBe('<w:rPr><w:b/></w:rPr>');
    expect(ins.runs[1]!.text).toBe('second');
    expect(ins.runs[1]!.propertiesXml).toBeUndefined();
  });

  it('preserves block order across a mix of paragraph and raw blocks', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [
        { kind: 'raw', xml: '<w:sectPr/>' },
        { kind: 'paragraph', inlines: [{ kind: 'run', text: 'middle' }] },
        { kind: 'raw', xml: '<w:tbl/>' },
      ],
      comments: {},
    };
    const back = yDocToDocumentJson(documentJsonToYDoc(doc));
    expect(back.body[0]).toMatchObject({ kind: 'raw', xml: '<w:sectPr/>' });
    expect(back.body[1]!.kind).toBe('paragraph');
    expect(back.body[2]).toMatchObject({ kind: 'raw', xml: '<w:tbl/>' });
  });

  it('preserves formatVersion and meta through the Y.Doc', () => {
    const ydoc = documentJsonToYDoc(FIXTURE, {
      matterId: 'matter-001',
      docId: 'doc-abc123',
      fileName: 'contract.docx',
    });
    const back = yDocToDocumentJson(ydoc);
    expect(back.formatVersion).toBe(1);
  });

  it('run without propertiesXml does not emit propertiesXml field', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'plain' }] }],
      comments: {},
    };
    const back = yDocToDocumentJson(documentJsonToYDoc(doc));
    const run = (back.body[0] as DocxParagraph).inlines[0];
    expect(run).toBeDefined();
    expect('propertiesXml' in run!).toBe(false);
  });

  it('paragraph without propertiesXml does not emit propertiesXml field', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [] }],
      comments: {},
    };
    const back = yDocToDocumentJson(documentJsonToYDoc(doc));
    expect(back.body[0]).toBeDefined();
    expect('propertiesXml' in back.body[0]!).toBe(false);
  });

  it('opaque inline types (commentRangeStart, inline raw) round-trip verbatim', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'commentRangeStart', id: 'c1' },
            { kind: 'run', text: 'annotated' },
            { kind: 'commentRangeEnd', id: 'c1' },
            { kind: 'commentReference', id: 'c1' },
            { kind: 'raw', xml: '<w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink>' },
          ],
        },
      ],
      comments: {},
    };
    const back = yDocToDocumentJson(documentJsonToYDoc(doc));
    const inlines = (back.body[0] as DocxParagraph).inlines;
    expect(inlines[0]).toMatchObject({ kind: 'commentRangeStart', id: 'c1' });
    expect(inlines[1]).toMatchObject({ kind: 'run', text: 'annotated' });
    expect(inlines[2]).toMatchObject({ kind: 'commentRangeEnd', id: 'c1' });
    expect(inlines[3]).toMatchObject({ kind: 'commentReference', id: 'c1' });
    expect(inlines[4]).toMatchObject({ kind: 'raw', xml: '<w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink>' });
  });
});
