import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapSelectionAuthorityFromPersistedFollower,
  readAuthoritativeMatterScope,
  readSharedClientContext,
  requestMatterScopeSelection,
  requestSharedClientSelection,
  resolveCanonicalHouseholdMatter,
  useClientContextStore,
  type SealedClientBoundary,
  type SealedMatterScopeSelection,
  type SharedClientIdentity,
} from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
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

afterEach(async () => {
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    setActiveMatter: originalSetActiveMatter,
  });
  useClientContextStore.getState().clearClient();
  bootstrapSelectionAuthorityFromPersistedFollower();
  await waitForConvergence();
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

  it('boot gate validates persisted follower before the authority reader can be used', () => {
    const valid = matter('matter-a', householdA.householdId);
    useMatterStore.setState({ matters: [valid], activeMatterId: valid.id });
    const booted = bootstrapSelectionAuthorityFromPersistedFollower();
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
    expect(bootstrapSelectionAuthorityFromPersistedFollower()).toEqual({
      kind: 'all-matters',
    });

    useMatterStore.setState({ matters: [valid], activeMatterId: 'missing' });
    expect(bootstrapSelectionAuthorityFromPersistedFollower()).toEqual({
      kind: 'blocked-unresolved',
    });

    useMatterStore.setState({
      matters: [{ ...valid, archived: true }],
      activeMatterId: valid.id,
    });
    expect(bootstrapSelectionAuthorityFromPersistedFollower()).toEqual({
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

  it('blocks a source whose selected matter disappears before follower projection', async () => {
    seed(matter('matter-a', householdA.householdId));
    const request = sealMatterScopeSelection({
      householdRef: householdA.householdId,
      matterId: 'matter-a',
    });
    if (!request) throw new Error('fixture must seal');

    await requestMatterScopeSelection(request);
    useMatterStore.setState({ matters: [] });
    await vi.waitFor(() => {
      expect(useClientContextStore.getState().scope).toEqual({
        kind: 'blocked-unresolved',
      });
    });
    await waitForConvergence();
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
    await vi.waitFor(() => expect(attempts).toBe(4));
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
