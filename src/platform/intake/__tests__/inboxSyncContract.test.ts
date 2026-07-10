import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import {
  generateContentKey,
  generateIntakeKeypair,
  importContentKey,
  sealItemChunk,
  sealManifest,
  wrapContentKey,
  type SealedManifest,
} from '../intakeCrypto';
import { hashPlaintextChunk } from '../chunkHash';
import { IntakeRelayClient } from '../IntakeRelayClient';
import { IntakeSyncClient, type IntakeSubmissionFlag } from '../IntakeSyncClient';
import type { IntakeFactUpsertInput } from '../factsStore';
import type { FileIntakeDocumentOptions } from '../intakeFiling';
import { useIntakeStore, type IntakeRecord } from '../intakeStore';
import type { FactKind, FactValue } from '../types';
import { routeIntakeSubmission } from '../useIntakeInboxSync';

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: vi.fn(),
}));

const enc = new TextEncoder();
const fetchMock = vi.fn();

interface RelayBlobRef {
  blob_id: number;
  index: number;
  size: number;
}

interface RelaySubmissionEnvelope {
  cursor: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  submitted_at: string;
  manifest_ciphertext_b64: string;
  wrapped_content_key_b64: string;
  chunk_count: number;
  blobs: RelayBlobRef[];
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function intakeRecord(): IntakeRecord {
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'Journey Beyond Wealth',
    status: 'active',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    items: [
      { itemId: 'dob', label: 'Date of birth', state: 'not_started' },
      { itemId: 'ssn', label: 'Social Security number', state: 'not_started' },
      { itemId: 'income', label: 'Income', state: 'not_started' },
      { itemId: 'spending', label: 'Spending', state: 'not_started' },
      { itemId: 'license', label: "Driver's license", state: 'not_started' },
      { itemId: 'mystery', label: 'Mystery question', state: 'not_started' },
    ],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
  };
}

async function sealedRelaySubmission(input: {
  intakeId: string;
  itemId: string;
  submissionId: string;
  submittedAt: string;
  publicKeyRaw: Uint8Array;
  contentType: string;
  fileNames: string[];
  plaintextChunks: Uint8Array[];
  cursor: number;
  nextBlobId: () => number;
}): Promise<{
  envelope: RelaySubmissionEnvelope;
  blobBytes: Array<{ blobId: number; bytes: Uint8Array }>;
}> {
  const contentKeyB64 = await generateContentKey();
  const contentKey = await importContentKey(contentKeyB64);
  const chunkHashes = await Promise.all(input.plaintextChunks.map((chunk) => hashPlaintextChunk(chunk)));
  const manifest: SealedManifest = {
    submission_id: input.submissionId,
    item_id: input.itemId,
    content_type: input.contentType,
    file_names: input.fileNames,
    chunk_hashes: chunkHashes,
    chunk_count: input.plaintextChunks.length,
  };
  const manifestCiphertext = await sealManifest(contentKey, manifest, {
    intakeId: input.intakeId,
    itemId: input.itemId,
    submissionId: input.submissionId,
  });
  const wrappedContentKey = await wrapContentKey(contentKeyB64, input.publicKeyRaw);
  const blobBytes: Array<{ blobId: number; bytes: Uint8Array }> = [];
  const blobs: RelayBlobRef[] = [];

  for (let index = 0; index < input.plaintextChunks.length; index += 1) {
    const chunk = input.plaintextChunks[index];
    expect(chunk).toBeDefined();
    if (!chunk) throw new Error('missing chunk fixture');
    const ciphertextB64 = await sealItemChunk(contentKey, chunk, {
      intakeId: input.intakeId,
      itemId: input.itemId,
      submissionId: input.submissionId,
      index,
    });
    const bytes = b64ToBytes(ciphertextB64);
    const blobId = input.nextBlobId();
    blobBytes.push({ blobId, bytes });
    blobs.push({ blob_id: blobId, index, size: bytes.byteLength });
  }

  return {
    envelope: {
      cursor: input.cursor,
      intake_id: input.intakeId,
      item_id: input.itemId,
      submission_id: input.submissionId,
      submitted_at: input.submittedAt,
      manifest_ciphertext_b64: manifestCiphertext,
      wrapped_content_key_b64: wrappedContentKey,
      chunk_count: input.plaintextChunks.length,
      blobs,
    },
    blobBytes,
  };
}

describe('intake client to relay to advisor inbox contract', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock as unknown as typeof fetch);
    useIntakeStore.getState().resetForTests();
  });

  it('files typed, guided, and file submissions from the real relay envelope without acking unstorable values', async () => {
    const intakeId = 'intake-1';
    const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
    let nextBlobIdValue = 1000;
    const nextBlobId = (): number => {
      nextBlobIdValue += 1;
      return nextBlobIdValue;
    };

    // These body shapes MUST stay in sync with intake-page/src/submission.ts.
    const typedDobBody = {
      item_id: 'dob',
      item_type: 'typed_field',
      subject: 'Sarah',
      value: '1960-02-03',
      display_value: '1960-02-03',
    };
    const typedSsnBody = {
      item_id: 'ssn',
      item_type: 'typed_field',
      subject: 'Sarah',
      value: '123456789',
      display_value: undefined,
    };
    const guidedIncomeBody = {
      item_id: 'income',
      item_type: 'guided_question',
      subject: 'Sarah',
      answer: { mode: 'amount', amount: 90000, currency: 'USD' },
    };
    const guidedSpendingBody = {
      item_id: 'spending',
      item_type: 'guided_question',
      subject: 'Sarah',
      answer: { mode: 'amount', amount: 4200, currency: 'USD' },
    };
    const unstorableBody = {
      item_id: 'mystery',
      item_type: 'typed_field',
      subject: 'Sarah',
      value: 'keep this visible for retry',
    };

    const submissions = await Promise.all([
      sealedRelaySubmission({
        intakeId,
        itemId: 'dob',
        submissionId: 'submission-dob',
        submittedAt: '2026-07-10T10:00:00.000Z',
        publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintextChunks: [enc.encode(JSON.stringify(typedDobBody))],
        cursor: 1,
        nextBlobId,
      }),
      sealedRelaySubmission({
        intakeId,
        itemId: 'ssn',
        submissionId: 'submission-ssn',
        submittedAt: '2026-07-10T10:01:00.000Z',
        publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintextChunks: [enc.encode(JSON.stringify(typedSsnBody))],
        cursor: 2,
        nextBlobId,
      }),
      sealedRelaySubmission({
        intakeId,
        itemId: 'income',
        submissionId: 'submission-income',
        submittedAt: '2026-07-10T10:02:00.000Z',
        publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintextChunks: [enc.encode(JSON.stringify(guidedIncomeBody))],
        cursor: 3,
        nextBlobId,
      }),
      sealedRelaySubmission({
        intakeId,
        itemId: 'spending',
        submissionId: 'submission-spending',
        submittedAt: '2026-07-10T10:03:00.000Z',
        publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintextChunks: [enc.encode(JSON.stringify(guidedSpendingBody))],
        cursor: 4,
        nextBlobId,
      }),
      sealedRelaySubmission({
        intakeId,
        itemId: 'license',
        submissionId: 'submission-license-front',
        submittedAt: '2026-07-10T10:04:00.000Z',
        publicKeyRaw,
        contentType: 'image/jpeg',
        fileNames: ['front.jpg'],
        plaintextChunks: [enc.encode('front-image')],
        cursor: 5,
        nextBlobId,
      }),
      sealedRelaySubmission({
        intakeId,
        itemId: 'mystery',
        submissionId: 'submission-mystery',
        submittedAt: '2026-07-10T10:05:00.000Z',
        publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintextChunks: [enc.encode(JSON.stringify(unstorableBody))],
        cursor: 6,
        nextBlobId,
      }),
    ]);
    const blobBytes = new Map<number, Uint8Array>();
    for (const submission of submissions) {
      for (const blob of submission.blobBytes) {
        blobBytes.set(blob.blobId, blob.bytes);
      }
    }
    const acked: string[] = [];

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url);
      if (parsed.pathname === `/intake/${intakeId}/inbox`) {
        expect(parsed.searchParams.get('cursor')).toBe('0');
        expect(init?.headers).toMatchObject({ 'X-Seat-Token': 'seat-token' });
        return Promise.resolve(jsonResponse({
          intake_id: intakeId,
          cursor: 6,
          latest_cursor: 6,
          has_more: false,
          submissions: submissions.map((submission) => submission.envelope),
        }));
      }
      const blobMatch = parsed.pathname.match(new RegExp(`^/intake/${intakeId}/blob/(\\d+)$`, 'u'));
      if (blobMatch) {
        expect(init?.headers).toMatchObject({ 'X-Seat-Token': 'seat-token' });
        const blobId = Number(blobMatch[1]);
        const bytes = blobBytes.get(blobId);
        if (!bytes) return Promise.resolve(jsonResponse({ error: 'missing blob' }, 404));
        return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
      }
      if (parsed.pathname === `/intake/${intakeId}/ack`) {
        const rawBody = typeof init?.body === 'string' ? init.body : '{}';
        const body = JSON.parse(rawBody) as { submission_ids?: string[] };
        acked.push(...(body.submission_ids ?? []));
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected route' }, 404));
    });

    const storedFacts: IntakeFactUpsertInput[] = [];
    const storedFiles: Array<{ fileName: string; bytesB64: string }> = [];
    const flags: IntakeSubmissionFlag[] = [];
    const relay = new IntakeRelayClient({
      baseUrl: 'https://relay.example.test',
      seatToken: 'seat-token',
    });
    useIntakeStore.getState().upsertIntake(intakeRecord());

    const sync = new IntakeSyncClient({
      relay: {
        fetchInbox: (cursor) => relay.fetchInbox(intakeId, cursor),
        ackSubmission: (id, submissionId, cursor) => relay.ackSubmission(id, submissionId, cursor),
      },
      loadPrivateKey: () => Promise.resolve(privateKey),
      hasSubmission: (submissionId) => Promise.resolve(
        useIntakeStore.getState().intakesById[intakeId]?.knownSubmissionIds.includes(submissionId) ?? false,
      ),
      rememberSubmission: (submissionId) => {
        useIntakeStore.getState().rememberSubmission(intakeId, submissionId);
        return Promise.resolve();
      },
      isKnownSession: () => Promise.resolve(true),
      rememberSession: () => Promise.resolve(),
      flagSubmission: (flag) => {
        flags.push(flag);
        useIntakeStore.getState().addFlag(flag.intakeId, {
          id: `submission:${flag.submissionId}:${flag.kind}`,
          kind: flag.kind,
          itemId: flag.itemId,
          submissionId: flag.submissionId,
          message: flag.reason,
          at: flag.at,
        });
        return Promise.resolve();
      },
      routeSubmission: (submission) => {
        const current = useIntakeStore.getState().intakesById[intakeId];
        if (!current) throw new Error('missing intake');
        return routeIntakeSubmission(submission, {
          intake: current,
          matterFolderPath: '/workspace/Sarah',
          workspaceService: {} as never,
          upsertFact: (input: IntakeFactUpsertInput) => {
            storedFacts.push(input);
            return Promise.resolve({
              fact_id: `fact-${input.kind}`,
              matter_id: input.matter_id,
              subject: input.subject,
              kind: input.kind,
              sensitivity: input.sensitivity,
              display_value: 'stored',
              provenance: input.provenance,
              verification: input.verification,
              status: 'active',
            });
          },
          fileDocument: (input: FileIntakeDocumentOptions) => {
            storedFiles.push({
              fileName: input.fileName,
              bytesB64: bytesToB64(input.bytes),
            });
            return Promise.resolve(`/workspace/Sarah/Requests/onboarding/${input.fileName}`);
          },
        });
      },
    });

    const result = await sync.syncOnce();

    expect(result).toMatchObject({
      pulled: 6,
      routed: 5,
      acked: 5,
      rejected: 1,
      cursor: 5,
    });
    expect(acked).toEqual([
      'submission-dob',
      'submission-ssn',
      'submission-income',
      'submission-spending',
      'submission-license-front',
    ]);
    expect(acked).not.toContain('submission-mystery');

    const factsByKind = new Map<FactKind, FactValue>(storedFacts.map((fact) => [fact.kind, fact.value]));
    expect(factsByKind.get('dob')).toEqual({ t: 'date', v: '1960-02-03' });
    expect(factsByKind.get('ssn')).toEqual({ t: 'string', v: '123456789' });
    expect(factsByKind.get('income_annual')).toEqual({ t: 'money', v: { amount: 90000, currency: 'USD' } });
    expect(factsByKind.get('spending_monthly')).toEqual({ t: 'money', v: { amount: 4200, currency: 'USD' } });
    expect(storedFiles).toEqual([{
      fileName: 'front.jpg',
      bytesB64: bytesToB64(enc.encode('front-image')),
    }]);

    const stored = useIntakeStore.getState().intakesById[intakeId];
    expect(stored?.lastClientActivityAt).toBe('2026-07-10T10:04:00.000Z');
    expect(stored?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'dob', state: 'received', factId: 'fact-dob' }),
      expect.objectContaining({ itemId: 'ssn', state: 'received', factId: 'fact-ssn' }),
      expect.objectContaining({ itemId: 'income', state: 'received', factId: 'fact-income_annual' }),
      expect.objectContaining({ itemId: 'spending', state: 'received', factId: 'fact-spending_monthly' }),
      expect.objectContaining({ itemId: 'license', state: 'received', filePath: '/workspace/Sarah/Requests/onboarding/front.jpg' }),
      expect.objectContaining({ itemId: 'mystery', state: 'needs_followup' }),
    ]));
    expect(flags).toEqual([
      expect.objectContaining({
        kind: 'routing_failed',
        itemId: 'mystery',
        submissionId: 'submission-mystery',
      }),
    ]);
  });
});
