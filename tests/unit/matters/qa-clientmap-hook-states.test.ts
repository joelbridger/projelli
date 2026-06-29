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
    // The fresh AI content is proposed as an update. Approve-first (B5): even a
    // clean source-backed add is queued for the user to approve, NOT auto-applied.
    proposeUpdatesMock.mockReturnValue([
      { id: 'p1', sectionKey: 'goals', op: 'add', reason: 'r', createdAt: 't2',
        draft: { id: 'ai1', text: 'Matter is a contract dispute', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/a', snippet: 's' }], updatedAt: 't2' } },
    ]);

    const { result } = renderHook(() => useClientMap('m1'));
    await act(async () => { await result.current.generate(); });

    const stored = useClientMapStore.getState().getMap('m1');
    const allTexts = stored?.sections.flatMap((s) => s.items.map((i) => i.text)) ?? [];
    // The user's note survives a regenerate (the core BUG-101 invariant).
    expect(allTexts).toContain('Client insists on settling by year end');
    // Approve-first: the fresh AI content is PENDING, not auto-applied to the body.
    expect(allTexts).not.toContain('Matter is a contract dispute');
    expect(stored?.pendingUpdates.map((u) => u.draft?.text)).toContain('Matter is a contract dispute');
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
      id: 'U1', sectionKey: 'money', op: 'add', reason: 'from an earlier pass', createdAt: 't',
      draft: { id: 'd1', text: 'Earlier proposed fact', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' },
    };
    const seeded = { ...emptyClientMap('m3'), lastBuiltAt: 't', lastSourceFingerprint: 'fp-old', pendingUpdates: [pendingU1] };
    useClientMapStore.getState().setMap('m3', seeded);

    // A new source change triggers another check; the fresh pass proposes only U2.
    computeFingerprintMock.mockResolvedValue('fp-new');
    buildMock.mockResolvedValue({ ...emptyClientMap('m3'), lastBuiltAt: 't2' });
    const u2: ProposedUpdate = {
      id: 'U2', sectionKey: 'household', op: 'add', reason: 'newly found', createdAt: 't2',
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
    gapOnly.completeness.ask = [{ text: 'What outcome does the client want?', sectionKey: 'goals' }];
    buildMock.mockResolvedValue(gapOnly);
    computeFingerprintMock.mockResolvedValue('fp');

    const { result } = renderHook(() => useClientMap('mG'));
    await act(async () => { await result.current.generate(); });
    await waitFor(() => expect(useClientMapStore.getState().getMap('mG')).toBeDefined());

    expect(result.current.status).toBe('ready');
  });
});

// Fix 2 — autoBuild: a Client Map builds automatically the first time a matter
// is opened (status 'idle'), so a connector-created (Wealthbox-synced) client —
// whose CRM data is indexed under the matter — shows a populated, cited map with
// NO manual "Open Client Map" step. Idle-gated so it fires once per matter.
describe('useClientMap — autoBuild on open (connector-created clients)', () => {
  it('auto-builds a populated map on first open when autoBuild is set (no manual generate())', async () => {
    const built = { ...emptyClientMap('mA'), lastBuiltAt: 't' };
    built.sections[0]!.items = [
      {
        id: 'ai1',
        text: 'Household: the Carter family',
        origin: 'ai',
        isAssumption: false,
        sources: [{ kind: 'crm', ref: 'wb:123', snippet: 'Wealthbox household' }],
        updatedAt: 't',
      },
    ];
    buildMock.mockResolvedValue(built);
    computeFingerprintMock.mockResolvedValue('fp');

    // No explicit generate() — the hook builds itself on mount.
    const { result } = renderHook(() => useClientMap('mA', { autoBuild: true }));

    await waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const stored = useClientMapStore.getState().getMap('mA');
    expect(
      stored?.sections.some((s) => s.items.some((i) => i.text.includes('Carter'))),
    ).toBe(true);
  });

  it('does NOT auto-build when autoBuild is unset (the lazy default is preserved)', () => {
    buildMock.mockResolvedValue({ ...emptyClientMap('mB'), lastBuiltAt: 't' });
    renderHook(() => useClientMap('mB'));
    // Effects flush synchronously inside renderHook; generate() would call
    // buildClientMap up to its first await immediately, so this is reliable.
    expect(buildMock).not.toHaveBeenCalled();
  });

  it('does NOT auto-build a matter that already has a stored map (idle-gated → fires once)', () => {
    const seeded = { ...emptyClientMap('mC'), lastBuiltAt: 't' };
    seeded.sections[2]!.items = [userItem('Client insists on settling by year end')];
    useClientMapStore.getState().setMap('mC', seeded);
    buildMock.mockResolvedValue({ ...emptyClientMap('mC'), lastBuiltAt: 't2' });

    renderHook(() => useClientMap('mC', { autoBuild: true }));
    // Status is 'ready' (a stored map exists), so the idle-gated auto-build
    // must not run and clobber/rebuild it.
    expect(buildMock).not.toHaveBeenCalled();
  });

  it('dedupes concurrent builds for the same matter (in-flight guard → no duplicate cost)', async () => {
    // Hold the build open so a second generate() lands while the first is in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    buildMock.mockImplementation(async () => {
      await gate;
      return { ...emptyClientMap('mD'), lastBuiltAt: 't' };
    });
    computeFingerprintMock.mockResolvedValue('fp');

    const { result } = renderHook(() => useClientMap('mD'));
    await act(async () => {
      const p1 = result.current.generate();
      const p2 = result.current.generate(); // in flight → must no-op
      release();
      await Promise.all([p1, p2]);
    });
    // Two generate() calls, ONE actual build (the StrictMode / fast-click guard).
    expect(buildMock).toHaveBeenCalledTimes(1);
  });

  // Codex race #3 — content arriving DURING the build must not leave an empty map
  // stuck. generate() fingerprints the source BEFORE building, so an empty build
  // stores the PRE-build fingerprint; a later check then sees the new content's
  // fingerprint differ and recovers (instead of storing the new fingerprint
  // against the empty map and skipping forever).
  it('Codex race #3: an empty build stores the pre-build fingerprint so mid-build content recovers', async () => {
    let contentArrived = false;
    // The fingerprint reflects the CURRENT source: 'fp-empty' until content lands.
    computeFingerprintMock.mockImplementation(async () =>
      contentArrived ? 'fp-content' : 'fp-empty',
    );
    // The first build sees nothing, but content lands WHILE it runs.
    buildMock.mockImplementationOnce(async () => {
      contentArrived = true;
      return { ...emptyClientMap('mR'), lastBuiltAt: 't' };
    });

    const { result } = renderHook(() => useClientMap('mR'));
    await act(async () => { await result.current.generate(); });

    // Crucial: the stored fingerprint is the PRE-build one, NOT the post-build
    // 'fp-content' — otherwise the next check would think nothing changed.
    const stored = useClientMapStore.getState().getMap('mR');
    expect(stored?.lastSourceFingerprint).toBe('fp-empty');
    expect(result.current.status).toBe('empty');

    // Recovery: the now-indexed content rebuilds on the next check (fp differs).
    const withContent = { ...emptyClientMap('mR'), lastBuiltAt: 't2' };
    withContent.sections[0]!.items = [
      { id: 'a', text: 'Carter household', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't2' },
    ];
    buildMock.mockResolvedValue(withContent);
    proposeUpdatesMock.mockReturnValue([
      { id: 'p1', sectionKey: 'goals', op: 'add', reason: 'r', createdAt: 't2',
        draft: { id: 'a', text: 'Carter household', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't2' } },
    ]);
    await act(async () => { await result.current.checkForUpdates(); });
    expect(
      (useClientMapStore.getState().getMap('mR')?.pendingUpdates.length ?? 0),
    ).toBeGreaterThan(0); // no longer stuck empty
  });

  // Codex #4 — two checkForUpdates() firing together (MatterHub runs one on status
  // change and one on CRM-sync completion) must build only once.
  it('Codex #4: concurrent checkForUpdates build the map only once (shared in-flight guard)', async () => {
    const seeded = { ...emptyClientMap('mU'), lastBuiltAt: 't', lastSourceFingerprint: 'fp-old' };
    seeded.sections[0]!.items = [
      { id: 'x', text: 'existing fact', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' },
    ];
    useClientMapStore.getState().setMap('mU', seeded);
    computeFingerprintMock.mockResolvedValue('fp-new'); // changed → both want to rebuild
    proposeUpdatesMock.mockReturnValue([]);

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    buildMock.mockImplementation(async () => {
      await gate;
      return { ...emptyClientMap('mU'), lastBuiltAt: 't2' };
    });

    const { result } = renderHook(() => useClientMap('mU'));
    await act(async () => {
      const p1 = result.current.checkForUpdates();
      const p2 = result.current.checkForUpdates(); // in flight → must no-op
      release();
      await Promise.all([p1, p2]);
    });
    expect(buildMock).toHaveBeenCalledTimes(1);
  });

  // Codex #4 (HARD ordering) — call A completes FULLY (builds + stores fp + clears
  // the guard) BEFORE call B's slower fingerprint resolves. B must compare its fp
  // against the LATEST stored fingerprint (which A just wrote), not its own stale
  // pre-await snapshot, and therefore NOT build again. This is the TOCTOU the
  // guard alone does not close.
  it('Codex #4 (hard): a second check whose fingerprint resolves after the first fully completes does not build again', async () => {
    const seeded = { ...emptyClientMap('mU2'), lastBuiltAt: 't', lastSourceFingerprint: 'fp-old' };
    seeded.sections[0]!.items = [
      { id: 'x', text: 'existing fact', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' },
    ];
    useClientMapStore.getState().setMap('mU2', seeded);

    // A's fingerprint resolves immediately; B's (the 2nd call) waits on a gate, so
    // A finishes its whole build BEFORE B's fingerprint returns.
    let releaseB!: () => void;
    const bGate = new Promise<void>((r) => { releaseB = r; });
    let fpCall = 0;
    computeFingerprintMock.mockImplementation(async () => {
      fpCall += 1;
      if (fpCall >= 2) { await bGate; }
      return 'fp-new';
    });
    buildMock.mockResolvedValue({ ...emptyClientMap('mU2'), lastBuiltAt: 't2' });
    proposeUpdatesMock.mockReturnValue([]);

    const { result } = renderHook(() => useClientMap('mU2'));
    await act(async () => {
      const pA = result.current.checkForUpdates();
      const pB = result.current.checkForUpdates();
      await pA;        // A fully completes: builds, stores 'fp-new', clears the guard
      releaseB();      // now B's fingerprint resolves to 'fp-new'
      await pB;        // B re-reads current ('fp-new' stored by A) → unchanged → no build
    });
    // Only A built; B saw the already-current fingerprint and skipped.
    expect(buildMock).toHaveBeenCalledTimes(1);
  });
});
