import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Provider } from '@/platform/providers/Provider';

import { extractDocumentFacts } from './documentExtractionEngine';
import { setIntakeDocumentExtractionAuditEmitter } from './documentExtractionAudit';

function providerWithFacts(facts: unknown[]): Provider {
  return {
    getMetadata: () => ({ model: 'test-model' }),
    sendMessage: vi.fn(),
    structuredOutput: vi.fn().mockResolvedValue({ facts }),
    formatAttachmentForRequest: vi.fn(),
    supportsAttachment: vi.fn(),
  };
}

describe('extractDocumentFacts', () => {
  afterEach(() => {
    setIntakeDocumentExtractionAuditEmitter(null);
  });

  it('uses code-owned identifiers and drops unsupported or restricted output', async () => {
    const provider = providerWithFacts([
      { fact_kind: 'income_annual', amount: 120000, currency: 'USD', page: 1, quote: 'Annual salary: $120,000', confidence: 'high' },
      { fact_kind: 'ssn', amount: 1, page: 1, quote: 'Annual salary: $120,000', confidence: 'high' },
      { fact_kind: 'spending_monthly', amount: 3000, page: 1, quote: 'Account number 123456789', confidence: 'high' },
    ]);

    const result = await extractDocumentFacts({
      readResult: {
        status: 'read',
        pages: [{ page: 1, text: `Annual salary: $120,000. ${'This statement is complete. '.repeat(10)}Account number 123456789.`, extraction: 'text' }],
      },
      classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] },
      matterId: 'matter-code',
      requestId: 'request-code',
      intakeId: 'intake-code',
      itemId: 'income',
      sourcePath: 'Clients/A/source.pdf',
      provider,
      providerId: 'test-provider',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ matter_id: 'matter-code', request_id: 'request-code', intake_id: 'intake-code', item_id: 'income', fact_kind: 'income_annual' });
    expect(JSON.stringify(result)).not.toContain('123456789');
  });

  it('keeps only exact money totals from a safe cited span', async () => {
    const provider = providerWithFacts([
      { fact_kind: 'income_annual', amount: 999999, currency: 'USD', page: 1, quote: 'Annual income: $120,000', confidence: 'high' },
      { fact_kind: 'income_annual', amount: 120000, currency: 'USD', page: 1, quote: 'Annual income: $120,000', confidence: 'high' },
      { fact_kind: 'spending_monthly', amount: 3000, currency: 'USD', page: 1, quote: 'Monthly spending: $3,000', confidence: 'high', reason: 'Reference 123 45 6789' },
      { fact_kind: 'spending_monthly', amount: 3000, currency: 'USD', page: 2, quote: 'Monthly spending: $3,000', confidence: 'high', reason: 'Printed total.' },
    ]);

    const result = await extractDocumentFacts({
      readResult: {
        status: 'read',
        pages: [
          { page: 1, text: `Annual income: $120,000. Monthly spending: $3,000. ${'A separate section follows. '.repeat(10)}Tax ID 12-3456789.`, extraction: 'text' },
          { page: 2, text: 'Monthly spending: $3,000. Acct # 123 45 6789.', extraction: 'text' },
        ],
      },
      classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] },
      matterId: 'matter-code',
      requestId: 'request-code',
      intakeId: 'intake-code',
      sourcePath: 'Clients/A/source.pdf',
      provider,
      providerId: 'test-provider',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.proposed_value).toEqual({ t: 'money', v: { amount: 120000, currency: 'USD' } });
  });

  it('records egress without putting document text or extracted values in the audit trail', async () => {
    const auditEntries: unknown[] = [];
    setIntakeDocumentExtractionAuditEmitter((entry) => {
      auditEntries.push(entry);
      return Promise.resolve();
    });

    await extractDocumentFacts({
      readResult: {
        status: 'read',
        pages: [{ page: 1, text: 'Annual income: $120,000.', extraction: 'text' }],
      },
      classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] },
      matterId: 'matter-code',
      requestId: 'request-code',
      intakeId: 'intake-code',
      sourcePath: 'Clients/A/source.pdf',
      provider: providerWithFacts([]),
      providerId: 'test-provider',
    });

    // Fold note: routing through the real promptPreparation layer adds one
    // more entry here - its own 'prompt_preparation' scrub receipt, logged
    // before the model call - on top of the pre-fold 'egress' + 'model_call'
    // pair. It carries only finding categories/counts and a decision enum,
    // never prompt content, so the no-leak assertions below still apply to
    // all three entries.
    expect(auditEntries).toHaveLength(3);
    const auditJson = JSON.stringify(auditEntries);
    expect(auditJson).toContain('"action":"egress"');
    expect(auditJson).toContain('"action":"model_call"');
    expect(auditJson).toContain('"action":"prompt_preparation"');
    expect(auditJson).toContain('"classifier":"document_extraction"');
    expect(auditJson).toContain('"matterId":"matter-code"');
    expect(auditJson).toContain('"requestId":"request-code"');
    expect(auditJson).not.toContain('120000');
    expect(auditJson).not.toContain('Annual income');
  });

  it('blocks extraction (never calls the provider) when the document text carries a secret', async () => {
    const structuredOutput = vi.fn().mockResolvedValue({ facts: [] });
    const provider = providerWithFacts([]);
    provider.structuredOutput = structuredOutput;

    // Background mode always blocks on a finding rather than opening a
    // dialog (this is unattended extraction work, not advisor-clicked) - the
    // plan requires the item be left for review, not silently skipped or
    // silently sent anyway.
    await expect(
      extractDocumentFacts({
        readResult: {
          status: 'read',
          pages: [{ page: 1, text: 'Annual income: $120,000. Account password: hunter2-super-secret.', extraction: 'text' }],
        },
        classification: { kind: 'pay_stub', confidence: 'high', sourceRefs: [], evidence: [] },
        matterId: 'matter-code',
        requestId: 'request-code',
        intakeId: 'intake-code',
        sourcePath: 'Clients/A/source.pdf',
        provider,
        providerId: 'test-provider',
      })
    ).rejects.toThrow('prompt_review_required');

    expect(structuredOutput).not.toHaveBeenCalled();
  });
});
