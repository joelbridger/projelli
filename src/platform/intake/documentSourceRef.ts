import type { SourceRef } from '@/platform/clientMap/types';
import type { IntakeDocumentSourceRef } from './documentExtractionTypes';

export type { IntakeDocumentSourceRef } from './documentExtractionTypes';

const SOURCE_REF_PREFIX = 'document:v1:';
const LOW_CONFIDENCE_OCR = 60;

export function docSourceRefToString(ref: IntakeDocumentSourceRef): string {
  const payload = ref.page === undefined ? { path: ref.path } : { path: ref.path, page: ref.page };
  return `${SOURCE_REF_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

export function docSourceRefFromString(value: string): IntakeDocumentSourceRef | null {
  if (!value.startsWith(SOURCE_REF_PREFIX)) return null;
  const encoded = value.slice(SOURCE_REF_PREFIX.length);
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(encoded));
    const record = parsed as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !('path' in record) ||
      typeof record['path'] !== 'string' ||
      !record['path'] ||
      (Object.keys(record).length !== (Object.hasOwn(record, 'page') ? 2 : 1)) ||
      Object.keys(record).some((key) => key !== 'path' && key !== 'page')
    ) return null;
    const path = record['path'];
    const rawPage = Object.hasOwn(record, 'page') ? record['page'] : undefined;
    if (rawPage !== undefined && (typeof rawPage !== 'number' || !Number.isSafeInteger(rawPage) || rawPage < 1)) return null;
    const page = rawPage;
    const canonicalPayload = page === undefined ? { path } : { path, page };
    if (encodeURIComponent(JSON.stringify(canonicalPayload)) !== encoded) return null;
    return { kind: 'document', path, snippet: '', ...(page === undefined ? {} : { page }) };
  } catch {
    return null;
  }
}

export function docSourceRefToUi(ref: IntakeDocumentSourceRef): SourceRef {
  const lowConfidenceOcr = ref.extraction === 'ocr' && ref.confidence !== undefined && ref.confidence < LOW_CONFIDENCE_OCR;
  return {
    kind: 'document',
    ref: ref.path,
    snippet: ref.snippet,
    ...(ref.page === undefined ? {} : { locator: `p. ${String(ref.page)}${lowConfidenceOcr ? ' (low-confidence scan)' : ''}` }),
    ...(ref.extraction === undefined ? {} : { extraction: ref.extraction }),
    ...(ref.confidence === undefined ? {} : { extractionConfidence: ref.confidence }),
  };
}
