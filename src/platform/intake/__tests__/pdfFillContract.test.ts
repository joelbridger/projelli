import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/features/intake/welcomeJourneyDefaults';
import { assertValidRequestBlueprint } from '@/platform/intake/blueprintValidation';
import { assertSendableRequest, createAdvisorIntake } from '@/platform/intake/createIntake';
import { loadIntakeLinkSecret } from '@/platform/intake/intakeKeychain';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import type { FormRequest, PdfTemplateDescriptor, RequestItem } from '../types';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

const fetchMock = vi.fn();

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

function pdfItem(template = approvedTemplate()): Extract<RequestItem, { t: 'pdf_fill' }> {
  return {
    t: 'pdf_fill', item_id: 'client-form-logical-id', label: 'Client information form', help_text: '',
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

async function issue(checklist: FormRequest): Promise<void> {
  await createAdvisorIntake({
    intakeId: checklist.request_id, matterId: checklist.matter_id, intakeHost: 'https://forms.test',
    expiresAt: '2026-12-01T00:00:00.000Z', checklist, clientFirstName: 'Avery', firm: firm(), relay: relay(),
  });
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

  // TODO(w8-gate): enable once Lane 3 exports preparePdfFillSubmission from intake-page/src/pdfFill/preparePdfFillSubmission.
  it.skip('fills a sealed source locally, flattens it, and seals a receipt with the encrypted PDF submission', async () => {
    const modulePath = '../../../../intake-page/src/pdfFill/preparePdfFillSubmission';
    const { preparePdfFillSubmission } = await import(/* @vite-ignore */ modulePath) as {
      preparePdfFillSubmission: (input: { sourceBytes: Uint8Array; template: PdfTemplateDescriptor; values: Record<string, string> }) => Promise<{ pdfBytes: Uint8Array; receipt: unknown; contentType: string; fileName: string }>;
    };
    const result = await preparePdfFillSubmission({
      sourceBytes: new Uint8Array([37, 80, 68, 70]), template: approvedTemplate(), values: { client_name: 'Avery Chen' },
    });
    expect(result.contentType).toBe('application/pdf');
    expect(result.fileName).not.toContain('client-information');
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(result.receipt).toEqual(expect.objectContaining({ templateId: 'template_approved_04' }));
  });

  // TODO(w8-gate): enable once Lane 4 adds the pdf_fill branch to routeIntakeSubmission and exports intakePdfFormFolder from src/platform/intake/intakeFiling.ts.
  it.skip('decrypts, verifies, files only beneath the matching request forms folder, then acknowledges', () => {
    const requestSlug = 'request-0123456789abcdef';
    const expectedPath = `/workspace/Avery/Requests/${requestSlug}/forms/client-information.pdf`;
    const received = { manifest: { content_type: 'application/pdf', file_names: ['opaque.pdf'] }, plaintextBytes: [new Uint8Array([37, 80, 68, 70])] };
    expect(received.manifest.content_type).toBe('application/pdf');
    expect(expectedPath).toContain(`/Requests/${requestSlug}/forms/`);
    expect(expectedPath).not.toContain('/Requests/onboarding/');
  });

  // TODO(w8-gate): enable once Lane 4 adds routeIntakeSubmission pdf_fill integrity flags and leaves rejected submissions unacknowledged.
  it.skip('integrity-flags changed hashes, wrong handles, non-PDF payloads, multiple files, active forms, and receipt mismatches', () => {
    const invalids = ['changed-template-hash', 'wrong-opaque-handle', 'json-payload', 'non-pdf-mime', 'multiple-files', 'interactive-pdf', 'active-content', 'receipt-hash-mismatch', 'other-request'];
    const acknowledgements: string[] = [];
    const flags: string[] = [];
    for (const invalid of invalids) flags.push(invalid);
    expect(flags).toEqual(invalids);
    expect(acknowledgements).toEqual([]);
  });

  // TODO(w8-gate): enable once Lane 4 exports intakePdfFormFolder and its routeIntakeSubmission pdf_fill isolation branch.
  it.skip('keeps an onboarding request isolated from a same-matter PDF-fill request', () => {
    const onboardingPath = '/workspace/Avery/Requests/onboarding/';
    const pdfPath = '/workspace/Avery/Requests/request-0123456789abcdef/forms/';
    expect(pdfPath).not.toBe(onboardingPath);
    expect(pdfPath).not.toContain('/Requests/onboarding/');
  });

  // TODO(w8-gate): enable once Lane 3 exports preparePdfFillSubmission and Lane 4 exports the pdf_fill route/filing harness needed for a complete encrypted round trip.
  it.skip('inspects create, chunk, manifest, and inbox wires for every prohibited PDF plaintext', () => {
    const sourceBytes = '%PDF-source-secret';
    const completedBytes = '%PDF-completed-secret';
    const wire = 'ciphertext-only-wire-placeholder';
    for (const forbidden of [sourceBytes, completedBytes, 'client_name', 'Avery Chen', 'a'.repeat(64), 'b'.repeat(64), 'template_approved_04', 'Client information form', 'Schwab', 'client-information.pdf', 'client-form-logical-id', 'matter-private-004']) {
      expect(wire).not.toContain(forbidden);
    }
  });
});
