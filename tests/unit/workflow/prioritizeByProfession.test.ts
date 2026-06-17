import { describe, it, expect } from 'vitest';
import { prioritizeByProfession } from '@/features/workflows/engine/prioritizeByProfession';
import type { WorkflowTemplate } from '@/types/workflow';

// Minimal template factory — only the fields the helper reads matter.
function tpl(id: string, category: WorkflowTemplate['category']): WorkflowTemplate {
  return {
    id,
    name: id,
    description: id,
    version: '1.0.0',
    category,
    steps: [],
    requiredInputs: [],
    outputs: [],
  } as WorkflowTemplate;
}

describe('prioritizeByProfession (PIVOT-16)', () => {
  const list = [
    tpl('weekly-review', 'planning'),
    tpl('depo-finder', 'legal'),
    tpl('competitor', 'research'),
    tpl('privilege-log', 'legal'),
    tpl('engagement-letter', 'tax'),
  ];

  it('floats the matching-profession pack to the top, preserving relative order', () => {
    const out = prioritizeByProfession(list, 'legal');
    expect(out.map((t) => t.id)).toEqual([
      'depo-finder',
      'privilege-log', // both legal, original order kept
      'weekly-review',
      'competitor',
      'engagement-letter', // non-legal, original order kept
    ]);
  });

  it('works for tax', () => {
    const out = prioritizeByProfession(list, 'tax');
    expect(out[0]!.id).toBe('engagement-letter');
  });

  it("leaves the list untouched for 'other'", () => {
    const out = prioritizeByProfession(list, 'other');
    expect(out).toBe(list); // same reference, no reordering
  });

  it('returns the original array when no template matches the profession', () => {
    const onlyGeneral = [tpl('a', 'planning'), tpl('b', 'research')];
    const out = prioritizeByProfession(onlyGeneral, 'consulting');
    expect(out).toBe(onlyGeneral);
  });

  it('does not mutate the input array', () => {
    const before = list.map((t) => t.id);
    prioritizeByProfession(list, 'legal');
    expect(list.map((t) => t.id)).toEqual(before);
  });
});
