import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '@/platform/audit/AuditService';
import type { AuditEntry } from '@/platform/types/audit';
import { useAcatsReviewStore } from './acatsReviewStore';
import { getAcatsReviewBlockingItems } from './reviewRules';
import type { AcatsTransferDraft } from './types';

function field<T>(value: T, confidence = 0.95) {
  return {
    value,
    confidence,
    source: {
      path: 'Clients/Hendricks/statement.pdf',
      page: 1,
      textSnippet: String(value),
      extraction: 'native-pdf' as const,
    },
  };
}

function draft(overrides: Partial<AcatsTransferDraft> = {}): AcatsTransferDraft {
  return {
    id: 'draft-1',
    matterId: 'matter-1',
    sourceStatementPath: 'Clients/Hendricks/statement.pdf',
    sourceStatementDate: field('2026-03-31'),
    deliveringFirm: {
      name: field('Wells Fargo Advisors'),
      normalizedName: 'wells-fargo-advisors',
    },
    deliveringAccount: {
      accountNumber: field('1234-5678'),
      accountTitle: field('Jamie Daines and Taylor Daines JTWROS'),
      registrationType: field('joint'),
      taxStatus: field('taxable'),
      owners: [field('Jamie Daines'), field('Taylor Daines')],
    },
    receivingSchwabAccount: {},
    instruction: {
      transferType: 'unknown',
    },
    assets: [
      {
        description: field('Apple Inc.'),
        symbol: field('AAPL'),
        cusip: field('037833100'),
        quantity: field('25'),
        marketValue: field('$4,750.00'),
        assetType: field('Equity'),
        action: 'unknown',
        warnings: [],
      },
    ],
    missingFields: ['Transfer type'],
    warnings: ['Account number is masked'],
    reviewStatus: 'needs_review',
    ...overrides,
  };
}

function savedAuditEntry(description = 'saved'): AuditEntry {
  return {
    id: 'audit-1',
    timestamp: '2026-07-10T12:00:00.000Z',
    action: 'acats.approve',
    description,
    model: undefined,
    inputs: {},
    outputs: {},
    userDecision: 'approved',
    metadata: { auditPersistenceStatus: 'saved' },
  };
}

function confirmReadyDraft(): void {
  for (const key of [
    'deliveringFirm.name',
    'deliveringAccount.accountNumber',
    'deliveringAccount.accountTitle',
    'deliveringAccount.registrationType',
    'sourceStatementDate',
    'instruction.transferType',
  ]) {
    useAcatsReviewStore.getState().confirmField(key);
  }
  useAcatsReviewStore.getState().setTransferType('full');
  useAcatsReviewStore.getState().acknowledgeWarning('Account number is masked');
}

describe('ACATS review store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAcatsReviewStore.getState().resetAcatsReview();
  });

  it('blocks approval until critical fields are confirmed and warnings acknowledged', async () => {
    const auditSpy = vi
      .spyOn(AuditService.prototype, 'mustLogDurable')
      .mockResolvedValue(savedAuditEntry('approved'));
    useAcatsReviewStore.getState().setDraft(draft());

    expect(useAcatsReviewStore.getState().isReadyForApproval()).toBe(false);
    expect(useAcatsReviewStore.getState().blockingItems()).toEqual(
      expect.arrayContaining(['Confirm delivering firm', 'Acknowledge warning: Account number is masked']),
    );

    confirmReadyDraft();

    expect(useAcatsReviewStore.getState().isReadyForApproval()).toBe(true);
    await useAcatsReviewStore.getState().approveDraft();
    expect(useAcatsReviewStore.getState().draft?.reviewStatus).toBe('approved');
    expect(auditSpy).toHaveBeenCalledWith(
      'acats.approve',
      expect.stringContaining('matter matter-1'),
      expect.objectContaining({ userDecision: 'approved' }),
    );
  });

  it('logs approval with a masked account number and never the full number in the description', async () => {
    const auditSpy = vi
      .spyOn(AuditService.prototype, 'mustLogDurable')
      .mockResolvedValue(savedAuditEntry('approved'));
    useAcatsReviewStore.getState().setDraft(draft());
    confirmReadyDraft();

    await useAcatsReviewStore.getState().approveDraft();

    const call = auditSpy.mock.calls[0];
    expect(call?.[0]).toBe('acats.approve');
    expect(call?.[1]).toContain('Wells Fargo Advisors');
    expect(call?.[1]).toContain('****5678');
    expect(call?.[1]).not.toContain('1234-5678');
  });

  it('does not approve the draft when the durable audit row cannot be saved', async () => {
    vi.spyOn(AuditService.prototype, 'mustLogDurable').mockRejectedValue(new Error('audit failed'));
    useAcatsReviewStore.getState().setDraft(draft());
    confirmReadyDraft();

    await expect(useAcatsReviewStore.getState().approveDraft()).rejects.toThrow('audit failed');

    expect(useAcatsReviewStore.getState().draft?.reviewStatus).toBe('needs_review');
  });

  it('records advisor edits with original extracted values still recoverable', () => {
    useAcatsReviewStore.getState().setDraft(draft());
    useAcatsReviewStore.getState().editField('deliveringAccount.accountNumber', '1234-5678-90');

    const state = useAcatsReviewStore.getState();
    expect(state.draft?.deliveringAccount.accountNumber?.value).toBe('1234-5678-90');
    expect(state.draft?.deliveringAccount.accountNumber?.source.extraction).toBe('advisor-edited');
    expect(state.originalFields['deliveringAccount.accountNumber']?.value).toBe('1234-5678');
  });

  it('requires each partial-transfer asset action to be confirmed', () => {
    const partial = draft({
      instruction: { transferType: 'partial' },
      missingFields: [],
      warnings: [],
    });

    const blocking = getAcatsReviewBlockingItems({
      draft: partial,
      confirmedFields: {
        'deliveringFirm.name': true,
        'deliveringAccount.accountNumber': true,
        'deliveringAccount.accountTitle': true,
        'deliveringAccount.registrationType': true,
        sourceStatementDate: true,
        'instruction.transferType': true,
      },
      acknowledgedWarnings: {},
    });

    expect(blocking).toContain('Choose transfer action for Apple Inc.');
  });
});
