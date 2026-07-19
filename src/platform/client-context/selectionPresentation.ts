import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { readAuthoritativeMatterScope, useClientContextStore } from './clientContextStore';
import type { FollowerStatus } from './clientContextStore';
import type { MatterScopeSelection } from './selectionTypes';
import { isEnabled, useFlag } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';

export interface SelectionPresentation {
  /** The displayed arm. It is authoritative when the boot gate is active. */
  readonly scope: MatterScopeSelection;
  /** Always-read source arm, including while the inert compatibility path is selected. */
  readonly sourceScope: MatterScopeSelection;
  /** Projection agreement only. It never grants or changes the source arm. */
  readonly followerStatus: FollowerStatus;
  readonly matterId: string | null;
  readonly blocked: boolean;
  readonly allMatters: boolean;
  readonly stale: boolean;
  readonly authorityEnabled: boolean;
}

export function resolveSelectionPresentation(
  scope: MatterScopeSelection,
  followerStatus: FollowerStatus,
  options: {
    sourceScope?: MatterScopeSelection;
    authorityEnabled?: boolean;
  } = {},
): SelectionPresentation {
  const sourceScope = options.sourceScope ?? scope;
  const authorityEnabled = options.authorityEnabled ?? true;
  switch (scope.kind) {
    case 'matter':
    case 'matter-only':
      return {
        scope,
        sourceScope,
        followerStatus,
        matterId: scope.matterId,
        blocked: false,
        allMatters: false,
        stale: authorityEnabled && followerStatus === 'stale',
        authorityEnabled,
      };
    case 'all-matters':
      return {
        scope,
        sourceScope,
        followerStatus,
        matterId: null,
        blocked: false,
        allMatters: true,
        stale: authorityEnabled && followerStatus === 'stale',
        authorityEnabled,
      };
    case 'blocked-unresolved':
      return {
        scope,
        sourceScope,
        followerStatus,
        matterId: null,
        blocked: true,
        allMatters: false,
        stale: authorityEnabled && followerStatus === 'stale',
        authorityEnabled,
      };
  }
}

/** Immediate T2/context read for callbacks and non-React presentation copies. */
export function readSelectionPresentation(): SelectionPresentation {
  const authorityEnabled = isEnabled('selection-authority-boot-gate');
  if (authorityEnabled) readAuthoritativeMatterScope();
  const { scope, followerStatus } = useClientContextStore.getState();
  const activeMatterId = useMatterStore.getState().activeMatterId;
  const displayedScope = authorityEnabled
    ? scope
    : activeMatterId
      ? ({ kind: 'matter-only', matterId: activeMatterId } as const)
      : ({ kind: 'all-matters' } as const);
  return resolveSelectionPresentation(displayedScope, followerStatus, {
    sourceScope: scope,
    authorityEnabled,
  });
}

/** Reactive T2 reader. Source kind and projection status are always read together. */
export function useSelectionPresentation(): SelectionPresentation {
  const authorityEnabled = useFlag('selection-authority-boot-gate');
  if (authorityEnabled) readAuthoritativeMatterScope();
  const selection = useClientContextStore(
    useShallow((state) => ({
      scope: state.scope,
      followerStatus: state.followerStatus,
    })),
  );
  const activeMatterId = useMatterStore((state) => state.activeMatterId);
  return useMemo(
    () => {
      const displayedScope = authorityEnabled
        ? selection.scope
        : activeMatterId
          ? ({ kind: 'matter-only', matterId: activeMatterId } as const)
          : ({ kind: 'all-matters' } as const);
      return resolveSelectionPresentation(displayedScope, selection.followerStatus, {
        sourceScope: selection.scope,
        authorityEnabled,
      });
    },
    [activeMatterId, authorityEnabled, selection],
  );
}
