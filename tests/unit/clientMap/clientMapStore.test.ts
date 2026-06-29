// tests/unit/clientMap/clientMapStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useClientMapStore, getClientMap, migratePersistedClientMaps } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ProposedUpdate, ClientMapItem } from '@/platform/clientMap/types';

const item = (id: string, text: string): ClientMapItem => ({
  id, text, origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-22T00:00:00Z',
});

const userItem = (id: string, text: string): ClientMapItem => ({
  id, text, origin: 'user', isAssumption: false, sources: [], updatedAt: '2026-06-22T00:00:00Z',
});

beforeEach(() => { useClientMapStore.setState({ maps: {} }); });

describe('migratePersistedClientMaps', () => {
  it('converts a legacy string[] ask into section-tagged GapQuestions', () => {
    const legacy = {
      maps: {
        m1: { ...emptyClientMap('m1'), completeness: { level: 'thin', know: [], assuming: [], ask: ['What is the deadline?', 'Who is opposing counsel?'] } },
      },
    };
    const out = migratePersistedClientMaps(legacy, 1);
    expect(out.maps!['m1']!.completeness.ask).toEqual([
      { text: 'What is the deadline?', sectionKey: 'money' },
      { text: 'Who is opposing counsel?', sectionKey: 'money' },
    ]);
  });

  it('leaves already-tagged GapQuestions untouched', () => {
    const current = {
      maps: {
        m1: { ...emptyClientMap('m1'), completeness: { level: 'thin', know: [], assuming: [], ask: [{ text: 'q', sectionKey: 'household' }] } },
      },
    };
    const out = migratePersistedClientMaps(current, 2);
    expect(out.maps!['m1']!.completeness.ask).toEqual([{ text: 'q', sectionKey: 'household' }]);
  });

  it('remaps legacy v2 core sections and merges upcoming plus next into followups', () => {
    const legacy = {
      maps: {
        m1: {
          ...emptyClientMap('m1'),
          sections: [
            { id: 'people', kind: 'core' as const, key: 'people', title: 'People', items: [item('p', 'Robert and Susan')] },
            { id: 'story', kind: 'core' as const, key: 'story', title: 'Story', items: [item('g', 'Retire in 2026')] },
            { id: 'standing', kind: 'core' as const, key: 'standing', title: 'Standing', items: [item('m', 'Schwab IRA')] },
            { id: 'upcoming', kind: 'core' as const, key: 'upcoming', title: 'Upcoming', items: [item('u', 'Annual review in July')] },
            { id: 'next', kind: 'core' as const, key: 'next', title: 'Next', items: [item('n', 'Confirm beneficiaries')] },
          ],
          completeness: {
            level: 'thin' as const,
            know: [],
            assuming: [],
            ask: [{ text: 'Who is the CPA?', sectionKey: 'people' }],
          },
          pendingUpdates: [
            { id: 'upd', sectionKey: 'next', op: 'add' as const, draft: item('x', 'Schedule follow-up'), reason: 'r', createdAt: 't' },
          ],
        },
      },
    };

    const out = migratePersistedClientMaps(legacy, 2);
    const map = out.maps!['m1']!;

    expect(map.sections.map((s) => s.key)).toEqual(['household', 'goals', 'money', 'followups']);
    expect(map.sections.find((s) => s.key === 'followups')!.items.map((i) => i.text)).toEqual([
      'Annual review in July',
      'Confirm beneficiaries',
    ]);
    expect(map.completeness.ask).toEqual([{ text: 'Who is the CPA?', sectionKey: 'household' }]);
    expect(map.pendingUpdates).toEqual([
      expect.objectContaining({ id: 'upd', sectionKey: 'followups' }),
    ]);
  });

  it('tolerates empty / missing persisted state', () => {
    expect(migratePersistedClientMaps(undefined, 1)).toEqual({});
    expect(migratePersistedClientMaps({}, 1)).toEqual({});
  });

  it('fails soft on malformed persisted maps and gap entries', () => {
    const malformed = {
      maps: {
        nullMap: null,
        noCompleteness: { matterId: 'x' },
        m1: { ...emptyClientMap('m1'), completeness: { level: 'thin', know: [], assuming: [], ask: [null, 123, '', '  ', 'Real question', { text: 'Tagged', sectionKey: 'household' }, { sectionKey: 'household' }] } },
      },
    };
    const out = migratePersistedClientMaps(malformed, 1);
    // The null map and the one without completeness must not throw or be corrupted.
    expect(out.maps!['nullMap']).toBeNull();
    // Only well-formed gap questions survive, each with a valid text + sectionKey.
    expect(out.maps!['m1']!.completeness.ask).toEqual([
      { text: 'Real question', sectionKey: 'money' },
      { text: 'Tagged', sectionKey: 'household' },
    ]);
  });
});

describe('clientMapStore', () => {
  it('sets and gets a map by matter id', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    expect(useClientMapStore.getState().getMap('m1')?.matterId).toBe('m1');
    expect(getClientMap('m1')?.matterId).toBe('m1'); // non-reactive accessor
  });

  it('editItem marks the item as user-origin and not an assumption', () => {
    const m = emptyClientMap('m1');
    const section = m.sections[0]!;
    section.items.push(item('i1', 'AI text'));
    section.items[0]!.isAssumption = true;
    useClientMapStore.getState().setMap('m1', m);
    useClientMapStore.getState().editItem('m1', 'household', 'i1', 'My corrected text');
    const edited = useClientMapStore.getState().getMap('m1')!.sections[0]!.items[0]!;
    expect(edited.text).toBe('My corrected text');
    expect(edited.origin).toBe('user');
    expect(edited.isAssumption).toBe(false);
  });

  it('acceptUpdate(add) appends the drafted item and clears the update', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'u1', sectionKey: 'money', op: 'add',
      draft: item('n1', 'New open issue'), reason: 'new email', createdAt: '2026-06-22T00:00:00Z',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().acceptUpdate('m1', 'u1');
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.sections.find((s) => s.key === 'money')!.items.map((i) => i.text)).toContain('New open issue');
    expect(map.pendingUpdates).toEqual([]);
  });

  it('dismissUpdate drops the update without changing items', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = { id: 'u2', sectionKey: 'followups', op: 'add', draft: item('x', 'X'), reason: 'r', createdAt: 't' };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().dismissUpdate('m1', 'u2');
    expect(useClientMapStore.getState().getMap('m1')!.pendingUpdates).toEqual([]);
    expect(useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'followups')!.items).toEqual([]);
  });

  it('acceptUpdate(change, no override) on a user-origin item leaves text unchanged and clears the pending update', () => {
    const m = emptyClientMap('m1');
    m.sections[0]!.items.push(userItem('u-item-1', 'My own text'));
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'upd-ai-change', sectionKey: 'household', op: 'change', itemId: 'u-item-1',
      draft: { ...item('u-item-1', 'AI replacement text'), id: 'u-item-1' },
      reason: 'AI thinks it knows better', createdAt: '2026-06-22T00:00:00Z',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().acceptUpdate('m1', 'upd-ai-change');
    const map = useClientMapStore.getState().getMap('m1')!;
    // The proposal must be cleared.
    expect(map.pendingUpdates).toEqual([]);
    // The user-origin item must be unchanged.
    const targetItem = map.sections.find((s) => s.key === 'household')!.items.find((i) => i.id === 'u-item-1');
    expect(targetItem?.text).toBe('My own text');
    expect(targetItem?.origin).toBe('user');
  });

  it('approve-first: setMap NEVER auto-applies updates — even a clean sourced add stays pending (B5)', () => {
    const m = emptyClientMap('m1');
    const sourcedAdd: ProposedUpdate = {
      id: 'safe-add',
      sectionKey: 'money',
      op: 'add',
      draft: {
        ...item('safe', 'Client wants capital preservation'),
        sources: [{ kind: 'document', ref: '/plan.pdf', snippet: 'capital preservation' }],
      },
      reason: 'Found in source',
      createdAt: '2026-06-22T00:00:00Z',
    };
    const unsourcedAdd: ProposedUpdate = {
      id: 'needs-review',
      sectionKey: 'followups',
      op: 'add',
      draft: item('review', 'Likely needs a follow-up'),
      reason: 'No source',
      createdAt: '2026-06-22T00:00:00Z',
    };

    useClientMapStore.getState().setMap('m1', {
      ...m,
      pendingUpdates: [sourcedAdd, unsourcedAdd],
    });

    const map = useClientMapStore.getState().getMap('m1')!;
    // Approve-first: nothing was applied to the map body — both stay pending until
    // the user approves them.
    expect(map.sections.find((s) => s.key === 'money')!.items.map((i) => i.text))
      .not.toContain('Client wants capital preservation');
    expect(map.pendingUpdates.map((u) => u.id)).toEqual(['safe-add', 'needs-review']);
  });
});
