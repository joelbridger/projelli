import type { SourceRef } from '@/platform/clientMap/types';
import type { IntakeDocumentSourceRef } from './documentExtractionTypes';

export type { IntakeDocumentSourceRef } from './documentExtractionTypes';

export function docSourceRefToString(ref: IntakeDocumentSourceRef): string {
  return `document:${ref.path}${ref.page === undefined ? '' : `#page=${String(ref.page)}`}`;
}

export function docSourceRefFromString(value: string): IntakeDocumentSourceRef | null {
  if (!value.startsWith('document:')) return null;
  const encoded = value.slice('document:'.length);
  const match = /^(.*?)(?:#page=(\d+))?$/u.exec(encoded);
  if (!match?.[1]) return null;
  const page = match[2] === undefined ? undefined : Number(match[2]);
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) return null;
  return { kind: 'document', path: match[1], snippet: '', ...(page === undefined ? {} : { page }) };
}

export function docSourceRefToUi(ref: IntakeDocumentSourceRef): SourceRef {
  return {
    kind: 'document',
    ref: ref.path,
    snippet: ref.snippet,
    ...(ref.page === undefined ? {} : { locator: `p. ${String(ref.page)}` }),
  };
}
