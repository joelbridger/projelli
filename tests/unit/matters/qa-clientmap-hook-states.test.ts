// tests/unit/matters/qa-clientmap-hook-states.test.ts
//
// KEEPANCE 5 (adversarial QA) — useClientMap status + regeneration safety.
//
// Mirrors the mocking harness in useClientMap.test.ts (generator + updater mocked).
// These were `it.fails` bug-docs; the bugs are now fixed, so they are normal
// passing regression tests. Backlog: BUG-101, BUG-103, BUG-104 (+ Codex review
// findings: empty-custom-section preservation, gap-only ready).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const buildMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/generator', () => ({ buildClientMap: buildMock }));

const computeFingerprintMock = vi.hoisted(() => vi.fn());
const proposeUpdatesMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/updater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/clientMap/updater')>();
  return {
    ...actual, // keep the real mergePendingUpdates (pure, store-free)
    computeSourceFingerprint: computeFingerprintMock,
    proposeUpdates: proposeUpdatesMock,
  };
});

import { useClientMap } from '@/features/matters/useClientMap';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMapItem, ProposedUpdate } from '@/platform/clientMap/types';

const userItem = (text: string): ClientMapItem => ({
  id: `u-${text}`, text, origin: 'user', isAssumption: false, sources: [], updatedAt: 't',
});

beforeEach(() => {
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
  buildMock.mockReset();
  computeFingerprintMock.mockReset();
  proposeUpdatesMock.mockReset();
});

describe('useClientMap — regression tests for fixed bugs (KEEPANCE 5)', () => {
  // BUG-101 — generate() overwrites the whole stored map, destroying user-origin
  // items (and accepted updates + custom sections). It calls setMap(matterId,
  // {...built}) unconditionally. It is currently only reachable when status is
  // 'idle' (so the single MatterHub button can't re-trigger it today), but the
  // function is unsafe by construction: any future refresh/invalidate path would
  // silently delete the professional's own edits. Spec §6 rule 3: user-origin
  // items must NEVER be overwritten by an AI pass.
  it('BUG-101: regenerate keeps user-origin items instead of wiping them', async () => {
    // Seed a stored map that already holds a user-written item.
    const seeded = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    seeded.sections[2]!.items = [userItem('Client insists on settling by year end')];
    useClientMapStore.getState().setMap('m1', seeded);

    // A fresh AI build has no knowledge of the user's note.
    const aiOnly = { ...emptyClientMap('m1'), lastBuiltAt: 't2' };
    aiOnly.sections[0]!.items = [
      { id: 'ai1', text: 'Matter is a contract dispute', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/a', snippet: 's' }], updatedAt: 't2' },
    ];
    buildMock.mockResolvedValue(aiOnly);
    computeFingerprintMock.mockResolvedValue('fp');
    // The fresh AI content is routed through the approve-first tray; no items are
    // overwritten. (The merge of proposals is the real mergePendingUpdates.)
    proposeUpdatesMock.mockReturnValue([
      { id: 'p1', sectionKey: 'story', op: 'add', reason: 'r', createdAt: 't2',
        draft: { id: 'ai1', text: 'Matter is a contract dispute', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/a', snippet: 's' }], updatedAt: 't2' } },
    ]);

    const { result } = renderHook(() => useClientMap('m1'));
    await act(async () => { await result.current.generate(); });

    const stored = useClientMapStore.getState().getMap('m1');
    const allTexts = stored?.sections.flatMap((s) => s.items.map((i) => i.text)) ?? [];
    // The user's note survives a regenerate.
    expect(allTexts).toContain('Client insists on settling by year end');
    // The fresh AI content lands in the approve-first tray, not the map body.
    expect(stored?.pendingUpdates.map((u) => u.draft?.text)).toContain('Matter is a contract dispute');
    expect(allTexts).not.toContain('Matter is a contract dispute');
  });

  // BUG-103 — a matter with no indexed content shows a blank map, not the honest
  // empty state. The hook returns `status: map ? 'ready' : status`, so once
  // generate() stores an (empty) map object the status is forced to 'ready',
  // making MatterHub's 'empty' branch ("No information found yet...") dead code.
  // Spec §7 open-question 5: an honest empty state.
  it('BUG-103: an empty build reports status "empty", not "ready"', async () => {
    buildMock.mockResolvedValue({ ...emptyClientMap('m2'), lastBuiltAt: 't' }); // zero items
    computeFingerprintMock.mockResolvedValue('0:');

    const { result } = renderHook(() => useClientMap('m2'));
    await act(async () => { await result.current.generate(); });
    await waitFor(() => expect(useClientMapStore.getState().getMap('m2')).toBeDefined());

    // DESIRED: the empty state is reachable. ACTUAL: the hook reports 'ready'.
    expect(result.current.status).toBe('empty');
  });

  // BUG-104 — un-reviewed pending proposals are discarded on the next update check.
  // checkForUpdates does setMap(..., pendingUpdates: proposals), replacing the
  // whole tray. A proposal the user has not yet accepted/dismissed vanishes if the
  // next fresh build no longer reproduces its exact item. Spec §6 rule 3:
  // approve-first review (the user decides every AI change).
  it('BUG-104: a still-pending proposal survives the next update check', async () => {
    const pendingU1: ProposedUpdate = {
      id: 'U1', sectionKey: 'standing', op: 'add', reason: 'from an earlier pass', createdAt: 't',
      draft: { id: 'd1', text: 'Earlier proposed fact', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' },
    };
    const seeded = { ...emptyClientMap('m3'), lastBuiltAt: 't', lastSourceFingerprint: 'fp-old', pendingUpdates: [pendingU1] };
    useClientMapStore.getState().setMap('m3', seeded);

    // A new source change triggers another check; the fresh pass proposes only U2.
    computeFingerprintMock.mockResolvedValue('fp-new');
    buildMock.mockResolvedValue({ ...emptyClientMap('m3'), lastBuiltAt: 't2' });
    const u2: ProposedUpdate = {
      id: 'U2', sectionKey: 'people', op: 'add', reason: 'newly found', createdAt: 't2',
      draft: { id: 'd2', text: 'A newly found fact', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't2' },
    };
    proposeUpdatesMock.mockReturnValue([u2]);

    const { result } = renderHook(() => useClientMap('m3'));
    await act(async () => { await result.current.checkForUpdates(); });

    const ids = useClientMapStore.getState().getMap('m3')?.pendingUpdates.map((u) => u.id) ?? [];
    // DESIRED: U1 is still awaiting the user's decision. ACTUAL: it was replaced away.
    expect(ids).toContain('U1');
  });

  // BUG-101 (Codex finding 1) — a map whose only state is a user-created (empty)
  // custom section must NOT be overwritten by a regenerate.
  it('BUG-101: regenerate preserves an empty user-created custom section', async () => {
    const seeded = { ...emptyClientMap('mC'), lastBuiltAt: 't' };
    seeded.sections.push({ id: 'cs1', kind: 'custom', key: 'cs1', title: 'Insurance', prompt: 'track coverage', scope: 'matter', items: [] });
    useClientMapStore.getState().setMap('mC', seeded);

    buildMock.mockResolvedValue({ ...emptyClientMap('mC'), lastBuiltAt: 't2' }); // AI build has no custom section
    computeFingerprintMock.mockResolvedValue('fp');
    proposeUpdatesMock.mockReturnValue([]);

    const { result } = renderHook(() => useClientMap('mC'));
    await act(async () => { await result.current.generate(); });

    const stored = useClientMapStore.getState().getMap('mC');
    expect(stored?.sections.some((s) => s.id === 'cs1')).toBe(true);
  });

  // BUG-103 (Codex finding 4) — a map with no section items but open gap questions
  // is NOT empty; it reports 'ready' so the Guided Interview can render.
  it('BUG-103: a gap-only map reports "ready", not "empty"', async () => {
    const gapOnly = { ...emptyClientMap('mG'), lastBuiltAt: 't' };
    gapOnly.completeness.ask = [{ text: 'What outcome does the client want?', sectionKey: 'story' }];
    buildMock.mockResolvedValue(gapOnly);
    computeFingerprintMock.mockResolvedValue('fp');

    const { result } = renderHook(() => useClientMap('mG'));
    await act(async () => { await result.current.generate(); });
    await waitFor(() => expect(useClientMapStore.getState().getMap('mG')).toBeDefined());

    expect(result.current.status).toBe('ready');
  });
});
