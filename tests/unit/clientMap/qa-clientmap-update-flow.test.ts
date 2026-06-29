// tests/unit/clientMap/qa-clientmap-update-flow.test.ts
//
// KEEPANCE 5 (adversarial QA) — Client Map update/dismiss/staleness flow.
//
// These tests exercise the REAL updater + REAL clientMapStore (only MemoryService
// is mocked, exactly like updater.test.ts). They split into two groups:
//
//   * Confirmed-working tests — assert real guarantees that hold today.
//   * Regression tests for fixed bugs — these were `it.fails` bug-docs; the
//     bugs are now fixed so they are normal passing tests, each carrying its
//     BUG-### id (plus the Codex-review follow-ups: multi-source dismissal and
//     source-less assumption re-surfacing).
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
import { interviewQuestions, answerQuestion } from '@/platform/clientMap/guidedInterview';
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
    store.addUserItem('matter-A', 'money', 'A-only secret detail');

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
      { id: 'p1', sectionKey: 'money', op: 'remove', itemId: 'u1', reason: 'AI thinks it is stale', createdAt: 't' },
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

describe('Client Map — regression tests for fixed bugs (KEEPANCE 5)', () => {
  // BUG-100 — dismissed updates reappear after any later source change.
  // dismissUpdate only drops the row from pendingUpdates; nothing records that the
  // user rejected it. proposeUpdates compares the fresh build only against items
  // PRESENT in the current map, so a dismissed-but-never-added item is re-proposed
  // on the next fingerprint change even though ITS source never changed.
  // Spec §3.2 / §6 rule 5: "dismissed ones don't reappear unless the underlying
  // source changes again."
  it('BUG-100: a dismissed proposal is not re-proposed when its source is unchanged', () => {
    const store = useClientMapStore.getState();
    // Seed a built map and propose the AI fact into the (empty) current map.
    const current: ClientMap = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    const built: ClientMap = { ...emptyClientMap('m1') };
    const reviewRequired = aiItem('Carrier denied coverage');
    reviewRequired.sources = [{ kind: 'document', ref: '/f', snippet: '' }];
    built.sections[2]!.items = [reviewRequired]; // same source, still retrieved

    // First pass proposes it (correct).
    const first = proposeUpdates('m1', current, built);
    expect(first.map((u) => u.draft?.text)).toContain('Carrier denied coverage');

    // The user dismisses it through the real store, which records the dismissal
    // keyed to the proposal's source fingerprint.
    store.setMap('m1', { ...current, pendingUpdates: first });
    const proposalId = first.find((u) => u.draft?.text === 'Carrier denied coverage')!.id;
    store.dismissUpdate('m1', proposalId);

    // A later UNRELATED source change triggers another pass over the same
    // (still-present, source-unchanged) item, threading the dismissals.
    const dismissed = useClientMapStore.getState().getMap('m1')!.dismissedSignatures ?? [];
    const second = proposeUpdates('m1', current, built, dismissed);
    // It must stay dismissed because its own source did not change.
    expect(second.map((u) => u.draft?.text)).not.toContain('Carrier denied coverage');
  });

  // BUG-100 (counterpart) — a dismissed proposal SHOULD reappear once its OWN
  // source changes again (spec §3.2: "unless the underlying source changes again").
  it('BUG-100: a dismissed proposal reappears when its own source changes again', () => {
    const store = useClientMapStore.getState();
    const current: ClientMap = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    const built: ClientMap = { ...emptyClientMap('m1') };
    const before = aiItem('Carrier denied coverage');
    before.sources = [{ kind: 'document', ref: '/denial.pdf', snippet: 's', citationId: 'chunk-v1' }];
    built.sections[2]!.items = [before];

    const first = proposeUpdates('m1', current, built);
    store.setMap('m1', { ...current, pendingUpdates: first });
    store.dismissUpdate('m1', first[0]!.id);
    const dismissed = useClientMapStore.getState().getMap('m1')!.dismissedSignatures ?? [];

    // The same fact, but now backed by a re-indexed chunk (new content id):
    const after = aiItem('Carrier denied coverage');
    after.sources = [{ kind: 'document', ref: '/denial.pdf', snippet: 's2', citationId: 'chunk-v2' }];
    const built2: ClientMap = { ...emptyClientMap('m1') };
    built2.sections[2]!.items = [after];

    const second = proposeUpdates('m1', current, built2, dismissed);
    expect(second.map((u) => u.draft?.text)).toContain('Carrier denied coverage');
  });

  // BUG-100 (Codex finding 2) — dismissing the SAME text from a DIFFERENT source
  // must not erase an earlier dismissal of the first source. Dismissals are keyed
  // by (signature, sourceSignature), not signature alone.
  it('BUG-100: dismissing the same text from a second source keeps the first source dismissed', () => {
    const store = useClientMapStore.getState();
    const current: ClientMap = { ...emptyClientMap('m1'), lastBuiltAt: 't' };

    const fromA = aiItem('Carrier denied coverage');
    fromA.sources = [{ kind: 'document', ref: '/a.pdf', snippet: '', citationId: 'A' }];
    const builtA: ClientMap = { ...emptyClientMap('m1') };
    builtA.sections[2]!.items = [fromA];
    const p1 = proposeUpdates('m1', current, builtA);
    store.setMap('m1', { ...current, pendingUpdates: p1 });
    store.dismissUpdate('m1', p1[0]!.id);

    // Same text, different source B — also proposed, also dismissed.
    const fromB = aiItem('Carrier denied coverage');
    fromB.sources = [{ kind: 'document', ref: '/b.pdf', snippet: '', citationId: 'B' }];
    const builtB: ClientMap = { ...emptyClientMap('m1') };
    builtB.sections[2]!.items = [fromB];
    let dismissed = useClientMapStore.getState().getMap('m1')!.dismissedSignatures ?? [];
    const p2 = proposeUpdates('m1', current, builtB, dismissed);
    expect(p2.map((u) => u.draft?.text)).toContain('Carrier denied coverage'); // B not yet dismissed
    store.setMap('m1', { ...useClientMapStore.getState().getMap('m1')!, pendingUpdates: p2 });
    store.dismissUpdate('m1', p2[0]!.id);

    // Source A, unchanged, must STILL be suppressed (the B dismissal didn't wipe A's).
    dismissed = useClientMapStore.getState().getMap('m1')!.dismissedSignatures ?? [];
    const again = proposeUpdates('m1', current, builtA, dismissed);
    expect(again.map((u) => u.draft?.text)).not.toContain('Carrier denied coverage');
  });

  // BUG-100 (Codex finding 3) — a dismissed SOURCE-LESS assumption must reappear
  // once matter content changes (its sourceSignature falls back to the matter
  // fingerprint), not stay suppressed forever.
  it('BUG-100: a dismissed source-less assumption reappears after matter content changes', () => {
    const store = useClientMapStore.getState();
    const current: ClientMap = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    const assumption = aiItem('Likely a contract dispute');
    assumption.sources = []; // unsourced assumption
    assumption.isAssumption = true;
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[0]!.items = [assumption];

    // Propose + dismiss at matter fingerprint fp1.
    const p1 = proposeUpdates('m1', current, built, [], 'fp1');
    store.setMap('m1', { ...current, pendingUpdates: p1, lastSourceFingerprint: 'fp1' });
    store.dismissUpdate('m1', p1[0]!.id);
    const dismissed = useClientMapStore.getState().getMap('m1')!.dismissedSignatures ?? [];

    // Same fingerprint -> still suppressed.
    expect(proposeUpdates('m1', current, built, dismissed, 'fp1').map((u) => u.draft?.text))
      .not.toContain('Likely a contract dispute');
    // Matter content changed (fp2) -> the assumption reappears for review.
    expect(proposeUpdates('m1', current, built, dismissed, 'fp2').map((u) => u.draft?.text))
      .toContain('Likely a contract dispute');
  });

  // BUG-102 — staleness fingerprint ignores content changes.
  // computeSourceFingerprint hashes only the set of unique sourceId/path values,
  // ignoring the content-addressed chunk `id` (which DOES change on edit) and any
  // timestamp. Editing a file in place (same path, new content) leaves the
  // fingerprint identical, so checkForUpdates early-returns and never proposes an
  // update. Spec §4.3 staleness + the "stays current" promise.
  it('BUG-102: fingerprint changes when an existing file is edited in place', async () => {
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
  it('BUG-106: flagging the same question twice does not duplicate it', () => {
    const store = useClientMapStore.getState();
    store.addClientQuestion('m1', 'What is the client trying to achieve?');
    store.addClientQuestion('m1', 'What is the client trying to achieve?');
    const qs = useClientMapStore.getState().getClientQuestions('m1');
    // Deduped to one.
    expect(qs).toHaveLength(1);
  });

  // BUG-106 (part) — the Guided Interview must not replay already-answered gaps.
  // Answering through the interview marks the gap resolved (map.resolvedGaps), so
  // interviewQuestions prunes it. Re-opening the interview no longer asks it.
  it('BUG-106: an answered gap question drops out of the interview list', () => {
    const map = emptyClientMap('m1');
    map.completeness.ask = [{ text: 'When did the client first contact opposing counsel?', sectionKey: 'money' }];
    useClientMapStore.getState().setMap('m1', map);

    // Before answering, the interview asks it.
    expect(interviewQuestions(useClientMapStore.getState().getMap('m1')!).map((g) => g.text))
      .toContain('When did the client first contact opposing counsel?');

    // User answers it through the interview (files a user-origin item + marks the gap resolved).
    answerQuestion('m1', 'money', 'They first contacted opposing counsel in March.', 'When did the client first contact opposing counsel?');

    const stillAsked = interviewQuestions(useClientMapStore.getState().getMap('m1')!).map((g) => g.text);
    // The answered gap no longer appears.
    expect(stillAsked).not.toContain('When did the client first contact opposing counsel?');
  });
});
