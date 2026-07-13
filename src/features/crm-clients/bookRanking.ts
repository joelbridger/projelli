import type { Matter } from '@/platform/types/matter';
import type { ClientMap, CompletenessLevel, ContextCompleteness } from '@/platform/clientMap/types';
import { displayCompleteness } from '@/features/matters/clientMap/guidedInterview';
import { matterLabel } from '@/platform/rag/matterResolver';

export interface BookRow {
  matterId: string;
  label: string;
  level: CompletenessLevel | 'not-built';
  score: number;
  knowCount: number;
  askCount: number;
  staleDays: number | null;
}

export type BookSortKey = 'label' | 'score' | 'staleDays';
export interface BookSort { key: BookSortKey; dir: 'asc' | 'desc' }

/** A 0–100 score using the same sourced-fact, assumption, and open-gap signals as Client Map completeness. */
export function completenessScore(completeness: ContextCompleteness): number {
  const factPart = 60 * Math.min(completeness.know.length / 8, 1);
  const assumptionPart = 20 * Math.max(0, 1 - Math.max(0, completeness.assuming.length - 2) / 6);
  const gapPart = 20 * Math.max(0, 1 - Math.max(0, completeness.ask.length - 2) / 6);
  return Math.round(factPart + assumptionPart + gapPart);
}

export function staleDaysFrom(iso: string | null, nowIso: string): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

function lastTouch(map: ClientMap | undefined, matter: Matter): string | null {
  const candidates = [matter.createdAt];
  if (map?.lastBuiltAt) candidates.push(map.lastBuiltAt);
  for (const section of map?.sections ?? []) {
    for (const item of section.items) if (item.updatedAt) candidates.push(item.updatedAt);
  }
  return candidates.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

export function buildBookRows(
  matters: Matter[],
  maps: Record<string, ClientMap>,
  nowIso: string,
  labelFor: (matter: Matter) => string = matterLabel,
): BookRow[] {
  const rows: BookRow[] = matters
    .filter((matter) => !matter.archived && !matter.isSample)
    .map((matter) => {
      const map = maps[matter.id];
      const completeness = map?.lastBuiltAt ? displayCompleteness(map) : undefined;
      const level: BookRow['level'] = completeness?.level ?? 'not-built';
      return {
        matterId: matter.id,
        label: labelFor(matter),
        level,
        score: completeness ? completenessScore(completeness) : 0,
        knowCount: completeness?.know.length ?? 0,
        askCount: completeness?.ask.length ?? 0,
        staleDays: staleDaysFrom(lastTouch(map, matter), nowIso),
      };
    });
  return sortBookRows(rows, { key: 'score', dir: 'asc' });
}

export function sortBookRows(rows: BookRow[], sort: BookSort): BookRow[] {
  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === 'label') return direction * left.label.localeCompare(right.label);
    if (sort.key === 'score') return direction * (left.score - right.score) || left.label.localeCompare(right.label);
    return direction * ((left.staleDays ?? -1) - (right.staleDays ?? -1)) || left.label.localeCompare(right.label);
  });
}
