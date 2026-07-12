import type {
  PdfCompletionReceipt,
  PdfFieldOption,
  PdfTemplateDescriptor,
} from './templateContract';
import { OPAQUE_ITEM_HANDLE_RE } from '../requestIdentity';

export const MAX_PDF_TEMPLATE_OUTPUT_BYTES = 50 * 1024 * 1024;

const SHA256_RE = /^[a-f0-9]{64}$/u;
const TEMPLATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SEALED_ARTIFACT_RE = /^sealed-artifact:[A-Za-z0-9_-]{16,512}$/u;
const OUTPUT_STEM_RE = /^[a-z0-9]+(?:-[a-z0-9]+){0,11}$/u;
const FIELD_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const PAGE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const FACT_KINDS = new Set([
  'dob', 'ssn', 'income_annual', 'spending_monthly', 'drivers_license',
  'address', 'citizenship', 'employer', 'beneficiary',
]);

export class PdfTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTemplateValidationError';
  }
}

type LooseRecord = Record<string, unknown> & {
  fact_kind?: unknown;
  kind?: unknown;
  page?: unknown;
  rect?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  font?: unknown;
  family?: unknown;
  size?: unknown;
  color?: unknown;
  alignment?: unknown;
  overflow?: unknown;
  field_id?: unknown;
  required?: unknown;
  pdf_field_type?: unknown;
  options?: unknown;
  acroform_field?: unknown;
  templateId?: unknown;
  version?: unknown;
  sourceSha256?: unknown;
  sourceArtifactRef?: unknown;
  outputFileStem?: unknown;
  maxOutputBytes?: unknown;
  fields?: unknown;
  templateVersion?: unknown;
  completedSha256?: unknown;
  completedAt?: unknown;
  pageVersion?: unknown;
  issuedItemId?: unknown;
  value?: unknown;
  label?: unknown;
};

function fail(message: string): never {
  throw new PdfTemplateValidationError(message);
}

function asRecord(value: unknown, name: string): LooseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`${name} must be an object.`);
  }
  return value as LooseRecord;
}

function requireExactKeys(value: LooseRecord, allowed: string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${name} contains unsupported property "${key}".`);
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string.`);
  return value;
}

function assertNoUrlOrPath(value: string, name: string): void {
  if (
    /(?:^|\s)(?:https?|file|javascript|data|mailto):/iu.test(value) ||
    /(?:^|\s)www\./iu.test(value) ||
    /[\\/]/u.test(value) ||
    hasControlCharacter(value)
  ) {
    fail(`${name} cannot contain a URL, filesystem path, or control character.`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function requireSafeIdentifier(value: unknown, name: string, pattern: RegExp): string {
  const text = requireString(value, name);
  assertNoUrlOrPath(text, name);
  if (!pattern.test(text)) fail(`${name} has an unsafe format.`);
  return text;
}

function requireFinitePositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a finite positive number.`);
  }
  return value;
}

function requireOptionalFactKind(entry: LooseRecord, name: string): void {
  if (entry.fact_kind === undefined) return;
  if (typeof entry.fact_kind !== 'string' || !FACT_KINDS.has(entry.fact_kind)) {
    fail(`${name}.fact_kind is not supported.`);
  }
}

function validateOptions(value: unknown, name: string): void {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) {
    fail(`${name} must contain between two and 64 reviewed choices.`);
  }
  const seen = new Set<string>();
  for (const option of value) {
    const record = asRecord(option, `${name} option`);
    requireExactKeys(record, ['value', 'label'], `${name} option`);
    const typed = record as unknown as PdfFieldOption;
    const optionValue = requireString(typed.value, `${name} option value`);
    const label = requireString(typed.label, `${name} option label`);
    if (optionValue.length > 80 || label.length > 120) fail(`${name} option is too long.`);
    assertNoUrlOrPath(optionValue, `${name} option value`);
    assertNoUrlOrPath(label, `${name} option label`);
    if (seen.has(optionValue)) fail(`${name} contains a duplicate option value.`);
    seen.add(optionValue);
  }
}

function validateOverlayEntry(entry: LooseRecord, name: string): void {
  requireExactKeys(entry, [
    'kind', 'field_id', 'fact_kind', 'required', 'pdf_field_type', 'options',
    'page', 'rect', 'font', 'alignment', 'overflow',
  ], name);
  if (entry.kind !== 'overlay') fail(`${name} must be an overlay field.`);
  if (!Number.isInteger(entry.page) || (entry.page as number) <= 0) {
    fail(`${name}.page must be a positive integer.`);
  }
  const rect = asRecord(entry.rect, `${name}.rect`);
  requireExactKeys(rect, ['x', 'y', 'width', 'height'], `${name}.rect`);
  const x = requireFinitePositive(rect.x, `${name}.rect.x`);
  const y = requireFinitePositive(rect.y, `${name}.rect.y`);
  const width = requireFinitePositive(rect.width, `${name}.rect.width`);
  const height = requireFinitePositive(rect.height, `${name}.rect.height`);
  if (x > 1 || y > 1 || width > 1 || height > 1 || x + width > 1 || y + height > 1) {
    fail(`${name}.rect must stay inside normalized page bounds.`);
  }
  const font = asRecord(entry.font, `${name}.font`);
  requireExactKeys(font, ['family', 'size', 'color'], `${name}.font`);
  if (font.family !== 'Helvetica' && font.family !== 'Times-Roman' && font.family !== 'Courier') {
    fail(`${name}.font.family must be a built-in local PDF font.`);
  }
  const size = requireFinitePositive(font.size, `${name}.font.size`);
  if (size > 72) fail(`${name}.font.size is too large.`);
  if (font.color !== undefined && (typeof font.color !== 'string' || !/^#[a-fA-F0-9]{6}$/u.test(font.color))) {
    fail(`${name}.font.color must be a six-digit hex color.`);
  }
  if (entry.alignment !== 'left' && entry.alignment !== 'center' && entry.alignment !== 'right') {
    fail(`${name}.alignment is not supported.`);
  }
  if (entry.overflow !== 'wrap' && entry.overflow !== 'stop') {
    fail(`${name}.overflow must explicitly be wrap or stop.`);
  }
}

function validateFieldEntry(
  mapKey: string,
  value: unknown,
  descriptorKind: string,
  seenIds: Set<string>,
  seenAcroformFields: Set<string>,
): void {
  const entry = asRecord(value, `Template field "${mapKey}"`);
  const name = `Template field "${mapKey}"`;
  const fieldId = requireSafeIdentifier(entry.field_id, `${name}.field_id`, FIELD_ID_RE);
  if (fieldId !== mapKey) fail(`${name}.field_id must exactly match its map key.`);
  if (seenIds.has(fieldId)) fail(`Template field id "${fieldId}" is duplicated.`);
  seenIds.add(fieldId);
  if (entry.required !== undefined && typeof entry.required !== 'boolean') fail(`${name}.required must be boolean.`);
  requireOptionalFactKind(entry, name);
  if (entry.pdf_field_type !== 'text' && entry.pdf_field_type !== 'date' &&
      entry.pdf_field_type !== 'checkbox' && entry.pdf_field_type !== 'number' &&
      entry.pdf_field_type !== 'money' && entry.pdf_field_type !== 'radio' &&
      entry.pdf_field_type !== 'select') {
    fail(`${name}.pdf_field_type is not supported; signatures are never fill fields.`);
  }
  const choice = entry.pdf_field_type === 'radio' || entry.pdf_field_type === 'select';
  if (choice) validateOptions(entry.options, `${name}.options`);
  else if (entry.options !== undefined) fail(`${name}.options are allowed only for radio or select fields.`);

  if (descriptorKind === 'acroform') {
    requireExactKeys(entry, [
      'kind', 'field_id', 'fact_kind', 'required', 'pdf_field_type', 'options', 'acroform_field',
    ], name);
    if (entry.kind !== 'acroform') fail(`${name} must match the descriptor kind.`);
    const acroformField = requireSafeIdentifier(entry.acroform_field, `${name}.acroform_field`, FIELD_ID_RE);
    if (seenAcroformFields.has(acroformField)) {
      fail(`Template AcroForm field "${acroformField}" is mapped more than once.`);
    }
    seenAcroformFields.add(acroformField);
  } else if (descriptorKind === 'overlay') {
    validateOverlayEntry(entry, name);
  } else {
    fail('Template kind is not supported.');
  }
}

/** Strictly validates an immutable structural template snapshot from JSON. */
export function assertValidPdfTemplateDescriptor(value: unknown): asserts value is PdfTemplateDescriptor {
  const descriptor = asRecord(value, 'PDF template descriptor');
  requireExactKeys(descriptor, [
    'templateId', 'version', 'kind', 'sourceSha256', 'sourceArtifactRef',
    'outputFileStem', 'maxOutputBytes', 'fields',
  ], 'PDF template descriptor');
  requireSafeIdentifier(descriptor.templateId, 'templateId', TEMPLATE_ID_RE);
  if (!Number.isInteger(descriptor.version) || (descriptor.version as number) <= 0) {
    fail('Template version must be a positive integer.');
  }
  if (descriptor.kind !== 'acroform' && descriptor.kind !== 'overlay') fail('Template kind is not supported.');
  const sourceSha256 = requireString(descriptor.sourceSha256, 'sourceSha256');
  if (!SHA256_RE.test(sourceSha256)) fail('sourceSha256 must be 64 lowercase hexadecimal characters.');
  const artifactRef = requireString(descriptor.sourceArtifactRef, 'sourceArtifactRef');
  if (!SEALED_ARTIFACT_RE.test(artifactRef)) fail('sourceArtifactRef must be an opaque sealed-artifact reference.');
  requireSafeIdentifier(descriptor.outputFileStem, 'outputFileStem', OUTPUT_STEM_RE);
  if (!Number.isInteger(descriptor.maxOutputBytes) || (descriptor.maxOutputBytes as number) <= 0 ||
      (descriptor.maxOutputBytes as number) > MAX_PDF_TEMPLATE_OUTPUT_BYTES) {
    fail(`maxOutputBytes must be a positive integer no larger than ${String(MAX_PDF_TEMPLATE_OUTPUT_BYTES)}.`);
  }
  const fields = asRecord(descriptor.fields, 'Template fields');
  const entries = Object.entries(fields);
  if (entries.length === 0 || entries.length > 512) fail('Template must contain between one and 512 reviewed fields.');
  const seenIds = new Set<string>();
  const seenAcroformFields = new Set<string>();
  for (const [mapKey, entry] of entries) {
    requireSafeIdentifier(mapKey, 'Template field map key', FIELD_ID_RE);
    validateFieldEntry(mapKey, entry, descriptor.kind, seenIds, seenAcroformFields);
  }
}

/** Boolean form for call sites that need a non-throwing predicate. */
export function isValidPdfTemplateDescriptor(value: unknown): value is PdfTemplateDescriptor {
  try {
    assertValidPdfTemplateDescriptor(value);
    return true;
  } catch (error) {
    if (error instanceof PdfTemplateValidationError) return false;
    throw error;
  }
}

export function assertValidPdfCompletionReceipt(value: unknown): asserts value is PdfCompletionReceipt {
  const receipt = asRecord(value, 'PDF completion receipt');
  requireExactKeys(receipt, [
    'issuedItemId', 'templateId', 'templateVersion', 'sourceSha256', 'completedSha256', 'completedAt', 'pageVersion',
  ], 'PDF completion receipt');
  requireSafeIdentifier(receipt.issuedItemId, 'Receipt issuedItemId', OPAQUE_ITEM_HANDLE_RE);
  requireSafeIdentifier(receipt.templateId, 'Receipt templateId', TEMPLATE_ID_RE);
  if (!Number.isInteger(receipt.templateVersion) || (receipt.templateVersion as number) <= 0) {
    fail('Receipt templateVersion must be a positive integer.');
  }
  for (const name of ['sourceSha256', 'completedSha256'] as const) {
    const hash = requireString(receipt[name], `Receipt ${name}`);
    if (!SHA256_RE.test(hash)) fail(`Receipt ${name} must be 64 lowercase hexadecimal characters.`);
  }
  const completedAt = requireString(receipt.completedAt, 'Receipt completedAt');
  if (Number.isNaN(Date.parse(completedAt))) fail('Receipt completedAt must be a valid ISO timestamp.');
  requireSafeIdentifier(receipt.pageVersion, 'Receipt pageVersion', PAGE_VERSION_RE);
}

/** Ensures a sealed receipt belongs to this exact immutable template snapshot. */
export function verifyReceiptAgainstDescriptor(
  receipt: PdfCompletionReceipt,
  descriptor: PdfTemplateDescriptor,
): void {
  assertValidPdfCompletionReceipt(receipt);
  assertValidPdfTemplateDescriptor(descriptor);
  if (receipt.templateId !== descriptor.templateId || receipt.templateVersion !== descriptor.version) {
    fail('Completion receipt does not belong to this template version.');
  }
  if (receipt.sourceSha256 !== descriptor.sourceSha256) {
    fail('Completion receipt source hash does not match the template snapshot.');
  }
}
