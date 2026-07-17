import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

// Platform persistence boundary mock (owned by the CRM platform, not a feature).
const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  load: vi.fn<() => Promise<readonly LiveCrmRecord[]>>(),
  save: vi.fn<(record: LiveCrmRecord) => Promise<LiveCrmRecord>>(),
}));
vi.mock('@/platform/crm/liveRecords', () => ({
  loadLiveCrmRecords: () => boundary.load(),
}));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: boundary.records.map((record) => structuredClone(record)),
    workspaceRoot: '/fixture-workspace',
    save: boundary.save,
  }),
}));

import { act, renderHook } from '@testing-library/react';
// The owner wiring under test is reached ONLY through the public @/features/ask
// surface. There is no deep import of the owner socket anywhere in this fixture.
import * as AskPublic from '@/features/ask';
import {
  askClientIdentityAdapter,
  askScopeBuilder,
  buildAskCitation,
  buildAskRetrievalPlan,
  collectAskSourceCandidates,
  establishAskSharedClientContext,
  listAskAnswerActions,
  listAskSourceAdapters,
  noLocalAnswer,
  readAskSharedClientSnapshot,
  registerAskAnswerAction,
  registerAskSource,
  resolveAskCitationOpenPath,
  resolveAskScope,
  sealAskOpenPath,
  toAskClientSnapshot,
  type AskAnswerActionContext,
  type AskAnswerActionDescriptor,
  type AskSourceAdapter,
  type AskSourceDescriptor,
} from '@/features/ask';
import * as ClientBarPublic from '@/features/client-bar';
import { type SharedClientContext } from '@/features/client-bar';
import { useClientContextStore } from '@/platform/client-context';

const householdA: SharedClientContext = {
  householdId: 'household-a',
  displayName: 'Alpha household',
  primaryPeople: ['Ann Alpha'],
};
const householdB: SharedClientContext = {
  householdId: 'household-b',
  displayName: 'Beta household',
  primaryPeople: ['Ben Beta'],
};

function setSharedClient(context: SharedClientContext): void {
  act(() => {
    useClientContextStore.getState().setClient({
      householdId: context.householdId,
      displayName: context.displayName,
      ...(context.primaryPeople ? { primaryPeople: context.primaryPeople } : {}),
    });
  });
}
function clearSharedClient(): void {
  act(() => {
    useClientContextStore.getState().clearClient();
  });
}

const RAW_TOKEN = 'household-a-document-secret';
type LiveSnapshot = NonNullable<ReturnType<typeof readAskSharedClientSnapshot>>;
/** The live snapshot, asserted non-null (a client is expected to be selected). */
function liveSnapshot(): LiveSnapshot {
  const snapshot = readAskSharedClientSnapshot();
  if (!snapshot) throw new Error('expected a live shared-client snapshot');
  return snapshot;
}
function sourceUnder(
  snapshot: LiveSnapshot
): AskSourceDescriptor<SharedClientContext> {
  return {
    sourceId: 'binding-source-a',
    kind: 'document',
    workspaceId: 'workspace-a',
    client: snapshot,
    label: 'Alpha plan',
    availability: 'available',
    citationOpenPath: sealAskOpenPath({ kind: 'document', token: RAW_TOKEN }),
  };
}

interface Authority {
  readonly allowed: true;
}
interface Audit {
  readonly receiptId: string;
}
const executed = vi.fn();

let dispose: (() => void) | null = null;

beforeAll(() => {
  // Registry-backed doorways need one contributor; register once with unique ids.
  const adapter: AskSourceAdapter<SharedClientContext> = {
    id: 'binding-source-adapter',
    order: 8001,
    sourceKinds: ['document'],
    listCandidates: (scope) => {
      const snapshot = readAskSharedClientSnapshot();
      return snapshot && scope.kind !== 'whole-firm' ? [sourceUnder(snapshot)] : [];
    },
  };
  registerAskSource(adapter);
  const action: AskAnswerActionDescriptor<
    SharedClientContext,
    never,
    Authority,
    Audit
  > = {
    id: 'binding-action',
    order: 8002,
    isAvailable: () => true,
    execute: executed,
  };
  registerAskAnswerAction(action);
});

beforeEach(() => {
  boundary.records = [];
  boundary.load.mockReset();
  boundary.save.mockReset();
  boundary.load.mockImplementation(() =>
    Promise.resolve(boundary.records.map((record) => structuredClone(record)))
  );
  boundary.save.mockImplementation((record) => {
    const saved = structuredClone(record);
    const index = boundary.records.findIndex((item) => item.id === saved.id);
    if (index >= 0) boundary.records[index] = saved;
    else boundary.records.push(saved);
    return Promise.resolve(structuredClone(saved));
  });
  executed.mockReset();
  clearSharedClient();
  dispose = establishAskSharedClientContext();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  clearSharedClient();
});

afterAll(() => {
  clearSharedClient();
});

describe('shared-client owner wiring: live isolation on the real client bar', () => {
  it('refuses held read/open/list handles after A -> B -> none, without rebuilding', () => {
    setSharedClient(householdA);
    const snapA = liveSnapshot();
    const source = sourceUnder(snapA);
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources('workspace-a', snapA, [source.sourceId]),
      snapA,
      askClientIdentityAdapter
    );
    const citation = buildAskCitation('claim-a', scope, source);
    const context: AskAnswerActionContext<
      SharedClientContext,
      never,
      Authority,
      Audit
    > = {
      scope,
      answer: noLocalAnswer(),
      citations: [citation],
      authority: { allowed: true },
      audit: { receiptId: 'r' },
    };
    const heldAction = listAskAnswerActions(context).find(
      (candidate) => candidate.id === 'binding-action'
    );
    expect(heldAction).toBeDefined();

    // Under A everything resolves and the opener unseals to the real token.
    expect(resolveAskCitationOpenPath(scope, citation)).toEqual({
      kind: 'document',
      token: RAW_TOKEN,
    });
    expect(collectAskSourceCandidates(scope).length).toBeGreaterThan(0);

    // Switch the REAL shared client. The same held handles refuse at use-time.
    setSharedClient(householdB);
    expect(resolveAskCitationOpenPath).toBeDefined();
    expect(() => resolveAskCitationOpenPath(scope, citation)).toThrow(
      'stale or outside the current client'
    );
    expect(() => listAskSourceAdapters(scope)).toThrow('stale or unavailable');
    expect(() => collectAskSourceCandidates(scope)).toThrow(
      'stale or unavailable'
    );
    expect(() => buildAskRetrievalPlan(scope, ['document'], [source])).toThrow(
      'stale or unavailable'
    );
    expect(() => buildAskCitation('claim-b', scope, source)).toThrow(
      'outside the resolved scope'
    );
    expect(
      listAskAnswerActions(context).some((c) => c.id === 'binding-action')
    ).toBe(false);
    expect(heldAction?.isAvailable(context)).toBe(false);

    // Clear the client (A -> none, owner still bound): still fails closed.
    clearSharedClient();
    expect(() => resolveAskCitationOpenPath(scope, citation)).toThrow(
      'stale or outside the current client'
    );
    expect(() => listAskSourceAdapters(scope)).toThrow('stale or unavailable');
    expect(executed).not.toHaveBeenCalled();
  });

  it('fails closed for an operation that crosses an async wait when the client switches mid-wait', async () => {
    setSharedClient(householdA);
    const snapA = liveSnapshot();
    const source = sourceUnder(snapA);
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources('workspace-a', snapA, [source.sourceId]),
      snapA,
      askClientIdentityAdapter
    );
    const citation = buildAskCitation('claim-a', scope, source);
    expect(resolveAskCitationOpenPath(scope, citation)).toEqual({
      kind: 'document',
      token: RAW_TOKEN,
    });

    // An operation that only opens the citation AFTER awaiting.
    const pending = (async () => {
      await Promise.resolve();
      await Promise.resolve();
      return resolveAskCitationOpenPath(scope, citation);
    })();
    // The shared client switches while the operation is parked at its await.
    setSharedClient(householdB);
    await expect(pending).rejects.toThrow('stale or outside the current client');
  });

  it('fails closed on a save handle held across a client switch (A -> B / none), then works again under A', async () => {
    setSharedClient(householdA);
    const snapA = liveSnapshot();
    const store = renderHook(() =>
      AskPublic.useAskConversation({
        currentClient: snapA,
        owners: askClientIdentityAdapter,
      })
    );
    const scopeA = askScopeBuilder.chosenSources('workspace-a', snapA, [
      'document-a',
    ]);
    const now = '2026-07-16T20:00:00.000Z';
    const conversationA = {
      id: 'conversation-a',
      scope: scopeA,
      title: 'Plan question',
      createdAt: now,
      updatedAt: now,
    };
    const heldSave = store.result.current.saveConversation;

    for (const next of [householdB, null] as const) {
      if (next) setSharedClient(next);
      else clearSharedClient();
      boundary.save.mockClear();
      await expect(heldSave(conversationA)).rejects.toThrow(
        'malformed or stale'
      );
      expect(boundary.save).not.toHaveBeenCalled();
    }

    // Back under A, the SAME held handle persists (proves a live recheck, not a
    // permanently broken handle).
    setSharedClient(householdA);
    boundary.save.mockClear();
    await act(async () => {
      await expect(heldSave(conversationA)).resolves.toBeUndefined();
    });
    expect(boundary.save).toHaveBeenCalledTimes(1);
    store.unmount();
  });

  it('establish-once: a second establish throws and cannot overwrite the live reader', () => {
    setSharedClient(householdB);
    const snapA = toAskClientSnapshot(householdA);
    const scope = resolveAskScope(
      askScopeBuilder.currentClient('workspace-a', snapA),
      snapA,
      askClientIdentityAdapter
    );
    // B is active, so a scope built under A is already refused.
    expect(() => listAskSourceAdapters(scope)).toThrow('stale or unavailable');

    // A second establishment (e.g. an attacker trying to install a frozen-A
    // reader) is refused at runtime by establish-once.
    expect(() => establishAskSharedClientContext()).toThrow(
      'already established'
    );
    // A is still refused; nothing could restore it.
    expect(() => listAskSourceAdapters(scope)).toThrow('stale or unavailable');
  });

  it('freeze-class: the live reader is re-read every call (no capture-once), and openers stay sealed', () => {
    setSharedClient(householdA);
    const snapA1 = readAskSharedClientSnapshot();
    setSharedClient(householdB);
    const snapB = readAskSharedClientSnapshot();
    // The reader is NOT captured once: reading again returns the new client.
    expect(snapA1?.contactRef.householdId).toBe('household-a');
    expect(snapB?.contactRef.householdId).toBe('household-b');

    // A source seals its opener: the raw token is never a plain field, never
    // JSON-visible, and the sealed ref is not the raw token.
    setSharedClient(householdA);
    const source = sourceUnder(liveSnapshot());
    expect(
      (source.citationOpenPath as unknown as Record<string, unknown>)['token']
    ).toBeUndefined();
    expect(JSON.stringify(source.citationOpenPath)).not.toContain(RAW_TOKEN);
  });

  it('release: disposing the owner fails every client-scoped doorway closed', () => {
    setSharedClient(householdA);
    const snapA = liveSnapshot();
    const source = sourceUnder(snapA);
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources('workspace-a', snapA, [source.sourceId]),
      snapA,
      askClientIdentityAdapter
    );
    const citation = buildAskCitation('claim-a', scope, source);
    expect(resolveAskCitationOpenPath(scope, citation)).toEqual({
      kind: 'document',
      token: RAW_TOKEN,
    });

    // Detach the owner entirely; there is no bound reader at all now.
    dispose?.();
    dispose = null;
    expect(() => collectAskSourceCandidates(scope)).toThrow('is not bound');
    expect(() => resolveAskCitationOpenPath(scope, citation)).toThrow(
      'stale or outside the current client'
    );
  });

  it('exposes no public bind/owner capability on the Ask or client-bar surfaces', () => {
    const askKeys = Object.keys(AskPublic as Record<string, unknown>);
    // The owner socket and its raw reader are never on the public surface.
    expect((AskPublic as Record<string, unknown>)['createAskSharedClientOwner']).toBeUndefined();
    expect((AskPublic as Record<string, unknown>)['readOwnerBoundAccess']).toBeUndefined();
    expect((AskPublic as Record<string, unknown>)['bindAskSharedClient']).toBeUndefined();
    // No export names a bind/owner capability.
    expect(askKeys.filter((name) => /bind|owner/i.test(name))).toEqual([]);
    const barKeys = Object.keys(ClientBarPublic as Record<string, unknown>);
    expect(barKeys.filter((name) => /bind|owner/i.test(name))).toEqual([]);

    // The only establish doorway is zero-argument: it cannot inject an arbitrary
    // client reader. (Second call throws — establish-once — proving it does not
    // silently replace the live reader.)
    expect(establishAskSharedClientContext.length).toBe(0);
  });
});
