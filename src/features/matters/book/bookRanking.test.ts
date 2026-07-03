import { describe, it, expect } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import type { ClientMap, ClientMapItem } from '@/platform/clientMap/types';
import { emptyClientMap } from '@/platform/clientMap/types';
import { completenessScore, buildBookRows, sortBookRows, staleDaysFrom } from './bookRanking';

const NOW = '2026-07-02T12:00:00.000Z';

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
  map.sections[0]!.items = [
    ...Array.from({ length: know }, (_, i) => item(`k${i}`)),
    ...Array.from({ length: assuming }, (_, i) => item(`a${i}`, { isAssumption: true, sources: [] })),
  ];
  map.completeness.ask = Array.from({ length: ask }, (_, i) => ({ text: `gap ${i}`, sectionKey: 'money' }));
  return map;
}

describe('completenessScore', () => {
  it('gives 100 to a comfortably solid map and 0 to an empty one', () => {
    expect(completenessScore({ level: 'solid', know: Array(10).fill(item('x')), assuming: [], ask: [] })).toBe(100);
    expect(completenessScore({ level: 'thin', know: [], assuming: [], ask: [] })).toBe(40); // 0 base + full no-assumption/no-gap credit
  });
  it('is monotonic in sourced facts and penalized by assumptions/gaps', () => {
    const base = { level: 'getting-there' as const, assuming: [], ask: [] };
    const s4 = completenessScore({ ...base, know: Array(4).fill(item('x')) });
    const s8 = completenessScore({ ...base, know: Array(8).fill(item('x')) });
    expect(s8).toBeGreaterThan(s4);
    const withAssume = completenessScore({ level: 'thin', know: Array(8).fill(item('x')), assuming: Array(5).fill(item('a')), ask: [] });
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
    expect(rows[0]!.level).toBe('not-built');
    expect(rows[0]!.score).toBe(0);
    expect(rows[2]!.score).toBe(100);
    expect(rows[2]!.staleDays).toBe(1); // lastBuiltAt 7/1 vs NOW 7/2
  });
  it('derives lastTouch from the max of lastBuiltAt and item updatedAt', () => {
    const map = builtMap('m1', 2, 0, 0, '2026-05-01T00:00:00.000Z');
    map.sections[0]!.items[0]!.updatedAt = '2026-06-20T00:00:00.000Z';
    const rows = buildBookRows([matter('m1')], { m1: map }, NOW, label);
    expect(rows[0]!.lastTouchIso).toBe('2026-06-20T00:00:00.000Z');
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
    expect(byScoreDesc[0]!.matterId).toBe('a');
    expect(rows).not.toBe(byScoreDesc);
    const byLabel = sortBookRows(rows, { key: 'label', dir: 'asc' });
    expect(byLabel[0]!.label).toBe('a');
  });
});
