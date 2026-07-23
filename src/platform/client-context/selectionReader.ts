import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  readAuthoritativeMatterScope,
  useClientContextStore,
  type ClientContextState,
} from './clientContextStore';
import {
  resolveActiveMatter,
  useMatterStore,
} from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import type { MatterScopeSelection, SharedClientIdentity } from './selectionTypes';

export type SelectionOperationClass = 'matter-scoped' | 'client-scoped';

export type ExpectedSelectionScope =
  | { readonly kind: 'matter'; readonly matterId: string }
  | { readonly kind: 'all-matters' };

export interface SelectionOperationRequest {
  /**
   * Matter-scoped means the selected matter and its live-owned data completely
   * determine both the operation and its destination. Client-scoped means the
   * operation needs the separately proven household/client identity.
   */
  readonly operationClass: SelectionOperationClass;
  /** Explicit workspace-wide authority is accepted only for operations that support it. */
  readonly allowAllMatters: boolean;
  /** Re-check a scope captured earlier in the same operation before a sensitive step. */
  readonly expectedScope?: ExpectedSelectionScope;
  /**
   * Strengthen-only isolation boundary: disagreement can refuse, but follower
   * state can never grant authority.
   */
  readonly requireFollowerAgreement?: boolean;
}

export type SelectionRefusalReason =
  | 'blocked-unresolved'
  | 'client-required'
  | 'all-matters-not-allowed'
  | 'matter-missing-or-archived'
  | 'selection-changed'
  | 'follower-disagreement';

export type SelectionOperationDecision =
  | {
      readonly kind: 'matter';
      readonly sourceKind: 'matter' | 'matter-only';
      readonly matter: Matter;
      readonly client: SharedClientIdentity | null;
      /** A matching pair after A → B → A is still a new authority. */
      readonly selectionGeneration?: number;
    }
  | {
      readonly kind: 'all-matters';
      readonly client: SharedClientIdentity | null;
      readonly selectionGeneration?: number;
    }
  | {
      readonly kind: 'refused';
      readonly reason: SelectionRefusalReason;
      readonly message: string;
    };

interface SelectionReaderSnapshot {
  readonly client: SharedClientIdentity | null;
  readonly scope: MatterScopeSelection;
  readonly followerStatus: ClientContextState['followerStatus'];
  readonly matters: Matter[];
  readonly activeMatterId: string | null;
  readonly selectionGeneration?: number;
}

const refusalMessages: Record<SelectionRefusalReason, string> = {
  'blocked-unresolved':
    'The selected client is still unresolved. Choose a valid client or matter and try again.',
  'client-required':
    'This action needs a confirmed client. Choose a client with a valid household link and try again.',
  'all-matters-not-allowed':
    'This action needs one selected client or matter. Choose one and try again.',
  'matter-missing-or-archived':
    'The selected client or matter is no longer available. Choose another one and try again.',
  'selection-changed':
    'The selected client changed before this action finished. Try the action again for the current client.',
  'follower-disagreement':
    'The client selection is still catching up. Wait a moment and try again.',
};

function refused(reason: SelectionRefusalReason): SelectionOperationDecision {
  return { kind: 'refused', reason, message: refusalMessages[reason] };
}

function projectedFollower(scope: MatterScopeSelection): string | null {
  switch (scope.kind) {
    case 'matter':
    case 'matter-only':
      return scope.matterId;
    case 'all-matters':
    case 'blocked-unresolved':
      return null;
  }
}

function expectedSelectionStillMatches(
  scope: MatterScopeSelection,
  expected: ExpectedSelectionScope | undefined,
): boolean {
  if (!expected) return true;
  switch (expected.kind) {
    case 'matter':
      return (
        (scope.kind === 'matter' || scope.kind === 'matter-only') &&
        scope.matterId === expected.matterId
      );
    case 'all-matters':
      return scope.kind === 'all-matters';
  }
}

export function resolveSelectionOperationDecision(
  snapshot: SelectionReaderSnapshot,
  request: SelectionOperationRequest,
): SelectionOperationDecision {
  if (!expectedSelectionStillMatches(snapshot.scope, request.expectedScope)) {
    return refused('selection-changed');
  }

  if (
    request.requireFollowerAgreement === true &&
    (snapshot.followerStatus !== 'converged' ||
      snapshot.activeMatterId !== projectedFollower(snapshot.scope))
  ) {
    return refused('follower-disagreement');
  }

  switch (snapshot.scope.kind) {
    case 'blocked-unresolved':
      return refused('blocked-unresolved');
    case 'all-matters':
      if (request.operationClass === 'client-scoped') return refused('client-required');
      return request.allowAllMatters
        ? {
            kind: 'all-matters',
            client: snapshot.client,
            selectionGeneration: snapshot.selectionGeneration ?? 0,
          }
        : refused('all-matters-not-allowed');
    case 'matter-only': {
      if (request.operationClass === 'client-scoped') return refused('client-required');
      const matter = resolveActiveMatter(snapshot.matters, snapshot.scope.matterId);
      return matter
        ? {
            kind: 'matter',
            sourceKind: 'matter-only',
            matter,
            client: null,
            selectionGeneration: snapshot.selectionGeneration ?? 0,
          }
        : refused('matter-missing-or-archived');
    }
    case 'matter': {
      const matter = resolveActiveMatter(snapshot.matters, snapshot.scope.matterId);
      if (!matter) return refused('matter-missing-or-archived');
      if (request.operationClass === 'client-scoped' && !snapshot.client) {
        return refused('client-required');
      }
      return {
        kind: 'matter',
        sourceKind: 'matter',
        matter,
        client: snapshot.client,
        selectionGeneration: snapshot.selectionGeneration ?? 0,
      };
    }
  }
}

function currentReaderSnapshot(): SelectionReaderSnapshot {
  // This is the T1 boot doorway. Persisted values are classified before the
  // source scope is observed; neither the persisted arm nor the follower grants.
  readAuthoritativeMatterScope();
  const source = useClientContextStore.getState();
  const matter = useMatterStore.getState();
  return {
    client: source.client,
    scope: source.scope,
    followerStatus: source.followerStatus,
    matters: matter.matters,
    activeMatterId: matter.activeMatterId,
    selectionGeneration: source.selectionRevision,
  };
}

/** Re-read current source + live data immediately before a sensitive operation. */
export function readSelectionOperationDecision(
  request: SelectionOperationRequest,
): SelectionOperationDecision {
  return resolveSelectionOperationDecision(currentReaderSnapshot(), request);
}

/** Reactive T1 reader. It never derives an arm from the legacy follower. */
export function useSelectionOperationDecision(
  request: SelectionOperationRequest,
): SelectionOperationDecision {
  readAuthoritativeMatterScope();
  const source = useClientContextStore(
    useShallow((state) => ({
      client: state.client,
      scope: state.scope,
      followerStatus: state.followerStatus,
      selectionGeneration: state.selectionRevision,
    })),
  );
  const matter = useMatterStore(
    useShallow((state) => ({
      matters: state.matters,
      activeMatterId: state.activeMatterId,
    })),
  );
  return useMemo(
    () =>
      resolveSelectionOperationDecision(
        {
          ...source,
          matters: matter.matters,
          activeMatterId: matter.activeMatterId,
        },
        request,
      ),
    [source, matter, request],
  );
}

export function expectedScopeFromDecision(
  decision: Exclude<SelectionOperationDecision, { kind: 'refused' }>,
): ExpectedSelectionScope {
  switch (decision.kind) {
    case 'matter':
      return { kind: 'matter', matterId: decision.matter.id };
    case 'all-matters':
      return { kind: 'all-matters' };
  }
}
