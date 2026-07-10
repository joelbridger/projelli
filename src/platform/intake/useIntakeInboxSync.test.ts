import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntakeInboxSubmission, RoutedIntakeSubmission } from './IntakeSyncClient';
import type { IntakeFactUpsertInput } from './factsStore';
import {
  generateContentKey,
  generateIntakeKeypair,
  importContentKey,
  sealItemChunk,
  sealManifest,
  wrapContentKey,
} from './intakeCrypto';
import { hashPlaintextChunk } from './chunkHash';
import { storeIntakeSecrets } from './intakeKeychain';
import { useIntakeStore, type IntakeRecord } from './intakeStore';
import {
  bindIntakeRelayInbox,
  discoverGrantedIntakes,
  routeIntakeSubmission,
  syncActiveIntakeInboxesOnce,
} from './useIntakeInboxSync';
import { useMatterStore } from '@/platform/matter/matterStore';

const enc = new TextEncoder();

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  const items = overrides.items ?? [{ itemId: 'ssn', label: 'Social Security number', state: 'not_started' }];
  const requestItems = overrides.requestItems ?? items.map((item) => {
    if (item.itemId === 'income') return { t: 'guided_question' as const, item_id: item.itemId, label: item.label, help_text: '', required: true, subject: 'household', prompt: '', response_format: 'money' as const, fact_kind: 'income_annual' as const };
    if (item.itemId === 'spending') return { t: 'guided_question' as const, item_id: item.itemId, label: item.label, help_text: '', required: true, subject: 'household', prompt: '', response_format: 'range' as const, fact_kind: 'spending_monthly' as const };
    if (item.itemId === 'license') return { t: 'doc_upload' as const, item_id: item.itemId, label: item.label, help_text: '', required: true, subject: 'primary', max_files: 1 };
    if (item.itemId === 'income-support') return { t: 'doc_upload' as const, item_id: item.itemId, label: item.label, help_text: '', required: true, subject: 'primary' };
    if (item.itemId === 'mystery') return { t: 'readonly_card' as const, item_id: item.itemId, label: item.label, help_text: '', required: false, subject: 'primary', body: '' };
    return { t: 'typed_field' as const, item_id: item.itemId, label: item.label, help_text: '', required: true, subject: 'primary', fact_kind: 'ssn' as const, input: 'text' as const };
  });
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    kind: 'onboarding',
    requestTitle: 'New client onboarding',
    requestSlug: 'onboarding',
    requestItems,
    items,
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

async function sealedInboxSubmission(input: {
  intakeId: string;
  itemId: string;
  submissionId: string;
  cursor: number;
  publicKeyRaw: Uint8Array;
  body: unknown;
}): Promise<IntakeInboxSubmission> {
  const contentKeyB64 = await generateContentKey();
  const contentKey = await importContentKey(contentKeyB64);
  const plaintext = enc.encode(JSON.stringify(input.body));
  const manifestCiphertext = await sealManifest(contentKey, {
    submission_id: input.submissionId,
    item_id: input.itemId,
    content_type: 'application/json',
    file_names: [],
    chunk_hashes: [await hashPlaintextChunk(plaintext)],
    chunk_count: 1,
  }, {
    intakeId: input.intakeId,
    itemId: input.itemId,
    submissionId: input.submissionId,
  });
  const ciphertext = await sealItemChunk(contentKey, plaintext, {
    intakeId: input.intakeId,
    itemId: input.itemId,
    submissionId: input.submissionId,
    index: 0,
  });
  return {
    cursor: input.cursor,
    intake_id: input.intakeId,
    item_id: input.itemId,
    submission_id: input.submissionId,
    submitted_at: '2026-07-10T10:00:00.000Z',
    manifest_ciphertext_b64: manifestCiphertext,
    wrapped_content_key_b64: await wrapContentKey(contentKeyB64, input.publicKeyRaw),
    chunks: [{
      intake_id: input.intakeId,
      item_id: input.itemId,
      submission_id: input.submissionId,
      index: 0,
      ciphertext_b64: ciphertext,
    }],
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

  it('acknowledges a redelivered submission and still routes the next submission through the live sync wiring', async () => {
    const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
    await storeIntakeSecrets('intake-1', privateKey, 'link-secret');
    const localMatter = useMatterStore.getState().createMatter({
      name: 'Sarah', client: 'Sarah', folderPaths: ['/workspace/Sarah'],
    });
    useIntakeStore.getState().upsertIntake(intake({
      matterId: localMatter.id,
      knownSubmissionIds: ['already-filed'],
    }));
    const [redelivery, next] = await Promise.all([
      sealedInboxSubmission({
        intakeId: 'intake-1', itemId: 'ssn', submissionId: 'already-filed', cursor: 1, publicKeyRaw,
        body: { value: '111-11-1111' },
      }),
      sealedInboxSubmission({
        intakeId: 'intake-1', itemId: 'ssn', submissionId: 'new-submission', cursor: 2, publicKeyRaw,
        body: { value: '222-22-2222' },
      }),
    ]);
    const relay = {
      fetchInbox: vi.fn().mockResolvedValue({ cursor: 2, has_more: false, submissions: [redelivery, next] }),
      ackSubmission: vi.fn().mockResolvedValue(undefined),
    };
    const current = useIntakeStore.getState().intakesById['intake-1'];
    if (!current) throw new Error('Expected active intake.');

    await syncActiveIntakeInboxesOnce({ relayClient: relay, workspaceService: {} as never });

    expect(relay.ackSubmission).toHaveBeenCalledWith('intake-1', 'already-filed', 1);
    expect(relay.ackSubmission).toHaveBeenCalledWith('intake-1', 'new-submission', 2);
    const updated = useIntakeStore.getState().intakesById['intake-1'];
    expect(updated?.knownSubmissionIds).toEqual(expect.arrayContaining(['already-filed', 'new-submission']));
    expect(updated?.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'duplicate', submissionId: 'already-filed' }),
    ]));
    expect(updated?.items[0]).toMatchObject({ state: 'received' });
    expect(updated?.lastCursor).toBe(2);
  });

  it('marks a shared intake without a recovered checklist as setup-required, not an integrity mismatch', async () => {
    const sharedIntake = intake();
    delete sharedIntake.requestItems;
    useIntakeStore.getState().upsertIntake(sharedIntake);
    const current = useIntakeStore.getState().intakesById['intake-1'];
    if (!current) throw new Error('Expected active intake.');

    await expect(routeIntakeSubmission(routedSubmission({ value: '123-45-6789' }), {
      intake: current,
      matterFolderPath: '/workspace/Sarah',
      workspaceService: null,
    })).rejects.toThrow(/needs setup to receive shared intake responses/iu);

    expect(useIntakeStore.getState().intakesById['intake-1']?.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'shared_intake_setup_required' }),
    ]));
    expect(useIntakeStore.getState().intakesById['intake-1']?.flags).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'integrity_mismatch' }),
    ]));
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
    })).rejects.toThrow(/cannot receive submissions/iu);

    expect(upsertFact).not.toHaveBeenCalled();
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored?.items[0]).toMatchObject({
      itemId: 'mystery',
      state: 'needs_followup',
    });
    expect(stored?.receivedItems).toEqual([]);
    expect(stored?.flags).toEqual([
      expect.objectContaining({
        kind: 'integrity_mismatch',
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

  it('rejects body metadata that conflicts with the saved request contract', async () => {
    useIntakeStore.getState().upsertIntake(intake());
    const current = useIntakeStore.getState().intakesById['intake-1'];
    if (!current) throw new Error('missing intake');
    const upsertFact = vi.fn();
    await expect(routeIntakeSubmission(routedSubmission({ value: '123', fact_kind: 'dob', subject: 'other', response_format: 'money' }), {
      intake: current, matterFolderPath: '/workspace/Sarah', workspaceService: null, upsertFact,
    })).rejects.toThrow(/conflicts/iu);
    expect(upsertFact).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().intakesById['intake-1']?.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'integrity_mismatch' }),
    ]));
  });

  it('rejects a file for a fact and JSON for an upload without filing either', async () => {
    useIntakeStore.getState().upsertIntake(intake({
      items: [{ itemId: 'upload', label: 'Upload', state: 'not_started' }],
      requestItems: [{ t: 'doc_upload', item_id: 'upload', label: 'Upload', help_text: '', required: true, subject: 'primary', accepted_mime_types: ['application/pdf'], max_files: 1, max_bytes: 10 }],
    }));
    const current = useIntakeStore.getState().intakesById['intake-1'];
    if (!current) throw new Error('missing intake');
    await expect(routeIntakeSubmission(routedSubmission({ value: 'nope' }, { itemId: 'upload' }), {
      intake: current, matterFolderPath: '/workspace/Sarah', workspaceService: {} as never,
    })).rejects.toThrow(/JSON/iu);
    const fact = intake();
    useIntakeStore.getState().upsertIntake(fact);
    await expect(routeIntakeSubmission(routedSubmission(null, { contentType: 'application/pdf', fileNames: ['x.pdf'], plaintextBytes: [enc.encode('x')] }), {
      intake: useIntakeStore.getState().intakesById['intake-1']!, matterFolderPath: '/workspace/Sarah', workspaceService: {} as never,
    })).rejects.toThrow(/file/iu);
  });
});
