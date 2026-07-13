import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/platform/intake/welcomeJourneyDefaults';
import { instantiateRequestBlueprint } from '@/platform/intake/blueprintFactory';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import {
  clearInMemoryFactsForTests,
  intakeFactMatchList,
  intakeFactUpsert,
  type IntakeFactUpsertInput,
} from '@/platform/intake/factsStore';
import { derivePageKey } from '@/platform/intake/intakeCrypto';
import { openPageJson } from '@/platform/intake/pageSeal';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { RelayClient } from '../../../../intake-page/src/relayClient';
import { createAdvisorIntake } from '../createIntake';
import { hashPlaintextChunk } from '../chunkHash';
import {
  generateContentKey,
  importContentKey,
  sealItemChunk,
  sealManifest,
  wrapContentKey,
  type SealedManifest,
} from '../intakeCrypto';
import { IntakeRelayClient } from '../IntakeRelayClient';
import { IntakeSyncClient } from '../IntakeSyncClient';
import { useIntakeStore, type IntakeRecord } from '../intakeStore';
import type { ChunkUpload, SubmitManifest } from '../intakeContract';
import type { FormRequest, RequestItem } from '../types';
import { routeIntakeSubmission } from '../useIntakeInboxSync';

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: vi.fn(),
}));

interface StandingFixture {
  blueprint: RequestBlueprint;
  client_fact_seed: {
    matter_id: string;
    subject: string;
    fact_kind: 'income_annual';
    value: { amount: number; currency: string };
  };
  upload: { file: string; file_name: string; mime_type: string };
  expected_routed_outcome: {
    fact_kind: 'income_annual';
    fact_subject: string;
    provenance_channel: 'intake_link';
    verification: 'client_stated';
  };
}

interface WireCall {
  url: string;
  body: string;
}

interface RelayEnvelope {
  cursor: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  submitted_at: string;
  manifest_ciphertext_b64: string;
  wrapped_content_key_b64: string;
  chunk_count: number;
  blobs: Array<{ blob_id: number; index: number; size: number }>;
}

const fixtureRoot = resolve(
  process.cwd(),
  'tests/fixtures/intake-standing-request'
);
const fixture = JSON.parse(
  readFileSync(resolve(fixtureRoot, 'manifest.json'), 'utf8')
) as StandingFixture;
const fixtureUpload = new Uint8Array(
  readFileSync(resolve(fixtureRoot, 'annual-review-support.pdf'))
);
const enc = new TextEncoder();
const fetchMock = vi.fn();

function requireSlug(record: IntakeRecord): string {
  if (!record.requestSlug) throw new Error('Expected the standing request to have a generated slug.');
  return record.requestSlug;
}
const FIRM = {
  name: 'Synthetic Harbor Advisory',
  accent: '#123456',
  advisor_name: 'Demo Advisor',
  advisor_email: 'advisor@example.invalid',
  next_steps: [],
  journey: DEFAULT_WELCOME_JOURNEY,
};

function b64ToBytes(value: string): Uint8Array {
  const raw = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function urlStringOf(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.toString();
  return url.url;
}

function pathnameOf(url: RequestInfo | URL): string {
  return new URL(urlStringOf(url), 'https://synthetic-relay.invalid').pathname;
}

function bodyStringOf(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function wireCall(url: RequestInfo | URL, init?: RequestInit): WireCall {
  return { url: urlStringOf(url), body: bodyStringOf(init) };
}

function requestItem(
  record: IntakeRecord,
  type: RequestItem['t']
): RequestItem {
  const item = record.requestItems?.find((candidate) => candidate.t === type);
  if (!item) throw new Error(`Missing ${type} fixture item.`);
  return item;
}

function configureAdvisorFetch(
  responder: (path: string, init: RequestInit | undefined) => Response
): WireCall[] {
  const calls: WireCall[] = [];
  fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(wireCall(url, init));
    return Promise.resolve(responder(pathnameOf(url), init));
  });
  return calls;
}

function fixtureRequest(input: {
  requestId: string;
  matterId?: string;
  items?: RequestItem[];
}): FormRequest {
  return instantiateRequestBlueprint({
    blueprint: fixture.blueprint,
    requestId: input.requestId,
    matterId: input.matterId ?? fixture.client_fact_seed.matter_id,
    kind: 'standing',
    ...(input.items ? { items: input.items } : {}),
  });
}

async function issueRequest(input: {
  checklist: FormRequest;
  requestTitle?: string;
  requestSlug?: string;
}) {
  const relay = new IntakeRelayClient({
    baseUrl: 'https://relay.test',
    seatToken: 'synthetic-seat',
  });
  const bundle = await createAdvisorIntake({
    intakeId: input.checklist.request_id,
    matterId: input.checklist.matter_id,
    intakeHost: 'https://forms.synthetic.invalid',
    expiresAt: '2026-08-01T00:00:00.000Z',
    checklist: input.checklist,
    clientFirstName: 'Demo Client',
    firm: FIRM,
    relay,
    ...(input.requestTitle ? { requestTitle: input.requestTitle } : {}),
    ...(input.requestSlug ? { requestSlug: input.requestSlug } : {}),
  });
  const record =
    useIntakeStore.getState().intakesById[input.checklist.request_id];
  if (!record) throw new Error('Expected a local intake record.');
  return { bundle, record, relay };
}

async function openedChecklist(
  bundle: Awaited<ReturnType<typeof issueRequest>>['bundle']
): Promise<FormRequest> {
  const pageKey = await derivePageKey(b64ToBytes(bundle.linkSecretB64));
  return openPageJson<FormRequest>(pageKey, bundle.checklistCiphertextB64);
}

async function seedActiveIncome(
  input: { subject?: string } = {}
): Promise<void> {
  await intakeFactUpsert({
    matter_id: fixture.client_fact_seed.matter_id,
    subject: input.subject ?? fixture.client_fact_seed.subject,
    kind: fixture.client_fact_seed.fact_kind,
    value: { t: 'money', v: fixture.client_fact_seed.value },
    sensitivity: 'confidential',
    provenance: {
      channel: 'manual',
      entered_by: 'synthetic fixture',
      at: '2026-07-10T10:00:00.000Z',
    },
    verification: 'advisor_confirmed',
  });
}

function installClientRelay(): {
  calls: WireCall[];
  chunks: ChunkUpload[];
  manifests: SubmitManifest[];
} {
  const calls: WireCall[] = [];
  const chunks: ChunkUpload[] = [];
  const manifests: SubmitManifest[] = [];
  const clientFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(wireCall(url, init));
    const path = pathnameOf(url);
    if (path.endsWith('/chunks'))
      return Promise.resolve(json({ uploaded_indexes: [] }));
    if (path.endsWith('/chunk')) {
      chunks.push(JSON.parse(bodyStringOf(init)) as ChunkUpload);
      return Promise.resolve(json({ ok: true }));
    }
    if (path.endsWith('/submit')) {
      manifests.push(JSON.parse(bodyStringOf(init)) as SubmitManifest);
      return Promise.resolve(json({ ok: true }));
    }
    return Promise.resolve(json({ ok: true }));
  });
  vi.stubGlobal('fetch', clientFetch);
  return { calls, chunks, manifests };
}

function inboxFromClient(client: ReturnType<typeof installClientRelay>): {
  envelopes: RelayEnvelope[];
  blobs: Map<number, Uint8Array>;
} {
  const blobs = new Map<number, Uint8Array>();
  let nextBlobId = 900;
  const envelopes = client.manifests.map((manifest, submissionIndex) => {
    const matchingChunks = client.chunks.filter(
      (chunk) => chunk.submission_id === manifest.submission_id
    );
    const refs = matchingChunks.map((chunk) => {
      nextBlobId += 1;
      blobs.set(nextBlobId, b64ToBytes(chunk.ciphertext_b64));
      return {
        blob_id: nextBlobId,
        index: chunk.index,
        size: b64ToBytes(chunk.ciphertext_b64).byteLength,
      };
    });
    return {
      cursor: submissionIndex + 1,
      intake_id: manifest.intake_id,
      item_id: manifest.item_id,
      submission_id: manifest.submission_id,
      submitted_at: `2026-07-10T10:00:0${String(submissionIndex)}.000Z`,
      manifest_ciphertext_b64: manifest.manifest_ciphertext_b64,
      wrapped_content_key_b64: manifest.wrapped_content_key_b64,
      chunk_count: refs.length,
      blobs: refs,
    };
  });
  return { envelopes, blobs };
}

async function submitFixtureResponses(
  input: Awaited<ReturnType<typeof issueRequest>>
) {
  const client = installClientRelay();
  const guided = requestItem(input.record, 'guided_question');
  const upload = requestItem(input.record, 'doc_upload');
  const relay = new RelayClient(input.record.intakeId, input.bundle.tokenB64);
  await sendClientSubmission({
    intakeId: input.record.intakeId,
    item: guided,
    publicKeyRaw: input.bundle.publicKeyRaw,
    relay,
    submissionId: 'synthetic-guided-submission',
    contentType: 'application/json',
    fileNames: [],
    plaintext: enc.encode(
      JSON.stringify({
        item_id: guided.item_id,
        item_type: guided.t,
        subject: guided.subject,
        answer: {
          amount: fixture.client_fact_seed.value.amount,
          currency: 'USD',
        },
      })
    ),
  });
  await sendClientSubmission({
    intakeId: input.record.intakeId,
    item: upload,
    publicKeyRaw: input.bundle.publicKeyRaw,
    relay,
    submissionId: 'synthetic-upload-submission',
    contentType: fixture.upload.mime_type,
    fileNames: [fixture.upload.file_name],
    plaintext: fixtureUpload,
  });
  return client;
}

async function sendClientSubmission(input: {
  intakeId: string;
  item: RequestItem;
  publicKeyRaw: Uint8Array;
  relay: RelayClient;
  submissionId: string;
  contentType: string;
  fileNames: string[];
  plaintext: Uint8Array;
}): Promise<void> {
  const contentKeyB64 = await generateContentKey();
  const contentKey = await importContentKey(contentKeyB64);
  await input.relay.fetchUploadedIndexes(
    input.item.item_id,
    input.submissionId
  );
  const ciphertext_b64 = await sealItemChunk(contentKey, input.plaintext, {
    intakeId: input.intakeId,
    itemId: input.item.item_id,
    submissionId: input.submissionId,
    index: 0,
  });
  await input.relay.uploadChunk(input.item.item_id, {
    intake_id: input.intakeId,
    item_id: input.item.item_id,
    submission_id: input.submissionId,
    index: 0,
    ciphertext_b64,
  });
  const manifest: SealedManifest = {
    submission_id: input.submissionId,
    item_id: input.item.item_id,
    content_type: input.contentType,
    file_names: input.fileNames,
    chunk_hashes: [await hashPlaintextChunk(input.plaintext)],
    chunk_count: 1,
  };
  await input.relay.submitManifest(input.item.item_id, {
    intake_id: input.intakeId,
    item_id: input.item.item_id,
    submission_id: input.submissionId,
    manifest_ciphertext_b64: await sealManifest(contentKey, manifest, {
      intakeId: input.intakeId,
      itemId: input.item.item_id,
      submissionId: input.submissionId,
    }),
    wrapped_content_key_b64: await wrapContentKey(
      contentKeyB64,
      input.publicKeyRaw
    ),
  });
}

async function sealed(input: {
  intakeId: string;
  itemId: string;
  submissionId: string;
  publicKeyRaw: Uint8Array;
  contentType: string;
  fileNames: string[];
  plaintext: Uint8Array;
  cursor: number;
  blobId: number;
}) {
  const keyB64 = await generateContentKey();
  const key = await importContentKey(keyB64);
  const manifest: SealedManifest = {
    submission_id: input.submissionId,
    item_id: input.itemId,
    content_type: input.contentType,
    file_names: input.fileNames,
    chunk_hashes: [await hashPlaintextChunk(input.plaintext)],
    chunk_count: 1,
  };
  return {
    envelope: {
      cursor: input.cursor,
      intake_id: input.intakeId,
      item_id: input.itemId,
      submission_id: input.submissionId,
      submitted_at: '2026-07-10T10:00:00.000Z',
      manifest_ciphertext_b64: await sealManifest(key, manifest, {
        intakeId: input.intakeId,
        itemId: input.itemId,
        submissionId: input.submissionId,
      }),
      wrapped_content_key_b64: await wrapContentKey(keyB64, input.publicKeyRaw),
      chunk_count: 1,
      blobs: [
        { blob_id: input.blobId, index: 0, size: input.plaintext.byteLength },
      ],
    } satisfies RelayEnvelope,
    blob: b64ToBytes(
      await sealItemChunk(key, input.plaintext, {
        intakeId: input.intakeId,
        itemId: input.itemId,
        submissionId: input.submissionId,
        index: 0,
      })
    ),
  };
}

describe('standing request receiver-owned contract', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getCorsSafeFetch).mockResolvedValue(
      fetchMock as unknown as typeof fetch
    );
    useIntakeStore.getState().resetForTests();
    clearInMemoryFactsForTests();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('1. creates a blueprint standing request with a fresh id, generated slug, opaque handles, and onboarding-equivalent ciphertext-only relay shape', async () => {
    const calls = configureAdvisorFetch(() => json({ ok: true }));
    const request = fixtureRequest({
      requestId: 'standing-fixture-contract-1',
    });
    const standing = await issueRequest({
      checklist: request,
      requestTitle: fixture.blueprint.label,
    });
    const onboarding = await issueRequest({
      checklist: {
        request_id: 'onboarding-fixture-contract-1',
        schema_version: 1,
        matter_id: fixture.client_fact_seed.matter_id,
        kind: 'onboarding',
        items: [
          {
            t: 'typed_field',
            item_id: 'onboarding-name',
            label: 'Name',
            help_text: '',
            required: true,
            subject: 'primary',
            fact_kind: 'beneficiary',
            input: 'text',
          },
        ],
      },
    });
    const createBodies = calls
      .filter((call) => new URL(call.url).pathname === '/intake')
      .map((call) => call.body);

    expect(request.matter_id).toBe(fixture.client_fact_seed.matter_id);
    expect(standing.record.matterId).toBe(fixture.client_fact_seed.matter_id);
    expect(standing.record.intakeId).not.toBe(fixture.blueprint.blueprintId);
    expect(standing.record.requestSlug).toMatch(/^request-[a-f0-9]{16}$/u);
    expect(standing.record.requestSlug).not.toBe('onboarding');
    expect(standing.record.requestItems?.map((item) => item.item_id)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^ri_[a-f0-9]{36}$/u)])
    );
    expect(createBodies).toHaveLength(2);
    const firstBody = JSON.parse(createBodies[0] ?? '{}') as Record<string, unknown>;
    const secondBody = JSON.parse(createBodies[1] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(firstBody).sort()).toEqual(Object.keys(secondBody).sort());
    expect(Object.keys(firstBody).sort()).toEqual([
      'auth_token',
      'checklist_ciphertext_b64',
      'checklist_version',
      'expires_at',
      'intake_id',
      'state_ciphertext_b64',
    ]);
    expect(firstBody).toMatchObject({
      intake_id: standing.record.intakeId,
      checklist_version: 1,
    });
    expect(typeof firstBody['checklist_ciphertext_b64']).toBe('string');
    expect(typeof firstBody['state_ciphertext_b64']).toBe('string');
    const decryptedChecklist = await openedChecklist(standing.bundle);
    expect(decryptedChecklist).toMatchObject({
      matter_id: fixture.client_fact_seed.matter_id,
      blueprint_ref: fixture.blueprint.blueprintId,
    });
    expect(decryptedChecklist.items.map((item) => item.item_id)).toEqual(
      standing.record.requestItems?.map((item) => item.item_id)
    );
    expect(decryptedChecklist.items.map((item) => item.label)).toEqual(
      fixture.blueprint.items.map((item) => item.label)
    );
    expect(onboarding.record.kind).toBe('onboarding');
  });

  it('2. removes only an active exact fact match before sealing a standing checklist', async () => {
    configureAdvisorFetch(() => json({ ok: true }));
    await seedActiveIncome();
    const exactResolution = (await import('../requestAskOnce')).resolveAskOnce(
      fixture.blueprint.items,
      await intakeFactMatchList(fixture.client_fact_seed.matter_id)
    );
    expect(
      exactResolution.visibleItems.map((item) => item.item_id)
    ).not.toContain('annual-income-guided');
    const exact = await issueRequest({
      checklist: fixtureRequest({
        requestId: 'standing-fixture-ask-once',
        items: exactResolution.visibleItems,
      }),
    });
    expect(
      (await openedChecklist(exact.bundle)).items.map((item) => item.item_id)
    ).not.toContain('annual-income-guided');

    clearInMemoryFactsForTests();
    await seedActiveIncome({ subject: 'joint' });
    const nearMissResolution = (
      await import('../requestAskOnce')
    ).resolveAskOnce(
      fixture.blueprint.items,
      await intakeFactMatchList(fixture.client_fact_seed.matter_id)
    );
    expect(
      nearMissResolution.visibleItems.map((item) => item.item_id)
    ).toContain('annual-income-guided');
    const supersededResolution = (
      await import('../requestAskOnce')
    ).resolveAskOnce(fixture.blueprint.items, [
      {
        subject: fixture.client_fact_seed.subject,
        kind: fixture.client_fact_seed.fact_kind,
        status: 'superseded',
      },
    ]);
    expect(
      supersededResolution.visibleItems.map((item) => item.item_id)
    ).toContain('annual-income-guided');
  });

  it('3. decrypts and routes a fixture standing request into its own request folder with client-stated provenance', async () => {
    const inbox = {
      envelopes: [] as RelayEnvelope[],
      blobs: new Map<number, Uint8Array>(),
    };
    const acked: string[] = [];
    configureAdvisorFetch((path, init) => {
      if (path.endsWith('/inbox'))
        return json({
          cursor: inbox.envelopes.length,
          has_more: false,
          submissions: inbox.envelopes,
        });
      const blobId = path.match(/\/blob\/(\d+)$/u)?.[1];
      if (blobId)
        return new Response(inbox.blobs.get(Number(blobId)), { status: 200 });
      if (path.endsWith('/ack')) {
        acked.push(
          ...(JSON.parse(bodyStringOf(init)) as { submission_ids: string[] })
            .submission_ids
        );
      }
      return json({ ok: true });
    });
    const standing = await issueRequest({
      checklist: fixtureRequest({ requestId: 'standing-fixture-round-trip' }),
      requestTitle: fixture.blueprint.label,
    });
    const client = await submitFixtureResponses(standing);
    Object.assign(inbox, inboxFromClient(client));
    const facts: IntakeFactUpsertInput[] = [];
    const paths: string[] = [];
    const sync = new IntakeSyncClient({
      relay: {
        fetchInbox: (cursor) =>
          standing.relay.fetchInbox(standing.record.intakeId, cursor),
        ackSubmission: (intakeId, submissionId, cursor) =>
          standing.relay.ackSubmission(intakeId, submissionId, cursor),
      },
      loadPrivateKey: () => Promise.resolve(standing.bundle.privateKey),
      hasSubmission: () => Promise.resolve(false),
      rememberSubmission: () => Promise.resolve(),
      getKnownSessionIds: () => Promise.resolve(['known-session']),
      rememberSession: () => Promise.resolve(),
      flagSubmission: () => Promise.resolve(),
      routeSubmission: (submission) =>
        routeIntakeSubmission(submission, {
          intake: standing.record,
          matterFolderPath: '/workspace/Demo Client',
          workspaceService: {} as never,
          upsertFact: (input) => {
            facts.push(input);
            return Promise.resolve({
              fact_id: 'synthetic-fact',
              matter_id: input.matter_id,
              subject: input.subject,
              kind: input.kind,
              sensitivity: input.sensitivity,
              display_value: 'masked',
              provenance: input.provenance,
              verification: input.verification,
              status: 'active' as const,
            });
          },
          fileDocument: (input) => {
            const path = `/workspace/Demo Client/Requests/${input.requestSlug ?? 'onboarding'}/${input.fileName}`;
            paths.push(path);
            return Promise.resolve(path);
          },
        }),
    });
    await expect(sync.syncOnce()).resolves.toMatchObject({
      routed: 2,
      acked: 2,
    });
    expect(acked).toHaveLength(2);
    expect(paths).toEqual([
      `/workspace/Demo Client/Requests/${requireSlug(standing.record)}/${fixture.upload.file_name}`,
    ]);
    expect(paths.join('\n')).not.toContain('/Requests/onboarding/');
    expect(facts).toEqual([
      expect.objectContaining({
        matter_id: fixture.client_fact_seed.matter_id,
        subject: fixture.expected_routed_outcome.fact_subject,
        kind: fixture.expected_routed_outcome.fact_kind,
        provenance: expect.objectContaining({
          channel: fixture.expected_routed_outcome.provenance_channel,
          entered_by: 'client',
        }) as IntakeFactUpsertInput['provenance'],
        verification: fixture.expected_routed_outcome.verification,
      }),
    ]);
  });

  it('4. leaves an active onboarding request byte-for-byte unchanged while its standing sibling completes', async () => {
    const inbox = {
      envelopes: [] as RelayEnvelope[],
      blobs: new Map<number, Uint8Array>(),
    };
    const writtenPaths: string[] = [];
    configureAdvisorFetch((path) => {
      if (path.endsWith('/inbox'))
        return json({
          cursor: inbox.envelopes.length,
          has_more: false,
          submissions: inbox.envelopes,
        });
      const blobId = path.match(/\/blob\/(\d+)$/u)?.[1];
      if (blobId)
        return new Response(inbox.blobs.get(Number(blobId)), { status: 200 });
      return json({ ok: true });
    });
    const matterId = fixture.client_fact_seed.matter_id;
    const onboarding = await issueRequest({
      checklist: {
        request_id: 'onboarding-fixture-isolation',
        schema_version: 1,
        matter_id: matterId,
        kind: 'onboarding',
        items: [
          {
            t: 'doc_upload',
            item_id: 'onboarding-upload',
            label: 'Onboarding file',
            help_text: '',
            required: true,
            subject: 'primary',
            accepted_mime_types: ['application/pdf'],
            max_files: 1,
            max_bytes: 4096,
          },
        ],
      },
    });
    const standing = await issueRequest({
      checklist: fixtureRequest({
        requestId: 'standing-fixture-isolation',
        matterId,
      }),
    });
    const before = JSON.stringify(
      useIntakeStore.getState().intakesById[onboarding.record.intakeId]
    );
    const client = await submitFixtureResponses(standing);
    Object.assign(inbox, inboxFromClient(client));
    const sync = new IntakeSyncClient({
      relay: {
        fetchInbox: (cursor) =>
          standing.relay.fetchInbox(standing.record.intakeId, cursor),
        ackSubmission: (id, submissionId, cursor) =>
          standing.relay.ackSubmission(id, submissionId, cursor),
      },
      loadPrivateKey: () => Promise.resolve(standing.bundle.privateKey),
      hasSubmission: () => Promise.resolve(false),
      rememberSubmission: () => Promise.resolve(),
      getKnownSessionIds: () => Promise.resolve(['known-session']),
      rememberSession: () => Promise.resolve(),
      flagSubmission: () => Promise.resolve(),
      routeSubmission: (submission) =>
        routeIntakeSubmission(submission, {
          intake: standing.record,
          matterFolderPath: '/workspace/Demo Client',
          workspaceService: {} as never,
          upsertFact: (input) =>
            Promise.resolve({
              fact_id: 'isolation-fact',
              matter_id: input.matter_id,
              subject: input.subject,
              kind: input.kind,
              sensitivity: input.sensitivity,
              display_value: 'masked',
              provenance: input.provenance,
              verification: input.verification,
              status: 'active' as const,
            }),
          fileDocument: (input) => {
            const path = `/workspace/Demo Client/Requests/${input.requestSlug ?? 'onboarding'}/${input.fileName}`;
            writtenPaths.push(path);
            return Promise.resolve(path);
          },
        }),
    });
    await expect(sync.syncOnce()).resolves.toMatchObject({
      routed: 2,
      acked: 2,
    });
    expect(
      JSON.stringify(
        useIntakeStore.getState().intakesById[onboarding.record.intakeId]
      )
    ).toBe(before);
    expect(
      writtenPaths.some((path) => path.includes('/Requests/onboarding/'))
    ).toBe(false);
    expect(
      writtenPaths.some((path) =>
        path.includes(`/Requests/${requireSlug(standing.record)}/`)
      )
    ).toBe(true);
  });

  it('5. flags and leaves unacked every cross-request, unknown-item, wrong-class, conflicting, and over-limit submission', async () => {
    configureAdvisorFetch(() => json({ ok: true }));
    const standing = await issueRequest({
      checklist: fixtureRequest({ requestId: 'standing-fixture-rejections' }),
    });
    const onboarding = await issueRequest({
      checklist: {
        request_id: 'onboarding-fixture-rejections',
        schema_version: 1,
        matter_id: fixture.client_fact_seed.matter_id,
        kind: 'onboarding',
        items: [
          {
            t: 'typed_field',
            item_id: 'onboarding-beneficiary',
            label: 'Onboarding beneficiary',
            help_text: '',
            required: true,
            subject: 'primary',
            fact_kind: 'beneficiary',
            input: 'text',
          },
        ],
      },
    });
    const guided = requestItem(standing.record, 'guided_question');
    const upload = requestItem(standing.record, 'doc_upload');
    const invalids = await Promise.all([
      sealed({
        intakeId: onboarding.record.intakeId,
        itemId: guided.item_id,
        submissionId: 'wrong-onboarding-id',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintext: enc.encode(JSON.stringify({ answer: { amount: 1 } })),
        cursor: 1,
        blobId: 1,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: 'onboarding-beneficiary',
        submissionId: 'wrong-standing-id',
        publicKeyRaw: onboarding.bundle.publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintext: enc.encode(JSON.stringify({ value: 'x' })),
        cursor: 2,
        blobId: 2,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: 'ri_unknown_fixture',
        submissionId: 'unknown-item',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintext: enc.encode(JSON.stringify({ answer: { amount: 1 } })),
        cursor: 3,
        blobId: 3,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: upload.item_id,
        submissionId: 'json-for-upload',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintext: enc.encode(JSON.stringify({ value: 'no file' })),
        cursor: 4,
        blobId: 4,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: guided.item_id,
        submissionId: 'file-for-guided',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/pdf',
        fileNames: [fixture.upload.file_name],
        plaintext: fixtureUpload,
        cursor: 5,
        blobId: 5,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: guided.item_id,
        submissionId: 'conflicting-body',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/json',
        fileNames: [],
        plaintext: enc.encode(
          JSON.stringify({
            answer: { amount: 1 },
            fact_kind: 'ssn',
            subject: 'joint',
            response_format: 'text',
          })
        ),
        cursor: 6,
        blobId: 6,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: upload.item_id,
        submissionId: 'wrong-mime',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'image/png',
        fileNames: ['synthetic.png'],
        plaintext: fixtureUpload,
        cursor: 7,
        blobId: 7,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: upload.item_id,
        submissionId: 'too-many-files',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/pdf',
        fileNames: ['one.pdf', 'two.pdf'],
        plaintext: fixtureUpload,
        cursor: 8,
        blobId: 8,
      }),
      sealed({
        intakeId: standing.record.intakeId,
        itemId: upload.item_id,
        submissionId: 'too-many-bytes',
        publicKeyRaw: standing.bundle.publicKeyRaw,
        contentType: 'application/pdf',
        fileNames: [fixture.upload.file_name],
        plaintext: new Uint8Array(5000),
        cursor: 9,
        blobId: 9,
      }),
    ]);
    for (const invalid of invalids) {
      const acks: string[] = [];
      const flags: string[] = [];
      const sync = new IntakeSyncClient({
        relay: {
          fetchInbox: () =>
            Promise.resolve({
              cursor: invalid.envelope.cursor,
              has_more: false,
              submissions: [
                {
                  ...invalid.envelope,
                  chunks: [
                    {
                      intake_id: invalid.envelope.intake_id,
                      item_id: invalid.envelope.item_id,
                      submission_id: invalid.envelope.submission_id,
                      index: 0,
                      ciphertext_b64: btoa(
                        String.fromCharCode(...invalid.blob)
                      ),
                    },
                  ],
                },
              ],
            }),
          ackSubmission: (_id, submissionId) => {
            acks.push(submissionId);
            return Promise.resolve();
          },
        },
        loadPrivateKey: () =>
          Promise.resolve(
            invalid.envelope.submission_id === 'wrong-standing-id'
              ? onboarding.bundle.privateKey
              : standing.bundle.privateKey
          ),
        hasSubmission: () => Promise.resolve(false),
        rememberSubmission: () => Promise.resolve(),
        getKnownSessionIds: () => Promise.resolve(['known-session']),
        rememberSession: () => Promise.resolve(),
        flagSubmission: (flag) => {
          flags.push(flag.kind);
          return Promise.resolve();
        },
        routeSubmission: (submission) =>
          routeIntakeSubmission(submission, {
            intake: standing.record,
            matterFolderPath: '/workspace/Demo Client',
            workspaceService: {} as never,
            upsertFact: () => {
              throw new Error('Invalid submission wrote a fact.');
            },
            fileDocument: () => {
              throw new Error('Invalid submission filed a document.');
            },
          }),
      });
      await expect(sync.syncOnce()).resolves.toMatchObject({
        rejected: 1,
        acked: 0,
      });
      expect(acks).toEqual([]);
      expect(flags).toContain('routing_failed');
    }
  });

  it('7. inspects the serialized create, upload, submit, and inbox wires for standing-request leakage', async () => {
    const inbox = {
      envelopes: [] as RelayEnvelope[],
      blobs: new Map<number, Uint8Array>(),
    };
    const advisorCalls = configureAdvisorFetch((path) => {
      if (path.endsWith('/inbox'))
        return json({
          cursor: inbox.envelopes.length,
          has_more: false,
          submissions: inbox.envelopes,
        });
      const blobId = path.match(/\/blob\/(\d+)$/u)?.[1];
      if (blobId)
        return new Response(inbox.blobs.get(Number(blobId)), { status: 200 });
      return json({ ok: true });
    });
    const standing = await issueRequest({
      checklist: fixtureRequest({ requestId: 'standing-fixture-wire-proof' }),
      requestTitle: fixture.blueprint.label,
    });
    const client = await submitFixtureResponses(standing);
    Object.assign(inbox, inboxFromClient(client));
    await standing.relay.fetchInbox(standing.record.intakeId, 0);
    const wire = [...advisorCalls, ...client.calls]
      .map((call) => `${call.url}\n${call.body}`)
      .join('\n---\n');
    const forbidden = [
      fixture.client_fact_seed.matter_id,
      ...fixture.blueprint.items.flatMap((item) => [item.item_id, item.label]),
      fixture.blueprint.blueprintId,
      fixture.blueprint.label,
      String(fixture.client_fact_seed.value.amount),
      fixture.upload.file_name,
    ];
    for (const value of forbidden) expect(wire).not.toContain(value);
    const handles =
      standing.record.requestItems?.map((item) => item.item_id) ?? [];
    expect(handles).toHaveLength(fixture.blueprint.items.length);
    for (const handle of handles) {
      expect(handle).toMatch(/^ri_[a-f0-9]{36}$/u);
      for (const item of fixture.blueprint.items) {
        expect(handle).not.toContain(item.item_id);
        expect(handle).not.toContain(
          item.label.toLowerCase().replaceAll(' ', '-')
        );
        if ('fact_kind' in item) expect(handle).not.toContain(item.fact_kind);
      }
    }
  });
});
