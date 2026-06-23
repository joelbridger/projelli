// tests/unit/clientMap/clientMapStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useClientMapStore, getClientMap } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ProposedUpdate, ClientMapItem } from '@/platform/clientMap/types';

const item = (id: string, text: string): ClientMapItem => ({
  id, text, origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-22T00:00:00Z',
});

beforeEach(() => { useClientMapStore.setState({ maps: {} }); });

describe('clientMapStore', () => {
  it('sets and gets a map by matter id', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    expect(useClientMapStore.getState().getMap('m1')?.matterId).toBe('m1');
    expect(getClientMap('m1')?.matterId).toBe('m1'); // non-reactive accessor
  });

  it('editItem marks the item as user-origin and not an assumption', () => {
    const m = emptyClientMap('m1');
    m.sections[0].items.push(item('i1', 'AI text'));
    m.sections[0].items[0].isAssumption = true;
    useClientMapStore.getState().setMap('m1', m);
    useClientMapStore.getState().editItem('m1', 'story', 'i1', 'My corrected text');
    const edited = useClientMapStore.getState().getMap('m1')!.sections[0].items[0];
    expect(edited.text).toBe('My corrected text');
    expect(edited.origin).toBe('user');
    expect(edited.isAssumption).toBe(false);
  });

  it('acceptUpdate(add) appends the drafted item and clears the update', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'u1', sectionKey: 'standing', op: 'add',
      draft: item('n1', 'New open issue'), reason: 'new email', createdAt: '2026-06-22T00:00:00Z',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().acceptUpdate('m1', 'u1');
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.sections.find((s) => s.key === 'standing')!.items.map((i) => i.text)).toContain('New open issue');
    expect(map.pendingUpdates).toEqual([]);
  });

  it('dismissUpdate drops the update without changing items', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = { id: 'u2', sectionKey: 'next', op: 'add', draft: item('x', 'X'), reason: 'r', createdAt: 't' };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().dismissUpdate('m1', 'u2');
    expect(useClientMapStore.getState().getMap('m1')!.pendingUpdates).toEqual([]);
    expect(useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'next')!.items).toEqual([]);
  });
});
