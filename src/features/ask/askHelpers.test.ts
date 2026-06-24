import { describe, expect, it } from 'vitest';
import type { RagHit } from '@/platform/utils/tauri-commands';
import {
  bindAnswerCitations,
  buildRecentAskSessions,
  sessionBelongsToWorkspace,
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

describe('bindAnswerCitations', () => {
  it('attaches a verified citation when the model emits no marker but a retrieved hit supports the answer', () => {
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
      verified: true,
      paragraphIndex: 12,
      id: 'chunk-client-map-12',
      matterId: 'hollings',
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

  it('does not verify a citation from a different matter', () => {
    const result = bindAnswerCitations(
      'The central issue is estate tax exposure. [estate-tax-ilit.docx paragraph 4]',
      [hit({ id: 'chunk-1', matterId: 'webb' })],
      'hollings',
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.verified).toBe(false);
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
