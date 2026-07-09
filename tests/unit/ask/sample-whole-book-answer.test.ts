import { describe, expect, it } from 'vitest';
import { buildSampleWholeBookAnswer } from '@/features/ask/book/sampleWholeBookAnswer';
import type { Matter } from '@/platform/types/matter';

describe('buildSampleWholeBookAnswer', () => {
  it('returns a grounded whole-book sample answer for the Hendricks demo client', () => {
    const matter = {
      id: 'matter-sample',
      name: 'The Hendricks Household',
      client: 'The Hendricks Household',
      folderPaths: ['/workspace'],
      isSample: true,
    } as Matter;

    const result = buildSampleWholeBookAnswer(matter);

    expect(result.model).toBe('Sample practice');
    expect(result.answer).toContain('Hendricks Household');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matterId).toBe('matter-sample');
    expect(result.matches[0]?.facts[0]?.text).toContain('Beneficiary');
    expect(result.matches[0]?.facts[0]?.source?.ref).toContain('/workspace/Sample - Beneficiary');
  });
});
