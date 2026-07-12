import type { SourceDate } from './contracts';

/**
 * Normalize only trustworthy source timestamps. A malformed or legacy value
 * stays readable as "Date unavailable" (`value: null`) and retains raw source
 * wording for audit; index time is never substituted.
 */
export function normalizeSourceDate(sourceDate: SourceDate | undefined): SourceDate {
  if (!sourceDate || sourceDate.value == null) {
    return {
      value: null,
      kind: sourceDate?.kind ?? 'unknown',
      ...(sourceDate?.rawValue ? { rawValue: sourceDate.rawValue } : {}),
      confidence: sourceDate?.confidence ?? 'unknown',
    };
  }

  const timestamp = Date.parse(sourceDate.value);
  if (!Number.isFinite(timestamp)) {
    return {
      value: null,
      kind: sourceDate.kind,
      rawValue: sourceDate.rawValue ?? sourceDate.value,
      confidence: sourceDate.confidence,
    };
  }

  return {
    value: new Date(timestamp).toISOString(),
    kind: sourceDate.kind,
    ...(sourceDate.rawValue ? { rawValue: sourceDate.rawValue } : {}),
    confidence: sourceDate.confidence,
  };
}

export function sourceDateTimestamp(sourceDate: SourceDate): number | null {
  return sourceDate.value == null ? null : Date.parse(sourceDate.value);
}
