// tests/unit/clientMap/updater.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const retrieveMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({ MemoryService: { retrieve: retrieveMock }, isMemoryEnabled: () => true }));
import {
  CLIENT_MAP_SECTION_ITEM_CAP,
  autoApplySafeAddUpdates,
  capGeneratedSectionItems,
  computeSourceFingerprint,
  proposeUpdates,
} from '@/platform/clientMap/updater';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem } from '@/platform/clientMap/types';

const it1 = (text: string, origin: 'ai' | 'user' = 'ai'): ClientMapItem => ({ id: text, text, origin, isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
const distinctFacts = [
  'Roth conversion window opens in November.',
  'Susan has a 403b through the school district.',
  'Robert receives consulting income quarterly.',
  'College funding is complete for both children.',
  'The household keeps cash reserves at Ally.',
  'Estate documents were last signed in 2018.',
  'The taxable brokerage account holds concentrated stock.',
  'Umbrella insurance renews every September.',
  'The mortgage rate is fixed at 3.1 percent.',
  'Charitable giving runs through a donor advised fund.',
  'The investment policy statement uses moderate risk.',
  'The next review meeting is scheduled for April.',
  'Beneficiary forms need confirmation after the rollover.',
  'The emergency fund target is nine months.',
  'Long term care coverage was declined in 2021.',
  'The family cabin is owned through an LLC.',
  'The custodial account belongs to Maya.',
  'Tax estimates are paid from the operating account.',
  'The trust names Susan as successor trustee.',
  'The pension election is single life with survivor option.',
];
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
    current.sections[2]!.items = [it1('Existing issue'), it1('My own note', 'user')];
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2]!.items = [it1('Existing issue'), it1('A brand new issue'), it1('My own note')];
    const updates = proposeUpdates('m1', current, built);
    expect(updates.every((u) => u.op === 'add')).toBe(true);
    expect(updates.map((u) => u.draft?.text)).toContain('A brand new issue');
    expect(updates.map((u) => u.draft?.text)).not.toContain('Existing issue'); // already present
    expect(updates.map((u) => u.draft?.text)).not.toContain('My own note'); // user-origin, untouched
  });

  it('suppresses reworded near-duplicate proposals against existing section items', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    current.sections[2]!.items = [it1('Robert holds a Schwab IRA for retirement income.')];
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2]!.items = [
      it1("Robert's Schwab IRA supports retirement income."),
      it1('Susan expects to retire in 2032.'),
    ];

    const updates = proposeUpdates('m1', current, built);

    expect(updates.map((u) => u.draft?.text)).toEqual(['Susan expects to retire in 2032.']);
  });

  it('caps proposed additions to the open space in a section', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    current.sections[2]!.items = [it1('Existing insurance review is complete.'), it1('Existing cash flow note is confirmed.')];
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2]!.items = distinctFacts.map((fact) => it1(fact));

    const updates = proposeUpdates('m1', current, built);

    expect(updates).toHaveLength(CLIENT_MAP_SECTION_ITEM_CAP - 2);
  });

  it('keeps the strongest sourced item when generated facts are near-duplicates', () => {
    const weak = { ...it1('Robert holds a Schwab IRA for retirement income.'), sources: [], isAssumption: true };
    const strong = {
      ...it1("Robert's Schwab IRA supports retirement income."),
      sources: [{ kind: 'document' as const, ref: '/plan.pdf', snippet: 'IRA supports retirement income', citationId: 'chunk-1' }],
    };

    expect(capGeneratedSectionItems([weak, strong]).map((item) => item.text))
      .toEqual(["Robert's Schwab IRA supports retirement income."]);
  });

  it('auto-applies only clean source-backed add proposals', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    const safeAdd = {
      id: 'safe',
      sectionKey: 'money',
      op: 'add' as const,
      draft: it1('A sourced new fact'),
      reason: 'new source',
      createdAt: 't',
    };
    const unsourcedAdd = {
      id: 'unsourced',
      sectionKey: 'followups',
      op: 'add' as const,
      draft: { ...it1('Needs review'), sources: [] },
      reason: 'no source',
      createdAt: 't',
    };
    const change = {
      id: 'change',
      sectionKey: 'money',
      op: 'change' as const,
      itemId: 'existing',
      draft: it1('Changed fact'),
      reason: 'changed',
      createdAt: 't',
    };

    const applied = autoApplySafeAddUpdates({
      ...current,
      pendingUpdates: [safeAdd, unsourcedAdd, change],
    });

    expect(applied.sections.find((s) => s.key === 'money')!.items.map((i) => i.text))
      .toContain('A sourced new fact');
    expect(applied.pendingUpdates.map((u) => u.id)).toEqual(['unsourced', 'change']);
  });

  it('does not auto-apply a near-duplicate add or grow past the section cap', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    current.sections[2]!.items = [it1('Robert holds a Schwab IRA for retirement income.')];
    const nearDuplicate = {
      id: 'near-duplicate',
      sectionKey: 'money',
      op: 'add' as const,
      draft: it1("Robert's Schwab IRA supports retirement income."),
      reason: 'same fact',
      createdAt: 't',
    };

    const deduped = autoApplySafeAddUpdates({ ...current, pendingUpdates: [nearDuplicate] });
    expect(deduped.sections[2]!.items.map((item) => item.text))
      .toEqual(['Robert holds a Schwab IRA for retirement income.']);
    expect(deduped.pendingUpdates.map((update) => update.id)).toEqual(['near-duplicate']);

    const capped: ClientMap = { ...emptyClientMap('m1') };
    capped.sections[2]!.items = Array.from({ length: CLIENT_MAP_SECTION_ITEM_CAP }, (_, index) => it1(`Existing cap marker ${String(index)}`));
    const overflow = {
      id: 'overflow',
      sectionKey: 'money',
      op: 'add' as const,
      draft: it1('New overflow item with a strong source'),
      reason: 'cap',
      createdAt: 't',
    };

    const afterCap = autoApplySafeAddUpdates({ ...capped, pendingUpdates: [overflow] });
    expect(afterCap.sections[2]!.items).toHaveLength(CLIENT_MAP_SECTION_ITEM_CAP);
    expect(afterCap.pendingUpdates.map((update) => update.id)).toEqual(['overflow']);
  });
});
