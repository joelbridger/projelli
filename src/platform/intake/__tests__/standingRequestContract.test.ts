import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/features/intake/welcomeJourneyDefaults';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { createAdvisorIntake } from '../createIntake';
import { hashPlaintextChunk } from '../chunkHash';
import { generateContentKey, importContentKey, sealItemChunk, sealManifest, wrapContentKey, type SealedManifest } from '../intakeCrypto';
import { IntakeRelayClient } from '../IntakeRelayClient';
import { IntakeSyncClient } from '../IntakeSyncClient';
import { useIntakeStore } from '../intakeStore';
import { routeIntakeSubmission } from '../useIntakeInboxSync';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

const enc = new TextEncoder();
const fetchMock = vi.fn();

function b64ToBytes(value: string): Uint8Array {
  const raw = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
function json(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200 }); }

async function sealed(input: {
  intakeId: string; itemId: string; submissionId: string; publicKeyRaw: Uint8Array;
  contentType: string; fileNames: string[]; plaintext: Uint8Array; cursor: number; blobId: number;
}) {
  const keyB64 = await generateContentKey();
  const key = await importContentKey(keyB64);
  const manifest: SealedManifest = {
    submission_id: input.submissionId, item_id: input.itemId, content_type: input.contentType,
    file_names: input.fileNames, chunk_hashes: [await hashPlaintextChunk(input.plaintext)], chunk_count: 1,
  };
  return {
    envelope: {
      cursor: input.cursor, intake_id: input.intakeId, item_id: input.itemId, submission_id: input.submissionId,
      submitted_at: '2026-07-10T10:00:00.000Z',
      manifest_ciphertext_b64: await sealManifest(key, manifest, { intakeId: input.intakeId, itemId: input.itemId, submissionId: input.submissionId }),
      wrapped_content_key_b64: await wrapContentKey(keyB64, input.publicKeyRaw), chunk_count: 1,
      blobs: [{ blob_id: input.blobId, index: 0, size: input.plaintext.byteLength }],
    },
    blob: b64ToBytes(await sealItemChunk(key, input.plaintext, { intakeId: input.intakeId, itemId: input.itemId, submissionId: input.submissionId, index: 0 })),
  };
}

describe('standing request receiver-owned contract', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock as unknown as typeof fetch);
    useIntakeStore.getState().resetForTests();
    localStorage.clear();
  });

  it('keeps request meaning sealed locally and files real encrypted JSON and file submissions by the contract', async () => {
    const relay = new IntakeRelayClient({ baseUrl: 'https://relay.test', seatToken: 'seat' });
    const createdBodies: string[] = [];
    const intakeId = 'standing-1';
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof url === 'string' ? url : url.toString()).pathname;
      if (path === '/intake') { createdBodies.push(String(init?.body)); return Promise.resolve(json({ ok: true, intake_id: intakeId })); }
      return Promise.resolve(json({ ok: true }));
    });
    const bundle = await createAdvisorIntake({
      intakeId, matterId: 'matter-secret', intakeHost: 'https://forms.test', expiresAt: '2026-08-01T00:00:00.000Z',
      checklist: { request_id: intakeId, schema_version: 1, matter_id: 'matter-secret', kind: 'standing', items: [
        { t: 'guided_question', item_id: 'income_annual', label: 'Income', help_text: '', required: true, subject: 'household', prompt: 'Income?', response_format: 'money', fact_kind: 'income_annual' },
        { t: 'doc_upload', item_id: 'tax_return', label: 'Tax return', help_text: '', required: true, subject: 'household', accepted_mime_types: ['application/pdf'], max_files: 1, max_bytes: 1024 },
      ] },
      clientFirstName: 'Sarah', firm: { name: 'North Star', accent: '#000', advisor_name: 'Ada', advisor_email: 'ada@test', next_steps: [], journey: DEFAULT_WELCOME_JOURNEY }, relay,
      requestTitle: 'Tax review', requestSlug: 'tax-review-a1',
    });
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0]).not.toContain('matter-secret');
    expect(createdBodies[0]).not.toContain('income_annual');
    expect(createdBodies[0]).not.toContain('household');
    const record = useIntakeStore.getState().intakesById[intakeId]!;
    expect(record.requestItems?.map((item) => item.item_id)).toEqual(expect.arrayContaining([expect.stringMatching(/^ri_/u), expect.stringMatching(/^ri_/u)]));
    const jsonItem = record.requestItems!.find((item) => item.t === 'guided_question')!;
    const fileItem = record.requestItems!.find((item) => item.t === 'doc_upload')!;
    const one = await sealed({ intakeId, itemId: jsonItem.item_id, submissionId: 'answer', publicKeyRaw: bundle.publicKeyRaw, contentType: 'application/json', fileNames: [], plaintext: enc.encode(JSON.stringify({ answer: { amount: 91000, currency: 'USD' } })), cursor: 1, blobId: 11 });
    const two = await sealed({ intakeId, itemId: fileItem.item_id, submissionId: 'file', publicKeyRaw: bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: ['return.pdf'], plaintext: enc.encode('pdf'), cursor: 2, blobId: 12 });
    const blobs = new Map([[11, one.blob], [12, two.blob]]);
    const acks: string[] = [];
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const parsed = new URL(typeof url === 'string' ? url : url.toString());
      if (parsed.pathname.endsWith('/inbox')) return Promise.resolve(json({ cursor: 2, has_more: false, submissions: [one.envelope, two.envelope] }));
      const match = parsed.pathname.match(/\/blob\/(\d+)$/u);
      if (match) return Promise.resolve(new Response(blobs.get(Number(match[1])), { status: 200 }));
      if (parsed.pathname.endsWith('/ack')) { acks.push(...((JSON.parse(String(init?.body)) as { submission_ids: string[] }).submission_ids)); return Promise.resolve(json({ ok: true })); }
      return Promise.resolve(json({ ok: true }));
    });
    const facts: unknown[] = []; const paths: string[] = [];
    const sync = new IntakeSyncClient({
      relay: { fetchInbox: (cursor) => relay.fetchInbox(intakeId, cursor), ackSubmission: (id, submissionId, cursor) => relay.ackSubmission(id, submissionId, cursor) },
      loadPrivateKey: () => Promise.resolve(bundle.privateKey), hasSubmission: () => Promise.resolve(false), rememberSubmission: () => Promise.resolve(), isKnownSession: () => Promise.resolve(true), rememberSession: () => Promise.resolve(), flagSubmission: () => Promise.resolve(),
      routeSubmission: (submission) => routeIntakeSubmission(submission, { intake: record, matterFolderPath: '/workspace/Sarah', workspaceService: {} as never,
        upsertFact: (input) => { facts.push(input); return Promise.resolve({ fact_id: 'fact', matter_id: input.matter_id, subject: input.subject, kind: input.kind, sensitivity: input.sensitivity, display_value: 'x', provenance: input.provenance, verification: input.verification, status: 'active' as const }); },
        fileDocument: (input) => { paths.push(`/workspace/Sarah/Requests/${input.requestSlug}/${input.fileName}`); return Promise.resolve(paths[paths.length - 1]!); },
      }),
    });
    await expect(sync.syncOnce()).resolves.toMatchObject({ routed: 2, acked: 2 });
    expect(acks).toEqual(['answer', 'file']);
    expect(facts).toEqual([expect.objectContaining({ kind: 'income_annual', subject: 'household' })]);
    expect(paths).toEqual(['/workspace/Sarah/Requests/tax-review-a1/return.pdf']);
  });
});
