export type SignatureStatus =
  | 'not_ready'
  | 'ready_to_send'
  | 'envelope_created'
  | 'signing_opened'
  | 'completion_pending'
  | 'signed'
  | 'declined'
  | 'voided'
  | 'needs_followup';

export interface SignatureEvent {
  /** Opaque deduplication key. Lane 4 derives it from DocuSign's own event identity. */
  eventId: string;
  status: SignatureStatus;
  source: 'browser_return' | 'connect_webhook' | 'poll' | 'direct_retrieval';
  at: string;
}

/** Encrypted-local-only evidence for exactly one request signature item. */
export interface LocalSignatureRecord {
  requestId: string;
  signatureItemId: string;
  sourcePdfFillItemId: string;
  sourceTemplateVersion: number;
  sourceTemplateSha256: string;
  wave8CompletedSha256: string;
  envelopeId: string;
  status: SignatureStatus;
  finalSignedSha256?: string;
  certificateSha256?: string;
  events: SignatureEvent[];
}

export class SignatureRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureRecordValidationError';
  }
}

const SHA256_RE = /^[a-f0-9]{64}$/u;
const STATUSES = new Set<SignatureStatus>([
  'not_ready', 'ready_to_send', 'envelope_created', 'signing_opened', 'completion_pending',
  'signed', 'declined', 'voided', 'needs_followup',
]);
const EVENT_SOURCES = new Set<SignatureEvent['source']>([
  'browser_return', 'connect_webhook', 'poll', 'direct_retrieval',
]);

type LooseRecord = Record<string, unknown> & {
  requestId?: unknown;
  signatureItemId?: unknown;
  sourcePdfFillItemId?: unknown;
  sourceTemplateVersion?: unknown;
  sourceTemplateSha256?: unknown;
  wave8CompletedSha256?: unknown;
  envelopeId?: unknown;
  status?: unknown;
  finalSignedSha256?: unknown;
  certificateSha256?: unknown;
  events?: unknown;
  eventId?: unknown;
  source?: unknown;
  at?: unknown;
};

function fail(message: string): never {
  throw new SignatureRecordValidationError(message);
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || hasControlCharacter(value)) {
    fail(`${name} must be a non-empty safe string.`);
  }
  return value;
}

function requireHash(value: unknown, name: string): void {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    fail(`${name} must be 64 lowercase hexadecimal characters.`);
  }
}

function requireIsoDate(value: unknown, name: string): void {
  const text = requireText(value, name);
  if (Number.isNaN(Date.parse(text))) fail(`${name} must be an ISO timestamp.`);
}

function validateEvent(value: unknown): void {
  const event = asRecord(value, 'Signature event');
  requireExactKeys(event, ['eventId', 'status', 'source', 'at'], 'Signature event');
  requireText(event.eventId, 'Signature event eventId');
  if (typeof event.status !== 'string' || !STATUSES.has(event.status as SignatureStatus)) {
    fail('Signature event status is not supported.');
  }
  if (typeof event.source !== 'string' || !EVENT_SOURCES.has(event.source as SignatureEvent['source'])) {
    fail('Signature event source is not supported.');
  }
  requireIsoDate(event.at, 'Signature event at');
}

/** Fails closed: a signed state always proves both local durable artifacts exist. */
export function assertValidLocalSignatureRecord(value: unknown): asserts value is LocalSignatureRecord {
  const record = asRecord(value, 'Local signature record');
  requireExactKeys(record, [
    'requestId', 'signatureItemId', 'sourcePdfFillItemId', 'sourceTemplateVersion', 'sourceTemplateSha256',
    'wave8CompletedSha256', 'envelopeId', 'status', 'finalSignedSha256', 'certificateSha256', 'events',
  ], 'Local signature record');
  requireText(record.requestId, 'Local signature record requestId');
  requireText(record.signatureItemId, 'Local signature record signatureItemId');
  requireText(record.sourcePdfFillItemId, 'Local signature record sourcePdfFillItemId');
  if (!Number.isInteger(record.sourceTemplateVersion) || (record.sourceTemplateVersion as number) <= 0) {
    fail('Local signature record sourceTemplateVersion must be a positive integer.');
  }
  requireHash(record.sourceTemplateSha256, 'Local signature record sourceTemplateSha256');
  requireHash(record.wave8CompletedSha256, 'Local signature record wave8CompletedSha256');
  requireText(record.envelopeId, 'Local signature record envelopeId');
  if (typeof record.status !== 'string' || !STATUSES.has(record.status as SignatureStatus)) {
    fail('Local signature record status is not supported.');
  }
  if (!Array.isArray(record.events)) fail('Local signature record events must be an array.');
  const eventIds = new Set<string>();
  for (const event of record.events) {
    validateEvent(event);
    const eventId = (event as SignatureEvent).eventId;
    if (eventIds.has(eventId)) fail('Local signature record events contain a duplicate eventId.');
    eventIds.add(eventId);
  }
  if (record.finalSignedSha256 !== undefined) requireHash(record.finalSignedSha256, 'Local signature record finalSignedSha256');
  if (record.certificateSha256 !== undefined) requireHash(record.certificateSha256, 'Local signature record certificateSha256');
  if (record.status === 'signed' && record.finalSignedSha256 === undefined) {
    fail('A signed local signature record requires finalSignedSha256.');
  }
  if (record.status === 'signed' && record.certificateSha256 === undefined) {
    fail('A signed local signature record requires certificateSha256.');
  }
}

export function isDuplicateSignatureEvent(events: SignatureEvent[], candidate: SignatureEvent): boolean {
  return events.some((event) => event.eventId === candidate.eventId);
}
