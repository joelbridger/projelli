import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/platform/utils/external-write-commands', async () => {
  const actual = await vi.importActual<typeof import('@/platform/utils/external-write-commands')>(
    '@/platform/utils/external-write-commands',
  );
  return {
    ...actual,
    externalWriteSaveProposal: vi.fn().mockResolvedValue(null),
    externalWritePrepareProposal: vi.fn().mockResolvedValue(null),
    externalWriteApproveProposal: vi.fn().mockResolvedValue({
      target: 'rightcapital',
      operation: 'rightcapital.upsert_income',
      remoteId: 'rc-income-1',
      deduped: false,
      receiptRef: 'external-write:m1:rightcapital:abc',
    }),
    externalWriteListProposals: vi.fn().mockResolvedValue([]),
    externalWriteDeleteProposal: vi.fn().mockResolvedValue(undefined),
  };
});

import { ExternalWriteReviewCard } from '@/features/planning/ExternalWriteReviewCard';
import { useExternalWriteQueueStore, type RightCapitalIncomeProposal } from '@/platform/state/externalWriteQueueStore';
import {
  externalWriteApproveProposal,
  externalWritePrepareProposal,
  externalWriteSaveProposal,
} from '@/platform/utils/external-write-commands';

function proposal(): RightCapitalIncomeProposal {
  return {
    target: 'rightcapital',
    kind: 'income',
    matterId: 'm1',
    rightCapitalHouseholdId: 'rc-household-1',
    existing: {
      incomeId: 'income-1',
      incomeType: 'Salary',
      owner: 'Robert',
      amount: 125000,
      frequency: 'annual',
    },
    fromSource: {
      incomeType: 'Salary',
      owner: 'Robert',
      amount: 185000,
      frequency: 'annual',
      confidence: 'high',
      quote: 'My salary is now $185,000.',
    },
    final: {
      incomeId: 'income-1',
      incomeType: 'Salary',
      owner: 'Robert',
      amount: 185000,
      frequency: 'annual',
      notes: 'Approved income update.',
    },
    sourceRef: 'meeting:income',
  };
}

beforeEach(() => {
  useExternalWriteQueueStore.setState({ items: [] });
  vi.mocked(externalWriteSaveProposal).mockClear();
  vi.mocked(externalWritePrepareProposal).mockClear();
  vi.mocked(externalWriteApproveProposal).mockClear();
  vi.mocked(externalWriteSaveProposal).mockResolvedValue(null);
  vi.mocked(externalWritePrepareProposal).mockResolvedValue(null);
  vi.mocked(externalWriteApproveProposal).mockResolvedValue({
    target: 'rightcapital',
    operation: 'rightcapital.upsert_income',
    remoteId: 'rc-income-1',
    deduped: false,
    receiptRef: 'external-write:m1:rightcapital:abc',
  });
});

describe('ExternalWriteReviewCard', () => {
  it('renders the RightCapital three-column review row', () => {
    useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());

    render(<ExternalWriteReviewCard matterId="m1" />);

    expect(screen.getByRole('button', { name: /update rightcapital/i })).toBeInTheDocument();
    expect(screen.getByText('Nothing is sent until you approve')).toBeInTheDocument();
    expect(screen.getByText('Current in RightCapital')).toBeInTheDocument();
    expect(screen.getByText('From this meeting/intake')).toBeInTheDocument();
    expect(screen.getByText('Will send')).toBeInTheDocument();
    expect(screen.getByText(/My salary is now \$185,000/)).toBeInTheDocument();
  });

  it('does not approve on mount, enqueue, or timer', async () => {
    vi.useFakeTimers();
    try {
      useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());
      render(<ExternalWriteReviewCard matterId="m1" />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(externalWriteSaveProposal).toHaveBeenCalledTimes(1);
      expect(externalWritePrepareProposal).not.toHaveBeenCalled();
      expect(externalWriteApproveProposal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('approves only after the explicit button click', async () => {
    const id = useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());
    render(<ExternalWriteReviewCard matterId="m1" />);

    fireEvent.click(screen.getByRole('button', { name: /update rightcapital/i }));

    await waitFor(() => {
      expect(externalWriteApproveProposal).toHaveBeenCalledTimes(1);
    });
    expect(externalWriteApproveProposal).toHaveBeenCalledWith(id);
    expect(screen.getByTestId(`external-write-status-${id}`).textContent).toContain('Receipt');
  });

  it('lets the advisor edit the Will send amount before approving', () => {
    const id = useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());
    render(<ExternalWriteReviewCard matterId="m1" />);

    fireEvent.change(screen.getByTestId(`external-income-final-amount-${id}`), {
      target: { value: '190000' },
    });

    const item = useExternalWriteQueueStore.getState().items[0];
    expect(item?.proposalType).toBe('rightcapital_income');
    if (item?.proposalType === 'rightcapital_income') {
      expect(item.data.final.amount).toBe(190000);
    }
  });
});
