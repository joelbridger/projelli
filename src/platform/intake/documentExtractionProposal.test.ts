import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptDocumentExtractionProposal } from './documentExtractionAccept';
import { setIntakeDocumentExtractionAuditEmitter } from './documentExtractionAudit';
import {
  clearInMemoryDocumentExtractionQueuesForTests,
  documentExtractionProposalGetForAccept,
  documentExtractionProposalList,
  documentExtractionProposalSave,
  documentExtractionStableKey,
  stableDocumentExtractionProposalId,
  type DocumentExtractionProposalInput,
  type DocumentExtractionProposalRecord,
} from './documentExtractionProposalStore';
import type { IntakeFactUpsertInput, MaskedClientFact } from './factsStore';
import {
  clearInMemoryFactsForTests,
  intakeFactList,
  intakeFactUpsert,
} from './factsStore';
import { documentExtractionProposalAcceptRow } from './documentExtractionProposalStore';

function input(): DocumentExtractionProposalInput {
  const ids = { matterId: 'matter-1', requestId: 'request-1', intakeId: 'intake-1', sourcePath: 'Clients/A/income.pdf' };
  return {
    proposalId: stableDocumentExtractionProposalId(ids),
    stableKey: documentExtractionStableKey(ids),
    ...ids,
    items: [
      { id: 'income-row', subject: 'primary', kind: 'income_annual', value: { t: 'money', v: { amount: 120000, currency: 'USD' } }, displayValue: 'USD 120000', sensitivity: 'confidential', source: { kind: 'document', path: ids.sourcePath, page: 2, snippet: 'Annual income: $120,000', extraction: 'text' }, confidence: 'high', reason: 'Printed annual income.', checkedByDefault: true },
      { id: 'low-row', subject: 'primary', kind: 'spending_monthly', value: { t: 'money', v: { amount: 2000, currency: 'USD' } }, displayValue: 'USD 2000', sensitivity: 'confidential', source: { kind: 'document', path: ids.sourcePath, page: 3, snippet: 'Monthly total: $2,000', extraction: 'text' }, confidence: 'low', reason: 'Printed total.', checkedByDefault: false },
    ],
  };
}

function proposalRecord(): DocumentExtractionProposalRecord {
  return {
    ...input(),
    status: 'pending',
    completedRows: [],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}

describe('document extraction proposal queue', () => {
  beforeEach(() => {
    clearInMemoryDocumentExtractionQueuesForTests();
    clearInMemoryFactsForTests();
  });

  afterEach(() => {
    setIntakeDocumentExtractionAuditEmitter(null);
  });

  it('is idempotent and masks list reads while keeping full review data behind a matching client check', async () => {
    await documentExtractionProposalSave(input());
    await documentExtractionProposalSave({ ...input(), proposalId: 'other' });

    const [listed] = await documentExtractionProposalList('matter-1');
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain('Annual income: $120,000');
    expect(listed?.items[0]?.value).toBeUndefined();
    expect(listed?.items[0]?.source.snippet).toBe('');
    await expect(documentExtractionProposalGetForAccept(input().proposalId, 'matter-2')).rejects.toThrow('not found');

    const full = await documentExtractionProposalGetForAccept(input().proposalId, 'matter-1');
    expect(full.items[0]?.source.snippet).toBe('Annual income: $120,000');
    expect(full.items[0]?.value).toBeDefined();
  });

  it('writes nothing before an explicit approval and requires intent audit before a fact', async () => {
    const proposal = proposalRecord();
    const upsert = vi.fn().mockResolvedValue({ fact_id: 'fact-1' } as MaskedClientFact);
    setIntakeDocumentExtractionAuditEmitter((entry) => entry.metadata['phase'] === 'intent'
      ? Promise.reject(new Error('audit offline'))
      : Promise.resolve());

    await expect(acceptDocumentExtractionProposal({
      proposalId: proposal.proposalId,
      selectedRowIds: ['income-row'],
      advisorId: 'advisor-1',
      getProposal: () => Promise.resolve(proposal),
      upsertFact: upsert,
    })).rejects.toThrow('audit offline');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes exact document provenance only after intent audit', async () => {
    const proposal = proposalRecord();
    proposal.items = proposal.items.map((item) => (
      item.id === 'income-row' ? { ...item, subject: 'spouse' } : item
    ));
    const order: string[] = [];
    const upsert = vi.fn<(input: IntakeFactUpsertInput) => Promise<MaskedClientFact>>(() => {
      order.push('fact');
      return Promise.resolve({ fact_id: 'fact-1' } as MaskedClientFact);
    });
    setIntakeDocumentExtractionAuditEmitter((entry) => {
      order.push(`audit:${String(entry.metadata['phase'])}`);
      return Promise.resolve();
    });

    await acceptDocumentExtractionProposal({
      proposalId: proposal.proposalId,
      selectedRowIds: ['income-row'],
      advisorId: 'advisor-1',
      getProposal: () => Promise.resolve(proposal),
      upsertFact: upsert,
      markRowCompleted: () => Promise.resolve(proposal),
      setProposalStatus: () => Promise.resolve(proposal),
    });

    expect(order).toEqual(['audit:intent', 'fact', 'audit:outcome']);
    const writtenFact = upsert.mock.calls[0]?.[0];
    expect(writtenFact).toBeDefined();
    expect(writtenFact?.verification).toBe('document_verified');
    expect(writtenFact?.subject).toBe('spouse');
    expect(writtenFact?.provenance.channel).toBe('doc_extraction');
    expect(writtenFact?.provenance.confirmed_by).toBe('advisor-1');
    expect(writtenFact?.provenance.entered_by).toBe('advisor-1');
    expect(writtenFact?.provenance.source_ref).toContain('document:v1:');
  });

  it('files a spouse document fact under the spouse without superseding the primary fact in the browser fallback', async () => {
    const proposal = input();
    proposal.items = proposal.items.map((item) => (
      item.id === 'income-row' ? { ...item, subject: 'spouse' } : item
    ));
    await documentExtractionProposalSave(proposal);
    const primary = await intakeFactUpsert({
      fact_id: 'primary-income',
      matter_id: proposal.matterId,
      subject: 'primary',
      kind: 'income_annual',
      value: { t: 'money', v: { amount: 110000, currency: 'USD' } },
      sensitivity: 'confidential',
      provenance: { channel: 'manual', entered_by: 'advisor-1', at: '2026-07-10T00:00:00.000Z' },
      verification: 'advisor_confirmed',
    });

    const accepted = await documentExtractionProposalAcceptRow({
      proposalId: proposal.proposalId,
      matterId: proposal.matterId,
      rowId: 'income-row',
      amount: 120000,
      expectedActiveFactId: null,
      expectedActiveFactChecked: true,
      advisorId: 'advisor-1',
    });

    expect(accepted.fact.subject).toBe('spouse');
    await expect(intakeFactList(proposal.matterId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ fact_id: primary.fact_id, subject: 'primary', status: 'active' }),
      expect.objectContaining({ fact_id: accepted.fact.fact_id, subject: 'spouse', status: 'active' }),
    ]));
  });

  it('refuses an off-contract final value before any fact write', async () => {
    const proposal = proposalRecord();
    const upsert = vi.fn();

    await expect(acceptDocumentExtractionProposal({
      proposalId: proposal.proposalId,
      selectedRowIds: ['income-row'],
      advisorId: 'advisor-1',
      finalValues: { 'income-row': { t: 'string', v: 'not money' } },
      getProposal: () => Promise.resolve(proposal),
      upsertFact: upsert,
    })).rejects.toThrow('money amount');
    expect(upsert).not.toHaveBeenCalled();
  });
});
