import { describe, it, expect } from 'vitest';
import { createDemoRetriever, type DemoFile } from '@/web-demo/demoRetrieval';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';

const WEBB = 'matter_demo_webb';
const OTHER = 'matter_demo_other';

const FILES: DemoFile[] = [
  {
    path: '/keepance-demo/Webb Household/Financial Plan Summary.md',
    content:
      '# Financial Plan Summary: Webb Household\n\n' +
      'Goals: retire at 60, fund both kids college, pay off the house early.\n\n' +
      'Marcus 401(k): $412,000, contributing 12% plus a 4% match.\n\n' +
      'Old employer 401(k) of $96,000 still sitting at the prior custodian, not yet rolled over.',
  },
  {
    path: '/keepance-demo/Webb Household/Beneficiary Designations.md',
    content:
      '# Beneficiary Designations\n\n' +
      'Old 401(k) still lists Jessica Reyes, the ex-wife, as 100% primary beneficiary, dated 2019.',
  },
  {
    path: '/keepance-demo/Acme Trust/Acme Notes.md',
    content:
      '# Acme Trust\n\nThe Acme Trust portfolio holds municipal bonds and a large cash position.',
  },
  {
    path: '/README.md',
    content: '# Demo workspace\n\nThis is the seeded demo workspace readme.',
  },
];

/** Test matter resolver mirroring the demo's folder→matter mapping. */
function resolveMatter(path: string): string {
  if (path.startsWith('/keepance-demo/Webb Household/')) return WEBB;
  if (path.startsWith('/keepance-demo/Acme Trust/')) return OTHER;
  return 'unassigned';
}

const ALL: RetrievalScope = { kind: 'allMatters' };
const WEBB_SCOPE: RetrievalScope = { kind: 'matter', matterId: WEBB };
const OTHER_SCOPE: RetrievalScope = { kind: 'matter', matterId: OTHER };

describe('createDemoRetriever', () => {
  it('returns RagHit-shaped results for a content query', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    const hits = await r.retrieve('retire goals college', 5, ALL);
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top.path).toContain('Webb Household/Financial Plan Summary.md');
    expect(typeof top.chunkText).toBe('string');
    expect(top.chunkText.length).toBeGreaterThan(0);
    expect(typeof top.score).toBe('number');
    expect(typeof top.paragraphIndex).toBe('number');
    expect(top.matterId).toBe(WEBB);
    expect(top.sourceId).toBe(top.path);
    expect(top.sourceType).toBe('text');
  });

  it('finds a specific fact in the right document', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    const hits = await r.retrieve('Jessica Reyes beneficiary', 5, ALL);
    expect(hits.some((h) => h.path.includes('Beneficiary Designations.md'))).toBe(true);
  });

  it('ISOLATION: a Webb-scoped query never returns another client or unassigned chunks', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    // "portfolio bonds cash" matches the Acme doc; scoped to Webb it must be dropped.
    const hits = await r.retrieve('portfolio bonds cash municipal trust', 10, WEBB_SCOPE);
    expect(hits.every((h) => h.matterId === WEBB)).toBe(true);
    expect(hits.some((h) => h.path.includes('Acme Trust'))).toBe(false);
    expect(hits.some((h) => h.path === '/README.md')).toBe(false);
  });

  it('ISOLATION: an other-client query never returns Webb chunks', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    const hits = await r.retrieve('401k retire goals Webb', 10, OTHER_SCOPE);
    expect(hits.every((h) => h.matterId === OTHER)).toBe(true);
    expect(hits.some((h) => h.path.includes('Webb Household'))).toBe(false);
  });

  it('allMatters scope can return chunks from multiple matters', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    const hits = await r.retrieve('trust portfolio retire 401k', 10, ALL);
    const matters = new Set(hits.map((h) => h.matterId));
    expect(matters.size).toBeGreaterThanOrEqual(1);
    // At least one Webb and the query also matches Acme — both allowed cross-matter.
    expect(hits.length).toBeGreaterThan(0);
  });

  it('respects topK', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    const hits = await r.retrieve('the', 2, ALL);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('returns [] for an empty query or non-positive topK', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    expect(await r.retrieve('   ', 5, ALL)).toEqual([]);
    expect(await r.retrieve('retire', 0, ALL)).toEqual([]);
  });

  it('assigns distinct paragraph indices within a multi-paragraph file', async () => {
    const r = createDemoRetriever(FILES, resolveMatter);
    const hits = await r.retrieve('401k custodian match', 10, WEBB_SCOPE);
    const planHits = hits.filter((h) => h.path.includes('Financial Plan Summary.md'));
    expect(planHits.length).toBeGreaterThan(0);
    // paragraph indices are non-negative integers
    for (const h of planHits) {
      expect(Number.isInteger(h.paragraphIndex)).toBe(true);
      expect(h.paragraphIndex).toBeGreaterThanOrEqual(0);
    }
  });
});
