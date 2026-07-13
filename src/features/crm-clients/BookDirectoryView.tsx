/* eslint-disable lantern-i18n/no-hardcoded-string -- restored Whole book copy matches the existing frozen Client Map locale catalog. */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { Chip, EmptyState } from '@/ui/kp';
import { useActiveMatters } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildBookRows, sortBookRows, type BookRow, type BookSort, type BookSortKey } from './bookRanking';

const grid = 'minmax(220px, 2fr) 160px 110px 110px 130px';

const levelLabel: Record<BookRow['level'], string> = {
  thin: 'Thin',
  'getting-there': 'Getting there',
  solid: 'Solid',
  'not-built': 'Not built yet',
};

function SortHeader({ label, column, sort, onSort }: { label: string; column: BookSortKey; sort: BookSort; onSort: (key: BookSortKey) => void }) {
  const active = sort.key === column;
  const Icon = sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button type="button" className={`kp-eyebrow${active ? ' kp-eyebrow--primary' : ''}`} onClick={() => { onSort(column); }} style={{ background: 'none', border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}>
      {label}{active ? <Icon size={12} aria-hidden /> : null}
    </button>
  );
}

/** The old MattersHome Whole book view, ported into the live Clients / Directory surface. */
export function BookDirectoryView({ onOpenClient }: { onOpenClient: (matterId: string) => void }) {
  const matters = useActiveMatters();
  const maps = useClientMapStore((state) => state.maps);
  const [sort, setSort] = useState<BookSort>({ key: 'score', dir: 'asc' });
  const rows = useMemo(() => buildBookRows(matters, maps, new Date().toISOString()), [matters, maps]);
  const sorted = useMemo(() => sortBookRows(rows, sort), [rows, sort]);
  const toggleSort = (key: BookSortKey) => {
    setSort((previous) => previous.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  if (sorted.length === 0) return <EmptyState icon={BookOpen} title="No clients yet. Add a client to see your whole book here." />;

  return (
    <div data-testid="book-view">
      <p style={{ fontSize: 13, color: 'var(--color-muted-foreground)', margin: '4px 0 12px' }}>Every client, ranked by who needs attention: how complete their Client Map is and how long since it was touched.</p>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '6px 12px', borderBottom: '1px solid var(--kp-divider-strong)' }}>
        <SortHeader label="Client" column="label" sort={sort} onSort={toggleSort} />
        <SortHeader label="Client Map" column="score" sort={sort} onSort={toggleSort} />
        <span className="kp-eyebrow">Sourced facts</span><span className="kp-eyebrow">Open gaps</span>
        <SortHeader label="Last touch" column="staleDays" sort={sort} onSort={toggleSort} />
      </div>
      {sorted.map((row) => (
        <div key={row.matterId} role="row" data-testid={`book-row-${row.matterId}`} tabIndex={0} onClick={() => { onOpenClient(row.matterId); }} onKeyDown={(event) => { if (event.key === 'Enter') onOpenClient(row.matterId); }} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--kp-divider)', cursor: 'pointer' }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{row.label}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Chip size="sm">{levelLabel[row.level]}</Chip>{row.level !== 'not-built' ? <span>{row.score}</span> : null}</span>
          <span>{row.knowCount}</span><span>{row.askCount}</span>
          <span style={{ fontSize: 12.5, color: 'var(--color-muted-foreground)' }}>{row.staleDays === null ? 'Not built yet' : row.staleDays === 0 ? 'Today' : `${String(row.staleDays)} days ago`}</span>
        </div>
      ))}
    </div>
  );
}
