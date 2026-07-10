import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  useExternalWriteQueueStore,
  type HolistiplanUploadProposal,
  type RightCapitalIncomeProposal,
} from '@/platform/state/externalWriteQueueStore';
import {
  externalWriteApproveProposal,
  externalWriteDeleteProposal,
  externalWritePrepareProposal,
  externalWriteSaveProposal,
} from '@/platform/utils/external-write-commands';

function proposal(overrides: Partial<RightCapitalIncomeProposal> = {}): RightCapitalIncomeProposal {
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
    ...overrides,
  };
}

function holistiplanProposal(overrides: Partial<HolistiplanUploadProposal> = {}): HolistiplanUploadProposal {
  return {
    target: 'holistiplan',
    kind: 'tax_document_upload',
    matterId: 'm1',
    holistiplanHouseholdId: 'hp-household-1',
    documents: [
      {
        documentRef: 'Clients/Henderson/2025-return.pdf',
        displayName: '2025 tax return',
        taxYear: 2025,
        documentKind: 'tax_return',
        source: 'client_folder',
      },
    ],
    sourceRef: 'client-folder:tax-return',
    ...overrides,
  };
}

beforeEach(() => {
  useExternalWriteQueueStore.setState({ items: [] });
  vi.mocked(externalWriteSaveProposal).mockClear();
  vi.mocked(externalWritePrepareProposal).mockClear();
  vi.mocked(externalWriteApproveProposal).mockClear();
  vi.mocked(externalWriteDeleteProposal).mockClear();
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
describe('externalWriteQueueStore', () => {
  it('enqueue saves a proposed item but never sends', async () => {
    useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());

    expect(useExternalWriteQueueStore.getState().items).toHaveLength(1);
    expect(useExternalWriteQueueStore.getState().items[0]).toMatchObject({
      proposalType: 'rightcapital_income',
      status: 'proposed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(externalWriteSaveProposal).toHaveBeenCalledTimes(1);
    expect(externalWritePrepareProposal).not.toHaveBeenCalled();
    expect(externalWriteApproveProposal).not.toHaveBeenCalled();
  });

  it('a timer cannot send a queued proposal', async () => {
    vi.useFakeTimers();
    try {
      useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(externalWritePrepareProposal).not.toHaveBeenCalled();
      expect(externalWriteApproveProposal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('approve prepares the proposal, sends by id, and marks it sent', async () => {
    const id = useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());

    await useExternalWriteQueueStore.getState().approve([id]);

    expect(externalWritePrepareProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: id,
        subjectKey: 'rc-household-1',
        requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
    expect(externalWriteApproveProposal).toHaveBeenCalledTimes(1);
    expect(externalWriteApproveProposal).toHaveBeenCalledWith(id);
    expect(useExternalWriteQueueStore.getState().items[0]).toMatchObject({
      status: 'sent',
      remoteId: 'rc-income-1',
      receiptRef: 'external-write:m1:rightcapital:abc',
    });
  });

  it('verify-pending and stale errors map to reviewable statuses', async () => {
    vi.mocked(externalWriteApproveProposal).mockRejectedValueOnce(
      new Error('Delivery unconfirmed. Lantern will check before retrying.'),
    );
    const firstId = useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());
    await useExternalWriteQueueStore.getState().approve([firstId]);
    expect(useExternalWriteQueueStore.getState().items[0]?.status).toBe('verify_pending');

    vi.mocked(externalWriteApproveProposal).mockRejectedValueOnce(
      new Error('external value changed since proposal - current hash: abc'),
    );
    const secondId = useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal({ sourceRef: 'meeting:income-2' }));
    await useExternalWriteQueueStore.getState().approve([secondId]);
    expect(useExternalWriteQueueStore.getState().items[1]?.status).toBe('stale');
  });

  it('blocks send for an unmatched Holistiplan target instead of sending to a placeholder (codex-review, 2026-07-10)', async () => {
    // exactOptionalPropertyTypes forbids `holistiplanHouseholdId: undefined` on
    // a Partial<> override, so build the "neither field set" case directly
    // instead of trying to unset the helper's default household id.
    const unmatched: HolistiplanUploadProposal = {
      target: 'holistiplan',
      kind: 'tax_document_upload',
      matterId: 'm1',
      documents: [
        {
          documentRef: 'Clients/Henderson/2025-return.pdf',
          displayName: '2025 tax return',
          taxYear: 2025,
          documentKind: 'tax_return',
          source: 'client_folder',
        },
      ],
      sourceRef: 'client-folder:tax-return',
    };
    const id = useExternalWriteQueueStore.getState().enqueueHolistiplanUpload(unmatched);

    await useExternalWriteQueueStore.getState().approve([id]);

    expect(externalWriteApproveProposal).not.toHaveBeenCalled();
    expect(useExternalWriteQueueStore.getState().items[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Link this proposal'),
    });
  });

  it('blocks send for a multi-document Holistiplan upload instead of only sending the first document (codex-review, 2026-07-10)', async () => {
    const id = useExternalWriteQueueStore.getState().enqueueHolistiplanUpload(
      holistiplanProposal({
        documents: [
          {
            documentRef: 'Clients/Henderson/2025-return.pdf',
            displayName: '2025 tax return',
            taxYear: 2025,
            documentKind: 'tax_return',
            source: 'client_folder',
          },
          {
            documentRef: 'Clients/Henderson/2025-w2.pdf',
            displayName: '2025 W-2',
            taxYear: 2025,
            documentKind: 'w2',
            source: 'client_folder',
          },
        ],
      }),
    );

    await useExternalWriteQueueStore.getState().approve([id]);

    expect(externalWriteApproveProposal).not.toHaveBeenCalled();
    expect(useExternalWriteQueueStore.getState().items[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Multi-document'),
    });
  });

  it('dismiss removes the item without sending it', () => {
    const id = useExternalWriteQueueStore.getState().enqueueRightCapitalIncome(proposal());

    useExternalWriteQueueStore.getState().dismiss(id);

    expect(useExternalWriteQueueStore.getState().items).toHaveLength(0);
    expect(externalWriteDeleteProposal).toHaveBeenCalledWith(id);
    expect(externalWriteApproveProposal).not.toHaveBeenCalled();
  });
});
