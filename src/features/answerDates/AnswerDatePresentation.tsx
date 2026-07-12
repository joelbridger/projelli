import { CalendarClock, Flag, ShieldCheck } from 'lucide-react';

/**
 * A small, deliberately defensive date view for Ask citations.
 *
 * The RAG date contract is extended in a parallel lane. This component receives
 * the existing citation list as unknown values so persisted answers without any
 * date metadata continue to render exactly as they do today. Once a citation
 * carries a supported optional date field, it appears here without requiring a
 * migration of old answers.
 */
type DateRow = {
  label: string;
  date: string;
  time: number;
  authoritative: boolean;
  conflict: boolean;
};

type ConflictEvidenceRow = {
  factKey: string;
  label: string;
  value: string;
  date: string;
  time: number;
  authorityReason: string | null;
};

const DATE_FIELDS = [
  'citationDate',
  'documentDate',
  'sourceDate',
  'asOfDate',
  'effectiveDate',
  'date',
  'updatedAt',
] as const;

const DATE_VALUE_FIELDS = ['value', 'iso', 'date', 'timestamp'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return null;

  for (const key of DATE_VALUE_FIELDS) {
    const nested = value[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return null;
}

function readDate(citation: Record<string, unknown>): { value: string; time: number } | null {
  for (const field of DATE_FIELDS) {
    const value = readText(citation[field]);
    if (!value) continue;
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return { value, time };
  }
  return null;
}

function isAuthoritative(citation: Record<string, unknown>): boolean {
  if (citation.authoritative === true || citation.isAuthoritative === true) return true;
  const authority = citation.dateAuthority ?? citation.authority;
  return authority === 'authoritative' || authority === 'primary';
}

function hasConflict(citation: Record<string, unknown>): boolean {
  return citation.hasDateConflict === true || citation.dateConflict === true || isRecord(citation.dateConflict) || citation.conflict === true;
}

function citationLabel(citation: Record<string, unknown>, index: number): string {
  const label = citation.label ?? citation.path ?? citation.sourceId;
  return typeof label === 'string' && label.trim() ? label.trim() : `Source ${String(index + 1)}`;
}

function toDateRows(citations: readonly unknown[]): DateRow[] {
  return citations.flatMap((citation, index) => {
    if (!isRecord(citation)) return [];
    const date = readDate(citation);
    if (!date) return [];
    return [{
      label: citationLabel(citation, index),
      date: date.value,
      time: date.time,
      authoritative: isAuthoritative(citation),
      conflict: hasConflict(citation),
    }];
  }).sort((a, b) => a.time - b.time);
}

function textAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * `dateConflict` is optional on every source. When it is supplied by the
 * retrieval layer it already contains the exact incompatible evidence set; do
 * not infer a conflict from two merely different dates.
 */
function conflictEvidence(citations: readonly unknown[]): ConflictEvidenceRow[] {
  const seen = new Set<string>();
  const rows: ConflictEvidenceRow[] = [];

  for (const citation of citations) {
    if (!isRecord(citation) || !isRecord(citation.dateConflict)) continue;
    const factKey = textAt(citation.dateConflict, 'factKey') ?? 'cited record';
    const evidence = citation.dateConflict.evidence;
    if (!Array.isArray(evidence)) continue;

    for (const item of evidence) {
      if (!isRecord(item)) continue;
      const sourceDate = isRecord(item.sourceDate) ? readText(item.sourceDate) : null;
      const time = sourceDate ? Date.parse(sourceDate) : Number.NaN;
      const sourceId = textAt(item, 'sourceId') ?? textAt(item, 'path') ?? 'source';
      const value = textAt(item, 'value') ?? 'Value not recorded';
      if (!sourceDate || Number.isNaN(time)) continue;
      const key = `${factKey}|${sourceId}|${sourceDate}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        factKey,
        label: textAt(item, 'path') ?? sourceId,
        value,
        date: sourceDate,
        time,
        authorityReason: textAt(item, 'authorityReason'),
      });
    }
  }

  return rows;
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(time));
}

/**
 * The dated slice of an answer. It is intentionally absent when no cited source
 * has a usable date, keeping older and undated answers visually unchanged.
 */
export function AnswerDatePresentation({ citations }: { citations: readonly unknown[] }) {
  const rows = toDateRows(citations);
  if (rows.length === 0) return null;

  const newest = rows.at(-1)!;
  const authoritative = rows.filter((row) => row.authoritative).at(-1);
  const evidence = conflictEvidence(citations);
  const newestEvidence = evidence.toSorted((a, b) => a.time - b.time).at(-1);
  // The retrieval contract keeps authority as advisor-readable context, never a
  // hidden score. A source with that stated context is surfaced alongside the
  // newest record so "newer" is never silently treated as "better".
  const authoritativeEvidence = evidence.find((item) => item.authorityReason !== null);
  const conflict = evidence.length > 1 || rows.some((row) => row.conflict) || (
    authoritative !== undefined && authoritative.date !== newest.date
  );

  return (
    <section
      aria-label="Dates in cited records"
      data-testid="answer-date-timeline"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        padding: '10px 12px',
        border: '1px solid var(--kp-divider)',
        borderRadius: 10,
        background: 'var(--kp-bg-soft)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--kp-navy)' }}>
        <CalendarClock size={14} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 700 }}>Dates in the cited records</span>
      </div>

      <ol
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {rows.map((row, index) => (
          <li
            key={`${row.label}-${row.date}-${String(index)}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
          >
            <span
              aria-hidden="true"
              style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 999, background: 'var(--kp-accent)' }}
            />
            <span
              data-testid={`answer-citation-date-chip-${String(index + 1)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                border: '1px solid var(--kp-action-border)',
                borderRadius: 999,
                background: 'var(--color-background)',
                color: 'var(--kp-navy)',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {formatDate(row.date)}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--kp-text-dim)' }}>
              {row.label}
            </span>
            {row.authoritative && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#16654a', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                <ShieldCheck size={12} aria-hidden="true" />
                Authoritative
              </span>
            )}
          </li>
        ))}
      </ol>

      {conflict && (
        <div
          data-testid="answer-date-conflict"
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 7,
            padding: '8px 9px',
            border: '1px solid #e3b878',
            borderRadius: 8,
            background: '#fef6e6',
            color: '#754b00',
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <Flag size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
          <span>
            <strong>Date conflict flagged.</strong>{' '}
            {newestEvidence ? (
              <>Newest record: {formatDate(newestEvidence.date)} — {newestEvidence.value}.</>
            ) : (
              <>Newest record: {formatDate(newest.date)}.</>
            )}{' '}
            {authoritativeEvidence ? (
              <>Authoritative record: {formatDate(authoritativeEvidence.date)} — {authoritativeEvidence.value} ({authoritativeEvidence.authorityReason}).</>
            ) : authoritative ? (
              <>Authoritative record: {formatDate(authoritative.date)}.</>
            ) : (
              <>Check the cited records before relying on either date.</>
            )}
          </span>
        </div>
      )}
    </section>
  );
}
