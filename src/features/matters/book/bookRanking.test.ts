import { describe, it, expect } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import type { ClientMap, ClientMapItem, GapQuestion } from '@/platform/clientMap/types';
import { emptyClientMap } from '@/platform/clientMap/types';
import { completenessScore, buildBookRows, sortBookRows, staleDaysFrom } from './bookRanking';

const NOW = '2026-07-02T12:00:00.000Z';

/** Index into an array under `noUncheckedIndexedAccess` without a non-null
 *  assertion: throws (failing the test with a clear message) if the index is
 *  out of range, instead of silently narrowing away `undefined`. */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected index ${String(i)} to exist`);
  return v;
}

function items(n: number, prefix: string, over: Partial<ClientMapItem> = {}): ClientMapItem[] {
  return Array.from({ length: n }, (_, i) => item(`${prefix}${String(i)}`, over));
}

function matter(id: string, over: Partial<Matter> = {}): Matter {
  return {
    id, name: `Matter ${id}`, client: `Client ${id}`, folderPaths: [`Clients/${id}`],
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  } as Matter;
}
function item(id: string, over: Partial<ClientMapItem> = {}): ClientMapItem {
  return {
    id, text: `fact ${id}`, origin: 'ai', isAssumption: false,
    sources: [{ kind: 'document', ref: `/doc-${id}.pdf`, snippet: 's' }],
    updatedAt: '2026-06-01T00:00:00.000Z', ...over,
  };
}
function builtMap(matterId: string, know: number, assuming: number, ask: number, lastBuiltAt: string): ClientMap {
  const map = emptyClientMap(matterId);
  map.lastBuiltAt = lastBuiltAt;
  at(map.sections, 0).items = [
    ...items(know, 'k'),
    ...items(assuming, 'a', { isAssumption: true, sources: [] }),
  ];
  map.completeness.ask = Array.from({ length: ask }, (_, i) => ({ text: `gap ${String(i)}`, sectionKey: 'money' }));
  return map;
}

describe('completenessScore', () => {
  it('gives 100 to a comfortably solid map and 0 to an empty one', () => {
    expect(completenessScore({ level: 'solid', know: items(10, 'x'), assuming: [], ask: [] })).toBe(100);
    expect(completenessScore({ level: 'thin', know: [], assuming: [], ask: [] })).toBe(40); // 0 base + full no-assumption/no-gap credit
  });
  it('is monotonic in sourced facts and penalized by assumptions/gaps', () => {
    const base = { level: 'getting-there' as const, assuming: [] as ClientMapItem[], ask: [] as GapQuestion[] };
    const s4 = completenessScore({ ...base, know: items(4, 'x') });
    const s8 = completenessScore({ ...base, know: items(8, 'x') });
    expect(s8).toBeGreaterThan(s4);
    const withAssume = completenessScore({ level: 'thin', know: items(8, 'x'), assuming: items(5, 'a'), ask: [] });
    expect(withAssume).toBeLessThan(s8);
  });
});

describe('staleDaysFrom', () => {
  it('computes whole days and handles null/garbage', () => {
    expect(staleDaysFrom('2026-06-30T12:00:00.000Z', NOW)).toBe(2);
    expect(staleDaysFrom(null, NOW)).toBeNull();
    expect(staleDaysFrom('not-a-date', NOW)).toBeNull();
  });
});

describe('buildBookRows', () => {
  const label = (m: Matter) => m.client;
  it('ranks neediest first, skips archived and sample matters, marks unbuilt maps', () => {
    const matters = [
      matter('rich'), matter('poor'), matter('unbuilt'),
      matter('arch', { archived: true }), matter('samp', { isSample: true }),
    ];
    const maps = {
      rich: builtMap('rich', 10, 0, 0, '2026-07-01T00:00:00.000Z'),
      poor: builtMap('poor', 1, 3, 4, '2026-03-01T00:00:00.000Z'),
    };
    const rows = buildBookRows(matters, maps, NOW, label);
    expect(rows.map((r) => r.matterId)).toEqual(['unbuilt', 'poor', 'rich']);
    expect(at(rows, 0).level).toBe('not-built');
    expect(at(rows, 0).score).toBe(0);
    expect(at(rows, 2).score).toBe(100);
    expect(at(rows, 2).staleDays).toBe(1); // lastBuiltAt 7/1 vs NOW 7/2
  });
  it('derives lastTouch from the max of lastBuiltAt and item updatedAt', () => {
    const map = builtMap('m1', 2, 0, 0, '2026-05-01T00:00:00.000Z');
    at(at(map.sections, 0).items, 0).updatedAt = '2026-06-20T00:00:00.000Z';
    const rows = buildBookRows([matter('m1')], { m1: map }, NOW, label);
    expect(at(rows, 0).lastTouchIso).toBe('2026-06-20T00:00:00.000Z');
  });
});

describe('sortBookRows', () => {
  it('sorts by any key both directions without mutating input', () => {
    const rows = buildBookRows(
      [matter('a'), matter('b')],
      { a: builtMap('a', 8, 0, 0, '2026-07-01T00:00:00.000Z'), b: builtMap('b', 1, 0, 0, '2026-07-01T00:00:00.000Z') },
      NOW, (m) => m.id,
    );
    const byScoreDesc = sortBookRows(rows, { key: 'score', dir: 'desc' });
    expect(at(byScoreDesc, 0).matterId).toBe('a');
    expect(rows).not.toBe(byScoreDesc);
    const byLabel = sortBookRows(rows, { key: 'label', dir: 'asc' });
    expect(at(byLabel, 0).label).toBe('a');
  });
});
