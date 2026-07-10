import { beforeEach, describe, expect, it } from 'vitest';
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

describe('ACATS review store', () => {
  beforeEach(() => {
    useAcatsReviewStore.getState().resetAcatsReview();
  });

  it('blocks approval until critical fields are confirmed and warnings acknowledged', () => {
    useAcatsReviewStore.getState().setDraft(draft());

    expect(useAcatsReviewStore.getState().isReadyForApproval()).toBe(false);
    expect(useAcatsReviewStore.getState().blockingItems()).toEqual(
      expect.arrayContaining(['Confirm delivering firm', 'Acknowledge warning: Account number is masked']),
    );

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

    expect(useAcatsReviewStore.getState().isReadyForApproval()).toBe(true);
    useAcatsReviewStore.getState().approveDraft();
    expect(useAcatsReviewStore.getState().draft?.reviewStatus).toBe('approved');
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
