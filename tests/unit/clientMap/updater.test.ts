// tests/unit/clientMap/updater.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const retrieveMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({ MemoryService: { retrieve: retrieveMock }, isMemoryEnabled: () => true }));
import { computeSourceFingerprint, proposeUpdates } from '@/platform/clientMap/updater';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem } from '@/platform/clientMap/types';

const it1 = (text: string, origin: 'ai' | 'user' = 'ai'): ClientMapItem => ({ id: text, text, origin, isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
beforeEach(() => retrieveMock.mockReset());

describe('updater', () => {
  it('fingerprint changes when the indexed source set changes', async () => {
    retrieveMock.mockResolvedValueOnce([{ path: '/a', sourceId: '/a', chunkText: 'x', score: 1, paragraphIndex: 0 }]);
    const f1 = await computeSourceFingerprint('m1');
    retrieveMock.mockResolvedValueOnce([
      { path: '/a', sourceId: '/a', chunkText: 'x', score: 1, paragraphIndex: 0 },
      { path: '/b', sourceId: '/b', chunkText: 'y', score: 1, paragraphIndex: 0 },
    ]);
    const f2 = await computeSourceFingerprint('m1');
    expect(f1).not.toBe(f2);
  });

  it('proposes adds for new facts only and never touches user-origin items', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    current.sections[2].items = [it1('Existing issue'), it1('My own note', 'user')];
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2].items = [it1('Existing issue'), it1('A brand new issue'), it1('My own note')];
    const updates = proposeUpdates('m1', current, built);
    expect(updates.every((u) => u.op === 'add')).toBe(true);
    expect(updates.map((u) => u.draft?.text)).toContain('A brand new issue');
    expect(updates.map((u) => u.draft?.text)).not.toContain('Existing issue'); // already present
    expect(updates.map((u) => u.draft?.text)).not.toContain('My own note'); // user-origin, untouched
  });
});
