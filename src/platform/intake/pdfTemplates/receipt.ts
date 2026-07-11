import type { PdfCompletionReceipt, PdfTemplateDescriptor } from './templateContract';
import {
  PdfTemplateValidationError,
  verifyReceiptAgainstDescriptor,
} from './templateValidation';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Verifies the sealed source artifact bytes before the public page renders them. */
export async function verifySourceBytesAgainstDescriptor(
  sourceBytes: Uint8Array,
  descriptor: PdfTemplateDescriptor,
): Promise<void> {
  const actual = await sha256Hex(sourceBytes);
  if (actual !== descriptor.sourceSha256) {
    throw new PdfTemplateValidationError('Source PDF bytes do not match the approved template hash.');
  }
}

/** Verifies receipt/template binding and completed bytes after decrypting locally. */
export async function verifyCompletedBytesAgainstReceipt(
  completedBytes: Uint8Array,
  receipt: PdfCompletionReceipt,
  descriptor: PdfTemplateDescriptor,
): Promise<void> {
  verifyReceiptAgainstDescriptor(receipt, descriptor);
  if (completedBytes.byteLength > descriptor.maxOutputBytes) {
    throw new PdfTemplateValidationError('Completed PDF bytes exceed the approved template output size limit.');
  }
  const actual = await sha256Hex(completedBytes);
  if (actual !== receipt.completedSha256) {
    throw new PdfTemplateValidationError('Completed PDF bytes do not match the sealed receipt hash.');
  }
}
