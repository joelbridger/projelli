import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AcatsReviewScreen, AcatsTransferListRow } from './AcatsReviewScreen';
import { useAcatsReviewStore } from './acatsReviewStore';
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

function reviewDraft(): AcatsTransferDraft {
  return {
    id: 'draft-ui',
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
  };
}

function getInputByTestId(testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId);
  if (!(element instanceof HTMLInputElement)) {
    throw new TypeError(`Expected ${testId} to be an input`);
  }
  return element;
}

function getButtonByTestId(testId: string): HTMLButtonElement {
  const element = screen.getByTestId(testId);
  if (!(element instanceof HTMLButtonElement)) {
    throw new TypeError(`Expected ${testId} to be a button`);
  }
  return element;
}

describe('AcatsReviewScreen', () => {
  beforeEach(() => {
    useAcatsReviewStore.getState().resetAcatsReview();
  });

  it('masks account numbers in list rows but shows the full value in the review screen', () => {
    const draft = reviewDraft();
    render(<AcatsTransferListRow draft={draft} />);
    expect(screen.getByTestId('acats-list-row-account').textContent).toContain('****5678');
    expect(screen.getByTestId('acats-list-row-account').textContent).not.toContain('1234-5678');

    render(<AcatsReviewScreen draft={draft} />);
    expect(getInputByTestId('acats-field-account-number').value).toBe('1234-5678');
  });

  it('keeps approval disabled until critical fields and warnings are handled', () => {
    render(<AcatsReviewScreen draft={reviewDraft()} />);

    const approveButton = getButtonByTestId('acats-approve');
    expect(approveButton.disabled).toBe(true);

    for (const id of [
      'acats-confirm-deliveringFirm.name',
      'acats-confirm-deliveringAccount.accountNumber',
      'acats-confirm-deliveringAccount.accountTitle',
      'acats-confirm-deliveringAccount.registrationType',
      'acats-confirm-sourceStatementDate',
      'acats-confirm-instruction.transferType',
    ]) {
      fireEvent.click(screen.getByTestId(id));
    }
    fireEvent.change(screen.getByTestId('acats-transfer-type'), {
      target: { value: 'full' },
    });
    fireEvent.click(screen.getByTestId('acats-warning-Account number is masked'));

    expect(approveButton.disabled).toBe(false);
  });

  it('records edits and keeps the extracted value visible', () => {
    render(<AcatsReviewScreen draft={reviewDraft()} />);
    fireEvent.change(screen.getByTestId('acats-field-account-number'), {
      target: { value: '1234567890' },
    });

    const fieldPanel = screen.getByTestId('acats-review-field-deliveringAccount.accountNumber');
    expect(within(fieldPanel).getByText(/Original:/).textContent).toContain('1234-5678');
    expect(useAcatsReviewStore.getState().draft?.deliveringAccount.accountNumber?.source.extraction).toBe(
      'advisor-edited',
    );
  });
});
