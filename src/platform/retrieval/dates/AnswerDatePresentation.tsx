import { CalendarClock, Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DateableCitation } from './contracts';

/**
 * A small date view for citations. Date fields remain optional so saved,
 * older answers without source-time metadata stay visually unchanged.
 */
type DateRow = {
  label: string;
  date: string;
  time: number;
  conflict: boolean;
  localFileMetadata: boolean;
};

type ConflictEvidenceRow = {
  factKey: string;
  label: string;
  date: string;
  time: number;
};

function toDateRows(citations: readonly DateableCitation[]): DateRow[] {
  return citations
    .flatMap((citation, index) => {
      const value = citation.sourceDate?.value;
      if (!value) return [];
      const time = Date.parse(value);
      if (Number.isNaN(time)) return [];
      return [
        {
          label: citation.label.trim() || `Source ${String(index + 1)}`,
          date: value,
          time,
          conflict: citation.dateConflict !== undefined,
          // Filesystem mtime tells us when this local copy changed. It does not
          // prove when the document itself was written, so say that plainly.
          localFileMetadata: citation.sourceDate?.confidence === 'derived',
        },
      ];
    })
    .sort((a, b) => a.time - b.time);
}

/**
 * `dateConflict` is optional on every source. When it is supplied by the
 * retrieval layer it already contains matching copies of one record with
 * different timestamps; do not infer a warning from two merely different dates.
 */
function conflictEvidence(
  citations: readonly DateableCitation[]
): ConflictEvidenceRow[] {
  const seen = new Set<string>();
  const rows: ConflictEvidenceRow[] = [];

  for (const citation of citations) {
    const conflict = citation.dateConflict;
    if (!conflict) continue;

    for (const item of conflict.evidence) {
      const sourceDate = item.sourceDate.value;
      const time = sourceDate === null ? Number.NaN : Date.parse(sourceDate);
      const sourceId = item.sourceId;
      const value = item.value;
      if (!sourceDate || Number.isNaN(time)) continue;
      const key = `${conflict.factKey}|${sourceId}|${sourceDate}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        factKey: conflict.factKey,
        label: item.path,
        date: sourceDate,
        time,
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
export function AnswerDatePresentation({
  citations,
}: {
  citations: readonly DateableCitation[];
}) {
  const { t } = useTranslation();
  const rows = toDateRows(citations);
  if (rows.length === 0) return null;

  const newest = rows.at(-1);
  if (!newest) return null;
  const evidence = conflictEvidence(citations);
  const newestEvidence = evidence
    .slice()
    .sort((a, b) => a.time - b.time)
    .at(-1);
  const earliestEvidence = evidence
    .slice()
    .sort((a, b) => a.time - b.time)
    .at(0);
  // This is intentionally limited to a warning supplied by retrieval for
  // matching copies of one record. Different dates on unrelated documents are
  // a normal timeline, not a detected factual disagreement.
  const conflict = evidence.length > 1 || rows.some((row) => row.conflict);

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--kp-navy)',
        }}
      >
        <CalendarClock size={14} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {t('answer-dates.title')}
        </span>
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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                flex: '0 0 auto',
                borderRadius: 999,
                background: 'var(--kp-accent)',
              }}
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
              {row.localFileMetadata
                ? `Local file metadata · ${formatDate(row.date)}`
                : formatDate(row.date)}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
                color: 'var(--kp-text-dim)',
              }}
            >
              {row.label}
            </span>
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
            border: '1px solid var(--kp-date-conflict-border)',
            borderRadius: 8,
            background: 'var(--kp-date-conflict-bg)',
            color: 'var(--kp-date-conflict-text)',
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <Flag
            size={14}
            aria-hidden="true"
            style={{ flex: 'none', marginTop: 1 }}
          />
          <span>
            <strong>{t('answer-dates.record-copy-flagged')}</strong>{' '}
            {newestEvidence ? (
              <>Newest copy: {formatDate(newestEvidence.date)}.</>
            ) : (
              <>Newest copy: {formatDate(newest.date)}.</>
            )}{' '}
            {earliestEvidence && earliestEvidence !== newestEvidence ? (
              <>Earlier copy: {formatDate(earliestEvidence.date)}.</>
            ) : (
              <>{t('answer-dates.review-record-copies')}</>
            )}
          </span>
        </div>
      )}
    </section>
  );
}
