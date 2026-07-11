import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/platform/intake/welcomeJourneyDefaults';
import { assertValidRequestBlueprint } from '@/platform/intake/blueprintValidation';
import { createAdvisorIntake } from '@/platform/intake/createIntake';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import type { FormRequest, PdfFillRequestItem, RequestItem } from '../types';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

const fetchMock = vi.fn();

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

  // TODO Lane 2: import createDocusignEnvelope from src/platform/docusignSigning/envelopeAdapter.
  it.skip('captures exact flattened bytes and reviewed tabs in the DocuSign envelope adapter', async () => {
    const adapter = undefined as unknown as { createDocusignEnvelope: (input: { pdfBytes: Uint8Array; tabMap: ReturnType<typeof signature>['tab_map'] }) => Promise<{ envelopeId: string }> };
    const source = new Uint8Array([1, 2, 3]);
    const result = await adapter.createDocusignEnvelope({ pdfBytes: source, tabMap: signature().tab_map });
    expect(result.envelopeId).toBeTruthy();
  });

  // TODO Lane 3/4: import sealSignatureLaunchRecord and relaySignatureLaunchRecord from their sealed launch-record module.
  it.skip('round-trips a sealed launch record as ciphertext-only relay data', async () => {
    const launchRelay = undefined as unknown as { sealSignatureLaunchRecord: (value: unknown) => Promise<string>; relaySignatureLaunchRecord: (ciphertext: string) => Promise<string> };
    const ciphertext = await launchRelay.sealSignatureLaunchRecord({ recipientViewUrl: 'https://demo.docusign.invalid/view' });
    const wire = await launchRelay.relaySignatureLaunchRecord(ciphertext);
    expect(wire).not.toContain('recipientViewUrl');
  });

  // TODO Lane 4: import assertValidDocusignBrokerRequest from backend/src/lib/docusignSigning/requestSchema.
  it.skip('rejects document bytes, recipient details, and a matter id before a DocuSign call', () => {
    const broker = undefined as unknown as { assertValidDocusignBrokerRequest: (value: unknown) => void };
    expect(() => { broker.assertValidDocusignBrokerRequest({ documentBytes: 'bytes', recipientEmail: 'client@example.invalid', matter_id: 'private' }); }).toThrow();
  });

  // TODO Lane 2: import fileRetrievedDocusignArtifacts from src/platform/intake/intakeFiling.
  it.skip('files signed artifacts together without changing the original Wave 8 form', async () => {
    const filing = undefined as unknown as { fileRetrievedDocusignArtifacts: (value: unknown) => Promise<{ signedPath: string; certificatePath: string }> };
    const filed = await filing.fileRetrievedDocusignArtifacts({ requestId: 'request', signedPdf: new Uint8Array(), certificate: new Uint8Array() });
    expect(filed.signedPath).toContain('/signatures/');
    expect(filed.certificatePath).toContain('/signatures/');
  });

  // TODO Lane 2 and Lane 4: import applyVerifiedSignatureRetrieval and handleDocusignConnectEvent.
  it.skip('does not mark browser-return-only or webhook-only records signed', async () => {
    const flow = undefined as unknown as { applyVerifiedSignatureRetrieval: (value: unknown) => Promise<{ status: string }>; handleDocusignConnectEvent: (value: unknown) => Promise<{ status: string }> };
    expect((await flow.handleDocusignConnectEvent({ eventId: 'event-1' })).status).not.toBe('signed');
    expect((await flow.applyVerifiedSignatureRetrieval({ browserReturnOnly: true })).status).not.toBe('signed');
  });

  // TODO Lane 4: import handleDocusignConnectEvent from backend/src/routes/docusignSigning.
  it.skip('deduplicates repeated DocuSign Connect completion events before filing', async () => {
    const handler = undefined as unknown as { handleDocusignConnectEvent: (value: { eventId: string }) => Promise<{ filed: boolean }> };
    await handler.handleDocusignConnectEvent({ eventId: 'docusign-event-1' });
    expect((await handler.handleDocusignConnectEvent({ eventId: 'docusign-event-1' })).filed).toBe(false);
  });
});
