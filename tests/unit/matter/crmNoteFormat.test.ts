import { describe, it, expect } from 'vitest';
import { splitNoteForCrm, buildDocNoteCrmWrite } from '@/features/matters/logic/crmNoteFormat';

describe('splitNoteForCrm', () => {
  it('splits the first line as title and the rest as body', () => {
    expect(splitNoteForCrm('Roth conversion review\nDiscussed timing for Q4.')).toEqual({
      title: 'Roth conversion review',
      body: 'Discussed timing for Q4.',
    });
  });

  it('reuses the single line as both title and body when there is no second line', () => {
    expect(splitNoteForCrm('Just one line')).toEqual({
      title: 'Just one line',
      body: 'Just one line',
    });
  });
});

// Coordinator review catch: `note:${matterId}` collapses every normal .docx
// note under the same client into indistinguishable provenance in the
// review card ("from: ...") and audit log — the real document path is what
// makes two separate notes distinguishable. MatterNotesEditor is exempt
// (one shared notes doc per matter, so `note:${matterId}` is already unique).
describe('buildDocNoteCrmWrite', () => {
  it('pins sourceRef to the document path, not the matter id', () => {
    const write = buildDocNoteCrmWrite(
      '/Clients/Webb/Meeting Notes 2026-06-24.docx',
      'matter-1',
      'Roth conversion review\nDiscussed timing for Q4.',
    );
    expect(write).toEqual({
      kind: 'note',
      matterId: 'matter-1',
      title: 'Roth conversion review',
      body: 'Discussed timing for Q4.',
      sourceRef: 'doc:/Clients/Webb/Meeting Notes 2026-06-24.docx',
    });
  });

  it('gives two different notes under the same matter distinct provenance', () => {
    const a = buildDocNoteCrmWrite('/Clients/Webb/Note A.docx', 'matter-1', 'Note A\nBody A');
    const b = buildDocNoteCrmWrite('/Clients/Webb/Note B.docx', 'matter-1', 'Note B\nBody B');
    expect(a?.sourceRef).not.toBe(b?.sourceRef);
  });

  it('returns null (nothing to queue) for a blank/table-only document with no extractable title', () => {
    expect(buildDocNoteCrmWrite('/Clients/Webb/Blank.docx', 'matter-1', '   ')).toBeNull();
  });
});
