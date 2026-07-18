import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  bootstrapSelectionAuthorityFromPersistedFollower,
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  issueRehydratedSelection,
  issueSharedClientSelection,
  readAuthoritativeMatterScope,
  rehydrateSelectionHint,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestMatterScopeSelection,
  requestRehydratedSelection,
  requestSharedClientSelection,
  resolveCanonicalHouseholdClassification,
  useClientContextStore,
  type RehydratedSelectionInput,
  type SealedClientSelectionClassification,
  type SealedMatterScopeSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const clientA = {
  provider: 'wealthbox' as const,
  householdId: 'household-a',
  displayName: 'Alpha household',
};
const clientB = {
  provider: 'wealthbox' as const,
  householdId: 'household-b',
  displayName: 'Beta household',
};
const clientWrong = {
  provider: 'wealthbox' as const,
  householdId: 'household-wrong',
  displayName: 'Wrong household',
};

function matter(
  id: string,
  crmHouseholdKeys?: string[],
  patch: Partial<Matter> = {}
): Matter {
  return {
    id,
    name: id,
    client: id,
    folderPaths: [],
    ...(crmHouseholdKeys === undefined ? {} : { crmHouseholdKeys }),
    createdAt: '2026-07-18T00:00:00.000Z',
    ...patch,
  };
}

function seed(matters: Matter[], activeMatterId: string | null = null): void {
  useMatterStore.setState({ matters, activeMatterId });
}

function publish(...clients: Array<typeof clientA | typeof clientB | typeof clientWrong>): void {
  replaceCanonicalHouseholdDirectory('wealthbox', clients);
}

async function selectMatter(matterId: string) {
  return requestMatterScopeSelection(issueMatterScopeSelection(matterId));
}

async function selectClient(client: typeof clientA | typeof clientB | typeof clientWrong) {
  return requestSharedClientSelection(issueSharedClientSelection(client));
}

async function waitForFollower(value: string | null): Promise<void> {
  await vi.waitFor(() => {
    expect(useMatterStore.getState().activeMatterId).toBe(value);
    expect(useClientContextStore.getState().followerStatus).toBe('converged');
  });
}

function restartFrom(value: unknown): void {
  rehydrateSelectionHint({ kind: 'persisted-hint', value });
}

beforeEach(() => {
  localStorage.clear();
  setDevFlagOverride('selection-authority-boot-gate', false);
  seed([]);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', true);
  publish();
  restartFrom({ version: 1, source: 'explicit-all-matters' });
});

afterEach(() => {
  setDevFlagOverride('selection-authority-boot-gate', false);
  seed([]);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  localStorage.clear();
  setDevFlagOverride('selection-authority-boot-gate', undefined);
});

describe('total selection classifiers', () => {
  it('classifies provider-qualified liveness and every matter topology deterministically', () => {
    const live = matter('matter-live', ['household-a']);
    const archived = matter('matter-archived', ['household-a'], { archived: true });
    publish(clientA);

    expect(
      resolveCanonicalHouseholdClassification(clientA, [live]).kind
    ).toBe('exactly-one-live');
    expect(
      resolveCanonicalHouseholdClassification(clientA, []).kind
    ).toBe('zero-live');
    expect(
      resolveCanonicalHouseholdClassification(clientA, [live, matter('two', ['household-a'])]).kind
    ).toBe('ambiguous-live');
    expect(
      resolveCanonicalHouseholdClassification(clientA, [archived]).kind
    ).toBe('archived-only');

    replaceCanonicalHouseholdDirectory('wealthbox', null);
    expect(
      resolveCanonicalHouseholdClassification(clientA, [live]).kind
    ).toBe('invalid-household');
  });

  it('returns a sealed classification for blank, missing, archived, and live matter inputs', () => {
    seed([
      matter('live'),
      matter('archived', [], { archived: true }),
    ]);
    for (const input of ['', '   ', 'missing', 'archived', 'live']) {
      const request = issueMatterScopeSelection(input);
      expect(request).toBeTruthy();
      expect(Object.isFrozen(request)).toBe(true);
    }
  });

  it('makes seals runtime-only and rejects copied or fabricated handles', async () => {
    seed([matter('matter-a')]);
    const sealed = issueMatterScopeSelection('matter-a');
    expect(() => JSON.stringify(sealed)).toThrow(/runtime-only/);
    expect(() => JSON.stringify(issueSharedClientSelection(clientA))).toThrow(
      /runtime-only/
    );
    expect(() =>
      JSON.stringify(
        issueRehydratedSelection({
          kind: 'legacy-follower',
          activeMatterId: null,
        })
      )
    ).toThrow(/runtime-only/);

    await expect(
      requestMatterScopeSelection(Object.freeze({}) as SealedMatterScopeSelection)
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-matter-scope-request',
    });
    await expect(
      requestSharedClientSelection(
        Object.freeze({}) as SealedClientSelectionClassification
      )
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-client-boundary',
    });
  });

  it('refuses stale matter and client classifications after live data changes', async () => {
    seed([matter('matter-a', ['household-a'])]);
    publish(clientA);
    const matterRequest = issueMatterScopeSelection('matter-a');
    const clientRequest = issueSharedClientSelection(clientA);

    seed([matter('matter-a', ['household-a'], { archived: true })]);

    await expect(requestMatterScopeSelection(matterRequest)).resolves.toEqual({
      kind: 'refused',
      reason: 'stale-matter-scope-request',
    });
    await expect(requestSharedClientSelection(clientRequest)).resolves.toEqual({
      kind: 'refused',
      reason: 'stale-client-boundary',
    });
  });
});

describe('writer-owned localStorage rehydration', () => {
  it('treats the stored follower as a hint and reclassifies the persisted selection hint', async () => {
    const live = matter('matter-live');
    const forgedFollower = matter('matter-forged');
    localStorage.setItem(
      'lantern:matters',
      JSON.stringify({
        version: 10,
        state: {
          matters: [live, forgedFollower],
          activeMatterId: forgedFollower.id,
          selectionHint: {
            version: 1,
            source: 'specific-matter',
            matterId: live.id,
          },
        },
      })
    );

    await useMatterStore.persist.rehydrate();

    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter-only',
      matterId: live.id,
    });
    await waitForFollower(live.id);
  });
});

describe('matter-only and full-pair writer classification', () => {
  it('selects an unlinked or legacy-missing-link matter as matter-only', async () => {
    for (const value of [matter('empty', []), matter('missing-field')]) {
      seed([value]);
      const result = await selectMatter(value.id);
      expect(result).toMatchObject({
        kind: 'selected',
        client: null,
        scope: { kind: 'matter-only', matterId: value.id },
      });
      await waitForFollower(value.id);
    }
  });

  it('never lets a caller downgrade one canonical pair to matter-only', async () => {
    seed([matter('matter-a', ['household-a'])]);
    publish(clientA);

    await expect(selectMatter('matter-a')).resolves.toMatchObject({
      kind: 'selected',
      client: clientA,
      scope: { kind: 'matter', matterId: 'matter-a' },
    });
  });

  it('uses matter-only for 2+ candidates unless a live selected client disambiguates', async () => {
    seed([matter('matter-a', ['household-a', 'household-b'])]);
    publish(clientA, clientB);

    await expect(selectMatter('matter-a')).resolves.toMatchObject({
      kind: 'selected',
      client: null,
      scope: { kind: 'matter-only', matterId: 'matter-a' },
    });

    seed([
      matter('matter-a', ['household-a', 'household-b']),
      matter('matter-wrong', ['household-wrong']),
    ]);
    await selectClient(clientWrong);
    await expect(selectMatter('matter-a')).resolves.toMatchObject({
      kind: 'selected',
      client: null,
      scope: { kind: 'matter-only', matterId: 'matter-a' },
    });

    seed([matter('matter-a', ['household-a', 'household-b'])]);
    await selectClient(clientA);
    await expect(selectMatter('matter-a')).resolves.toMatchObject({
      kind: 'selected',
      client: clientA,
      scope: { kind: 'matter', matterId: 'matter-a' },
    });
  });

  it('keeps matter-only stable across unrelated matter and directory revisions', async () => {
    const selected = matter('matter-a');
    seed([selected]);
    await selectMatter(selected.id);

    seed([selected, matter('unrelated', ['household-b'])]);
    publish(clientA, clientB);
    publish(clientA, clientB);

    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter-only',
      matterId: selected.id,
    });
    expect(useClientContextStore.getState().client).toBeNull();
  });

  it('blocks failed specific-matter inputs while active and leaves dark state byte-identical', async () => {
    seed([matter('archived', [], { archived: true })], null);
    for (const input of ['', 'missing', 'archived']) {
      restartFrom({ version: 1, source: 'explicit-all-matters' });
      const result = await selectMatter(input);
      expect(result.kind).toBe('refused');
      expect(readAuthoritativeMatterScope()).toEqual({
        kind: 'blocked-unresolved',
      });
      expect(useClientContextStore.getState().client).toBeNull();
    }

    setDevFlagOverride('selection-authority-boot-gate', false);
    const before = useClientContextStore.getState();
    await selectMatter('missing');
    expect(useClientContextStore.getState()).toBe(before);
  });

  it('keeps existing matter and all-matters outcomes byte-identical while dark', async () => {
    seed([matter('matter-a')], null);
    setDevFlagOverride('selection-authority-boot-gate', false);
    const sourceBefore = useClientContextStore.getState();

    await expect(selectMatter('matter-a')).resolves.toEqual({
      kind: 'routed-dark',
      projectedMatterId: 'matter-a',
    });
    expect(useMatterStore.getState().activeMatterId).toBe('matter-a');
    expect(useClientContextStore.getState()).toBe(sourceBefore);

    await expect(
      requestMatterScopeSelection(issueAllMattersScopeSelection())
    ).resolves.toEqual({ kind: 'routed-dark', projectedMatterId: null });
    expect(useMatterStore.getState().activeMatterId).toBeNull();
    expect(useClientContextStore.getState()).toBe(sourceBefore);
  });
});

describe('client selection, clear, lifecycle, and follower ownership', () => {
  it('classifies every live client intent as full pair or retained-client blocked', async () => {
    publish(clientA, clientB);
    seed([matter('exact', ['household-a'])]);
    await expect(selectClient(clientA)).resolves.toEqual({
      kind: 'selected',
      client: clientA,
    });
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter',
      matterId: 'exact',
    });

    for (const matters of [
      [] as Matter[],
      [matter('a', ['household-b']), matter('b', ['household-b'])],
      [matter('archived', ['household-b'], { archived: true })],
    ]) {
      seed(matters);
      await selectClient(clientB);
      expect(useClientContextStore.getState().client).toEqual(clientB);
      expect(readAuthoritativeMatterScope()).toEqual({
        kind: 'blocked-unresolved',
      });
    }
  });

  it('preserves the exact scope on clear and rehydrates a cleared pair as matter-only', async () => {
    seed([matter('matter-a', ['household-a'])]);
    publish(clientA);
    await selectMatter('matter-a');
    requestClearClientSelection();

    expect(useClientContextStore.getState()).toMatchObject({
      client: null,
      scope: { kind: 'matter', matterId: 'matter-a' },
      persistenceHint: {
        version: 1,
        source: 'specific-matter',
        matterId: 'matter-a',
      },
    });
    const persisted = JSON.parse(
      JSON.stringify(useClientContextStore.getState().persistenceHint)
    ) as unknown;
    restartFrom(persisted);
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter-only',
      matterId: 'matter-a',
    });
    expect(useClientContextStore.getState().client).toBeNull();
  });

  it('blocks immediately on link removal, archive, and delete without a follower rollback', async () => {
    seed([matter('matter-a', ['household-a'])]);
    publish(clientA);
    await selectMatter('matter-a');
    await waitForFollower('matter-a');

    useMatterStore.getState().setMatterArchived('matter-a', true);
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'blocked-unresolved' });

    seed([matter('matter-b')]);
    await selectMatter('matter-b');
    await waitForFollower('matter-b');
    useMatterStore.getState().deleteMatter('matter-b');
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'blocked-unresolved' });
  });

  it('retries one throwing follower from the source-owned projection writer', async () => {
    const original = useMatterStore.getState().setActiveMatter;
    seed([matter('matter-a')]);
    let attempts = 0;
    useMatterStore.setState({
      setActiveMatter: (id) => {
        attempts += 1;
        if (attempts === 1) throw new Error('first projection failed');
        original(id);
      },
    });
    try {
      await selectMatter('matter-a');
      expect(useClientContextStore.getState().followerStatus).toBe('stale');
      await waitForFollower('matter-a');
      expect(attempts).toBeGreaterThanOrEqual(2);
    } finally {
      useMatterStore.setState({ setActiveMatter: original });
    }
  });

  it('still schedules reconciliation when a source subscriber throws', async () => {
    seed([matter('matter-a')]);
    const unsubscribe = useClientContextStore.subscribe(() => {
      throw new Error('subscriber failed');
    });
    try {
      await selectMatter('matter-a');
      expect(readAuthoritativeMatterScope()).toEqual({
        kind: 'matter-only',
        matterId: 'matter-a',
      });
      await waitForFollower('matter-a');
    } finally {
      unsubscribe();
    }
  });
});

describe('authority is re-derived across every restart', () => {
  it('treats legacy follower ids as hints: null is compatibility All, live id is matter-only', () => {
    seed([matter('matter-a', ['household-a'])], 'matter-a');
    setDevFlagOverride('selection-authority-boot-gate', false);
    bootstrapSelectionAuthorityFromPersistedFollower();
    setDevFlagOverride('selection-authority-boot-gate', true);
    expect(bootstrapSelectionAuthorityFromPersistedFollower()).toEqual({
      kind: 'matter-only',
      matterId: 'matter-a',
    });

    setDevFlagOverride('selection-authority-boot-gate', false);
    seed([matter('matter-a')], null);
    setDevFlagOverride('selection-authority-boot-gate', true);
    expect(bootstrapSelectionAuthorityFromPersistedFollower()).toEqual({
      kind: 'all-matters',
    });
  });

  it('keeps blocked blocked, drops stale optional All client, and blocks corrupt versions', () => {
    publish(clientA);
    restartFrom({ version: 1, source: 'blocked/refused', client: clientA });
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'blocked-unresolved' });

    restartFrom({
      version: 1,
      source: 'explicit-all-matters',
      client: clientA,
    });
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    restartFrom(useClientContextStore.getState().persistenceHint);
    expect(useClientContextStore.getState()).toMatchObject({
      client: null,
      scope: { kind: 'all-matters' },
    });

    for (const corrupt of [null, {}, { version: 999 }, { version: 1, source: 'made-up' }]) {
      restartFrom(corrupt);
      expect(readAuthoritativeMatterScope()).toEqual({
        kind: 'blocked-unresolved',
      });
    }
  });

  it('classifies unavailable provider liveness to blocked and never auto-upgrades it', async () => {
    seed([matter('matter-a', ['household-a'])]);
    publish(clientA);
    await selectClient(clientA);
    const persisted = useClientContextStore.getState().persistenceHint;

    replaceCanonicalHouseholdDirectory('wealthbox', null);
    restartFrom(persisted);
    expect(useClientContextStore.getState()).toMatchObject({
      client: null,
      scope: { kind: 'blocked-unresolved' },
    });

    publish(clientA);
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'blocked-unresolved' });
    expect(useClientContextStore.getState().client).toBeNull();

    await selectClient(clientA);
    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter',
      matterId: 'matter-a',
    });
  });

  it('obeys the quantified arm × restart round-trip law', async () => {
    const startingArm = fc.constantFrom(
      'full-pair' as const,
      'matter-only' as const,
      'all-matters' as const,
      'blocked' as const
    );
    const mutation = fc.constantFrom(
      'same' as const,
      'archive' as const,
      'move-link' as const,
      'provider-unavailable' as const
    );

    await fc.assert(
      fc.asyncProperty(startingArm, mutation, async (arm, change) => {
        setDevFlagOverride('selection-authority-boot-gate', false);
        seed([]);
        requestClearClientSelection();
        setDevFlagOverride('selection-authority-boot-gate', true);
        seed([matter('matter-a', ['household-a'])]);
        publish(clientA, clientB);
        restartFrom({ version: 1, source: 'explicit-all-matters' });

        if (arm === 'full-pair') await selectMatter('matter-a');
        else if (arm === 'matter-only') {
          seed([matter('matter-a')]);
          await selectMatter('matter-a');
        } else if (arm === 'all-matters') {
          await requestMatterScopeSelection(issueAllMattersScopeSelection());
        } else {
          restartFrom({ version: 1, source: 'blocked/refused' });
        }

        const persisted = JSON.parse(
          JSON.stringify(useClientContextStore.getState().persistenceHint)
        ) as unknown;
        if (change === 'archive') {
          seed([matter('matter-a', ['household-a'], { archived: true })]);
        } else if (change === 'move-link') {
          seed([matter('matter-a', ['household-b'])]);
        } else if (change === 'provider-unavailable') {
          replaceCanonicalHouseholdDirectory('wealthbox', null);
        }

        const request = issueRehydratedSelection({
          kind: 'persisted-hint',
          value: persisted,
        });
        const result = await requestRehydratedSelection(request);
        expect(result.kind).toBe('selected');
        const state = useClientContextStore.getState();
        expect(['matter', 'matter-only', 'all-matters', 'blocked-unresolved']).toContain(
          state.scope.kind
        );
        if (arm === 'blocked') expect(state.scope.kind).toBe('blocked-unresolved');
        if (arm === 'matter-only') expect(state.scope.kind).not.toBe('matter');
        if (arm === 'all-matters') expect(state.scope.kind).toBe('all-matters');
        if (state.scope.kind === 'matter') expect(state.client).not.toBeNull();
        if (state.scope.kind === 'matter-only') expect(state.client).toBeNull();
        await waitForFollower(
          state.scope.kind === 'matter' || state.scope.kind === 'matter-only'
            ? state.scope.matterId
            : null
        );
      }),
      { numRuns: 32, verbose: true }
    );
  });

  it('classifies malformed rehydration input through the declared conservative arm', async () => {
    const inputs: RehydratedSelectionInput[] = [
      { kind: 'persisted-hint', value: undefined },
      { kind: 'persisted-hint', value: { version: -1 } },
      { kind: 'legacy-follower', activeMatterId: 42 },
    ];
    for (const input of inputs) {
      const result = await requestRehydratedSelection(issueRehydratedSelection(input));
      expect(result).toMatchObject({
        kind: 'selected',
        client: null,
        scope: { kind: 'blocked-unresolved' },
      });
    }
  });
});
