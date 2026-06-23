import { describe, it, expect } from 'vitest';
import { prioritizeByProfession } from '@/features/workflows/engine/prioritizeByProfession';
import type { WorkflowTemplate } from '@/platform/types/workflow';

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

// PIVOT-A5 — Advisor profession must exclude legal templates and feature advisor pack first.
describe('prioritizeByProfession — advisor (PIVOT-A5)', () => {
  const mixed = [
    tpl('weekly-review', 'planning'),
    tpl('deposition-contradiction-finder', 'legal'),
    tpl('annual-review-packet', 'advisors'),
    tpl('research-memo', 'research'),
    tpl('reg-bi-doc', 'advisors'),
    tpl('privilege-log-drafter', 'legal'),
    tpl('engagement-letter', 'tax'),
  ];

  it('starts with advisor templates when profession is advisor', () => {
    const out = prioritizeByProfession(mixed, 'advisor');
    const ids = out.map((t) => t.id);
    expect(ids[0]).toBe('annual-review-packet');
    expect(ids[1]).toBe('reg-bi-doc');
  });

  it('contains NO legal-pack templates for advisor', () => {
    const out = prioritizeByProfession(mixed, 'advisor');
    const legalIds = out.filter((t) => t.category === 'legal').map((t) => t.id);
    expect(legalIds).toEqual([]);
  });

  it('excludes DepositionContradictionFinder (and all legal) for advisor', () => {
    const out = prioritizeByProfession(mixed, 'advisor');
    expect(out.find((t) => t.id === 'deposition-contradiction-finder')).toBeUndefined();
    expect(out.find((t) => t.id === 'privilege-log-drafter')).toBeUndefined();
  });

  it('preserves non-legal non-advisor templates after the advisor pack', () => {
    const out = prioritizeByProfession(mixed, 'advisor');
    const ids = out.map((t) => t.id);
    // advisor templates first, then the rest in original order
    expect(ids).toEqual([
      'annual-review-packet',
      'reg-bi-doc',
      'weekly-review',
      'research-memo',
      'engagement-letter',
    ]);
  });

  it('does not mutate the input array for advisor', () => {
    const before = mixed.map((t) => t.id);
    prioritizeByProfession(mixed, 'advisor');
    expect(mixed.map((t) => t.id)).toEqual(before);
  });

  it('legal profession still gets legal templates (unchanged)', () => {
    const out = prioritizeByProfession(mixed, 'legal');
    const ids = out.map((t) => t.id);
    expect(ids[0]).toBe('deposition-contradiction-finder');
    expect(ids[1]).toBe('privilege-log-drafter');
    // all legal templates are present
    expect(out.filter((t) => t.category === 'legal')).toHaveLength(2);
  });
});
