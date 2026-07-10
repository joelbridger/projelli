import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '@/platform/types/audit';
import { setMatterAuditEmitterAsync } from '@/platform/matter/matterStore';
import { useAcatsReviewStore } from './acatsReviewStore';
import { getAcatsReviewBlockingItems } from './reviewRules';
import type { AcatsTransferDraft } from './types';

type AuditEntryInput = Omit<AuditEntry, 'id' | 'timestamp'>;

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

function savedAuditEntry(entry: AuditEntryInput): AuditEntry {
  return {
    id: 'audit-1',
    timestamp: '2026-07-10T12:00:00.000Z',
    ...entry,
    metadata: { ...entry.metadata, auditPersistenceStatus: 'saved' },
  };
}

function installSavedAuditEmitter() {
  const emitter = vi.fn((entry: AuditEntryInput) => Promise.resolve(savedAuditEntry(entry)));
  setMatterAuditEmitterAsync(emitter);
  return emitter;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    setMatterAuditEmitterAsync(null);
  });

  afterEach(() => {
    setMatterAuditEmitterAsync(null);
  });

  it('blocks approval until critical fields are confirmed and warnings acknowledged', async () => {
    const auditSpy = installSavedAuditEmitter();
    useAcatsReviewStore.getState().setDraft(draft());

    expect(useAcatsReviewStore.getState().isReadyForApproval()).toBe(false);
    expect(useAcatsReviewStore.getState().blockingItems()).toEqual(
      expect.arrayContaining(['Confirm delivering firm', 'Acknowledge warning: Account number is masked']),
    );

    confirmReadyDraft();

    expect(useAcatsReviewStore.getState().isReadyForApproval()).toBe(true);
    await useAcatsReviewStore.getState().approveDraft();
    expect(useAcatsReviewStore.getState().draft?.reviewStatus).toBe('approved');
    const auditedEntry = auditSpy.mock.calls[0]?.[0];
    expect(auditedEntry?.action).toBe('acats.approve');
    expect(auditedEntry?.userDecision).toBe('approved');
    expect(auditedEntry?.description).toContain('matter matter-1');
  });

  it('logs approval through the async Activity Log emitter with only a masked account number', async () => {
    const auditSpy = installSavedAuditEmitter();
    useAcatsReviewStore.getState().setDraft(draft());
    confirmReadyDraft();

    await useAcatsReviewStore.getState().approveDraft();

    const entry = auditSpy.mock.calls[0]?.[0];
    expect(entry?.action).toBe('acats.approve');
    expect(entry?.description).toContain('Wells Fargo Advisors');
    expect(entry?.description).toContain('****5678');
    expect(entry?.metadata).toMatchObject({
      auditMustPersist: true,
      deliveringAccountNumber: '****5678',
      reviewStatus: 'approved',
    });
    expect(JSON.stringify(entry)).not.toContain('1234-5678');
  });

  it('does not approve the draft when the durable audit row cannot be saved', async () => {
    setMatterAuditEmitterAsync(vi.fn().mockRejectedValue(new Error('audit failed')));
    useAcatsReviewStore.getState().setDraft(draft());
    confirmReadyDraft();

    await expect(useAcatsReviewStore.getState().approveDraft()).rejects.toThrow('audit failed');

    expect(useAcatsReviewStore.getState().draft?.reviewStatus).toBe('needs_review');
    expect(useAcatsReviewStore.getState().isApprovingDraft).toBe(false);
  });

  it('throws instead of approving when the async Activity Log emitter is unavailable', async () => {
    useAcatsReviewStore.getState().setDraft(draft());
    confirmReadyDraft();

    await expect(useAcatsReviewStore.getState().approveDraft()).rejects.toThrow(
      'ACATS audit emitter is not registered',
    );

    expect(useAcatsReviewStore.getState().draft?.reviewStatus).toBe('needs_review');
    expect(useAcatsReviewStore.getState().isApprovingDraft).toBe(false);
  });

  it('locks draft edits while the approval audit is still saving', async () => {
    const pendingAudit = deferred<AuditEntry>();
    const auditSpy = vi.fn((entry: AuditEntryInput) => {
      void entry;
      return pendingAudit.promise;
    });
    setMatterAuditEmitterAsync(auditSpy);
    useAcatsReviewStore.getState().setDraft(draft());
    confirmReadyDraft();
    useAcatsReviewStore.getState().setAssetAction(0, 'in_kind');

    const approval = useAcatsReviewStore.getState().approveDraft();

    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(useAcatsReviewStore.getState().isApprovingDraft).toBe(true);

    useAcatsReviewStore.getState().editField('deliveringFirm.name', 'Changed firm');
    useAcatsReviewStore.getState().editField('deliveringAccount.accountNumber', '9999-0000');
    useAcatsReviewStore.getState().confirmField('extra.confirmation');
    useAcatsReviewStore.getState().unconfirmField('deliveringFirm.name');
    useAcatsReviewStore.getState().acknowledgeWarning('New warning');
    useAcatsReviewStore.getState().unacknowledgeWarning('Account number is masked');
    useAcatsReviewStore.getState().setTransferType('partial');
    useAcatsReviewStore.getState().setAssetAction(0, 'liquidate');

    const lockedState = useAcatsReviewStore.getState();
    expect(lockedState.draft?.deliveringFirm.name?.value).toBe('Wells Fargo Advisors');
    expect(lockedState.draft?.deliveringAccount.accountNumber?.value).toBe('1234-5678');
    expect(lockedState.confirmedFields['deliveringFirm.name']).toBe(true);
    expect(lockedState.confirmedFields['extra.confirmation']).toBeUndefined();
    expect(lockedState.acknowledgedWarnings['Account number is masked']).toBe(true);
    expect(lockedState.acknowledgedWarnings['New warning']).toBeUndefined();
    expect(lockedState.draft?.instruction.transferType).toBe('full');
    expect(lockedState.draft?.assets[0]?.action).toBe('in_kind');

    const auditedEntry = auditSpy.mock.calls[0]?.[0];
    expect(auditedEntry).toBeDefined();
    if (!auditedEntry) throw new Error('Expected an ACATS approval audit row');
    pendingAudit.resolve(savedAuditEntry(auditedEntry));
    await approval;

    const finalDraft = useAcatsReviewStore.getState().draft;
    expect(finalDraft?.reviewStatus).toBe('approved');
    expect(finalDraft?.deliveringFirm.name?.value).toBe('Wells Fargo Advisors');
    expect(finalDraft?.deliveringAccount.accountNumber?.value).toBe('1234-5678');
    expect(finalDraft?.instruction.transferType).toBe('full');
    expect(finalDraft?.assets[0]?.action).toBe('in_kind');
    expect(auditedEntry.metadata).toMatchObject({
      auditMustPersist: true,
      deliveringFirm: finalDraft?.deliveringFirm.name?.value,
      deliveringAccountNumber: '****5678',
      assetCount: finalDraft?.assets.length,
      reviewStatus: 'approved',
    });
    expect(useAcatsReviewStore.getState().isApprovingDraft).toBe(false);
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
