import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startDocusignSignature } from './signatureWorkflow';
import { saveLocalSignatureRecord } from './signatureRecordStore';
import { assertLocalOnlyAllowsExternal, LocalOnlyExternalError } from '@/platform/privacy/localOnlyGuard';
import { loadPdfTemplateDescriptor } from '@/platform/intake/intakeKeychain';

vi.mock('@/platform/intake/intakeKeychain', () => ({ loadIntakeLinkSecret: vi.fn(), loadPdfTemplateDescriptor: vi.fn() }));
vi.mock('@/platform/intake/pdfFillReceipt', () => ({ assertSafeFlattenedPdf: vi.fn(), verifyPdfFillReceipt: vi.fn() }));
vi.mock('@/platform/intake/pdfTemplates/receipt', () => ({ sha256Hex: vi.fn(async () => 'b'.repeat(64)) }));
vi.mock('./signatureRecordStore', () => ({ loadLocalSignatureRecord: vi.fn(async () => null), saveLocalSignatureRecord: vi.fn() }));
vi.mock('@/platform/privacy/localOnlyGuard', () => {
  class Block extends Error { constructor() { super('blocked'); this.name = 'LocalOnlyExternalError'; } }
  return { LocalOnlyExternalError: Block, assertLocalOnlyAllowsExternal: vi.fn() };
});

const request = { request_id: 'request-1', schema_version: 1, matter_id: 'never-sent', kind: 'standing' as const, items: [
  { t: 'pdf_fill' as const, item_id: 'pdf-1', label: 'Form', help_text: '', required: true, subject: 'primary', prefill: [], template: { templateId: 'template-1', version: 1, kind: 'acroform' as const, sourceSha256: 'a'.repeat(64), sourceArtifactRef: 'sealed-artifact:abcdefghijklmnop', outputFileStem: 'form', maxOutputBytes: 1000, fields: {} } },
  { t: 'signature' as const, grade: 'docusign' as const, item_id: 'sig-1', label: 'Sign', help_text: '', required: true, subject: 'primary', source_pdf_fill_item_id: 'pdf-1', tab_map: { signatureTab: { page: 1, rect: { x: .1, y: .1, width: .2, height: .1 } }, dateSignedTab: { page: 1, rect: { x: .1, y: .2, width: .2, height: .1 } }, signerNameTab: { page: 1, rect: { x: .1, y: .3, width: .2, height: .1 } } } },
] };

describe('signature send gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const pdfItem = request.items[0];
    if (pdfItem?.t !== 'pdf_fill') throw new Error('test setup: expected the pdf_fill fixture item first');
    vi.mocked(loadPdfTemplateDescriptor).mockResolvedValue(pdfItem.template);
  });
  it('records a blocked receipt and makes zero DocuSign or broker calls in Local-only mode', async () => {
    vi.mocked(assertLocalOnlyAllowsExternal).mockImplementation(() => { throw new LocalOnlyExternalError('Send for DocuSign signature'); });
    const adapter = { createEnvelopeAndRecipientView: vi.fn() };
    const relay = { putLaunch: vi.fn() };
    await expect(startDocusignSignature({ intakeId: 'intake-1', sourceFilePath: '/local/form.pdf', receipt: { issuedItemId: 'pdf-1', templateId: 'template-1', templateVersion: 1, sourceSha256: 'a'.repeat(64), completedSha256: 'b'.repeat(64), completedAt: '2026-07-11T00:00:00.000Z', pageVersion: 'w8' }, workspaceService: { readFileBinary: vi.fn(async () => new Uint8Array([1]).buffer), writeFileBinary: vi.fn() }, request, signatureItemId: 'sig-1', requestActive: true, matterFolderPath: '/local/client', requestSlug: 'w9-form-a1', signerName: 'Synthetic Signer', signerEmail: 'synthetic@example.test', returnUrl: 'https://lantern.test/return', adapter: adapter as never, launchRelay: relay as never })).rejects.toBeInstanceOf(LocalOnlyExternalError);
    expect(adapter.createEnvelopeAndRecipientView).not.toHaveBeenCalled();
    expect(relay.putLaunch).not.toHaveBeenCalled();
    expect(saveLocalSignatureRecord).toHaveBeenCalledWith('intake-1', expect.objectContaining({ egressReceipts: [expect.objectContaining({ outcome: 'blocked_local_only' })] }));
  });
});
