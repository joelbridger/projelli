import { describe, expect, it } from 'vitest';

import type { FormRequest, PdfFillRequestItem } from '../types';
import { assertValidDocusignTabMap } from './tabMap';
import { assertSignatureEligible, SignatureEligibilityError } from './signatureEligibility';
import { assertSignatureLaunchUsable, MAX_SIGNATURE_LAUNCH_TTL_MS } from './signatureLaunch';
import { signatureOutputFileNames } from './signatureOutputNaming';
import {
  assertValidLocalSignatureRecord,
  isDuplicateSignatureEvent,
  type LocalSignatureRecord,
  type SignatureEvent,
  type SignatureStatus,
} from './signatureRecord';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function pdfItem(overrides: Partial<PdfFillRequestItem> = {}): PdfFillRequestItem {
  return {
    t: 'pdf_fill', item_id: 'pdf-item', label: 'Approved form', help_text: '', required: true, subject: 'primary', prefill: [],
    template: {
      templateId: 'template_approved_09', version: 3, kind: 'acroform', sourceSha256: HASH_A,
      sourceArtifactRef: 'sealed-artifact:approvedartifact0009', outputFileStem: 'approved-form', maxOutputBytes: 1024,
      fields: { name: { kind: 'acroform', field_id: 'name', acroform_field: 'Name', pdf_field_type: 'text' } },
    },
    ...overrides,
  };
}

function tabMap() {
  return {
    signatureTab: { page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
    dateSignedTab: { page: 1, rect: { x: 0.1, y: 0.25, width: 0.2, height: 0.1 } },
    signerNameTab: { page: 1, rect: { x: 0.1, y: 0.4, width: 0.2, height: 0.1 } },
  };
}

function request(): FormRequest {
  return {
    request_id: 'request-9', schema_version: 1, matter_id: 'local-only-matter', kind: 'standing',
    items: [pdfItem(), {
      t: 'signature', item_id: 'signature-item', label: 'Sign form', help_text: '', required: true, subject: 'primary',
      grade: 'docusign', source_pdf_fill_item_id: 'pdf-item', tab_map: tabMap(),
    }],
  };
}

function completion(overrides: Partial<NonNullable<ReturnType<typeof eligibilityInput>['currentCompletion']>> = {}) {
  return {
    sourceItemId: 'pdf-item', templateId: 'template_approved_09', templateVersion: 3,
    sourceSha256: HASH_A, completedSha256: HASH_B, ...overrides,
  };
}

function eligibilityInput(overrides: Partial<Parameters<typeof assertSignatureEligible>[0]> = {}) {
  return {
    request: request(), signatureItemId: 'signature-item', currentCompletion: completion(), requestActive: true,
    existingActiveSignatureRecord: false, ...overrides,
  };
}

function record(status: SignatureStatus = 'envelope_created'): LocalSignatureRecord {
  return {
    requestId: 'request-9', signatureItemId: 'signature-item', sourcePdfFillItemId: 'pdf-item',
    sourceTemplateVersion: 3, sourceTemplateSha256: HASH_A, wave8CompletedSha256: HASH_B,
    envelopeId: 'envelope-9', status, events: [{ eventId: 'event-1', status, source: 'poll', at: '2026-07-11T12:00:00.000Z' }],
    ...(status === 'signed' ? { finalSignedSha256: HASH_A, certificateSha256: HASH_B } : {}),
  };
}

describe('reviewed DocuSign tab maps', () => {
  it('accepts only the three reviewed normalized tabs', () => {
    expect(() => assertValidDocusignTabMap(tabMap())).not.toThrow();
  });

  it.each([
    ['missing tab', (() => { const value = tabMap() as Partial<ReturnType<typeof tabMap>>; delete value.signerNameTab; return value; })()],
    ['non-finite coordinate', { ...tabMap(), signatureTab: { ...tabMap().signatureTab, rect: { ...tabMap().signatureTab.rect, x: Number.NaN } } }],
    ['zero coordinate', { ...tabMap(), signatureTab: { ...tabMap().signatureTab, rect: { ...tabMap().signatureTab.rect, width: 0 } } }],
    ['negative coordinate', { ...tabMap(), signatureTab: { ...tabMap().signatureTab, rect: { ...tabMap().signatureTab.rect, height: -0.1 } } }],
    ['non-integer page', { ...tabMap(), signatureTab: { ...tabMap().signatureTab, page: 1.5 } }],
    ['non-positive page', { ...tabMap(), signatureTab: { ...tabMap().signatureTab, page: 0 } }],
  ])('rejects %s', (_name, value) => {
    expect(() => assertValidDocusignTabMap(value)).toThrow();
  });

  it('bounds tabs to the known reviewed overlay pages', () => {
    const source = pdfItem({ template: {
      ...pdfItem().template, kind: 'overlay', fields: {
        field: {
          kind: 'overlay', field_id: 'field', page: 2, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
          font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'stop', pdf_field_type: 'text',
        },
      },
    } });
    expect(() => assertValidDocusignTabMap({ ...tabMap(), signerNameTab: { ...tabMap().signerNameTab, page: 3 } }, source.template)).toThrow(/page range/iu);
  });
});

describe('signature eligibility', () => {
  it('accepts an active request with exact fresh source evidence', () => {
    expect(assertSignatureEligible(eligibilityInput())).toMatchObject({ grade: 'docusign', source_pdf_fill_item_id: 'pdf-item' });
  });

  it.each([
    ['uncompleted form', () => eligibilityInput({ currentCompletion: null }), /has not been completed/iu],
    ['foreign source', () => eligibilityInput({ currentCompletion: completion({ sourceItemId: 'other-pdf' }) }), /different source item/iu],
    ['changed template id', () => eligibilityInput({ currentCompletion: completion({ templateId: 'template_other_09' }) }), /template id/iu],
    ['changed source hash', () => eligibilityInput({ currentCompletion: completion({ sourceSha256: HASH_B }) }), /source hash/iu],
    ['changed template version', () => eligibilityInput({ currentCompletion: completion({ templateVersion: 4 }) }), /template version/iu],
    ['invalid completed hash', () => eligibilityInput({ currentCompletion: completion({ completedSha256: 'changed-completed-hash' }) }), /completed PDF hash/iu],
    ['inactive request', () => eligibilityInput({ requestActive: false }), /no longer active/iu],
    ['active record reuse', () => eligibilityInput({ existingActiveSignatureRecord: true }), /already exists/iu],
    ['invalid tab map', () => {
      const changed = request();
      const signature = changed.items[1];
      if (signature?.t === 'signature' && signature.grade === 'docusign') signature.tab_map.signatureTab.page = 0;
      return eligibilityInput({ request: changed });
    }, /tab map/iu],
  ])('rejects %s', (_name, makeInput, message) => {
    expect(() => assertSignatureEligible(makeInput())).toThrow(message);
  });

  it('rejects native clicksign defensively', () => {
    const changed = request();
    changed.items[1] = { t: 'signature', item_id: 'signature-item', label: 'Sign', help_text: '', required: true, subject: 'primary', grade: 'native_clicksign' };
    expect(() => assertSignatureEligible(eligibilityInput({ request: changed }))).toThrow(SignatureEligibilityError);
    expect(() => assertSignatureEligible(eligibilityInput({ request: changed }))).toThrow(/native_clicksign/iu);
  });

  it('distinguishes a missing item from an item that is not a signature', () => {
    expect(() => assertSignatureEligible(eligibilityInput({ signatureItemId: 'missing' }))).toThrow(/does not exist/iu);
    const changed = request();
    changed.items[1] = { t: 'readonly_card', item_id: 'signature-item', label: 'Read', help_text: '', required: false, subject: 'primary', body: 'Read this.' };
    expect(() => assertSignatureEligible(eligibilityInput({ request: changed }))).toThrow(/not a DocuSign signature/iu);
  });
});

describe('local signature records', () => {
  it.each<SignatureStatus>([
    'not_ready', 'ready_to_send', 'envelope_created', 'signing_opened', 'completion_pending', 'signed', 'declined', 'voided', 'needs_followup',
  ])('accepts valid %s records', (status) => {
    expect(() => assertValidLocalSignatureRecord(record(status))).not.toThrow();
  });

  it.each([
    ['final signed hash', { ...record('signed'), finalSignedSha256: undefined }],
    ['certificate hash', { ...record('signed'), certificateSha256: undefined }],
    ['both signed hashes', { ...record('signed'), finalSignedSha256: undefined, certificateSha256: undefined }],
    ['malformed source hash', { ...record(), sourceTemplateSha256: 'not-a-hash' }],
    ['malformed completed hash', { ...record(), wave8CompletedSha256: 'not-a-hash' }],
  ])('rejects missing or malformed %s', (_name, value) => {
    expect(() => assertValidLocalSignatureRecord(value)).toThrow();
  });

  it('deduplicates only the stable DocuSign-derived event id', () => {
    const existing: SignatureEvent[] = [{ eventId: 'docusign-event-1', status: 'completion_pending', source: 'connect_webhook', at: '2026-07-11T12:00:00.000Z' }];
    expect(isDuplicateSignatureEvent(existing, { ...existing[0], source: 'poll' })).toBe(true);
    expect(isDuplicateSignatureEvent(existing, { ...existing[0], eventId: 'docusign-event-2' })).toBe(false);
  });
});

describe('signature launch records and generated names', () => {
  const launch = {
    requestId: 'request-9', signatureItemId: 'signature-item', recipientViewUrl: 'https://demo.docusign.invalid/view',
    issuedAt: '2026-07-11T12:00:00.000Z', expiresAt: '2026-07-11T12:29:00.000Z', consumed: false,
  };

  it('accepts a fresh unconsumed launch within the conservative TTL', () => {
    expect(MAX_SIGNATURE_LAUNCH_TTL_MS).toBe(30 * 60 * 1000);
    expect(() => assertSignatureLaunchUsable(launch, '2026-07-11T12:01:00.000Z')).not.toThrow();
  });

  it('rejects expired and consumed launches with separate failures', () => {
    expect(() => assertSignatureLaunchUsable(launch, '2026-07-11T12:30:00.000Z')).toThrow(/expired/iu);
    expect(() => assertSignatureLaunchUsable({ ...launch, consumed: true }, '2026-07-11T12:01:00.000Z')).toThrow(/consumed/iu);
  });

  it('returns bare generated output names only', () => {
    const names = signatureOutputFileNames({ requestId: 'request-9', signatureItemId: 'signature-item', envelopeId: 'envelope-9' });
    for (const name of Object.values(names)) {
      expect(name).not.toMatch(/[\\/]|\.\./u);
      expect(name).not.toContain('request-9');
      expect(name).not.toContain('signature-item');
      expect(name).not.toContain('envelope-9');
    }
  });

  it('keeps generated names bare even when an upstream opaque id is hostile', () => {
    const names = signatureOutputFileNames({ requestId: '../client-name', signatureItemId: 'item/with/slash', envelopeId: 'envelope\\with\\slash' });
    for (const name of Object.values(names)) {
      expect(name).not.toMatch(/[\\/]|\.\./u);
      expect(name).not.toContain('client-name');
    }
  });
});
