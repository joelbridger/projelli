import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import {
  bootstrapSelectionAuthorityFromPersistedFollower,
  readAuthoritativeMatterScope,
  readSharedClientContext,
  requestMatterScopeSelection,
  requestSharedClientSelection,
  resolveCanonicalHouseholdMatter,
  useClientContextStore,
  type ClientContextState,
  type SealedClientBoundary,
  type SealedMatterScopeSelection,
  type SharedClientIdentity,
} from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setDevFlagOverride } from '@/platform/flags/router';
import type { Matter } from '@/platform/types/matter';
import {
  sealAllMattersScopeSelection,
  sealMatterScopeSelection,
  sealResolvedClientBoundary,
} from './clientContextStore';

const householdA = {
  householdId: 'household-a',
  displayName: 'Alpha household',
  primaryPeople: ['Ann Alpha'],
} as const;
const householdB = {
  householdId: 'household-b',
  displayName: 'Beta household',
} as const;

const originalSetActiveMatter = useMatterStore.getState().setActiveMatter;

/**
 * Exact behavioral copy of the pre-foundation client store at 0683ff9b6.
 * This test deliberately runs the real old transition beside the dark current
 * transition rather than comparing the new store to a hand-written trace.
 */
function createPreFoundationClientStore() {
  type PreFoundationState = {
    client: SharedClientIdentity | null;
    setClient: (client: SharedClientIdentity) => void;
    clearClient: () => void;
  };
  function normalizeClient(client: SharedClientIdentity): SharedClientIdentity {
    const householdId = client.householdId.trim();
    if (!householdId) {
      throw new Error('Shared client context requires a household id.');
    }
    return {
      householdId,
      displayName: client.displayName.trim() || householdId,
      ...(client.primaryPeople
        ? {
            primaryPeople: client.primaryPeople
              .map((person) => person.trim())
              .filter(Boolean),
          }
        : {}),
    };
  }
  return create<PreFoundationState>()((set) => ({
    client: null,
    setClient: (client) => {
      set({ client: normalizeClient(client) });
    },
    clearClient: () => {
      set({ client: null });
    },
  }));
}

/**
 * This is intentionally the whole subscriber-visible ClientContextState.
 * Explicit fields make adding a state field fail this dark-path proof until it
 * is captured and asserted here too.
 */
function captureClientContextState(
  state: ClientContextState
): ClientContextState {
  return {
    client: state.client,
    scope: state.scope,
    followerStatus: state.followerStatus,
    selectionRevision: state.selectionRevision,
    setClient: state.setClient,
    clearClient: state.clearClient,
  };
}

function matter(
  id: string,
  householdId: string,
  patch: Partial<Matter> = {}
): Matter {
  return {
    id,
    name: id,
    client: householdId,
    folderPaths: [],
    crmHouseholdKeys: [householdId],
    createdAt: '2026-07-18T00:00:00.000Z',
    ...patch,
  };
}

function seed(...matters: Matter[]): void {
  useMatterStore.setState({ matters, activeMatterId: null });
}

async function waitForConvergence(): Promise<void> {
  await vi.waitFor(() => {
    expect(useClientContextStore.getState().followerStatus).toBe('converged');
  });
}

beforeEach(() => {
  // Foundation tests exercise the dormant code only through its one activation
  // gate. Production continues to start dark.
  setDevFlagOverride('selection-authority-boot-gate', true);
});

afterEach(async () => {
  // Cleanup uses the active authority behavior so no selected source leaks to
  // the next focused case.
  setDevFlagOverride('selection-authority-boot-gate', true);
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    setActiveMatter: originalSetActiveMatter,
  });
  useClientContextStore.getState().clearClient();
  bootstrapSelectionAuthorityFromPersistedFollower();
  await waitForConvergence();
  setDevFlagOverride('selection-authority-boot-gate', undefined);
});

describe('client-context selection authority', () => {
  it('keeps a narrow client adapter on the source client identity', () => {
    const adapter = {
      id: 'test',
      derive: (client: SharedClientIdentity | null) =>
        client?.householdId ?? null,
    };
    useClientContextStore.getState().setClient(householdA);

    expect(readSharedClientContext(adapter)).toBe('household-a');
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'blocked-unresolved',
    });
    expect('setState' in useClientContextStore).toBe(false);
  });

  it('keeps flag-off legacy client paths observationally identical to the real pre-foundation store', () => {
    const deliberatelyMessyClient: SharedClientIdentity = {
      householdId: '  household-a  ',
      displayName: '   ',
      primaryPeople: ['  Ann Alpha  ', ' ', '  Bea Beta '],
    };
    const activeMatterIdBefore = 'legacy-active-matter';
    const legacySetActiveMatter = vi.fn(originalSetActiveMatter);
    useMatterStore.setState({
      matters: [matter(activeMatterIdBefore, householdA.householdId)],
      activeMatterId: activeMatterIdBefore,
      setActiveMatter: legacySetActiveMatter,
    });
    setDevFlagOverride('selection-authority-boot-gate', false);

    const beforeStore = createPreFoundationClientStore();
    const beforeSubscriberValues: Array<{ client: SharedClientIdentity | null }> = [
      { client: null },
    ];
    const initialAfterState = captureClientContextState(
      useClientContextStore.getState()
    );
    const afterSubscriberValues: ClientContextState[] = [initialAfterState];
    const beforeErrors: string[] = [];
    const afterErrors: string[] = [];
    const unsubscribeBefore = beforeStore.subscribe((state) => {
      beforeSubscriberValues.push({ client: state.client });
    });
    const unsubscribeAfter = useClientContextStore.subscribe((state) => {
      afterSubscriberValues.push(captureClientContextState(state));
    });
    const sourceBefore = {
      scope: useClientContextStore.getState().scope,
      followerStatus: useClientContextStore.getState().followerStatus,
      selectionRevision: useClientContextStore.getState().selectionRevision,
    };
    try {
      // The pre-foundation app had no authority boot work. The dark current
      // boot call must be observably equivalent to that no-op.
      bootstrapSelectionAuthorityFromPersistedFollower();
      beforeStore.getState().setClient(deliberatelyMessyClient);
      useClientContextStore.getState().setClient(deliberatelyMessyClient);
      try {
        beforeStore.getState().setClient({ ...householdA, householdId: '  ' });
      } catch (error) {
        beforeErrors.push((error as Error).message);
      }
      try {
        useClientContextStore
          .getState()
          .setClient({ ...householdA, householdId: '  ' });
      } catch (error) {
        afterErrors.push((error as Error).message);
      }
      beforeStore.getState().clearClient();
      useClientContextStore.getState().clearClient();
    } finally {
      unsubscribeBefore();
      unsubscribeAfter();
    }

    const expectedSelectedClient: SharedClientIdentity = {
      householdId: householdA.householdId,
      displayName: householdA.householdId,
      primaryPeople: ['Ann Alpha', 'Bea Beta'],
    };
    const expectedSelectedState: ClientContextState = {
      client: expectedSelectedClient,
      scope: initialAfterState.scope,
      followerStatus: initialAfterState.followerStatus,
      selectionRevision: initialAfterState.selectionRevision,
      setClient: initialAfterState.setClient,
      clearClient: initialAfterState.clearClient,
    };
    expect(afterSubscriberValues).toStrictEqual([
      initialAfterState,
      expectedSelectedState,
      initialAfterState,
    ]);
    expect(afterSubscriberValues.map(({ client }) => ({ client }))).toEqual(
      beforeSubscriberValues
    );
    expect(afterErrors).toEqual(beforeErrors);
    const selectedClient = afterSubscriberValues[1]?.client;
    if (!selectedClient)
      throw new Error('legacy selection must expose a client');
    expect(selectedClient).toEqual(expectedSelectedClient);
    expect(Object.isFrozen(selectedClient)).toBe(false);
    expect(Object.isFrozen(selectedClient.primaryPeople)).toBe(false);
    const finalAfterState = captureClientContextState(
      useClientContextStore.getState()
    );
    expect(finalAfterState).toStrictEqual(initialAfterState);
    expect(finalAfterState.client).toEqual(beforeStore.getState().client);
    expect(useMatterStore.getState()).toMatchObject({
      activeMatterId: activeMatterIdBefore,
      clientMapHubId: null,
    });
    expect(legacySetActiveMatter).not.toHaveBeenCalled();
    expect({
      scope: finalAfterState.scope,
      followerStatus: finalAfterState.followerStatus,
      selectionRevision: finalAfterState.selectionRevision,
    }).toEqual(sourceBefore);
  });

  it('refuses forged or invalid sealed requests without blocking the legacy store while the flag is off', async () => {
    setDevFlagOverride('selection-authority-boot-gate', false);
    const before = useClientContextStore.getState();

    await expect(
      requestMatterScopeSelection(
        Object.freeze({}) as SealedMatterScopeSelection
      )
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-matter-scope-request',
    });

    await expect(
      requestSharedClientSelection(Object.freeze({}) as SealedClientBoundary)
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-client-boundary',
    });

    seed(matter('matter-a', householdA.householdId));
    const invalidatedRequest = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!invalidatedRequest) throw new Error('fixture must seal');
    useMatterStore.setState({ matters: [] });
    await expect(
      requestMatterScopeSelection(invalidatedRequest)
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'missing-matter',
    });

    expect(useClientContextStore.getState().client).toBe(before.client);
    expect(useClientContextStore.getState().scope).toBe(before.scope);
    expect(useClientContextStore.getState().selectionRevision).toBe(
      before.selectionRevision
    );
  });

  it('resolves exactly one unarchived canonical household match', () => {
    const one = matter('matter-a', householdA.householdId);
    expect(resolveCanonicalHouseholdMatter(householdA.householdId, [one])).toBe(
      one
    );
    expect(
      resolveCanonicalHouseholdMatter(householdA.householdId, [])
    ).toBeUndefined();
    expect(
      resolveCanonicalHouseholdMatter(householdA.householdId, [
        one,
        matter('matter-b', householdA.householdId),
      ])
    ).toBeUndefined();
    expect(
      resolveCanonicalHouseholdMatter(householdA.householdId, [
        matter('archived', householdA.householdId, { archived: true }),
      ])
    ).toBeUndefined();
  });

  it('selects a current full client/matter pair through the salvaged sealed boundary', async () => {
    seed(matter('matter-a', householdA.householdId));
    const boundary = sealResolvedClientBoundary({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
      displayName: householdA.displayName,
    });
    if (!boundary) throw new Error('fixture must seal');

    await expect(requestSharedClientSelection(boundary)).resolves.toEqual({
      kind: 'selected',
      client: { householdId: 'household-a', displayName: 'Alpha household' },
    });
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'matter',
      matterId: 'matter-a',
    });
    await waitForConvergence();
    expect(useMatterStore.getState().activeMatterId).toBe('matter-a');
  });

  it('accepts only a runtime-provenance-sealed specific scope request', async () => {
    seed(matter('matter-a', householdA.householdId));
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
      displayName: householdA.displayName,
    });
    if (!request) throw new Error('fixture must seal');

    const result = await requestMatterScopeSelection(request);
    expect(result).toEqual({
      kind: 'selected',
      client: { householdId: 'household-a', displayName: 'Alpha household' },
      scope: { kind: 'matter', matterId: 'matter-a' },
    });
    if (result.kind !== 'selected')
      throw new Error('fixture request must select');
    expect(Object.isFrozen(result.scope)).toBe(true);
    expect(() => Object.assign(result.scope, { matterId: 'other' })).toThrow();
    expect(Object.isFrozen(readAuthoritativeMatterScope())).toBe(true);
    await waitForConvergence();
  });

  it('keeps request provenance immutable and refuses a forged cast at runtime', async () => {
    seed(matter('matter-a', householdA.householdId));
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');
    expect(Object.isFrozen(request)).toBe(true);
    expect(() => Object.assign(request, { matterId: 'other' })).toThrow();

    const forged = Object.freeze({}) as SealedMatterScopeSelection;
    await expect(requestMatterScopeSelection(forged)).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-matter-scope-request',
    });
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'blocked-unresolved',
    });
  });

  it('has no raw-id or raw-union request boundary at compile time or runtime', async () => {
    const compileOnly = false as boolean;
    if (compileOnly) {
      // @ts-expect-error The authority door never accepts a raw matter id.
      await requestMatterScopeSelection('matter-a');
      // @ts-expect-error The authority door never accepts a caller-made scope union.
      await requestMatterScopeSelection({ kind: 'all-matters' });
    }

    await expect(
      requestMatterScopeSelection(
        'matter-a' as unknown as SealedMatterScopeSelection
      )
    ).resolves.toMatchObject({
      kind: 'refused',
      reason: 'unsealed-matter-scope-request',
    });
    expect(useClientContextStore.getState().scope.kind).toBe(
      'blocked-unresolved'
    );
  });

  it('preserves explicit all-matters capability with a separate sealed user-intent handle', async () => {
    seed(matter('matter-a', householdA.householdId));
    const request = sealAllMattersScopeSelection();

    await expect(requestMatterScopeSelection(request)).resolves.toEqual({
      kind: 'selected',
      client: null,
      scope: { kind: 'all-matters' },
    });
    await waitForConvergence();
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });

  it('refuses a stale request rather than replaying it after another source transition', async () => {
    seed(
      matter('matter-a', householdA.householdId),
      matter('matter-b', householdB.householdId)
    );
    const stale = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    const next = sealMatterScopeSelection({
      householdRef: householdB.householdId,
      matterId: 'matter-b',
    });
    if (!stale || !next) throw new Error('fixtures must seal');
    await requestMatterScopeSelection(next);

    await expect(requestMatterScopeSelection(stale)).resolves.toEqual({
      kind: 'refused',
      reason: 'stale-matter-scope-request',
    });
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'blocked-unresolved',
    });
  });

  it('refuses a stale sealed client boundary rather than replaying it', async () => {
    seed(
      matter('matter-a', householdA.householdId),
      matter('matter-b', householdB.householdId)
    );
    const stale = sealResolvedClientBoundary({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    const next = sealResolvedClientBoundary({
      householdRef: householdB.householdId,
      matterId: 'matter-b',
    });
    if (!stale || !next) throw new Error('fixtures must seal');
    await requestSharedClientSelection(next);

    await expect(requestSharedClientSelection(stale)).resolves.toEqual({
      kind: 'refused',
      reason: 'invalid-client-boundary',
    });
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'blocked-unresolved',
    });
  });

  it('revalidates missing, archived, unauthorized, and wrong-client pairs fail-closed', async () => {
    seed(matter('matter-a', householdA.householdId));
    const missing = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!missing) throw new Error('fixture must seal');
    useMatterStore.setState({ matters: [] });
    await expect(requestMatterScopeSelection(missing)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'missing-matter',
    });

    seed(matter('matter-a', householdA.householdId));
    bootstrapSelectionAuthorityFromPersistedFollower();
    const archived = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!archived) throw new Error('fixture must seal');
    useMatterStore.setState({
      matters: [matter('matter-a', householdA.householdId, { archived: true })],
    });
    await expect(requestMatterScopeSelection(archived)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'archived-matter',
    });

    seed(matter('matter-a', householdA.householdId));
    bootstrapSelectionAuthorityFromPersistedFollower();
    const unauthorized = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!unauthorized) throw new Error('fixture must seal');
    useMatterStore.setState({
      matters: [matter('matter-a', 'household-other')],
    });
    await expect(
      requestMatterScopeSelection(unauthorized)
    ).resolves.toMatchObject({ kind: 'refused', reason: 'unauthorized-pair' });

    seed(matter('matter-a', householdA.householdId));
    bootstrapSelectionAuthorityFromPersistedFollower();
    const wrongClient = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!wrongClient) throw new Error('fixture must seal');
    useMatterStore.setState({
      matters: [
        matter('matter-a', householdB.householdId),
        matter('matter-b', householdA.householdId),
      ],
    });
    await expect(
      requestMatterScopeSelection(wrongClient)
    ).resolves.toMatchObject({ kind: 'refused', reason: 'wrong-client-pair' });
  });

  it('never carries a prior matter across a proven next-client selection', async () => {
    seed(
      matter('matter-a', householdA.householdId),
      matter('matter-b', householdB.householdId)
    );
    const first = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!first) throw new Error('fixture must seal');
    await requestMatterScopeSelection(first);
    await waitForConvergence();
    const second = sealMatterScopeSelection({
      householdRef: householdB.householdId,
      matterId: 'matter-b',
    });
    if (!second) throw new Error('fixture must seal');
    await requestMatterScopeSelection(second);

    expect(useClientContextStore.getState().client?.householdId).toBe(
      householdB.householdId
    );
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'matter',
      matterId: 'matter-b',
    });
    await waitForConvergence();
    expect(useMatterStore.getState().activeMatterId).toBe('matter-b');
  });

  it('preserves the authoritative scope exactly when clearing client', async () => {
    seed(matter('matter-a', householdA.householdId));
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');
    await requestMatterScopeSelection(request);
    await waitForConvergence();

    useClientContextStore.getState().clearClient();
    expect(useClientContextStore.getState().client).toBeNull();
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'matter',
      matterId: 'matter-a',
    });
  });

  it('real authority reads validate persisted follower before exposing a scope', () => {
    const valid = matter('matter-a', householdA.householdId);
    const startFreshEnabledBoot = () => {
      setDevFlagOverride('selection-authority-boot-gate', false);
      bootstrapSelectionAuthorityFromPersistedFollower();
      setDevFlagOverride('selection-authority-boot-gate', true);
    };
    useMatterStore.setState({ matters: [valid], activeMatterId: valid.id });
    startFreshEnabledBoot();
    const booted = readAuthoritativeMatterScope();
    expect(booted).toEqual({
      kind: 'matter',
      matterId: 'matter-a',
    });
    expect(Object.isFrozen(booted)).toBe(true);
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter',
      matterId: 'matter-a',
    });

    useMatterStore.setState({ matters: [valid], activeMatterId: null });
    startFreshEnabledBoot();
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'all-matters',
    });

    useMatterStore.setState({ matters: [valid], activeMatterId: 'missing' });
    startFreshEnabledBoot();
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'blocked-unresolved',
    });

    useMatterStore.setState({
      matters: [{ ...valid, archived: true }],
      activeMatterId: valid.id,
    });
    startFreshEnabledBoot();
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'blocked-unresolved',
    });
  });

  it('retries a follower failure without another selection write', async () => {
    seed(matter('matter-a', householdA.householdId));
    let attempts = 0;
    useMatterStore.setState({
      setActiveMatter: (id) => {
        attempts += 1;
        if (attempts === 1) throw new Error('pre-apply follower failure');
        originalSetActiveMatter(id);
      },
    });
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');

    await requestMatterScopeSelection(request);
    expect(useClientContextStore.getState().followerStatus).toBe('stale');
    await waitForConvergence();
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(useMatterStore.getState().activeMatterId).toBe('matter-a');
  });

  it('schedules reconciliation in finally when a source subscriber throws before follower work', async () => {
    seed(matter('matter-a', householdA.householdId));
    const unsubscribe = useClientContextStore.subscribe(() => {
      throw new Error('source subscriber failure');
    });
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');
    try {
      await requestMatterScopeSelection(request);
      expect(useClientContextStore.getState().scope).toEqual({
        kind: 'matter',
        matterId: 'matter-a',
      });
      await vi.waitFor(() => {
        expect(useMatterStore.getState().activeMatterId).toBe('matter-a');
      });
    } finally {
      unsubscribe();
    }
  });

  it('keeps stale observable when the follower throws and then converges by retry', async () => {
    seed(matter('matter-a', householdA.householdId));
    let first = true;
    useMatterStore.setState({
      setActiveMatter: (id) => {
        if (first) {
          first = false;
          throw new Error('throwing follower');
        }
        originalSetActiveMatter(id);
      },
    });
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');

    await requestMatterScopeSelection(request);
    expect(useClientContextStore.getState().followerStatus).toBe('stale');
    await waitForConvergence();
  });

  it('blocks a selected source immediately when the real matter store archives or deletes after convergence', async () => {
    seed(matter('matter-a', householdA.householdId));
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');

    await requestMatterScopeSelection(request);
    await waitForConvergence();
    useMatterStore.getState().setMatterArchived('matter-a', true);
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'blocked-unresolved',
    });

    seed(matter('matter-b', householdA.householdId));
    const replacement = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-b',
    });
    if (!replacement) throw new Error('replacement fixture must seal');
    await requestMatterScopeSelection(replacement);
    await waitForConvergence();
    useMatterStore.getState().deleteMatter('matter-b');
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'blocked-unresolved',
    });
  });

  it('bounds a permanently failing follower retry and leaves stale observable', async () => {
    seed(matter('matter-a', householdA.householdId));
    let attempts = 0;
    useMatterStore.setState({
      setActiveMatter: () => {
        attempts += 1;
        throw new Error('permanent follower failure');
      },
    });
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');

    await requestMatterScopeSelection(request);
    await vi.waitFor(() => {
      expect(attempts).toBe(4);
    });
    expect(useClientContextStore.getState().followerStatus).toBe('stale');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBe(4);
  });

  it('refuses a forged client boundary and blocks the source scope', async () => {
    const forged = Object.freeze({}) as SealedClientBoundary;
    await expect(requestSharedClientSelection(forged)).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-client-boundary',
    });
    expect(useClientContextStore.getState().client).toBeNull();
    expect(useClientContextStore.getState().scope).toEqual({
      kind: 'blocked-unresolved',
    });
  });
});
