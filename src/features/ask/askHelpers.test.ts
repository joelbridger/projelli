import { describe, expect, it } from 'vitest';
import type { RagHit } from '@/platform/utils/tauri-commands';
import {
  bindAnswerCitations,
  buildRecentAskSessions,
  sessionBelongsToWorkspace,
  filterHitsByScope,
} from './askHelpers';

function hit(overrides: Partial<RagHit> = {}): RagHit {
  return {
    path: 'Clients/Hollings Family/estate-tax-ilit.docx',
    chunkText: 'Estate tax exposure is about $8.89M and the ILIT should be reviewed.',
    score: 0.92,
    paragraphIndex: 4,
    sourceType: 'docx',
    ...overrides,
  };
}

describe('filterHitsByScope', () => {
  it('whole-practice scope passes hits through unchanged (scope never reaches retrieval anyway)', () => {
    const hits = [hit()];
    expect(filterHitsByScope(hits, 'whole-practice')).toEqual(hits);
  });
});

describe('bindAnswerCitations', () => {
  it('attaches a GROUNDED-but-UNVERIFIED citation when the model emits no marker but a retrieved hit supports the answer (B1)', () => {
    const result = bindAnswerCitations(
      'The total portfolio value is $50,200,000, and the revocable trust holds $18,750,000.',
      [
        hit({
          path: 'Clients/Hollings Family/client-map.md',
          chunkText:
            'The total portfolio value is $50,200,000. The Hollings Revocable Trust holds $18,750,000.',
          paragraphIndex: 12,
          id: 'chunk-client-map-12',
          matterId: 'hollings',
        }),
      ],
      'hollings',
    );

    expect(result.answer).toBe(
      'The total portfolio value is $50,200,000, and the revocable trust holds $18,750,000. {1}',
    );
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      n: 1,
      label: 'client-map.md',
      path: 'Clients/Hollings Family/client-map.md',
      excerpt: 'The total portfolio value is $50,200,000. The Hollings Revocable Trust holds $18,750,000.',
      // B1: a post-hoc fuzzy match is NOT "verified" — it is grounded (kept, so
      // the chip isn't removed) but shown "source found, not verified".
      verified: false,
      grounded: true,
      paragraphIndex: 12,
      id: 'chunk-client-map-12',
      matterId: 'hollings',
    });
  });

  it('marks an EXPLICIT in-scope model citation as verified (B1)', () => {
    const result = bindAnswerCitations(
      'The central issue is estate tax exposure and the ILIT. [estate-tax-ilit.docx paragraph 4]',
      [hit({ id: 'chunk-1', matterId: 'hollings' })],
      'hollings',
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      n: 1,
      // The model explicitly cited a retrieved chunk in the expected client —
      // this earns the green badge.
      verified: true,
      grounded: true,
    });
  });

  it('keeps an unsupported no-marker answer uncited', () => {
    const result = bindAnswerCitations(
      'The total portfolio value is $51,000,000, and the revocable trust holds $18,750,000.',
      [
        hit({
          path: 'Clients/Hollings Family/client-map.md',
          chunkText:
            'The total portfolio value is $50,200,000. The Hollings Revocable Trust holds $18,750,000.',
          paragraphIndex: 12,
          id: 'chunk-client-map-12',
          matterId: 'hollings',
        }),
      ],
      'hollings',
    );

    expect(result.answer).toBe(
      'The total portfolio value is $51,000,000, and the revocable trust holds $18,750,000.',
    );
    expect(result.citations).toEqual([]);
  });

  it('attaches a citation when the answer cites a retrieved source without newer verification metadata', () => {
    const result = bindAnswerCitations(
      'The central issue is estate tax exposure and the ILIT. [estate-tax-ilit.docx paragraph 4]',
      [hit()],
      'hollings',
    );

    expect(result.answer).toBe('The central issue is estate tax exposure and the ILIT. {1}');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      n: 1,
      label: 'estate-tax-ilit.docx',
      path: 'Clients/Hollings Family/estate-tax-ilit.docx',
      excerpt: 'Estate tax exposure is about $8.89M and the ILIT should be reviewed.',
      verified: true,
      paragraphIndex: 4,
    });
  });

  it('drops a citation when no retrieved source supports the cited locator', () => {
    const result = bindAnswerCitations(
      'The central issue is estate tax exposure. [estate-tax-ilit.docx paragraph 99]',
      [hit()],
      'hollings',
    );

    expect(result.answer).toBe('The central issue is estate tax exposure.');
    expect(result.citations).toEqual([]);
  });

  it('B2: locates the cited chunk by paragraph for a non-PDF file, not the first source of the same file', () => {
    // Two chunks from the SAME .docx (no pageNumber). A citation for paragraph 8
    // must resolve to paragraph 8's locator — before the fix, `undefined ===
    // undefined` on pageNumber matched the FIRST source (paragraph 1).
    const result = bindAnswerCitations(
      'See the funding terms. [estate-plan.docx paragraph 8]',
      [
        hit({ path: 'Clients/Webb/estate-plan.docx', chunkText: 'Intro paragraph.', paragraphIndex: 1, id: 'c1', matterId: 'webb' }),
        hit({ path: 'Clients/Webb/estate-plan.docx', chunkText: 'The ILIT is funded annually via Crummey gifts.', paragraphIndex: 8, id: 'c8', matterId: 'webb' }),
      ],
      'webb',
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.paragraphIndex).toBe(8);
    // The locator must point at paragraph 8, NOT the first (paragraph 1) source.
    expect(result.citations[0]?.locator).toBe('estate-plan.docx §8');
  });

  it('P2: prefers the exact paragraph chunk over an earlier chunk sharing the same page (transcript)', () => {
    // Two transcript chunks on the SAME page (45) but different paragraph
    // chunks with DIFFERENT line locators. A citation for chunk 2 must carry
    // chunk 2's locator, not the first same-page chunk's.
    const result = bindAnswerCitations(
      'The witness admitted the delay. [depo.txt paragraph 2]',
      [
        hit({ path: 'Clients/Webb/depo.txt', chunkText: 'Intro lines.', paragraphIndex: 1, pageNumber: 45, sourceType: 'transcript', locator: '45:1-45:10', id: 't1', matterId: 'webb' }),
        hit({ path: 'Clients/Webb/depo.txt', chunkText: 'I admit we were late.', paragraphIndex: 2, pageNumber: 45, sourceType: 'transcript', locator: '45:11-45:20', id: 't2', matterId: 'webb' }),
      ],
      'webb',
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.paragraphIndex).toBe(2);
    // The locator must be chunk 2's line range, NOT the first same-page chunk's.
    expect(result.citations[0]?.locator).toBe('Tr. 45:11-45:20');
  });

  it('does not verify a citation from a different matter', () => {
    const result = bindAnswerCitations(
      'The central issue is estate tax exposure. [estate-tax-ilit.docx paragraph 4]',
      [hit({ id: 'chunk-1', matterId: 'webb' })],
      'hollings',
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.verified).toBe(false);
    // B1: a cross-client citation is neither verified NOR grounded — it must
    // never read as "from your files" for the wrong client.
    expect(result.citations[0]?.grounded).toBe(false);
  });
});

describe('recent Ask sessions', () => {
  it('shows only sessions saved for the current workspace', () => {
    const sessions = {
      'ask-hollings': {
        messages: [{ role: 'user' as const, content: 'What is the ILIT issue?', timestamp: '2026-06-24T10:00:00.000Z' }],
        workspaceRoot: 'C:/Northcrest',
      },
      'ask-webb': {
        messages: [{ role: 'user' as const, content: 'What is the answer deadline in the Garcia case?', timestamp: '2026-06-24T09:00:00.000Z' }],
        workspaceRoot: 'C:/Old Legal Demo',
      },
      'ask-global': {
        messages: [{ role: 'user' as const, content: 'Legacy unscoped question', timestamp: '2026-06-23T09:00:00.000Z' }],
      },
    };

    expect(sessionBelongsToWorkspace(sessions['ask-hollings'], 'C:/Northcrest')).toBe(true);
    expect(sessionBelongsToWorkspace(sessions['ask-webb'], 'C:/Northcrest')).toBe(false);
    expect(sessionBelongsToWorkspace(sessions['ask-global'], 'C:/Northcrest')).toBe(false);

    expect(buildRecentAskSessions(sessions, 'C:/Northcrest').map((s) => s.label)).toEqual([
      'What is the ILIT issue?',
    ]);
  });

  it('keeps startup behavior unchanged before a workspace root is known', () => {
    const sessions = {
      'ask-global': {
        messages: [{ role: 'user' as const, content: 'Existing question', timestamp: '2026-06-24T09:00:00.000Z' }],
      },
    };

    expect(buildRecentAskSessions(sessions, null).map((s) => s.label)).toEqual(['Existing question']);
  });
});
