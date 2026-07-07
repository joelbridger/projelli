// "Whole book" scope of the Client Map tab: every active client ranked by
// Client Map completeness score, staleness, and last touch. Read-only; a row
// click opens that client's hub. NOT a new tab. Light theme.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { Chip, EmptyState } from '@/ui/kp';
import { useActiveMatters } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildBookRows, sortBookRows, type BookRow, type BookSort, type BookSortKey } from './bookRanking';

const GRID = 'minmax(220px, 2fr) 160px 110px 110px 130px';

/** Label for each Client Map completeness level (literal keys per branch —
 *  `BookRow['level']` is a closed union but a record lookup isn't statically
 *  traceable by the i18n extractor). */
function levelLabel(level: BookRow['level'], t: (key: string) => string): string {
  switch (level) {
    case 'thin':
      return t('matter.book.level-thin');
    case 'getting-there':
      return t('matter.book.level-getting-there');
    case 'solid':
      return t('matter.book.level-solid');
    case 'not-built':
      return t('matter.book.level-not-built');
  }
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 64, height: 6, borderRadius: 3, background: 'var(--kp-divider, #e5e7eb)' }}>
        <div style={{ width: `${String(score)}%`, height: 6, borderRadius: 3, background: 'var(--kp-success)' }} />
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{score}</span>
    </div>
  );
}

function HeaderButton({ label, col, sort, onSort }: {
  label: string; col: BookSortKey; sort: BookSort; onSort: (k: BookSortKey) => void;
}) {
  const active = sort.key === col;
  const Icon = sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button type="button" className={`kp-eyebrow${active ? ' kp-eyebrow--primary' : ''}`}
      onClick={() => { onSort(col); }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}>
      {label}
      {active && <Icon size={12} aria-hidden />}
    </button>
  );
}

export function BookView({ onOpenClient }: { onOpenClient: (matterId: string) => void }) {
  const { t } = useTranslation();
  const matters = useActiveMatters();
  const maps = useClientMapStore((s) => s.maps);
  const [sort, setSort] = useState<BookSort>({ key: 'score', dir: 'asc' });
  const rows = useMemo(() => buildBookRows(matters, maps, new Date().toISOString()), [matters, maps]);
  const sorted = useMemo(() => sortBookRows(rows, sort), [rows, sort]);

  const toggleSort = (key: BookSortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  if (sorted.length === 0) return <EmptyState icon={BookOpen} title={t('matter.book.empty')} />;

  return (
    <div data-testid="book-view">
      <p style={{ fontSize: 13, color: 'var(--kp-text-muted, #6b7280)', margin: '4px 0 12px' }}>
        {t('matter.book.subtitle')}
      </p>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '6px 12px', borderBottom: '1px solid var(--kp-divider-strong, #d1d5db)' }}>
        <HeaderButton label={t('matter.book.col-client')} col="label" sort={sort} onSort={toggleSort} />
        <HeaderButton label={t('matter.book.col-completeness')} col="score" sort={sort} onSort={toggleSort} />
        <span className="kp-eyebrow">{t('matter.book.col-facts')}</span>
        <span className="kp-eyebrow">{t('matter.book.col-gaps')}</span>
        <HeaderButton label={t('matter.book.col-last-touch')} col="staleDays" sort={sort} onSort={toggleSort} />
      </div>
      {sorted.map((r) => (
        <div key={r.matterId} role="row" data-testid={`book-row-${r.matterId}`}
          onClick={() => { onOpenClient(r.matterId); }}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpenClient(r.matterId); }}
          tabIndex={0}
          style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--kp-divider, #e5e7eb)', cursor: 'pointer' }}>
          <span>
            <span style={{ fontWeight: 600, fontSize: 13.5, display: 'block' }}>{r.label}</span>
            {r.topGaps.length > 0 && (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {r.topGaps.map((g) => (
                  <Chip key={g} size="sm" data-testid="book-gap-chip" title={t('matter.beneficiary.review-note')}>
                    {g}
                  </Chip>
                ))}
              </span>
            )}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Chip size="sm">{levelLabel(r.level, t)}</Chip>
            {r.level !== 'not-built' && <ScoreBar score={r.score} />}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{r.knowCount}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{r.askCount}</span>
          <span style={{ fontSize: 12.5, color: 'var(--kp-text-muted, #6b7280)' }}>
            {r.staleDays === null
              ? t('matter.book.level-not-built')
              : r.staleDays === 0
                ? t('matter.book.stale-today')
                : t('matter.book.stale-days', { count: r.staleDays })}
          </span>
        </div>
      ))}
    </div>
  );
}
