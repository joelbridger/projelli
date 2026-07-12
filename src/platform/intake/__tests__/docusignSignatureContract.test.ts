import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/platform/intake/welcomeJourneyDefaults';
import { assertValidRequestBlueprint } from '@/platform/intake/blueprintValidation';
import { createAdvisorIntake } from '@/platform/intake/createIntake';
import { derivePageKey } from '@/platform/intake/intakeCrypto';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { fileIntakeDocument } from '@/platform/intake/intakeFiling';
import { sealPageJson } from '@/platform/intake/pageSeal';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { DirectDocusignAdapter } from '@/platform/docusignSigning/docusignAdapter';
import { DocusignLaunchRelayClient } from '@/platform/docusignSigning/launchRelayClient';
import { retrieveAndFileDocusignCompletion } from '@/platform/docusignSigning/signatureWorkflow';
import { saveLocalSignatureRecord } from '@/platform/docusignSigning/signatureRecordStore';
import type { SignatureLaunchRecord } from '@/platform/intake/docusignSignature/signatureLaunch';
import { SigningLaunchRelayClient } from '../../../../intake-page/src/docusignSigning/launchRelayClient';
import { validateDocusignConnectPayload } from '../../../../backend/src/lib/docusignSigning/connect';
import { isDuplicateSignatureWakeup, type SignatureWakeupRecord } from '../../../../backend/src/lib/docusignSigning/store';
import type { FormRequest, PdfFillRequestItem, RequestItem } from '../types';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

const fetchMock = vi.fn();

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function requestBody(init?: RequestInit): string {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return init.body;
}

function recordingWorkspace() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    workspaceService: {
      writeFileBinary: (path: string, bytes: ArrayBuffer) => {
        files.set(path, new Uint8Array(bytes));
        return Promise.resolve();
      },
    } as never,
  };
}

function pdfItem(itemId = 'pdf-fill-item'): PdfFillRequestItem {
  return {
    t: 'pdf_fill', item_id: itemId, label: 'Completed form', help_text: '', required: true, subject: 'primary', prefill: [],
    template: {
      templateId: 'template_approved_91', version: 1, kind: 'acroform', sourceSha256: 'a'.repeat(64),
      sourceArtifactRef: 'sealed-artifact:approvedartifact0091', outputFileStem: 'completed-form', maxOutputBytes: 1024,
      fields: { name: { kind: 'acroform', field_id: 'name', acroform_field: 'Name', pdf_field_type: 'text' } },
    },
  };
}

function signature(sourceId = 'pdf-fill-item') {
  return {
    t: 'signature' as const, item_id: 'signature-item', label: 'Sign form', help_text: '', required: true, subject: 'primary',
    grade: 'docusign' as const, source_pdf_fill_item_id: sourceId,
    tab_map: {
      signatureTab: { page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
      dateSignedTab: { page: 1, rect: { x: 0.1, y: 0.25, width: 0.2, height: 0.1 } },
      signerNameTab: { page: 1, rect: { x: 0.1, y: 0.4, width: 0.2, height: 0.1 } },
    },
  };
}

function request(items: RequestItem[]): FormRequest {
  return { request_id: 'signature-contract-request', schema_version: 1, matter_id: 'private-matter', kind: 'standing', items };
}

describe('Wave 9 signature contract gate', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock as unknown as typeof fetch);
  });

  it('rejects native clicksign, invalid sources, duplicate targets, incomplete maps, and the retired flat placeholder', () => {
    const blueprint = (items: unknown[]) => ({
      blueprintId: 'signature-contract', schemaVersion: 1, label: 'Signature contract', source: 'firm_saved' as const,
      defaultKind: 'standing' as const, items: items as RequestItem[],
    });
    expect(() => { assertValidRequestBlueprint(blueprint([{ t: 'signature', item_id: 'native', label: 'Native', help_text: '', required: true, subject: 'primary', grade: 'native_clicksign' }])); }).toThrow(/native_clicksign/iu);
    expect(() => { assertValidRequestBlueprint(blueprint([pdfItem(), signature('missing')])); }).toThrow(/source_pdf_fill_item_id/iu);
    expect(() => { assertValidRequestBlueprint(blueprint([{ t: 'readonly_card', item_id: 'card', label: 'Card', help_text: '', required: false, subject: 'primary', body: 'Read' }, signature('card')])); }).toThrow(/pdf_fill/iu);
    expect(() => { assertValidRequestBlueprint(blueprint([pdfItem(), signature(), { ...signature(), item_id: 'signature-item-2' }])); }).toThrow(/only one/iu);
    const missingTab = signature() as Omit<ReturnType<typeof signature>, 'tab_map'> & { tab_map: Partial<ReturnType<typeof signature>['tab_map']> };
    delete missingTab.tab_map.dateSignedTab;
    expect(() => { assertValidRequestBlueprint(blueprint([pdfItem(), missingTab])); }).toThrow(/tab map/iu);
    expect(() => { assertValidRequestBlueprint(blueprint([{ t: 'signature', item_id: 'old', label: 'Old', help_text: '', required: true, subject: 'primary', grade: 'docusign' }])); }).toThrow(/source_pdf_fill_item_id/iu);
  });

  it('uses the real relay client seam but rejects a DocuSign item before crypto or relay traffic', async () => {
    const relay = new IntakeRelayClient({ baseUrl: 'https://relay.test', seatToken: 'synthetic-seat' });
    const checklist = request([pdfItem(), signature()]);
    await expect(createAdvisorIntake({
      intakeId: checklist.request_id, matterId: checklist.matter_id, intakeHost: 'https://forms.test',
      expiresAt: '2026-12-01T00:00:00.000Z', checklist, clientFirstName: 'Avery',
      firm: { name: 'Synthetic Harbor', accent: '#123456', advisor_name: 'Ada', advisor_email: 'ada@example.invalid', next_steps: [], journey: DEFAULT_WELCOME_JOURNEY },
      relay,
    })).rejects.toThrow('signature items cannot be sent through an intake link.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captures exact flattened bytes and reviewed tabs in the DocuSign envelope adapter', async () => {
    fetchMock.mockResolvedValueOnce(response({ envelopeId: 'envelope-1' }, 201))
      .mockResolvedValueOnce(response({ url: 'https://demo.docusign.net/Signing/view' }, 201));
    const adapter = new DirectDocusignAdapter(() => Promise.resolve({
      accessToken: 'short-lived-token', accountId: 'account-1', baseUri: 'https://demo.docusign.net',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      allowedReturnUrl: 'https://lantern.test/return',
    }));
    const source = new Uint8Array([1, 2, 3]);
    await expect(adapter.createEnvelopeAndRecipientView({
      pdfBytes: source, signerName: 'Synthetic Signer', signerEmail: 'synthetic@example.test',
      requestId: 'signature-contract-request', signatureItemId: 'signature-item', clientUserId: 'lantern-client',
      tabMap: { signatureTab: { page: 1, xPosition: 61, yPosition: 79, width: 122, height: 79 }, dateSignedTab: { page: 1, xPosition: 61, yPosition: 198, width: 122, height: 79 }, signerNameTab: { page: 1, xPosition: 61, yPosition: 317, width: 122, height: 79 } }, returnUrl: 'https://lantern.test/return',
    })).resolves.toEqual({ envelopeId: 'envelope-1', recipientViewUrl: 'https://demo.docusign.net/Signing/view' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://demo.docusign.net/restapi/v2.1/accounts/account-1/envelopes');
    const body = JSON.parse(requestBody(init)) as {
      documents: Array<{ documentBase64: string }>;
      recipients: { signers: Array<{ tabs: { signHereTabs: unknown[]; dateSignedTabs: unknown[]; fullNameTabs: unknown[] } }> };
    };
    const signer = body.recipients.signers[0];
    expect(Uint8Array.from(atob(body.documents[0]?.documentBase64 ?? ''), (byte) => byte.charCodeAt(0))).toEqual(source);
    expect(signer?.tabs).toEqual({
      signHereTabs: [{ pageNumber: '1', xPosition: '61', yPosition: '79', width: '122', height: '79' }],
      dateSignedTabs: [{ pageNumber: '1', xPosition: '61', yPosition: '198', width: '122', height: '79' }],
      fullNameTabs: [{ pageNumber: '1', xPosition: '61', yPosition: '317', width: '122', height: '79' }],
    });
    await expect(adapter.createRecipientView({
      envelopeId: 'envelope-1', signerName: 'Synthetic Signer', signerEmail: 'synthetic@example.test', clientUserId: 'lantern-client', returnUrl: 'https://lantern.test/return',
    })).rejects.toThrow(/already generated/iu);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('round-trips a sealed launch record as ciphertext-only relay data', async () => {
    const launch: SignatureLaunchRecord = {
      requestId: 'private-request-id', signatureItemId: 'private-signature-item',
      recipientViewUrl: 'https://demo.docusign.invalid/ceremony/private-envelope-id',
      issuedAt: '2026-07-11T12:00:00.000Z', expiresAt: '2026-07-11T12:29:00.000Z', consumed: false,
    };
    const ciphertext = await sealPageJson(await derivePageKey(new Uint8Array(32).fill(7)), launch);
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    await new DocusignLaunchRelayClient({ baseUrl: 'https://relay.test', seatToken: 'synthetic-seat' }).putLaunch('intake-1', ciphertext);
    const [, putInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const wire = requestBody(putInit);
    expect(JSON.parse(wire)).toEqual({ launch_ciphertext_b64: ciphertext });
    for (const forbidden of [
      'recipientViewUrl', launch.recipientViewUrl, 'signatureItemId', launch.signatureItemId,
      'requestId', launch.requestId, 'matter_id', 'private-matter-id', 'private-envelope-id',
      'Avery', 'avery@example.invalid', 'document-bytes-123',
    ]) expect(wire).not.toContain(forbidden);

    const publicFetch = vi.fn().mockResolvedValue(response({ launch_ciphertext_b64: ciphertext }));
    vi.stubGlobal('fetch', publicFetch);
    await expect(new SigningLaunchRelayClient('intake-1', 'client-token').fetchLaunch()).resolves.toBe(ciphertext);
    expect(publicFetch).toHaveBeenCalledWith('/docusign-signing/intake-1/launch', { headers: { Authorization: 'Bearer client-token' } });
  });

  it('rejects document bytes, recipient details, and a matter id before a DocuSign call', () => {
    const result = validateDocusignConnectPayload(JSON.stringify({
      documentBytes: 'bytes', recipientEmail: 'client@example.invalid', matter_id: 'private',
    }), Date.parse('2026-07-11T12:00:00.000Z'));
    expect(result).toEqual({ ok: false, code: 'unknown_or_sensitive_field', status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('files signed artifacts together without changing the original Wave 8 form', async () => {
    const { files, workspaceService } = recordingWorkspace();
    const matterFolderPath = '/workspace/Client';
    const requestSlug = 'signature-contract-request';
    const originalForm = await fileIntakeDocument({ workspaceService, matterFolderPath, requestSlug, folder: 'pdf_form', fileName: 'wave-8-completed.pdf', bytes: new Uint8Array([8]) });
    const signedPath = await fileIntakeDocument({ workspaceService, matterFolderPath, requestSlug, folder: 'signature', fileName: 'signed.pdf', bytes: new Uint8Array([9]) });
    const certificatePath = await fileIntakeDocument({ workspaceService, matterFolderPath, requestSlug, folder: 'signature', fileName: 'certificate.pdf', bytes: new Uint8Array([10]) });
    expect(signedPath).toBe('/workspace/Client/Requests/signature-contract-request/signatures/signed.pdf');
    expect(certificatePath).toBe('/workspace/Client/Requests/signature-contract-request/signatures/certificate.pdf');
    expect(files.get(originalForm)).toEqual(new Uint8Array([8]));
    expect(files.get(signedPath)).toEqual(new Uint8Array([9]));
    expect(files.get(certificatePath)).toEqual(new Uint8Array([10]));
  });

  it('does not mark browser-return-only or webhook-only records signed', async () => {
    const intakeId = 'completion-pending-intake';
    await saveLocalSignatureRecord(intakeId, {
      record: {
        requestId: 'signature-contract-request', signatureItemId: 'signature-item', sourcePdfFillItemId: 'pdf-fill-item',
        sourceTemplateVersion: 1, sourceTemplateSha256: 'a'.repeat(64), wave8CompletedSha256: 'b'.repeat(64),
        envelopeId: 'envelope-1', matterFolderPath: '/workspace/Client', requestSlug: 'signature-contract-request', status: 'signing_opened', events: [],
      },
      egressReceipts: [],
    });
    const adapter = {
      pollEnvelopeStatus: vi.fn().mockResolvedValue('sent'),
      retrieveCompletion: vi.fn(),
    };
    const record = await retrieveAndFileDocusignCompletion({
      intakeId, requestId: 'signature-contract-request', signatureItemId: 'signature-item',
      matterFolderPath: '/workspace/Client', requestSlug: 'signature-contract-request', sourceFilePath: '/workspace/Client/form.pdf',
      receipt: { issuedItemId: 'pdf-fill-item', templateId: 'template_approved_91', templateVersion: 1, sourceSha256: 'a'.repeat(64), completedSha256: 'b'.repeat(64), completedAt: '2026-07-11T12:00:00.000Z', pageVersion: 'w8' },
      workspaceService: { readFileBinary: vi.fn(), writeFileBinary: vi.fn() }, adapter: adapter as never,
    });
    expect(record.status).toBe('completion_pending');
    expect(adapter.retrieveCompletion).not.toHaveBeenCalled();
  });

  it('deduplicates repeated DocuSign Connect completion events before filing', () => {
    const records: SignatureWakeupRecord[] = [{
      event_id: 'docusign-event-1', envelope_id: 'envelope-1', event_type: 'completed', at: '2026-07-11T12:00:00.000Z',
    }];
    expect(isDuplicateSignatureWakeup(records, { event_id: 'docusign-event-1' })).toBe(true);
    expect(isDuplicateSignatureWakeup(records, { event_id: 'docusign-event-2' })).toBe(false);
  });
});
