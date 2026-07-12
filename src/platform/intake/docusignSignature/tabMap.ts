import type { PdfOverlayRect, PdfTemplateDescriptor } from '../pdfTemplates/templateContract';

export interface DocusignTabAnchor {
  /** One-indexed page number in the reviewed source document. */
  page: number;
  /** Reviewed normalized page geometry, using the same rules as PDF overlays. */
  rect: PdfOverlayRect;
}

/** Only these three DocuSign tabs are reviewed in Wave 9. */
export interface ReviewedDocusignTabMap {
  signatureTab: DocusignTabAnchor;
  dateSignedTab: DocusignTabAnchor;
  signerNameTab: DocusignTabAnchor;
}

export class DocusignTabMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocusignTabMapValidationError';
  }
}

type LooseRecord = Record<string, unknown> & {
  page?: unknown;
  rect?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  signatureTab?: unknown;
  dateSignedTab?: unknown;
  signerNameTab?: unknown;
};

function fail(message: string): never {
  throw new DocusignTabMapValidationError(message);
}

function asRecord(value: unknown, name: string): LooseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as LooseRecord;
}

function requireExactKeys(value: LooseRecord, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${name} contains unsupported property "${key}".`);
  }
}

function requireFinitePositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a finite positive number.`);
  }
  return value;
}

function validateAnchor(value: unknown, name: string): void {
  const anchor = asRecord(value, name);
  requireExactKeys(anchor, ['page', 'rect'], name);
  if (!Number.isInteger(anchor.page) || (anchor.page as number) <= 0) {
    fail(`${name}.page must be a positive integer.`);
  }
  const rect = asRecord(anchor.rect, `${name}.rect`);
  requireExactKeys(rect, ['x', 'y', 'width', 'height'], `${name}.rect`);
  const x = requireFinitePositive(rect.x, `${name}.rect.x`);
  const y = requireFinitePositive(rect.y, `${name}.rect.y`);
  const width = requireFinitePositive(rect.width, `${name}.rect.width`);
  const height = requireFinitePositive(rect.height, `${name}.rect.height`);
  if (x > 1 || y > 1 || width > 1 || height > 1 || x + width > 1 || y + height > 1) {
    fail(`${name}.rect must stay inside normalized page bounds.`);
  }
}

function assertOverlayPageBounds(map: ReviewedDocusignTabMap, template: PdfTemplateDescriptor): void {
  if (template.kind !== 'overlay') return;
  const pages = Object.values(template.fields)
    .filter((field): field is Extract<typeof field, { kind: 'overlay' }> => field.kind === 'overlay')
    .map((field) => field.page);
  const maxPage = Math.max(...pages);
  for (const [name, anchor] of Object.entries(map) as Array<[keyof ReviewedDocusignTabMap, DocusignTabAnchor]>) {
    if (anchor.page > maxPage) {
      fail(`${name}.page exceeds the reviewed overlay template page range.`);
    }
  }
}

/**
 * Validates the sealed, reviewed map. For overlays we can bound a tab by the
 * largest page represented by a reviewed field. Lane 2 must still verify the
 * final flattened PDF's true page count before it calls DocuSign: AcroForms
 * carry no page count here, and this contract never opens PDF bytes.
 */
export function assertValidDocusignTabMap(
  value: unknown,
  sourceTemplate?: PdfTemplateDescriptor,
): asserts value is ReviewedDocusignTabMap {
  const map = asRecord(value, 'DocuSign tab map');
  requireExactKeys(map, ['signatureTab', 'dateSignedTab', 'signerNameTab'], 'DocuSign tab map');
  validateAnchor(map.signatureTab, 'DocuSign tab map.signatureTab');
  validateAnchor(map.dateSignedTab, 'DocuSign tab map.dateSignedTab');
  validateAnchor(map.signerNameTab, 'DocuSign tab map.signerNameTab');
  if (sourceTemplate) assertOverlayPageBounds(map as unknown as ReviewedDocusignTabMap, sourceTemplate);
}

export function isValidDocusignTabMap(value: unknown, sourceTemplate?: PdfTemplateDescriptor): value is ReviewedDocusignTabMap {
  try {
    assertValidDocusignTabMap(value, sourceTemplate);
    return true;
  } catch (error) {
    if (error instanceof DocusignTabMapValidationError) return false;
    throw error;
  }
}
