// tests/unit/clientMap/qa-clientmap-update-flow.test.ts
//
// KEEPANCE 5 (adversarial QA) — Client Map update/dismiss/staleness flow.
//
// These tests exercise the REAL updater + REAL clientMapStore (only MemoryService
// is mocked, exactly like updater.test.ts). They split into two groups:
//
//   * Confirmed-working tests — assert real guarantees that hold today. They PASS.
//   * Bug-documenting tests — each asserts the CORRECT/desired behavior and is
//     marked `it.fails`, so it stays green now (the desired assertion currently
//     throws) and turns RED the moment the bug is fixed, signaling the fixer to
//     drop the `.fails`. Each carries the BUG-### id from the backlog.
//
// Backlog: docs/quality/2026-06-20-test-bug-backlog.md (BUG-100, BUG-102, BUG-104, BUG-106).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const retrieveMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: retrieveMock },
  isMemoryEnabled: () => true,
}));

import { proposeUpdates, computeSourceFingerprint } from '@/platform/clientMap/updater';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { interviewQuestions } from '@/platform/clientMap/guidedInterview';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem } from '@/platform/clientMap/types';

function aiItem(text: string): ClientMapItem {
  return {
    id: `id-${text}`,
    text,
    origin: 'ai',
    isAssumption: false,
    sources: [{ kind: 'document', ref: '/f', snippet: 's' }],
    updatedAt: 't',
  };
}

beforeEach(() => {
  retrieveMock.mockReset();
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
});

describe('Client Map — confirmed-working guarantees (KEEPANCE 5)', () => {
  it('store keeps maps isolated by matterId (no cross-matter leak)', () => {
    const store = useClientMapStore.getState();
    store.setMap('matter-A', { ...emptyClientMap('matter-A'), lastBuiltAt: 't' });
    store.setMap('matter-B', { ...emptyClientMap('matter-B'), lastBuiltAt: 't' });
    store.addUserItem('matter-A', 'standing', 'A-only secret detail');

    const a = useClientMapStore.getState().getMap('matter-A');
    const b = useClientMapStore.getState().getMap('matter-B');
    const aTexts = a?.sections.flatMap((s) => s.items.map((i) => i.text)) ?? [];
    const bTexts = b?.sections.flatMap((s) => s.items.map((i) => i.text)) ?? [];
    expect(aTexts).toContain('A-only secret detail');
    expect(bTexts).not.toContain('A-only secret detail');
  });

  it('acceptUpdate(remove) targeting a user-origin item is blocked (sovereignty)', () => {
    const store = useClientMapStore.getState();
    const map = emptyClientMap('m1');
    map.lastBuiltAt = 't';
    map.sections[2]!.items = [
      { id: 'u1', text: 'My own note', origin: 'user', isAssumption: false, sources: [], updatedAt: 't' },
    ];
    map.pendingUpdates = [
      { id: 'p1', sectionKey: 'standing', op: 'remove', itemId: 'u1', reason: 'AI thinks it is stale', createdAt: 't' },
    ];
    store.setMap('m1', map);

    store.acceptUpdate('m1', 'p1');

    const after = useClientMapStore.getState().getMap('m1');
    // The user-origin item must survive an AI remove proposal.
    expect(after?.sections[2]?.items.some((i) => i.id === 'u1')).toBe(true);
    // The pending proposal is cleared either way.
    expect(after?.pendingUpdates).toHaveLength(0);
  });

  it('proposeUpdates does not re-propose a fact already present in the map', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    current.sections[2]!.items = [aiItem('Carrier denied coverage')];
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2]!.items = [aiItem('Carrier denied coverage')];
    const updates = proposeUpdates('m1', current, built);
    expect(updates.map((u) => u.draft?.text)).not.toContain('Carrier denied coverage');
  });
});

describe('Client Map — documented bugs (KEEPANCE 5, it.fails until fixed)', () => {
  // BUG-100 — dismissed updates reappear after any later source change.
  // dismissUpdate only drops the row from pendingUpdates; nothing records that the
  // user rejected it. proposeUpdates compares the fresh build only against items
  // PRESENT in the current map, so a dismissed-but-never-added item is re-proposed
  // on the next fingerprint change even though ITS source never changed.
  // Spec §3.2 / §6 rule 5: "dismissed ones don't reappear unless the underlying
  // source changes again."
  it.fails('BUG-100: a dismissed proposal is not re-proposed when its source is unchanged', () => {
    const current: ClientMap = { ...emptyClientMap('m1') }; // user dismissed -> never added
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2]!.items = [aiItem('Carrier denied coverage')]; // same source, still retrieved

    // First pass proposes it (correct).
    const first = proposeUpdates('m1', current, built);
    expect(first.map((u) => u.draft?.text)).toContain('Carrier denied coverage');

    // User dismisses; current map stays empty. A later UNRELATED source change
    // triggers another pass over the same (still-present) item.
    const second = proposeUpdates('m1', current, built);
    // DESIRED: it must stay dismissed. ACTUAL today: it reappears (this throws).
    expect(second.map((u) => u.draft?.text)).not.toContain('Carrier denied coverage');
  });

  // BUG-102 — staleness fingerprint ignores content changes.
  // computeSourceFingerprint hashes only the set of unique sourceId/path values,
  // ignoring the content-addressed chunk `id` (which DOES change on edit) and any
  // timestamp. Editing a file in place (same path, new content) leaves the
  // fingerprint identical, so checkForUpdates early-returns and never proposes an
  // update. Spec §4.3 staleness + the "stays current" promise.
  it.fails('BUG-102: fingerprint changes when an existing file is edited in place', async () => {
    retrieveMock.mockResolvedValueOnce([
      { path: '/a.docx', sourceId: '/a.docx', id: 'chunk-v1', chunkText: 'old content', score: 1, paragraphIndex: 0 },
    ]);
    const f1 = await computeSourceFingerprint('m1');

    // Same file/path, re-indexed after an edit: new content -> new content-addressed id.
    retrieveMock.mockResolvedValueOnce([
      { path: '/a.docx', sourceId: '/a.docx', id: 'chunk-v2', chunkText: 'NEW edited content', score: 1, paragraphIndex: 0 },
    ]);
    const f2 = await computeSourceFingerprint('m1');

    // DESIRED: an in-place content edit must change the fingerprint. ACTUAL: equal.
    expect(f1).not.toBe(f2);
  });

  // BUG-106 (part) — flagging the same gap question twice creates duplicate
  // "Questions for the client" rows (addClientQuestion has no dedup), and the
  // store exposes no remove control to the list UI, so the list can only grow.
  it.fails('BUG-106: flagging the same question twice does not duplicate it', () => {
    const store = useClientMapStore.getState();
    store.addClientQuestion('m1', 'What is the client trying to achieve?');
    store.addClientQuestion('m1', 'What is the client trying to achieve?');
    const qs = useClientMapStore.getState().getClientQuestions('m1');
    // DESIRED: deduped to one. ACTUAL: two identical rows.
    expect(qs).toHaveLength(1);
  });

  // BUG-106 (part) — the Guided Interview replays already-answered gaps.
  // interviewQuestions derives from completeness.ask, which is never pruned when a
  // gap is answered (answers file into a section, not back into `ask`). Re-opening
  // the interview shows the same answered questions again.
  it.fails('BUG-106: an answered gap question drops out of the interview list', () => {
    const map = emptyClientMap('m1');
    map.completeness.ask = ['When did the client first contact opposing counsel?'];
    useClientMapStore.getState().setMap('m1', map);

    // User answers it (files a user-origin item into a section).
    useClientMapStore.getState().addUserItem('m1', 'standing', 'They first contacted opposing counsel in March.');

    const stillAsked = interviewQuestions(useClientMapStore.getState().getMap('m1')!);
    // DESIRED: the answered gap no longer appears. ACTUAL: it persists in `ask`.
    expect(stillAsked).not.toContain('When did the client first contact opposing counsel?');
  });
});
