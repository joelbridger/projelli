// tests/unit/clientMap/clientMapStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useClientMapStore, getClientMap, migratePersistedClientMaps } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import { proposalSignature } from '@/platform/clientMap/updater';
import { useProfileStore } from '@/platform/profile/profileStore';
import type { ProposedUpdate, ClientMapItem } from '@/platform/clientMap/types';

const item = (id: string, text: string): ClientMapItem => ({
  id, text, origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-22T00:00:00Z',
});

const userItem = (id: string, text: string): ClientMapItem => ({
  id, text, origin: 'user', isAssumption: false, sources: [], updatedAt: '2026-06-22T00:00:00Z',
});

const sourced = (id: string, text: string): ClientMapItem => ({
  ...item(id, text),
  sources: [{ kind: 'document', ref: '/f.pdf', snippet: 's' }],
});

beforeEach(() => {
  useClientMapStore.setState({ maps: {} });
  useProfileStore.setState({ soloName: 'Casey Advisor', firmName: '' });
});

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

  it('remaps the embedded section key inside pending-update + dismissed signatures (v2->v3)', () => {
    // An upgrading user with a pending update AND a previously-dismissed proposal,
    // both carrying OLD-key signatures. The live update code derives signatures
    // from the NEW keys, so unless the migration remaps the key embedded INSIDE
    // each signature string, (a) the dismissal stops matching and the suggestion
    // REAPPEARS, and (b) the pending signature drifts from its remapped sectionKey.
    const pendingSig = proposalSignature('next', 'add', 'Schedule follow-up');
    const dismissedSig = proposalSignature('standing', 'change', 'Schwab IRA balance');
    const legacy = {
      maps: {
        m1: {
          ...emptyClientMap('m1'),
          sections: [
            { id: 'standing', kind: 'core' as const, key: 'standing', title: 'Standing', items: [] },
            { id: 'next', kind: 'core' as const, key: 'next', title: 'Next', items: [] },
          ],
          pendingUpdates: [
            {
              id: 'upd', sectionKey: 'next', op: 'add' as const, draft: item('x', 'Schedule follow-up'),
              reason: 'r', createdAt: 't', signature: pendingSig,
            },
          ],
          dismissedSignatures: [
            { signature: dismissedSig, sourceSignature: 'src-1' },
          ],
        },
      },
    };

    const out = migratePersistedClientMaps(legacy, 2);
    const map = out.maps!['m1']!;

    // The pending update's sectionKey AND the key embedded in its signature both
    // move to followups (op + normalized text preserved exactly).
    expect(map.pendingUpdates[0]!.sectionKey).toBe('followups');
    expect(map.pendingUpdates[0]!.signature).toBe(proposalSignature('followups', 'add', 'Schedule follow-up'));

    // The dismissed signature now equals what the live code generates under the
    // NEW key, so the dismissal keeps suppressing the same fact (no reappearance).
    expect(map.dismissedSignatures![0]!.signature).toBe(proposalSignature('money', 'change', 'Schwab IRA balance'));
    expect(map.dismissedSignatures![0]!.sourceSignature).toBe('src-1');
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

  it('records who/what/when/source history when a bullet is edited', () => {
    const m = emptyClientMap('m1');
    m.sections[0]!.items.push(sourced('i1', 'AI text'));
    useClientMapStore.getState().setMap('m1', m);

    useClientMapStore.getState().editItem('m1', 'household', 'i1', 'My corrected text');

    const history = useClientMapStore.getState().getMap('m1')!.editHistory!;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'bullet_edited',
      actor: 'Casey Advisor',
      sectionKey: 'household',
      itemId: 'i1',
      beforeText: 'AI text',
      afterText: 'My corrected text',
      sources: [{ kind: 'document', ref: '/f.pdf', snippet: 's' }],
    });
    expect(Date.parse(history[0]!.timestamp)).not.toBeNaN();
  });

  it('records add and remove bullet history', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);

    useClientMapStore.getState().addUserItem('m1', 'goals', 'Wants to retire in 2028');
    const added = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'goals')!.items[0]!;
    useClientMapStore.getState().removeItem('m1', 'goals', added.id);

    const history = useClientMapStore.getState().getMap('m1')!.editHistory!;
    expect(history.map((h) => h.action)).toEqual(['bullet_added', 'bullet_removed']);
    expect(history[0]!.afterText).toBe('Wants to retire in 2028');
    expect(history[1]!.beforeText).toBe('Wants to retire in 2028');
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
    expect(map.editHistory?.at(-1)).toMatchObject({
      action: 'bullet_added',
      afterText: 'New open issue',
    });
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

// D1: "What I know / what I'm missing" must reflect the CURRENT sections, not a
// stale snapshot taken when the map was generated. Every mutator that changes
// section items has to recompute completeness.know/assuming/level.
describe('D1: completeness stays in sync with section edits', () => {
  it('editItem moves a confirmed item out of "assuming" once isAssumption is cleared', () => {
    const m = emptyClientMap('m1');
    m.sections[0]!.items.push({ ...item('a1', 'draft text'), isAssumption: true });
    m.completeness = { level: 'thin', know: [], assuming: m.sections[0]!.items.slice(), ask: [] };
    useClientMapStore.getState().setMap('m1', m);
    expect(useClientMapStore.getState().getMap('m1')!.completeness.assuming).toHaveLength(1);

    useClientMapStore.getState().editItem('m1', 'household', 'a1', 'Confirmed text');

    const after = useClientMapStore.getState().getMap('m1')!;
    // Stale completeness would still list this item under "assuming".
    expect(after.completeness.assuming).toHaveLength(0);
  });

  it('removeItem drops the removed item from completeness.know', () => {
    const m = emptyClientMap('m1');
    const a = sourced('a', 'fact a');
    const b = sourced('b', 'fact b');
    const c = sourced('c', 'fact c');
    m.sections[0]!.items.push(a, b, c);
    m.completeness = { level: 'getting-there', know: [a, b, c], assuming: [], ask: [] };
    useClientMapStore.getState().setMap('m1', m);

    useClientMapStore.getState().removeItem('m1', 'household', 'a');

    const after = useClientMapStore.getState().getMap('m1')!;
    expect(after.completeness.know.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('acceptUpdate(add) folds the newly-accepted sourced item into completeness.know', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'u-add', sectionKey: 'money', op: 'add',
      draft: sourced('new1', 'New sourced fact'), reason: 'r', createdAt: 't',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);

    useClientMapStore.getState().acceptUpdate('m1', 'u-add');

    const after = useClientMapStore.getState().getMap('m1')!;
    expect(after.completeness.know.map((i) => i.id)).toContain('new1');
  });

  it('removeSection drops that section\'s items out of completeness too', () => {
    const m = emptyClientMap('m1');
    const cs = { id: 'cs1', kind: 'custom' as const, key: 'cs1', title: 'Billing', scope: 'matter' as const, items: [sourced('bill1', 'Flat fee')] };
    m.sections.push(cs);
    m.completeness = { level: 'thin', know: [cs.items[0]!], assuming: [], ask: [] };
    useClientMapStore.getState().setMap('m1', m);

    useClientMapStore.getState().removeSection('m1', 'cs1');

    const after = useClientMapStore.getState().getMap('m1')!;
    expect(after.completeness.know.map((i) => i.id)).not.toContain('bill1');
  });
});

// D2: editing an AI-suggested update with the user's own override text must not
// keep showing the AI's (now-unverified) citations next to it.
describe('D2: acceptUpdate override clears stale AI citations', () => {
  it('clears sources and marks the item user-origin when override text is used', () => {
    const m = emptyClientMap('m1');
    const original = sourced('i1', 'AI original text');
    m.sections.find((s) => s.key === 'money')!.items.push(original);
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'upd1', sectionKey: 'money', op: 'change', itemId: 'i1',
      draft: sourced('i1', 'AI suggested replacement'), reason: 'r', createdAt: 't',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);

    useClientMapStore.getState().acceptUpdate('m1', 'upd1', 'My own edited wording');

    const result = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'money')!.items.find((i) => i.id === 'i1')!;
    expect(result.text).toBe('My own edited wording');
    expect(result.origin).toBe('user');
    expect(result.sources).toEqual([]);
  });

  it('without an override, accepting the AI draft as-is keeps its citations', () => {
    const m = emptyClientMap('m1');
    const original = item('i1', 'AI original text');
    m.sections.find((s) => s.key === 'money')!.items.push(original);
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'upd2', sectionKey: 'money', op: 'change', itemId: 'i1',
      draft: sourced('i1', 'AI suggested replacement'), reason: 'r', createdAt: 't',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);

    useClientMapStore.getState().acceptUpdate('m1', 'upd2');

    const result = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'money')!.items.find((i) => i.id === 'i1')!;
    expect(result.sources).toEqual([{ kind: 'document', ref: '/f.pdf', snippet: 's' }]);
  });
});

// D3: generating a custom section's items happens async; while it's in flight a
// user can already add their own item to the (still-empty) section. The result
// must merge in the AI items, not clobber what the user just added.
describe('D3: mergeSectionItems does not clobber concurrent user edits', () => {
  it('appends generated items onto whatever is already in the section', () => {
    const m = emptyClientMap('m1');
    const cs = { id: 'cs1', kind: 'custom' as const, key: 'cs1', title: 'Billing', scope: 'matter' as const, items: [] };
    m.sections.push(cs);
    useClientMapStore.getState().setMap('m1', m);

    // The user adds their own note to the section while generation is still running.
    useClientMapStore.getState().addUserItem('m1', 'cs1', 'User note added during generation');

    // Generation now resolves and merges in.
    useClientMapStore.getState().mergeSectionItems('m1', 'cs1', [item('ai1', 'AI generated fact')]);

    const section = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'cs1')!;
    expect(section.items.map((i) => i.text)).toEqual([
      'User note added during generation',
      'AI generated fact',
    ]);
  });
});
