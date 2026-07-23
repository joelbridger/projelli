import { describe, expect, it } from 'vitest';
import { resolveSelectionOperationDecision } from './selectionReader';
import type { Matter } from '@/platform/types/matter';
import type { MatterScopeSelection, SharedClientIdentity } from './selectionTypes';

const client: SharedClientIdentity = {
  provider: 'wealthbox',
  householdId: 'household-a',
  displayName: 'Alpha household',
};

function matter(id: string, patch: Partial<Matter> = {}): Matter {
  return {
    id,
    name: id,
    client: id,
    folderPaths: [`/workspace/${id}`],
    createdAt: '2026-07-18T00:00:00.000Z',
    ...patch,
  };
}

function decide(
  scope: MatterScopeSelection,
  options: {
    client?: SharedClientIdentity | null;
    follower?: string | null;
    followerStatus?: 'converged' | 'stale';
    matters?: Matter[];
    selectionGeneration?: number;
    operationClass?: 'matter-scoped' | 'client-scoped';
    allowAllMatters?: boolean;
    expectedScope?:
      | { kind: 'matter'; matterId: string }
      | { kind: 'all-matters' };
    requireFollowerAgreement?: boolean;
  } = {},
) {
  const live = matter('matter-a');
  return resolveSelectionOperationDecision(
    {
      client: options.client === undefined ? client : options.client,
      scope,
      followerStatus: options.followerStatus ?? 'converged',
      matters: options.matters ?? [live],
      activeMatterId:
        options.follower !== undefined
          ? options.follower
          : scope.kind === 'matter' || scope.kind === 'matter-only'
            ? scope.matterId
            : null,
      selectionGeneration: options.selectionGeneration ?? 7,
    },
    {
      operationClass: options.operationClass ?? 'matter-scoped',
      allowAllMatters: options.allowAllMatters ?? true,
      ...(options.expectedScope ? { expectedScope: options.expectedScope } : {}),
      ...(options.requireFollowerAgreement
        ? { requireFollowerAgreement: true }
        : {}),
    },
  );
}

describe('authoritative T1 reader decision', () => {
  it('handles every source arm without deriving authority from follower null', () => {
    expect(decide({ kind: 'matter', matterId: 'matter-a' })).toMatchObject({
      kind: 'matter',
      sourceKind: 'matter',
      matter: { id: 'matter-a' },
    });
    expect(
      decide(
        { kind: 'matter-only', matterId: 'matter-a' },
        { client: null },
      ),
    ).toMatchObject({
      kind: 'matter',
      sourceKind: 'matter-only',
      matter: { id: 'matter-a' },
      client: null,
    });
    expect(decide({ kind: 'all-matters' }, { client: null })).toMatchObject({
      kind: 'all-matters',
    });
    expect(
      decide(
        { kind: 'blocked-unresolved' },
        { client: null, follower: null },
      ),
    ).toMatchObject({ kind: 'refused', reason: 'blocked-unresolved' });
  });

  it('applies the Amendment-6 predicate to matter-only and cleared full-pair state', () => {
    expect(
      decide(
        { kind: 'matter-only', matterId: 'matter-a' },
        { client: null, operationClass: 'matter-scoped' },
      ).kind,
    ).toBe('matter');
    expect(
      decide(
        { kind: 'matter-only', matterId: 'matter-a' },
        { client: null, operationClass: 'client-scoped' },
      ),
    ).toMatchObject({ kind: 'refused', reason: 'client-required' });
    expect(
      decide(
        { kind: 'matter', matterId: 'matter-a' },
        { client: null, operationClass: 'matter-scoped' },
      ).kind,
    ).toBe('matter');
    expect(
      decide(
        { kind: 'matter', matterId: 'matter-a' },
        { client: null, operationClass: 'client-scoped' },
      ),
    ).toMatchObject({ kind: 'refused', reason: 'client-required' });
  });

  it('uses follower disagreement only to refuse an agreement-check reader', () => {
    expect(
      decide(
        { kind: 'matter', matterId: 'matter-a' },
        {
          follower: 'matter-b',
          requireFollowerAgreement: true,
        },
      ),
    ).toMatchObject({ kind: 'refused', reason: 'follower-disagreement' });
    expect(
      decide(
        { kind: 'matter', matterId: 'matter-a' },
        { follower: 'matter-b' },
      ),
    ).toMatchObject({ kind: 'matter', matter: { id: 'matter-a' } });
  });

  it('refuses stale operation snapshots and live-data loss', () => {
    expect(
      decide(
        { kind: 'matter', matterId: 'matter-a' },
        { expectedScope: { kind: 'matter', matterId: 'matter-b' } },
      ),
    ).toMatchObject({ kind: 'refused', reason: 'selection-changed' });
    expect(
      decide(
        { kind: 'matter', matterId: 'matter-a' },
        { matters: [matter('matter-a', { archived: true })] },
      ),
    ).toMatchObject({ kind: 'refused', reason: 'matter-missing-or-archived' });
  });

  it('preserves named all-matters only where the operation permits it', () => {
    expect(
      decide({ kind: 'all-matters' }, { client: null, allowAllMatters: true }),
    ).toMatchObject({ kind: 'all-matters' });
    expect(
      decide({ kind: 'all-matters' }, { client: null, allowAllMatters: false }),
    ).toMatchObject({ kind: 'refused', reason: 'all-matters-not-allowed' });
  });
});
