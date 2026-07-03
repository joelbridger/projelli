import { describe, it, expect } from 'vitest';
import { beneficiaryConsistency, beneficiaryGapQuestions } from './beneficiaryConsistency';
import type { EstateDocEvidence } from './estateDocs';

const src = (ref: string) => ({ kind: 'document' as const, ref, snippet: 's' });
const ev = (kind: EstateDocEvidence['kind'], parties: string[], ref: string, docDateIso: string | null = null): EstateDocEvidence =>
  ({ kind, parties, docDateIso, accountHint: null, source: src(ref), confidence: 'high' });

describe('beneficiaryConsistency', () => {
  it('MISMATCH when two estate sources name different beneficiaries', () => {
    const out = beneficiaryConsistency({
      estate: [ev('trust', ['Susan Henderson'], 'trust.pdf'), ev('beneficiary-designation', ['Karen Henderson'], 'ira.pdf')],
      accountMentions: [], lifeEvents: [],
    });
    expect(out).toHaveLength(1);
    const [first] = out;
    expect(first?.kind).toBe('MISMATCH');
    expect(first?.sources.map((s) => s.ref).sort()).toEqual(['ira.pdf', 'trust.pdf']);
    expect(first?.text).toContain('Susan Henderson');
    expect(first?.text).toContain('Karen Henderson');
  });
  it('STALE when a dated life event postdates the newest estate document', () => {
    const out = beneficiaryConsistency({
      estate: [ev('trust', ['Susan Henderson'], 'trust.pdf', '2019-03-04')],
      accountMentions: [],
      lifeEvents: [{ event: 'married', dateIso: '2024-06-14' }],
    });
    expect(out.some((f) => f.kind === 'STALE')).toBe(true);
  });
  it('MISSING when retirement/insurance accounts are mentioned but no designation doc exists', () => {
    const out = beneficiaryConsistency({
      estate: [],
      accountMentions: [{ account: 'rollover IRA', source: src('mail:42') }],
      lifeEvents: [],
    });
    expect(out.some((f) => f.kind === 'MISSING')).toBe(true);
  });
  it('stays silent when everything agrees (no findings on consistent evidence)', () => {
    const out = beneficiaryConsistency({
      estate: [ev('trust', ['Susan Henderson'], 'trust.pdf'), ev('beneficiary-designation', ['Susan Henderson'], 'ira.pdf')],
      accountMentions: [], lifeEvents: [],
    });
    expect(out).toHaveLength(0);
  });
});

describe('beneficiaryGapQuestions', () => {
  it('produces household-section gaps with the discriminator prefix and honest-limits line', () => {
    const gaps = beneficiaryGapQuestions([
      { kind: 'MISSING', text: 'A rollover IRA is mentioned but no beneficiary designation is on file.', sources: [src('mail:42')] },
    ]);
    const [first] = gaps;
    expect(first?.sectionKey).toBe('household');
    expect(first?.text.startsWith('Beneficiary check:')).toBe(true);
    expect(first?.text).toContain('Flagged for your review. Not legal advice.');
  });
});
