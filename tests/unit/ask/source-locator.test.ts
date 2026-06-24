import { describe, expect, it } from 'vitest';
import { sourceLocator } from '@/features/ask/askHelpers';
import type { WorkspaceSource } from '@/platform/types/ai';

describe('sourceLocator', () => {
  it('uses the real PDF filename and page for citation labels', () => {
    const source: WorkspaceSource = {
      path: 'C:/ws/Northcrest/Clients/Hollings/Email - DAF grant request spring board meeting.pdf',
      chunkText: 'The client plans a DAF grant before the spring board meeting.',
      score: 0.92,
      paragraphIndex: 0,
      sourceType: 'pdf',
      pageNumber: 1,
    };

    expect(sourceLocator(source)).toBe(
      'Email - DAF grant request spring board meeting.pdf p. 1',
    );
  });
});
