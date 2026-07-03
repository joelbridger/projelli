import { describe, expect, it } from 'vitest';
import { chatToMarkdown, citationDisplayLabel } from '@/features/ask/renderingHelpers';
import type { AIChatFile } from '@/platform/types/ai';

describe('citationDisplayLabel', () => {
  it('distinguishes calendar vs calendly via path', () => {
    expect(
      citationDisplayLabel('evt-1', 0, 'meeting', undefined, undefined, undefined, undefined, 'calendar:evt-1:m-1'),
    ).toMatch(/^Calendar - /);
    expect(
      citationDisplayLabel('abc', 0, 'meeting', undefined, undefined, undefined, undefined, 'calendly:event:abc'),
    ).toMatch(/^Calendly - /);
  });

  it('defaults to Calendly when no path is available (pre-existing behavior preserved)', () => {
    expect(citationDisplayLabel('abc', 0, 'meeting')).toMatch(/^Calendly - /);
  });
});

function makeChat(messages: AIChatFile['messages']): AIChatFile {
  return {
    id: 'chat_1',
    title: 'Citation export',
    created: '2026-06-22T10:00:00.000Z',
    updated: '2026-06-22T10:05:00.000Z',
    messages,
  };
}

describe('chatToMarkdown', () => {
  it('exports assistant citation verification state', () => {
    const markdown = chatToMarkdown(
      makeChat([
        {
          role: 'assistant',
          content: 'Verified claim {1}. Unverified claim {2}.',
          timestamp: '2026-06-22T10:02:00.000Z',
          askCitations: [
            {
              n: 1,
              label: 'complaint.pdf p. 4',
              excerpt: 'The contract was signed on March 3.',
              path: 'Matter A/complaint.pdf',
              locator: 'p. 4',
              verified: true,
            },
            {
              n: 2,
              label: 'invented.pdf p. 9',
              excerpt: 'This quote was not found.',
              path: null,
              locator: 'p. 9',
              verified: false,
            },
          ],
          askSources: [
            {
              path: 'Matter A/complaint.pdf',
              chunkText: 'The contract was signed on March 3.',
              score: 0.95,
              paragraphIndex: 4,
              pageNumber: 4,
              verified: true,
            },
            {
              path: 'Matter A/invented.pdf',
              chunkText: 'This quote was not found.',
              score: 0.1,
              paragraphIndex: 9,
              pageNumber: 9,
              verified: false,
            },
          ],
        },
      ]),
    );

    expect(markdown).toContain('Sources and verification');
    expect(markdown).toContain('Source found');
    expect(markdown).toContain('complaint.pdf p. 4');
    expect(markdown).toContain('Matter A/complaint.pdf');
    expect(markdown).toContain('UNVERIFIED');
    expect(markdown).toContain('invented.pdf p. 9');
  });

  it('marks a citation UNVERIFIED when no saved source proves it', () => {
    const markdown = chatToMarkdown(
      makeChat([
        {
          role: 'assistant',
          content: 'Legacy claim {1}.',
          timestamp: '2026-06-22T10:02:00.000Z',
          askCitations: [
            {
              n: 1,
              label: 'legacy.pdf p. 2',
              excerpt: 'Persisted citation without a source.',
              path: 'Matter A/legacy.pdf',
              locator: 'p. 2',
              verified: true,
            },
          ],
        },
      ]),
    );

    expect(markdown).toContain('UNVERIFIED');
    expect(markdown).not.toContain('Source found');
  });

  it('exports verification for workspace citations stored on sources only', () => {
    const markdown = chatToMarkdown(
      makeChat([
        {
          role: 'assistant',
          content: 'Verified [complaint.pdf paragraph 4]. Unverified [invented.pdf paragraph 9].',
          timestamp: '2026-06-22T10:02:00.000Z',
          sources: [
            {
              path: 'Matter A/complaint.pdf',
              chunkText: 'The contract was signed on March 3.',
              score: 0.95,
              paragraphIndex: 4,
              verified: true,
            },
            {
              path: 'Matter A/invented.pdf',
              chunkText: 'This quote was not verified.',
              score: 0.1,
              paragraphIndex: 9,
              verified: false,
            },
          ],
        },
      ]),
    );

    expect(markdown).toContain('Sources and verification');
    expect(markdown).toContain('Source found');
    expect(markdown).toContain('complaint.pdf §4');
    expect(markdown).toContain('UNVERIFIED');
    expect(markdown).toContain('invented.pdf §9');
  });
});
