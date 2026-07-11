import type { DocusignSignatureRequestItem, FormRequest } from '../types';
import { assertValidDocusignTabMap } from './tabMap';

export class SignatureEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureEligibilityError';
  }
}

export interface SignatureEligibilityInput {
  request: FormRequest;
  signatureItemId: string;
  /** Freshly recomputed evidence for the exact completed bytes currently on disk. */
  currentCompletion: {
    sourceItemId: string;
    templateId: string;
    templateVersion: number;
    sourceSha256: string;
    completedSha256: string;
  } | null;
  requestActive: boolean;
  existingActiveSignatureRecord: boolean;
}

const SHA256_RE = /^[a-f0-9]{64}$/u;

function fail(message: string): never {
  throw new SignatureEligibilityError(message);
}

/**
 * Rechecks all available immutable source evidence immediately before envelope
 * creation. This intentionally does not trust a cached eligible flag.
 */
export function assertSignatureEligible(input: SignatureEligibilityInput): DocusignSignatureRequestItem {
  const item = input.request.items.find((candidate) => candidate.item_id === input.signatureItemId);
  if (!item) fail('The requested signature item does not exist in this request.');
  if (item.t !== 'signature') fail('The requested item is not a DocuSign signature item.');
  if (item.grade === 'native_clicksign') fail('native_clicksign signature items are not eligible for DocuSign.');
  if (item.grade !== 'docusign') fail('The requested signature item is not a DocuSign signature item.');

  const source = input.request.items.find((candidate) => candidate.item_id === item.source_pdf_fill_item_id);
  if (!source || source.t !== 'pdf_fill') {
    fail('The DocuSign signature source does not resolve to a pdf_fill item in this request.');
  }
  if (!input.currentCompletion) fail('The source PDF form has not been completed.');
  if (input.currentCompletion.sourceItemId !== item.source_pdf_fill_item_id) {
    fail('The supplied PDF completion belongs to a different source item.');
  }
  if (input.currentCompletion.templateId !== source.template.templateId) {
    fail('The completed PDF template id no longer matches the reviewed source.');
  }
  if (input.currentCompletion.templateVersion !== source.template.version) {
    fail('The completed PDF template version no longer matches the reviewed source.');
  }
  if (input.currentCompletion.sourceSha256 !== source.template.sourceSha256) {
    fail('The completed PDF source hash no longer matches the reviewed source.');
  }
  if (!SHA256_RE.test(input.currentCompletion.completedSha256)) {
    fail('The completed PDF hash must be 64 lowercase hexadecimal characters.');
  }
  try {
    assertValidDocusignTabMap(item.tab_map, source.template);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown tab map validation error.';
    fail(`The DocuSign signature tab map is not approved: ${message}`);
  }
  if (!input.requestActive) fail('The request is no longer active.');
  if (input.existingActiveSignatureRecord) fail('An active signature envelope already exists for this item.');
  return item;
}
