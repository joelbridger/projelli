import { describe, expect, it, vi } from 'vitest';
import { extractDocumentFacts } from './documentExtractionEngine';

describe('extractDocumentFacts', () => {
  it('uses code-owned identifiers and drops unsupported or restricted output', async () => {
    const provider = { structuredOutput: vi.fn().mockResolvedValue({ facts: [
      { fact_kind: 'income_annual', amount: 120000, currency: 'USD', page: 1, quote: 'Annual salary: $120,000', confidence: 'high' },
      { fact_kind: 'ssn', amount: 1, page: 1, quote: 'Annual salary: $120,000', confidence: 'high' },
      { fact_kind: 'spending_monthly', amount: 3000, page: 1, quote: 'Account number 123456789', confidence: 'high' },
    ] }) };
    const result = await extractDocumentFacts({ readResult: { status: 'read', pages: [{ page: 1, text: `Annual salary: $120,000. ${'This statement is complete. '.repeat(10)}Account number 123456789.`, extraction: 'text' }] }, classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] }, matterId: 'matter-code', requestId: 'request-code', intakeId: 'intake-code', itemId: 'income', sourcePath: 'Clients/A/source.pdf', provider });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ matter_id: 'matter-code', request_id: 'request-code', intake_id: 'intake-code', item_id: 'income', fact_kind: 'income_annual' });
    expect(JSON.stringify(result)).not.toContain('123456789');
  });

  it('keeps only exact money totals from a safe cited span', async () => {
    const provider = { structuredOutput: vi.fn().mockResolvedValue({ facts: [
      { fact_kind: 'income_annual', amount: 999999, currency: 'USD', page: 1, quote: 'Annual income: $120,000', confidence: 'high' },
      { fact_kind: 'income_annual', amount: 120000, currency: 'USD', page: 1, quote: 'Annual income: $120,000', confidence: 'high' },
      { fact_kind: 'spending_monthly', amount: 3000, currency: 'USD', page: 1, quote: 'Monthly spending: $3,000', confidence: 'high', reason: 'Reference 123 45 6789' },
      { fact_kind: 'spending_monthly', amount: 3000, currency: 'USD', page: 2, quote: 'Monthly spending: $3,000', confidence: 'high', reason: 'Printed total.' },
    ] }) };
    const result = await extractDocumentFacts({ readResult: { status: 'read', pages: [{ page: 1, text: `Annual income: $120,000. Monthly spending: $3,000. ${'A separate section follows. '.repeat(10)}Tax ID 12-3456789.`, extraction: 'text' }, { page: 2, text: 'Monthly spending: $3,000. Acct # 123 45 6789.', extraction: 'text' }] }, classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] }, matterId: 'matter-code', requestId: 'request-code', intakeId: 'intake-code', sourcePath: 'Clients/A/source.pdf', provider });
    expect(result).toHaveLength(1);
    expect(result[0]?.proposed_value).toEqual({ t: 'money', v: { amount: 120000, currency: 'USD' } });
  });
});
