import { create } from 'zustand';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

/** The scope the authority owns. `blocked-unresolved` is never all-matters. */
export type MatterScopeSelection =
  | { readonly kind: 'matter'; readonly matterId: string }
  | { readonly kind: 'all-matters' }
  | { readonly kind: 'blocked-unresolved' };

export type FollowerStatus = 'converged' | 'stale';

/**
 * The stable, cross-tool identity of the household the advisor is working on.
 * `householdId` is authoritative; the remaining fields are display hints only.
 */
export interface SharedClientIdentity {
  householdId: string;
  displayName: string;
  primaryPeople?: readonly string[];
}

export interface SharedClientContextAdapter<Context> {
  id: string;
  derive: (client: SharedClientIdentity | null) => Context;
}

/** A branded object is insufficient on its own: provenance lives in a private WeakMap. */
declare const sealedClientBoundaryBrand: unique symbol;
export interface SealedClientBoundary {
  readonly [sealedClientBoundaryBrand]: true;
}

declare const sealedMatterScopeRequestBrand: unique symbol;
export interface SealedMatterScopeSelection {
  readonly [sealedMatterScopeRequestBrand]: true;
}

interface ClientBoundaryIdentity {
  readonly householdRef: string;
  readonly matterId?: string;
  readonly displayName?: string;
}

interface MatterScopeRequestIdentity {
  readonly householdRef: string;
  readonly matterId: string;
  readonly displayName?: string;
}

interface SealedSpecificPair {
  readonly kind: 'matter';
  readonly client: SharedClientIdentity;
  readonly matterId: string;
  readonly issuedAtRevision: number;
}

interface SealedAllMattersIntent {
  readonly kind: 'all-matters';
  readonly issuedAtRevision: number;
}

const sealedClientBoundaries = new WeakMap<
  SealedClientBoundary,
  SealedSpecificPair
>();
const sealedMatterScopeRequests = new WeakMap<
  SealedMatterScopeSelection,
  SealedSpecificPair | SealedAllMattersIntent
>();

export type SelectionResult =
  | { readonly kind: 'selected'; readonly client: SharedClientIdentity }
  | { readonly kind: 'refused'; readonly reason: SelectionRefusalReason };

export type MatterScopeSelectionResult =
  | {
      readonly kind: 'selected';
      readonly client: SharedClientIdentity | null;
      readonly scope: MatterScopeSelection;
    }
  | { readonly kind: 'refused'; readonly reason: MatterScopeRefusalReason };

export type SelectionRefusalReason =
  | 'unsealed-client-boundary'
  | 'missing-matter-id'
  | 'invalid-matter-boundary'
  | 'invalid-client-boundary';

export type MatterScopeRefusalReason =
  | 'unsealed-matter-scope-request'
  | 'stale-matter-scope-request'
  | 'missing-matter'
  | 'archived-matter'
  | 'unauthorized-pair'
  | 'wrong-client-pair';

export interface ClientContextState {
  /** The source half of the canonical selection pair. */
  client: SharedClientIdentity | null;
  /** The source half of the canonical selection pair. */
  scope: MatterScopeSelection;
  /** Only whether the legacy activeMatterId currently equals the projection. */
  followerStatus: FollowerStatus;
  /** Monotonic freshness token; never a caller-supplied selection value. */
  selectionRevision: number;
  /**
   * Compatibility client writer until the writer-retirement lane moves callers.
   * A raw client has no proven matter pair, so it deliberately blocks scope.
   */
  setClient: (client: SharedClientIdentity) => void;
  /** Clearing client is not a failure and preserves the owned scope exactly. */
  clearClient: () => void;
}

function normalizeClient(client: SharedClientIdentity): SharedClientIdentity {
  const householdId = client.householdId.trim();
  if (!householdId)
    throw new Error('Shared client context requires a household id.');

  return Object.freeze({
    householdId,
    displayName: client.displayName.trim() || householdId,
    ...(client.primaryPeople
      ? {
          primaryPeople: Object.freeze(
            client.primaryPeople.map((person) => person.trim()).filter(Boolean)
          ),
        }
      : {}),
  });
}

function projectedFollowerValue(scope: MatterScopeSelection): string | null {
  return scope.kind === 'matter' ? scope.matterId : null;
}

function freezeScope(scope: MatterScopeSelection): MatterScopeSelection {
  return Object.freeze(
    scope.kind === 'matter'
      ? { kind: 'matter' as const, matterId: scope.matterId }
      : scope.kind === 'all-matters'
        ? { kind: 'all-matters' as const }
        : { kind: 'blocked-unresolved' as const }
  );
}

function followerStatusFor(scope: MatterScopeSelection): FollowerStatus {
  return useMatterStore.getState().activeMatterId ===
    projectedFollowerValue(scope)
    ? 'converged'
    : 'stale';
}

/**
 * The one legal household-to-matter resolver for this package. The CRM feature
 * helper is intentionally not used: it includes archived matches and therefore
 * cannot be the authority doorway.
 */
export function resolveCanonicalHouseholdMatter(
  householdId: string,
  matters: readonly Matter[] = useMatterStore.getState().matters
): Matter | undefined {
  const normalizedHouseholdId = householdId.trim();
  if (!normalizedHouseholdId) return undefined;
  const matches = matters.filter(
    (matter) =>
      !matter.archived &&
      (matter.crmHouseholdKeys ?? []).includes(normalizedHouseholdId)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function validatePair(
  client: SharedClientIdentity,
  matterId: string
): { readonly matter?: Matter; readonly reason?: MatterScopeRefusalReason } {
  const exact = useMatterStore
    .getState()
    .matters.find((matter) => matter.id === matterId);
  if (!exact) return { reason: 'missing-matter' };
  if (exact.archived) return { reason: 'archived-matter' };
  const canonical = resolveCanonicalHouseholdMatter(client.householdId);
  if (!canonical) return { reason: 'unauthorized-pair' };
  if (canonical.id !== matterId) return { reason: 'wrong-client-pair' };
  return { matter: exact };
}

/**
 * Internal issuer for a proven full client/matter pair. It is deliberately not
 * re-exported from this package's index; callers receive only its opaque handle.
 */
export function sealResolvedClientBoundary(
  identity: ClientBoundaryIdentity
): SealedClientBoundary | null {
  const matterId = identity.matterId?.trim();
  if (!matterId) return null;
  let client: SharedClientIdentity;
  try {
    client = normalizeClient({
      householdId: identity.householdRef,
      displayName: identity.displayName ?? identity.householdRef,
    });
  } catch {
    return null;
  }
  if (!validatePair(client, matterId).matter) return null;
  const boundary = Object.freeze({}) as SealedClientBoundary;
  sealedClientBoundaries.set(
    boundary,
    Object.freeze({
      kind: 'matter',
      client,
      matterId,
      issuedAtRevision: useClientContextStore.getState().selectionRevision,
    })
  );
  return boundary;
}

/** Internal issuer for a specific, already-authorized full selection pair. */
export function sealMatterScopeSelection(
  identity: MatterScopeRequestIdentity
): SealedMatterScopeSelection | null {
  let client: SharedClientIdentity;
  try {
    client = normalizeClient({
      householdId: identity.householdRef,
      displayName: identity.displayName ?? identity.householdRef,
    });
  } catch {
    return null;
  }
  const matterId = identity.matterId.trim();
  if (!matterId || !validatePair(client, matterId).matter) return null;
  const request = Object.freeze({}) as SealedMatterScopeSelection;
  sealedMatterScopeRequests.set(
    request,
    Object.freeze({
      kind: 'matter',
      client,
      matterId,
      issuedAtRevision: useClientContextStore.getState().selectionRevision,
    })
  );
  return request;
}

/** Internal issuer for explicit workspace-wide user intent; it carries no raw scope union. */
export function sealAllMattersScopeSelection(): SealedMatterScopeSelection {
  const request = Object.freeze({}) as SealedMatterScopeSelection;
  sealedMatterScopeRequests.set(
    request,
    Object.freeze({
      kind: 'all-matters',
      issuedAtRevision: useClientContextStore.getState().selectionRevision,
    })
  );
  return request;
}

let writeSourceSelection: (
  client: SharedClientIdentity | null,
  scope: MatterScopeSelection
) => void;
let reconciliationPending = false;
let failedReconciliationAttempts = 0;
const MAX_RECONCILIATION_RETRIES = 3;

function updateFollowerStatus(): void {
  const state = useClientContextStore.getState();
  const followerStatus = followerStatusFor(state.scope);
  if (state.followerStatus === followerStatus) return;
  try {
    clientContextStore.setState({ followerStatus });
  } catch (error) {
    // A subscriber cannot prevent state already swapped by Zustand from being
    // observed or retried. The next reconcile still re-checks the projection.
    void error;
  }
}

function reconcileFollower(): void {
  reconciliationPending = false;
  const source = useClientContextStore.getState();
  const scope = source.scope;
  if (
    scope.kind === 'matter' &&
    !useMatterStore
      .getState()
      .matters.some(
        (matter) => matter.id === scope.matterId && !matter.archived
      )
  ) {
    writeSourceSelection(source.client, { kind: 'blocked-unresolved' });
    return;
  }
  const projection = projectedFollowerValue(scope);
  try {
    useMatterStore.getState().setActiveMatter(projection);
  } catch (error) {
    // A throwing legacy subscriber/setter must leave an observable stale marker.
    void error;
  }
  updateFollowerStatus();
  if (followerStatusFor(useClientContextStore.getState().scope) === 'stale') {
    if (failedReconciliationAttempts < MAX_RECONCILIATION_RETRIES) {
      failedReconciliationAttempts += 1;
      scheduleFollowerReconciliation(2 ** failedReconciliationAttempts);
    }
  } else {
    failedReconciliationAttempts = 0;
  }
}

/** Exactly one queued reconciliation exists, independently of any later selection write. */
function scheduleFollowerReconciliation(delayMs = 0): void {
  if (reconciliationPending) return;
  reconciliationPending = true;
  setTimeout(reconcileFollower, delayMs);
}

function scopeFromPersistedFollower(): MatterScopeSelection {
  const { activeMatterId, matters } = useMatterStore.getState();
  if (activeMatterId === null) return { kind: 'all-matters' };
  const active = matters.find((matter) => matter.id === activeMatterId);
  return active && !active.archived
    ? { kind: 'matter', matterId: active.id }
    : { kind: 'blocked-unresolved' };
}

const bootScope = scopeFromPersistedFollower();

/**
 * The source of truth. Every source change is one `set()` call, then its
 * finally block schedules reconciliation even if a source subscriber throws.
 */
const clientContextStore = create<ClientContextState>()((set) => {
  writeSourceSelection = (client, scope) => {
    const nextScope = freezeScope(scope);
    failedReconciliationAttempts = 0;
    try {
      set((state) => ({
        client,
        scope: nextScope,
        followerStatus: followerStatusFor(nextScope),
        selectionRevision: state.selectionRevision + 1,
      }));
    } catch (error) {
      // Zustand's set has already swapped state before synchronously notifying
      // subscribers. A subscriber failure is not permission to roll back or
      // invent a different selection.
      void error;
    } finally {
      scheduleFollowerReconciliation();
    }
  };
  return {
    client: null,
    scope: bootScope,
    followerStatus: followerStatusFor(bootScope),
    selectionRevision: 0,
    setClient: (client) => {
      // Legacy raw-client entry point: retain compatibility without granting a
      // raw id authority path. Its missing canonical pair is fail-closed.
      writeSourceSelection(normalizeClient(client), {
        kind: 'blocked-unresolved',
      });
    },
    clearClient: () => {
      // Ordinary clear is not a failure and never widens a matter scope.
      writeSourceSelection(null, useClientContextStore.getState().scope);
    },
  };
});

/**
 * Boot gate used by the lifecycle lane at startup. It validates the persisted
 * follower against current live matters before any consumer can trust a scope.
 */
export function bootstrapSelectionAuthorityFromPersistedFollower(): MatterScopeSelection {
  const scope = scopeFromPersistedFollower();
  writeSourceSelection(useClientContextStore.getState().client, scope);
  return scope;
}

function refuseMatterScope(
  reason: MatterScopeRefusalReason
): MatterScopeSelectionResult {
  writeSourceSelection(useClientContextStore.getState().client, {
    kind: 'blocked-unresolved',
  });
  return { kind: 'refused', reason };
}

/**
 * The only public scope-selection request door. It accepts runtime-provenance
 * handles only; a raw id, raw union, cast, or stale handle cannot select scope.
 */
export async function requestMatterScopeSelection(
  request: SealedMatterScopeSelection
): Promise<MatterScopeSelectionResult> {
  await Promise.resolve();
  const sealed = sealedMatterScopeRequests.get(request);
  if (!sealed || !Object.isFrozen(request))
    return refuseMatterScope('unsealed-matter-scope-request');
  if (
    sealed.issuedAtRevision !==
    useClientContextStore.getState().selectionRevision
  ) {
    return refuseMatterScope('stale-matter-scope-request');
  }
  if (sealed.kind === 'all-matters') {
    const client = useClientContextStore.getState().client;
    const scope = freezeScope({ kind: 'all-matters' });
    writeSourceSelection(client, scope);
    return { kind: 'selected', client, scope };
  }
  const validation = validatePair(sealed.client, sealed.matterId);
  if (!validation.matter)
    return refuseMatterScope(validation.reason ?? 'unauthorized-pair');
  const scope = freezeScope({
    kind: 'matter',
    matterId: validation.matter.id,
  });
  writeSourceSelection(sealed.client, scope);
  return { kind: 'selected', client: sealed.client, scope };
}

/** The sealed cross-client doorway salvaged from the frozen worktree, now source-owned. */
export async function requestSharedClientSelection(
  boundary: SealedClientBoundary
): Promise<SelectionResult> {
  await Promise.resolve();
  const sealed = sealedClientBoundaries.get(boundary);
  if (!sealed || !Object.isFrozen(boundary)) {
    writeSourceSelection(useClientContextStore.getState().client, {
      kind: 'blocked-unresolved',
    });
    return { kind: 'refused', reason: 'unsealed-client-boundary' };
  }
  if (
    sealed.issuedAtRevision !==
    useClientContextStore.getState().selectionRevision
  ) {
    writeSourceSelection(useClientContextStore.getState().client, {
      kind: 'blocked-unresolved',
    });
    return { kind: 'refused', reason: 'invalid-client-boundary' };
  }
  const validation = validatePair(sealed.client, sealed.matterId);
  if (!validation.matter) {
    writeSourceSelection(useClientContextStore.getState().client, {
      kind: 'blocked-unresolved',
    });
    return {
      kind: 'refused',
      reason:
        validation.reason === 'missing-matter'
          ? 'invalid-matter-boundary'
          : 'invalid-client-boundary',
    };
  }
  writeSourceSelection(sealed.client, {
    kind: 'matter',
    matterId: validation.matter.id,
  });
  return { kind: 'selected', client: sealed.client };
}

/** Read a feature's narrow view without copying client state into that feature. */
export function readSharedClientContext<Context>(
  adapter: SharedClientContextAdapter<Context>
): Context {
  return adapter.derive(useClientContextStore.getState().client);
}

/** A narrow reader for future T1/T2 consumers; it never exposes a raw writer. */
export function readAuthoritativeMatterScope(): MatterScopeSelection {
  return useClientContextStore.getState().scope;
}

/**
 * Public read facade. Deliberately omit Zustand's raw `setState`: selection
 * changes must enter through the sealed request door or legacy compatibility
 * methods on the state, never through a structural scope object.
 */
export const useClientContextStore = Object.assign(
  <Selection>(selector: (state: ClientContextState) => Selection): Selection =>
    clientContextStore(selector),
  {
    getState: clientContextStore.getState,
    subscribe: clientContextStore.subscribe,
  }
);
