// Book view ranking: a numeric 0-100 completeness score derived from the SAME
// three signals deriveCompleteness's thresholds use (know/assuming/ask counts,
// src/platform/clientMap/completeness.ts:8-11), plus a derived last-touch
// (Matter has no activity timestamp; ClientMap.lastBuiltAt and item.updatedAt
// are the only touch signals that exist).
import type { Matter } from '@/platform/types/matter';
import type { ClientMap, CompletenessLevel, ContextCompleteness } from '@/platform/clientMap/types';
import { displayCompleteness } from '../clientMap/guidedInterview';
import { matterLabel } from '@/platform/rag/matterResolver';

export interface BookRow {
  matterId: string;
  label: string;
  level: CompletenessLevel | 'not-built';
  score: number;
  knowCount: number;
  assumingCount: number;
  askCount: number;
  lastTouchIso: string | null;
  staleDays: number | null;
  topGaps: string[];
}

export type BookSortKey = 'label' | 'score' | 'staleDays';
export interface BookSort { key: BookSortKey; dir: 'asc' | 'desc' }

/** 0-100. 60 pts for sourced facts (full at 8, the "solid" floor), 20 pts for
 *  few assumptions (full at <=2, fading to 0 at 8), 20 pts for few open gaps
 *  (same shape). Mirrors the solid thresholds in deriveCompleteness. */
export function completenessScore(c: ContextCompleteness): number {
  const know = c.know.length;
  const assuming = c.assuming.length;
  const ask = c.ask.length;
  const factPart = 60 * Math.min(know / 8, 1);
  const assumingPart = 20 * Math.max(0, 1 - Math.max(0, assuming - 2) / 6);
  const askPart = 20 * Math.max(0, 1 - Math.max(0, ask - 2) / 6);
  return Math.round(factPart + assumingPart + askPart);
}

export function lastTouchIso(map: ClientMap | undefined, matter: Matter): string | null {
  const candidates: string[] = [];
  if (map) {
    if (map.lastBuiltAt) candidates.push(map.lastBuiltAt);
    for (const sec of map.sections) for (const it of sec.items) if (it.updatedAt) candidates.push(it.updatedAt);
  }
  if (matter.createdAt) candidates.push(matter.createdAt);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

export function staleDaysFrom(iso: string | null, nowIso: string): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

const BENEFICIARY_PREFIX = 'Beneficiary check:';
const HONEST_LIMITS_SUFFIX = /\s*Flagged for your review\. Not legal advice\.\s*$/;

function topGapsFrom(c: ContextCompleteness | undefined): string[] {
  if (!c) return [];
  const benef = c.ask.filter((g) => g.text.startsWith(BENEFICIARY_PREFIX));
  const rest = c.ask.filter((g) => !g.text.startsWith(BENEFICIARY_PREFIX));
  return [...benef, ...rest]
    .slice(0, 2)
    .map((g) => g.text.replace(BENEFICIARY_PREFIX, '').replace(HONEST_LIMITS_SUFFIX, '').trim());
}

export function buildBookRows(
  matters: Matter[],
  maps: Record<string, ClientMap>,
  nowIso: string,
  labelFor: (m: Matter) => string = matterLabel,
): BookRow[] {
  const rows: BookRow[] = [];
  for (const m of matters) {
    if (m.archived || m.isSample) continue;
    const map = maps[m.id];
    const built = map !== undefined && map.lastBuiltAt !== '';
    const c = built ? displayCompleteness(map) : undefined;
    const touch = lastTouchIso(map, m);
    rows.push({
      matterId: m.id,
      label: labelFor(m),
      level: c ? c.level : 'not-built',
      score: c ? completenessScore(c) : 0,
      knowCount: c?.know.length ?? 0,
      assumingCount: c?.assuming.length ?? 0,
      askCount: c?.ask.length ?? 0,
      lastTouchIso: touch,
      staleDays: staleDaysFrom(touch, nowIso),
      topGaps: topGapsFrom(c),
    });
  }
  rows.sort(
    (a, b) =>
      a.score - b.score ||
      (b.staleDays ?? -1) - (a.staleDays ?? -1) ||
      a.label.localeCompare(b.label),
  );
  return rows;
}

export function sortBookRows(rows: BookRow[], sort: BookSort): BookRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'label') return dir * a.label.localeCompare(b.label);
    if (sort.key === 'score') return dir * (a.score - b.score) || a.label.localeCompare(b.label);
    return dir * ((a.staleDays ?? -1) - (b.staleDays ?? -1)) || a.label.localeCompare(b.label);
  });
}
