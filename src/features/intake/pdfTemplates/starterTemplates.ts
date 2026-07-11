import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import type { PdfTemplateDescriptor } from '@/platform/intake/pdfTemplates/templateContract';

const STARTER_PDF_B64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MiA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDcyIDcyMCBUZCAoQ29udGFjdCBJbmZvcm1hdGlvbiBVcGRhdGUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzQ4IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDE4CiUlRU9GCg==';

function bytes(): Uint8Array {
  const decoded = atob(STARTER_PDF_B64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function overlay(fieldId: string, y: number, type: 'text' | 'date' = 'text') {
  return { kind: 'overlay' as const, field_id: fieldId, pdf_field_type: type, page: 1, rect: { x: 0.12, y, width: 0.48, height: 0.05 }, font: { family: 'Helvetica' as const, size: 10 }, alignment: 'left' as const, overflow: 'wrap' as const };
}

/** Low-risk synthetic starter forms. They are local seeds, never custodian PDFs. */
export async function starterPdfTemplateSeeds(): Promise<Array<{ label: string; descriptor: PdfTemplateDescriptor; sourceBytes: Uint8Array }>> {
  const sourceBytes = bytes();
  const sourceSha256 = await sha256Hex(sourceBytes);
  return [
    { label: 'Contact information update', sourceBytes, descriptor: { templateId: 'template_contact_update', version: 1, kind: 'overlay', sourceSha256, sourceArtifactRef: 'sealed-artifact:startercontact0001', outputFileStem: 'contact-information-update', maxOutputBytes: 1024 * 1024, fields: { mailing_address: overlay('mailing_address', 0.25), phone_number: overlay('phone_number', 0.36), email_address: overlay('email_address', 0.47) } } },
    { label: 'Beneficiary information review', sourceBytes, descriptor: { templateId: 'template_beneficiary_review', version: 1, kind: 'overlay', sourceSha256, sourceArtifactRef: 'sealed-artifact:starterbeneficiary01', outputFileStem: 'beneficiary-information-review', maxOutputBytes: 1024 * 1024, fields: { beneficiary_name: overlay('beneficiary_name', 0.25), beneficiary_birth_date: overlay('beneficiary_birth_date', 0.36, 'date') } } },
  ];
}
