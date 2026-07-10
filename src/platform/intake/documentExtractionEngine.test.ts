import { describe, expect, it, vi } from 'vitest';
import { extractDocumentFacts } from './documentExtractionEngine';

describe('extractDocumentFacts', () => {
  it('uses code-owned identifiers and drops unsupported or restricted output', async () => {
    const provider = { structuredOutput: vi.fn().mockResolvedValue({ facts: [
      { fact_kind: 'income_annual', amount: 120000, currency: 'USD', page: 1, quote: 'Annual salary: $120,000', confidence: 'high' },
      { fact_kind: 'ssn', amount: 1, page: 1, quote: 'Annual salary: $120,000', confidence: 'high' },
      { fact_kind: 'spending_monthly', amount: 3000, page: 1, quote: 'Account number 123456789', confidence: 'high' },
    ] }) };
    const result = await extractDocumentFacts({ readResult: { status: 'read', pages: [{ page: 1, text: 'Annual salary: $120,000. Account number 123456789.', extraction: 'text' }] }, classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] }, matterId: 'matter-code', requestId: 'request-code', intakeId: 'intake-code', itemId: 'income', sourcePath: 'Clients/A/source.pdf', provider });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ matter_id: 'matter-code', request_id: 'request-code', intake_id: 'intake-code', item_id: 'income', fact_kind: 'income_annual' });
    expect(JSON.stringify(result)).not.toContain('123456789');
  });
});
