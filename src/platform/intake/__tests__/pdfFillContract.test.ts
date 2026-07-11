import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/features/intake/welcomeJourneyDefaults';
import { assertValidRequestBlueprint } from '@/platform/intake/blueprintValidation';
import { assertSendableRequest, createAdvisorIntake } from '@/platform/intake/createIntake';
import {
  derivePageKey,
  generateContentKey,
  importContentKey,
  sealItemChunk,
  sealManifest,
  wrapContentKey,
  type SealedManifest,
} from '@/platform/intake/intakeCrypto';
import { loadIntakeLinkSecret, loadPdfTemplateDescriptor } from '@/platform/intake/intakeKeychain';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { IntakeSyncClient, type IntakeInboxSubmission, type IntakeSubmissionFlag } from '@/platform/intake/IntakeSyncClient';
import { partializeIntakeStateForPersistence, useIntakeStore } from '@/platform/intake/intakeStore';
import { openPageJson } from '@/platform/intake/pageSeal';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { RelayClient } from '../../../../intake-page/src/relayClient';
import { preparePdfFillSubmission } from '../../../../intake-page/src/pdfFill/preparePdfFillSubmission';
import { submitAnswer } from '../../../../intake-page/src/submission';
import { syntheticAcroFormPdf } from '../../../../intake-page/tests/fixtures/pdfFixtures';
import { hashPlaintextChunk } from '../chunkHash';
import type { ChunkUpload, SubmitManifest } from '../intakeContract';
import type { IntakeRecord } from '../intakeStore';
import type { FormRequest, PdfCompletionReceipt, PdfTemplateDescriptor, RequestItem } from '../types';
import { routeIntakeSubmission } from '../useIntakeInboxSync';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

const fetchMock = vi.fn();
const encoder = new TextEncoder();

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

interface ClientRelayCapture {
  calls: Array<{ url: string; body: string }>;
  chunks: ChunkUpload[];
  manifests: SubmitManifest[];
}

interface RelayServer {
  envelopesByIntake: Map<string, RelayEnvelope[]>;
  blobs: Map<number, Uint8Array>;
  acknowledgements: string[];
  ingest: (capture: ClientRelayCapture) => void;
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function urlString(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.toString();
  return url.url;
}

function bodyString(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function requestItem(record: IntakeRecord, type: RequestItem['t']): RequestItem {
  const item = record.requestItems?.find((candidate) => candidate.t === type);
  if (!item) throw new Error(`Expected a ${type} request item.`);
  return item;
}

function requestSlug(record: IntakeRecord): string {
  if (!record.requestSlug) throw new Error('Expected a generated standing-request slug.');
  return record.requestSlug;
}

function installRelayServer(): RelayServer {
  const envelopesByIntake = new Map<string, RelayEnvelope[]>();
  const blobs = new Map<number, Uint8Array>();
  const acknowledgements: string[] = [];
  let nextBlobId = 700;

  fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(urlString(url));
    const inboxMatch = parsed.pathname.match(/^\/intake\/([^/]+)\/inbox$/u);
    if (inboxMatch) {
      const intakeId = decodeURIComponent(inboxMatch[1] ?? '');
      const submissions = envelopesByIntake.get(intakeId) ?? [];
      return Promise.resolve(response({ intake_id: intakeId, cursor: submissions.length, latest_cursor: submissions.length, has_more: false, submissions }));
    }
    const blobMatch = parsed.pathname.match(/^\/intake\/([^/]+)\/blob\/(\d+)$/u);
    if (blobMatch) {
      const bytes = blobs.get(Number(blobMatch[2]));
      return Promise.resolve(bytes ? new Response(bytes, { status: 200 }) : response({ error: 'missing blob' }));
    }
    if (parsed.pathname.endsWith('/ack')) {
      const body = JSON.parse(bodyString(init) || '{}') as { submission_ids?: string[] };
      acknowledgements.push(...(body.submission_ids ?? []));
      return Promise.resolve(response({ ok: true }));
    }
    return Promise.resolve(response({ ok: true }));
  });

  return {
    envelopesByIntake,
    blobs,
    acknowledgements,
    ingest(capture) {
      const manifests = capture.manifests;
      for (const [submissionIndex, manifest] of manifests.entries()) {
        const matchingChunks = capture.chunks.filter((chunk) => chunk.submission_id === manifest.submission_id);
        const refs = matchingChunks.map((chunk) => {
          nextBlobId += 1;
          const ciphertext = b64ToBytes(chunk.ciphertext_b64);
          blobs.set(nextBlobId, ciphertext);
          return { blob_id: nextBlobId, index: chunk.index, size: ciphertext.byteLength };
        });
        const existing = envelopesByIntake.get(manifest.intake_id) ?? [];
        existing.push({
          cursor: existing.length + submissionIndex + 1,
          intake_id: manifest.intake_id,
          item_id: manifest.item_id,
          submission_id: manifest.submission_id,
          submitted_at: '2026-07-11T12:00:00.000Z',
          manifest_ciphertext_b64: manifest.manifest_ciphertext_b64,
          wrapped_content_key_b64: manifest.wrapped_content_key_b64,
          chunk_count: refs.length,
          blobs: refs,
        });
        envelopesByIntake.set(manifest.intake_id, existing);
      }
    },
  };
}

function installClientRelay(): ClientRelayCapture {
  const calls: Array<{ url: string; body: string }> = [];
  const chunks: ChunkUpload[] = [];
  const manifests: SubmitManifest[] = [];
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const urlValue = urlString(url);
    const body = bodyString(init);
    calls.push({ url: urlValue, body });
    const pathname = new URL(urlValue, 'https://intake-page.synthetic.invalid').pathname;
    if (pathname.endsWith('/chunks')) return Promise.resolve(response({ uploaded_indexes: [] }));
    if (pathname.endsWith('/chunk')) {
      chunks.push(JSON.parse(body) as ChunkUpload);
      return Promise.resolve(response({ ok: true }));
    }
    if (pathname.endsWith('/submit')) {
      manifests.push(JSON.parse(body) as SubmitManifest);
      return Promise.resolve(response({ ok: true }));
    }
    return Promise.resolve(response({ ok: true }));
  }));
  return { calls, chunks, manifests };
}

async function realPdfTemplate(overrides: Partial<PdfTemplateDescriptor> = {}): Promise<{
  sourceBytes: Uint8Array;
  template: PdfTemplateDescriptor;
}> {
  const sourceBytes = await syntheticAcroFormPdf();
  return {
    sourceBytes,
    template: {
      templateId: 'template_approved_04',
      version: 1,
      kind: 'acroform',
      sourceSha256: await sha256Hex(sourceBytes),
      sourceArtifactRef: 'sealed-artifact:approvedartifact0004',
      outputFileStem: 'client-information',
      maxOutputBytes: 1024 * 1024,
      fields: {
        client_name: {
          kind: 'acroform', field_id: 'client_name', acroform_field: 'Client.Name', pdf_field_type: 'text', required: true,
        },
      },
      ...overrides,
    } as PdfTemplateDescriptor,
  };
}

async function submitPreparedPdf(input: {
  issued: Awaited<ReturnType<typeof issue>>;
  prepared: Awaited<ReturnType<typeof preparePdfFillSubmission>>;
  submissionId?: string;
}): Promise<ClientRelayCapture> {
  const capture = installClientRelay();
  const item = requestItem(input.issued.record, 'pdf_fill');
  await submitAnswer({
    intakeId: input.issued.record.intakeId,
    intakePubRaw: input.issued.bundle.publicKeyRaw,
    item,
    payload: { kind: 'files', files: [input.prepared.file], pdf_completion_receipt: input.prepared.receipt },
    relay: new RelayClient(input.issued.record.intakeId, input.issued.bundle.tokenB64),
    sessionId: 'pdf-contract-session',
    ...(input.submissionId ? { resumeSubmissionId: input.submissionId } : {}),
  });
  return capture;
}

function recordingWorkspace() {
  const paths: string[] = [];
  return {
    paths,
    workspaceService: {
      writeFileBinary: async (path: string) => { paths.push(path); },
    } as never,
  };
}

async function syncIssued(input: {
  issued: Awaited<ReturnType<typeof issue>>;
  workspaceService: never;
  intake?: IntakeRecord;
  flags?: IntakeSubmissionFlag[];
}) {
  const intake = input.intake ?? input.issued.record;
  const flags = input.flags ?? [];
  const sync = new IntakeSyncClient({
    relay: {
      fetchInbox: (cursor) => input.issued.relay.fetchInbox(input.issued.record.intakeId, cursor),
      ackSubmission: (_intakeId, submissionId, cursor) => input.issued.relay.ackSubmission(input.issued.record.intakeId, submissionId, cursor),
    },
    loadPrivateKey: () => Promise.resolve(input.issued.bundle.privateKey),
    hasSubmission: () => Promise.resolve(false),
    rememberSubmission: () => Promise.resolve(),
    isKnownSession: () => Promise.resolve(true),
    rememberSession: () => Promise.resolve(),
    flagSubmission: (flag) => { flags.push(flag); return Promise.resolve(); },
    routeSubmission: (submission) => routeIntakeSubmission(submission, {
      intake,
      matterFolderPath: '/workspace/Avery',
      workspaceService: input.workspaceService,
    }),
  });
  return sync.syncOnce();
}

async function sealedPdfSubmission(input: {
  intakeId: string;
  itemId: string;
  submissionId: string;
  publicKeyRaw: Uint8Array;
  contentType: string;
  fileNames: string[];
  bytes: Uint8Array;
  receipt: PdfCompletionReceipt;
  cursor?: number;
}): Promise<IntakeInboxSubmission> {
  const contentKeyB64 = await generateContentKey();
  const contentKey = await importContentKey(contentKeyB64);
  const manifest: SealedManifest & { pdf_completion_receipt: PdfCompletionReceipt } = {
    submission_id: input.submissionId,
    item_id: input.itemId,
    content_type: input.contentType,
    file_names: input.fileNames,
    chunk_hashes: [await hashPlaintextChunk(input.bytes)],
    chunk_count: 1,
    pdf_completion_receipt: input.receipt,
  };
  return {
    cursor: input.cursor ?? 1,
    intake_id: input.intakeId,
    item_id: input.itemId,
    submission_id: input.submissionId,
    submitted_at: '2026-07-11T12:00:00.000Z',
    manifest_ciphertext_b64: await sealManifest(contentKey, manifest, {
      intakeId: input.intakeId, itemId: input.itemId, submissionId: input.submissionId,
    }),
    wrapped_content_key_b64: await wrapContentKey(contentKeyB64, input.publicKeyRaw),
    chunks: [{
      intake_id: input.intakeId,
      item_id: input.itemId,
      submission_id: input.submissionId,
      index: 0,
      ciphertext_b64: await sealItemChunk(contentKey, input.bytes, {
        intakeId: input.intakeId, itemId: input.itemId, submissionId: input.submissionId, index: 0,
      }),
    }],
  };
}

function enqueueSealedSubmission(server: RelayServer, submission: IntakeInboxSubmission): void {
  const blobId = 9000 + server.blobs.size;
  const chunk = submission.chunks[0];
  if (!chunk) throw new Error('Expected one sealed PDF chunk.');
  const ciphertext = b64ToBytes(chunk.ciphertext_b64);
  server.blobs.set(blobId, ciphertext);
  server.envelopesByIntake.set(submission.intake_id, [{
    cursor: submission.cursor,
    intake_id: submission.intake_id,
    item_id: submission.item_id,
    submission_id: submission.submission_id,
    submitted_at: submission.submitted_at,
    manifest_ciphertext_b64: submission.manifest_ciphertext_b64,
    wrapped_content_key_b64: submission.wrapped_content_key_b64,
    chunk_count: 1,
    blobs: [{ blob_id: blobId, index: 0, size: ciphertext.byteLength }],
  }]);
}

function approvedTemplate(overrides: Record<string, unknown> = {}): PdfTemplateDescriptor {
  return {
    templateId: 'template_approved_04', version: 1, kind: 'acroform', sourceSha256: 'a'.repeat(64),
    sourceArtifactRef: 'sealed-artifact:approvedartifact0004', outputFileStem: 'client-information', maxOutputBytes: 1024 * 1024,
    fields: {
      client_name: {
        kind: 'acroform', field_id: 'client_name', acroform_field: 'Client.Name', pdf_field_type: 'text', required: true,
      },
    },
    ...overrides,
  } as PdfTemplateDescriptor;
}

function request(items: RequestItem[]): FormRequest {
  return {
    request_id: 'pdf-contract-request', schema_version: 1, matter_id: 'matter-private-004', kind: 'standing', items,
  };
}

function pdfItem(template = approvedTemplate(), itemId = 'client-form-logical-id'): Extract<RequestItem, { t: 'pdf_fill' }> {
  return {
    t: 'pdf_fill', item_id: itemId, label: 'Client information form', help_text: '',
    required: true, subject: 'primary', template, prefill: [],
  };
}

function relay(): IntakeRelayClient {
  return new IntakeRelayClient({ baseUrl: 'https://relay.test', seatToken: 'synthetic-seat' });
}

function firm() {
  return {
    name: 'Synthetic Harbor Advisory', accent: '#123456', advisor_name: 'Ada',
    advisor_email: 'ada@example.invalid', next_steps: [], journey: DEFAULT_WELCOME_JOURNEY,
  };
}

async function issue(checklist: FormRequest) {
  const relayClient = relay();
  const bundle = await createAdvisorIntake({
    intakeId: checklist.request_id, matterId: checklist.matter_id, intakeHost: 'https://forms.test',
    expiresAt: '2026-12-01T00:00:00.000Z', checklist, clientFirstName: 'Avery', firm: firm(), relay: relayClient,
  });
  const record = useIntakeStore.getState().intakesById[checklist.request_id];
  if (!record) throw new Error('Expected the issued intake record.');
  return { ...bundle, bundle, record, relay: relayClient };
}

describe('Wave 8 encrypted PDF-fill contract gate', () => {
  beforeEach(() => {
    localStorage.clear();
    useIntakeStore.getState().resetForTests();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock as unknown as typeof fetch);
  });

  it('seals an approved immutable template with an opaque handle and no template or matter metadata on the create wire', async () => {
    const checklist = request([pdfItem()]);
    await issue(checklist);

    const record = useIntakeStore.getState().intakesById[checklist.request_id];
    expect(record?.matterId).toBe(checklist.matter_id);
    expect(record?.intakeId).not.toBe('template_approved_04');
    expect(record?.requestItems?.[0]?.item_id).toMatch(/^ri_[a-f0-9]{36}$/u);
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    const body = calls[0]?.[1]?.body;
    const wire = typeof body === 'string' ? body : '';
    for (const forbidden of [
      checklist.matter_id, 'template_approved_04', 'client_name',
      'sealed-artifact:approvedartifact0004', 'a'.repeat(64), 'client-form-logical-id',
    ]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it('keeps complete PDF templates out of persisted state while retaining them in the sealed checklist and keychain', async () => {
    const template = approvedTemplate();
    const checklist = request([pdfItem(template)]);
    const bundle = await issue(checklist);
    const record = useIntakeStore.getState().intakesById[checklist.request_id];
    if (!record) throw new Error('Expected the issued intake to be stored.');

    const serialized = JSON.stringify(partializeIntakeStateForPersistence({
      intakesById: { [record.intakeId]: record },
    }));
    for (const forbidden of [
      'sourceSha256', template.sourceSha256,
      'sourceArtifactRef', template.sourceArtifactRef,
      'acroform_field', template.fields['client_name']?.kind === 'acroform'
        ? template.fields['client_name'].acroform_field
        : '',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const storedItem = record.requestItems?.find((item) => item.t === 'pdf_fill');
    if (!storedItem || storedItem.t !== 'pdf_fill') throw new Error('Expected the PDF request item.');
    expect(storedItem.template).toEqual({
      templateId: template.templateId,
      version: template.version,
      kind: template.kind,
    });
    await expect(loadPdfTemplateDescriptor(record.intakeId, storedItem.item_id)).resolves.toEqual(template);

    const sealedChecklist = await openPageJson<FormRequest>(
      await derivePageKey(b64ToBytes(bundle.linkSecretB64)),
      bundle.checklistCiphertextB64,
    );
    const sealedPdfItem = sealedChecklist.items.find((item) => item.t === 'pdf_fill');
    if (!sealedPdfItem || sealedPdfItem.t !== 'pdf_fill') throw new Error('Expected the sealed PDF request item.');
    expect(sealedPdfItem.template).toEqual(template);
  });

  it.each([
    ['bad hash', approvedTemplate({ sourceSha256: 'bad' })],
    ['signature field', approvedTemplate({ fields: { signature: { kind: 'acroform', field_id: 'signature', acroform_field: 'Signature', pdf_field_type: 'signature' } } })],
    ['URL artifact', approvedTemplate({ sourceArtifactRef: 'https://custodian.example/form.pdf' })],
    ['duplicate field id', approvedTemplate({ fields: {
      first: { kind: 'acroform', field_id: 'same', acroform_field: 'First', pdf_field_type: 'text' },
      second: { kind: 'acroform', field_id: 'same', acroform_field: 'Second', pdf_field_type: 'text' },
    } })],
  ])('fails %s before storing secrets or calling the relay', async (_name, template) => {
    const checklist = request([pdfItem(template)]);
    await expect(issue(checklist)).rejects.toThrow(/pdf_fill/iu);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(loadIntakeLinkSecret(checklist.request_id)).resolves.toBeNull();
    expect(useIntakeStore.getState().intakesById[checklist.request_id]).toBeUndefined();
  });

  it('continues to reject signatures and fails closed for the retired Wave 7 shape', () => {
    expect(() => { assertSendableRequest([
      { t: 'signature', item_id: 'sign', label: 'Sign', help_text: '', required: true, subject: 'primary', grade: 'native_clicksign' },
    ]); }).toThrow(/signature/iu);
    const oldWave7 = {
      t: 'pdf_fill', item_id: 'old-form', label: 'Old form', help_text: '', required: true, subject: 'primary',
      pdf_ref: 'forms/old.pdf', field_map: {}, prefill: [],
    };
    expect(() => { assertValidRequestBlueprint({
      blueprintId: 'old-pdf', schemaVersion: 1, label: 'Old PDF', source: 'firm_saved', defaultKind: 'standing',
      items: [oldWave7] as never,
    }); }).toThrow(/template is not approved/iu);
    expect(() => { assertSendableRequest([oldWave7] as never); }).toThrow(/pdf_fill/iu);
  });

  it('fills a sealed source locally, flattens it, and seals a receipt with the encrypted PDF submission', async () => {
    const { sourceBytes, template } = await realPdfTemplate();
    const result = await preparePdfFillSubmission({ sourceBytes, template, values: { client_name: 'Avery Chen' } });
    expect(result.contentType).toBe('application/pdf');
    expect(result.fileName).not.toContain('client-information');
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(result.pdfBytes).not.toEqual(sourceBytes);
    expect(result.receipt).toEqual(expect.objectContaining({
      templateId: template.templateId,
      sourceSha256: template.sourceSha256,
      completedSha256: await sha256Hex(result.pdfBytes),
    }));
  });

  it('decrypts, verifies, files only beneath the matching request forms folder, then acknowledges', async () => {
    const server = installRelayServer();
    const { sourceBytes, template } = await realPdfTemplate();
    const issued = await issue(request([pdfItem(template)]));
    const prepared = await preparePdfFillSubmission({ sourceBytes, template, values: { client_name: 'Avery Chen' } });
    const capture = await submitPreparedPdf({ issued, prepared, submissionId: 'pdf-valid-submission' });
    server.ingest(capture);
    const workspace = recordingWorkspace();

    await expect(syncIssued({ issued, workspaceService: workspace.workspaceService })).resolves.toMatchObject({ routed: 1, acked: 1, rejected: 0 });
    const expectedPath = `/workspace/Avery/Requests/${requestSlug(issued.record)}/forms/completed-form-pdf-valid-submission.pdf`;
    expect(workspace.paths).toEqual([expectedPath]);
    expect(expectedPath).not.toContain('/Requests/onboarding/');
    expect(server.acknowledgements).toEqual(['pdf-valid-submission']);
    expect(useIntakeStore.getState().intakesById[issued.record.intakeId]?.items.find((item) => item.itemId === requestItem(issued.record, 'pdf_fill').item_id)?.state).toBe('received');
    await expect(loadPdfTemplateDescriptor(issued.record.intakeId, requestItem(issued.record, 'pdf_fill').item_id)).resolves.toEqual(template);
  });

  it('integrity-flags changed hashes, wrong handles, non-PDF payloads, multiple files, active forms, and receipt mismatches', async () => {
    const server = installRelayServer();
    const { sourceBytes, template } = await realPdfTemplate();
    const alternateTemplate = { ...template, templateId: 'template_approved_05' };
    const issued = await issue(request([pdfItem(template), pdfItem(alternateTemplate, 'alternate-logical-id')]));
    const prepared = await preparePdfFillSubmission({ sourceBytes, template, values: { client_name: 'Avery Chen' } });
    const primaryItem = requestItem(issued.record, 'pdf_fill');
    const alternateItem = issued.record.requestItems?.find((item) => item.t === 'pdf_fill' && item.item_id !== primaryItem.item_id);
    if (!alternateItem) throw new Error('Expected the alternate opaque PDF-fill handle.');
    const other = await issue({ ...request([pdfItem(template)]), request_id: 'pdf-other-request' });
    const otherItem = requestItem(other.record, 'pdf_fill');
    const unsafeInteractive = sourceBytes;
    const unsafeActive = new Uint8Array([...prepared.pdfBytes, ...encoder.encode('\n/JavaScript (unsafe)\n')]);

    const cases: Array<{
      name: string;
      carrier?: typeof issued;
      routeIntake?: IntakeRecord;
      itemId: string;
      intakeId: string;
      publicKeyRaw: Uint8Array;
      contentType: string;
      fileNames: string[];
      bytes: Uint8Array;
      receipt: PdfCompletionReceipt;
      expectedRecord: IntakeRecord;
    }> = [
      { name: 'changed-template-hash', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: [prepared.fileName], bytes: prepared.pdfBytes, receipt: { ...prepared.receipt, sourceSha256: '0'.repeat(64) }, expectedRecord: issued.record },
      { name: 'wrong-opaque-handle', itemId: alternateItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: [prepared.fileName], bytes: prepared.pdfBytes, receipt: prepared.receipt, expectedRecord: issued.record },
      { name: 'json-payload', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/json', fileNames: [], bytes: encoder.encode(JSON.stringify({ value: 'not a form' })), receipt: prepared.receipt, expectedRecord: issued.record },
      { name: 'non-pdf-mime', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'image/png', fileNames: [prepared.fileName], bytes: prepared.pdfBytes, receipt: prepared.receipt, expectedRecord: issued.record },
      { name: 'multiple-files', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: ['one.pdf', 'two.pdf'], bytes: prepared.pdfBytes, receipt: prepared.receipt, expectedRecord: issued.record },
      { name: 'interactive-pdf', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: [prepared.fileName], bytes: unsafeInteractive, receipt: { ...prepared.receipt, completedSha256: await sha256Hex(unsafeInteractive) }, expectedRecord: issued.record },
      { name: 'active-content', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: [prepared.fileName], bytes: unsafeActive, receipt: { ...prepared.receipt, completedSha256: await sha256Hex(unsafeActive) }, expectedRecord: issued.record },
      { name: 'receipt-hash-mismatch', itemId: primaryItem.item_id, intakeId: issued.record.intakeId, publicKeyRaw: issued.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: [prepared.fileName], bytes: prepared.pdfBytes, receipt: { ...prepared.receipt, completedSha256: 'f'.repeat(64) }, expectedRecord: issued.record },
      { name: 'other-request', carrier: other, routeIntake: issued.record, itemId: otherItem.item_id, intakeId: other.record.intakeId, publicKeyRaw: other.bundle.publicKeyRaw, contentType: 'application/pdf', fileNames: [prepared.fileName], bytes: prepared.pdfBytes, receipt: prepared.receipt, expectedRecord: other.record },
    ];

    for (const invalid of cases) {
      server.envelopesByIntake.clear();
      server.acknowledgements.length = 0;
      const submission = await sealedPdfSubmission({
        intakeId: invalid.intakeId, itemId: invalid.itemId, submissionId: `invalid-${invalid.name}`,
        publicKeyRaw: invalid.publicKeyRaw, contentType: invalid.contentType, fileNames: invalid.fileNames,
        bytes: invalid.bytes, receipt: invalid.receipt,
      });
      enqueueSealedSubmission(server, submission);
      const flags: IntakeSubmissionFlag[] = [];
      const workspace = recordingWorkspace();
      const carrier = invalid.carrier ?? issued;
      await expect(syncIssued({
        issued: carrier,
        ...(invalid.routeIntake ? { intake: invalid.routeIntake } : {}),
        workspaceService: workspace.workspaceService,
        flags,
      })).resolves.toMatchObject({ routed: 0, acked: 0, rejected: 1 });
      expect(server.acknowledgements, invalid.name).toEqual([]);
      expect(flags, invalid.name).toEqual([expect.objectContaining({ submissionId: `invalid-${invalid.name}` })]);
      expect(workspace.paths, invalid.name).toEqual([]);
      const state = useIntakeStore.getState().intakesById[invalid.expectedRecord.intakeId]?.items.find((item) => item.itemId === invalid.itemId)?.state;
      expect(state, invalid.name).toBe('needs_followup');
    }
  });

  it('keeps an onboarding request isolated from a same-matter PDF-fill request', async () => {
    const server = installRelayServer();
    const { sourceBytes, template } = await realPdfTemplate();
    const matterId = 'matter-shared-pdf-isolation';
    const onboarding = await issue({
      request_id: 'onboarding-pdf-isolation', schema_version: 1, matter_id: matterId, kind: 'onboarding',
      items: [{ t: 'doc_upload', item_id: 'onboarding-file', label: 'Onboarding file', help_text: '', required: true, subject: 'primary', accepted_mime_types: ['application/pdf'] }],
    });
    const standing = await issue({ ...request([pdfItem(template)]), request_id: 'standing-pdf-isolation', matter_id: matterId });
    const prepared = await preparePdfFillSubmission({ sourceBytes, template, values: { client_name: 'Avery Chen' } });
    const onboardingCapture = installClientRelay();
    const onboardingItem = requestItem(onboarding.record, 'doc_upload');
    await submitAnswer({
      intakeId: onboarding.record.intakeId, intakePubRaw: onboarding.bundle.publicKeyRaw, item: onboardingItem,
      payload: { kind: 'files', files: [new File([prepared.pdfBytes], 'onboarding.pdf', { type: 'application/pdf' })] },
      relay: new RelayClient(onboarding.record.intakeId, onboarding.bundle.tokenB64), sessionId: 'onboarding-session',
    });
    const standingCapture = await submitPreparedPdf({ issued: standing, prepared, submissionId: 'standing-pdf-isolation-submission' });
    server.ingest(onboardingCapture);
    server.ingest(standingCapture);
    const onboardingWorkspace = recordingWorkspace();
    const standingWorkspace = recordingWorkspace();
    await expect(syncIssued({ issued: onboarding, workspaceService: onboardingWorkspace.workspaceService })).resolves.toMatchObject({ routed: 1, acked: 1 });
    await expect(syncIssued({ issued: standing, workspaceService: standingWorkspace.workspaceService })).resolves.toMatchObject({ routed: 1, acked: 1 });
    expect(onboardingWorkspace.paths).toEqual(['/workspace/Avery/Requests/onboarding/onboarding.pdf']);
    expect(standingWorkspace.paths).toEqual([`/workspace/Avery/Requests/${requestSlug(standing.record)}/forms/completed-form-standing-pdf-isolation-submission.pdf`]);
    expect(standingWorkspace.paths.join('\n')).not.toContain('/Requests/onboarding/');

    const manipulatedOnboarding = { ...standing.record, kind: 'onboarding' as const, requestSlug: 'onboarding' };
    const directWorkspace = recordingWorkspace();
    await expect(routeIntakeSubmission({
      intakeId: standing.record.intakeId,
      itemId: requestItem(standing.record, 'pdf_fill').item_id,
      submissionId: 'manipulated-onboarding-pdf-fill',
      submittedAt: '2026-07-11T12:00:00.000Z',
      manifest: {
        submission_id: 'manipulated-onboarding-pdf-fill', item_id: requestItem(standing.record, 'pdf_fill').item_id,
        content_type: 'application/pdf', file_names: [prepared.fileName], chunk_hashes: [await hashPlaintextChunk(prepared.pdfBytes)], chunk_count: 1,
        pdf_completion_receipt: prepared.receipt,
      } as SealedManifest & { pdf_completion_receipt: PdfCompletionReceipt },
      plaintextBytes: [prepared.pdfBytes],
    }, { intake: manipulatedOnboarding, matterFolderPath: '/workspace/Avery', workspaceService: directWorkspace.workspaceService })).rejects.toThrow(/standing request/i);
    expect(directWorkspace.paths).toEqual([]);
  });

  it('inspects create, chunk, manifest, and inbox wires for every prohibited PDF plaintext', async () => {
    const server = installRelayServer();
    const { sourceBytes, template } = await realPdfTemplate();
    const checklist = request([pdfItem(template)]);
    const issued = await issue(checklist);
    const prepared = await preparePdfFillSubmission({ sourceBytes, template, values: { client_name: 'Avery Chen' } });
    const capture = await submitPreparedPdf({ issued, prepared, submissionId: 'pdf-wire-inspection' });
    server.ingest(capture);
    const workspace = recordingWorkspace();
    await expect(syncIssued({ issued, workspaceService: workspace.workspaceService })).resolves.toMatchObject({ routed: 1, acked: 1 });

    const advisorWires = (fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit?]>).map(([url, init]) => `${urlString(url)}\n${bodyString(init)}`);
    const relayWires = capture.calls.map((call) => `${call.url}\n${call.body}`);
    const allWireBodies = [...advisorWires, ...relayWires].join('\n');
    for (const forbidden of [
      new TextDecoder('latin1').decode(sourceBytes),
      new TextDecoder('latin1').decode(prepared.pdfBytes),
      'client_name', 'Avery Chen', template.sourceSha256, prepared.receipt.completedSha256,
      template.templateId, 'Client information form', template.outputFileStem,
      prepared.fileName, 'client-form-logical-id', checklist.matter_id,
    ]) {
      expect(allWireBodies).not.toContain(forbidden);
    }
  });
});
