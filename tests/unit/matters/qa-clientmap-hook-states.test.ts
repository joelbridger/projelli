// tests/unit/matters/qa-clientmap-hook-states.test.ts
//
// KEEPANCE 5 (adversarial QA) — useClientMap status + regeneration safety.
//
// Mirrors the mocking harness in useClientMap.test.ts (generator + updater mocked).
// Bug-documenting tests are `it.fails`: they assert the CORRECT behavior, stay
// green today (the assertion currently throws), and flip RED when the bug is
// fixed. Backlog: BUG-101, BUG-103, BUG-104.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const buildMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/generator', () => ({ buildClientMap: buildMock }));

const computeFingerprintMock = vi.hoisted(() => vi.fn());
const proposeUpdatesMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/updater', () => ({
  computeSourceFingerprint: computeFingerprintMock,
  proposeUpdates: proposeUpdatesMock,
}));

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

describe('useClientMap — documented bugs (KEEPANCE 5, it.fails until fixed)', () => {
  // BUG-101 — generate() overwrites the whole stored map, destroying user-origin
  // items (and accepted updates + custom sections). It calls setMap(matterId,
  // {...built}) unconditionally. It is currently only reachable when status is
  // 'idle' (so the single MatterHub button can't re-trigger it today), but the
  // function is unsafe by construction: any future refresh/invalidate path would
  // silently delete the professional's own edits. Spec §6 rule 3: user-origin
  // items must NEVER be overwritten by an AI pass.
  it.fails('BUG-101: regenerate keeps user-origin items instead of wiping them', async () => {
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

    const { result } = renderHook(() => useClientMap('m1'));
    await act(async () => { await result.current.generate(); });

    const stored = useClientMapStore.getState().getMap('m1');
    const allTexts = stored?.sections.flatMap((s) => s.items.map((i) => i.text)) ?? [];
    // DESIRED: the user's note survives a regenerate. ACTUAL: it is wiped.
    expect(allTexts).toContain('Client insists on settling by year end');
  });

  // BUG-103 — a matter with no indexed content shows a blank map, not the honest
  // empty state. The hook returns `status: map ? 'ready' : status`, so once
  // generate() stores an (empty) map object the status is forced to 'ready',
  // making MatterHub's 'empty' branch ("No information found yet...") dead code.
  // Spec §7 open-question 5: an honest empty state.
  it.fails('BUG-103: an empty build reports status "empty", not "ready"', async () => {
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
  it.fails('BUG-104: a still-pending proposal survives the next update check', async () => {
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
});
