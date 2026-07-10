import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoutedIntakeSubmission } from './IntakeSyncClient';
import type { IntakeFactUpsertInput } from './factsStore';
import { useIntakeStore, type IntakeRecord } from './intakeStore';
import {
  bindIntakeRelayInbox,
  discoverGrantedIntakes,
  routeIntakeSubmission,
} from './useIntakeInboxSync';
import { useMatterStore } from '@/platform/matter/matterStore';

const enc = new TextEncoder();

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    items: [{ itemId: 'ssn', label: 'Social Security number', state: 'not_started' }],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    ...overrides,
  };
}

function routedSubmission(
  body: unknown,
  overrides: Partial<{
    itemId: string;
    submissionId: string;
    submittedAt: string;
    contentType: string;
    fileNames: string[];
    plaintextBytes: Uint8Array[];
    documentDetective: RoutedIntakeSubmission['manifest']['document_detective'];
  }> = {},
): RoutedIntakeSubmission {
  const itemId = overrides.itemId ?? 'ssn';
  const submissionId = overrides.submissionId ?? 'submission-1';
  const plaintextBytes = overrides.plaintextBytes ?? [enc.encode(JSON.stringify(body))];
  return {
    intakeId: 'intake-1',
    itemId,
    submissionId,
    submittedAt: overrides.submittedAt ?? '2026-07-10T10:00:00.000Z',
    manifest: {
      submission_id: submissionId,
      item_id: itemId,
      content_type: overrides.contentType ?? 'application/json',
      file_names: overrides.fileNames ?? [],
      chunk_hashes: ['hash'],
      chunk_count: plaintextBytes.length,
      ...(overrides.documentDetective === undefined ? {} : { document_detective: overrides.documentDetective }),
    },
    plaintextBytes,
  };
}

function maskedFact(input: IntakeFactUpsertInput, factId: string) {
  return {
    fact_id: factId,
    matter_id: input.matter_id,
    subject: input.subject,
    kind: input.kind,
    sensitivity: input.sensitivity,
    display_value: 'stored',
    provenance: input.provenance,
    verification: input.verification,
    status: 'active' as const,
  };
}

describe('useIntakeInboxSync wiring helpers', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    useMatterStore.setState({ matters: [] });
  });

  it('discovers a granted intake missing from local state, obtains its key, and makes it syncable', async () => {
    const obtainKey = vi.fn().mockResolvedValue({} as CryptoKey);
    const localMatter = useMatterStore.getState().createMatter({
      name: 'Shared household',
      client: '',
      shared: true,
      firmMatterId: 'firm-matter-1',
      folderPaths: ['/workspace/shared-household'],
    });
    const relay = { listGrantedIntakes: vi.fn().mockResolvedValue({
      intakes: [{ intake_id: 'granted-intake', matter_id: 'firm-matter-1', epoch: 2 }],
    }) };

    await discoverGrantedIntakes({
      relay,
      deviceId: 'device-1',
      firmClient: {} as never,
      seatToken: 'seat-token',
      obtainKey,
    });

    expect(relay.listGrantedIntakes).toHaveBeenCalledWith('device-1');
    expect(obtainKey).toHaveBeenCalledWith(expect.anything(), 'granted-intake', 'firm-matter-1', 'seat-token');
    expect(useIntakeStore.getState().intakesById['granted-intake']).toMatchObject({
      intakeId: 'granted-intake', matterId: localMatter.id, status: 'active', items: [],
    });
  });

  it('binds the relay inbox adapter to one intake id', async () => {
    const relay = {
      fetchInbox: vi.fn().mockResolvedValue({ cursor: 2, has_more: false, submissions: [] }),
      ackSubmission: vi.fn().mockResolvedValue(undefined),
    };

    const adapter = bindIntakeRelayInbox(relay, 'intake-1');

    await expect(adapter.fetchInbox(1)).resolves.toEqual({
      cursor: 2,
      has_more: false,
      submissions: [],
    });
    await adapter.ackSubmission('ignored-by-adapter', 'submission-1', 2);

    expect(relay.fetchInbox).toHaveBeenCalledWith('intake-1', 1);
    expect(relay.ackSubmission).toHaveBeenCalledWith('intake-1', 'submission-1', 2);
  });

  it('routes a typed submission into facts, checklist state, received items, and last activity without storing the value', async () => {
    useIntakeStore.getState().upsertIntake(intake());
    const upsertFact = vi.fn().mockResolvedValue({
      fact_id: 'fact-ssn',
    });

    const current = useIntakeStore.getState().intakesById['intake-1'];
    expect(current).toBeDefined();
    if (!current) throw new Error('Expected the intake to be in the store.');

    await expect(routeIntakeSubmission(routedSubmission({
      item_id: 'ssn',
      item_type: 'typed_field',
      subject: 'primary',
      value: '123-45-6789',
    }), {
      intake: current,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: null,
      upsertFact,
    })).resolves.toEqual({ factId: 'fact-ssn' });

    expect(upsertFact).toHaveBeenCalledWith(expect.objectContaining({
      matter_id: 'matter-1',
      subject: 'primary',
      kind: 'ssn',
      sensitivity: 'restricted',
      value: { t: 'string', v: '123-45-6789' },
      provenance: {
        channel: 'intake_link',
        entered_by: 'client',
        at: '2026-07-10T10:00:00.000Z',
      },
      verification: 'client_stated',
    }));
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored).toBeDefined();
    if (!stored) throw new Error('Expected the intake to stay in the store.');
    expect(stored.items[0]).toMatchObject({
      itemId: 'ssn',
      label: 'Social Security number',
      state: 'received',
      factId: 'fact-ssn',
      provenance: {
        channel: 'intake_link',
        label: 'provided by client',
        at: '2026-07-10T10:00:00.000Z',
      },
    });
    expect(stored.receivedItems).toEqual([
      expect.objectContaining({
        itemId: 'ssn',
        label: 'Social Security number',
        factId: 'fact-ssn',
      }),
    ]);
    expect(stored.lastClientActivityAt).toBe('2026-07-10T10:00:00.000Z');
    expect(JSON.stringify(stored)).not.toContain('123-45-6789');
    expect(JSON.stringify(stored)).not.toContain('6789');
  });

  it('keeps a client-supplied warned-file signal without treating it as verification', async () => {
    useIntakeStore.getState().upsertIntake(intake({
      items: [{ itemId: 'income-support', label: 'Income support', state: 'not_started' }],
    }));
    const fileDocument = vi.fn().mockResolvedValue('/workspace/Sarah/Requests/onboarding/income.pdf');
    const current = useIntakeStore.getState().intakesById['intake-1'];
    expect(current).toBeDefined();
    if (!current) throw new Error('Expected the intake to be in the store.');

    await routeIntakeSubmission(routedSubmission(null, {
      itemId: 'income-support',
      submissionId: 'submission-warned-file',
      contentType: 'application/pdf',
      fileNames: ['income.pdf'],
      plaintextBytes: [enc.encode('pdf-bytes')],
      documentDetective: [{ tier: 'tier1', slot_index: 0, warning_reason: 'wrong_doc', kept_anyway: true }],
    }), {
      intake: current,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: {} as never,
      fileDocument,
    });

    const received = useIntakeStore.getState().intakesById['intake-1']?.receivedItems[0];
    expect(received).toMatchObject({
      keptWarnedFile: true,
      keptWarnedFileReason: 'wrong_doc',
    });
    expect(received?.provenance).not.toHaveProperty('verification');
    expect(JSON.stringify(received)).not.toContain('pdf-bytes');
  });

  it('routes guided answer bodies into money and range facts', async () => {
    useIntakeStore.getState().upsertIntake(intake({
      items: [
        { itemId: 'income', label: 'Income', state: 'not_started' },
        { itemId: 'spending', label: 'Spending', state: 'not_started' },
      ],
    }));
    const upsertFact = vi.fn((input: IntakeFactUpsertInput) => Promise.resolve({
      ...maskedFact(
        input,
        input.kind === 'income_annual' ? 'fact-income' : 'fact-spending',
      ),
    }));

    const incomeCurrent = useIntakeStore.getState().intakesById['intake-1'];
    expect(incomeCurrent).toBeDefined();
    if (!incomeCurrent) throw new Error('Expected the intake to be in the store.');
    await expect(routeIntakeSubmission(routedSubmission({
      item_id: 'income',
      item_type: 'guided_question',
      subject: 'Sarah',
      answer: { mode: 'amount', amount: 90000, currency: 'USD' },
    }, {
      itemId: 'income',
      submissionId: 'submission-income',
    }), {
      intake: incomeCurrent,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: null,
      upsertFact,
    })).resolves.toEqual({ factId: 'fact-income' });

    const spendingCurrent = useIntakeStore.getState().intakesById['intake-1'];
    expect(spendingCurrent).toBeDefined();
    if (!spendingCurrent) throw new Error('Expected the intake to stay in the store.');
    await expect(routeIntakeSubmission(routedSubmission({
      item_id: 'spending',
      item_type: 'guided_question',
      subject: 'Sarah',
      answer: { mode: 'range', min: 4500, max: 5200, currency: 'USD' },
    }, {
      itemId: 'spending',
      submissionId: 'submission-spending',
      submittedAt: '2026-07-10T10:05:00.000Z',
    }), {
      intake: spendingCurrent,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: null,
      upsertFact,
    })).resolves.toEqual({ factId: 'fact-spending' });

    expect(upsertFact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'income_annual',
      value: { t: 'money', v: { amount: 90000, currency: 'USD' } },
    }));
    expect(upsertFact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'spending_monthly',
      value: { t: 'range', v: { min: 4500, max: 5200, currency: 'USD' } },
    }));
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'income', state: 'received', factId: 'fact-income' }),
      expect.objectContaining({ itemId: 'spending', state: 'received', factId: 'fact-spending' }),
    ]));
  });

  it('flags valued JSON that cannot be stored instead of marking it received', async () => {
    useIntakeStore.getState().upsertIntake(intake({
      items: [{ itemId: 'mystery', label: 'Mystery question', state: 'not_started' }],
    }));
    const upsertFact = vi.fn();
    const current = useIntakeStore.getState().intakesById['intake-1'];
    expect(current).toBeDefined();
    if (!current) throw new Error('Expected the intake to be in the store.');

    await expect(routeIntakeSubmission(routedSubmission({
      item_id: 'mystery',
      item_type: 'typed_field',
      subject: 'Sarah',
      value: 'do not lose this',
    }, {
      itemId: 'mystery',
      submissionId: 'submission-mystery',
    }), {
      intake: current,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: null,
      upsertFact,
    })).rejects.toThrow(/could not be filed/iu);

    expect(upsertFact).not.toHaveBeenCalled();
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored?.items[0]).toMatchObject({
      itemId: 'mystery',
      state: 'needs_followup',
    });
    expect(stored?.receivedItems).toEqual([]);
    expect(stored?.flags).toEqual([
      expect.objectContaining({
        kind: 'routing_failed',
        itemId: 'mystery',
        submissionId: 'submission-mystery',
      }),
    ]);
  });

  it('flags multi-file manifests instead of concatenating files under the first name', async () => {
    useIntakeStore.getState().upsertIntake(intake({
      items: [{ itemId: 'license', label: "Driver's license", state: 'not_started' }],
    }));
    const fileDocument = vi.fn();
    const current = useIntakeStore.getState().intakesById['intake-1'];
    expect(current).toBeDefined();
    if (!current) throw new Error('Expected the intake to be in the store.');

    await expect(routeIntakeSubmission(routedSubmission(null, {
      itemId: 'license',
      submissionId: 'submission-license',
      contentType: 'image/jpeg',
      fileNames: ['front.jpg', 'back.jpg'],
      plaintextBytes: [enc.encode('front-image'), enc.encode('back-image')],
    }), {
      intake: current,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: {} as never,
      fileDocument,
    })).rejects.toThrow(/multiple files/iu);

    expect(fileDocument).not.toHaveBeenCalled();
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored?.items[0]).toMatchObject({
      itemId: 'license',
      state: 'needs_followup',
    });
    expect(stored?.receivedItems).toEqual([]);
    expect(stored?.flags).toEqual([
      expect.objectContaining({
        kind: 'routing_failed',
        itemId: 'license',
        submissionId: 'submission-license',
      }),
    ]);
  });
});
