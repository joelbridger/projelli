import { create } from 'zustand';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  registerSelectionWriterBridge,
  rehydrateSelectionFromData,
} from './selectionWriterBridge';
import { installNativeActiveClientContextBridge } from './nativeActiveClientContext';
import type {
  CanonicalHouseholdRef,
  CrmProviderId,
  MatterScopeSelection,
  PersistedSelectionHint,
  RehydratedSelectionInput,
  SharedClientIdentity,
} from './selectionTypes';

export type {
  CanonicalHouseholdRef,
  CrmProviderId,
  MatterScopeSelection,
  PersistedSelectionHint,
  RehydratedSelectionInput,
  SharedClientIdentity,
} from './selectionTypes';

export type FollowerStatus = 'converged' | 'stale';

export interface SharedClientContextAdapter<Context> {
  id: string;
  derive: (client: SharedClientIdentity | null) => Context;
}

export interface SharedClientSelectionInput {
  readonly provider: CrmProviderId;
  readonly householdId: string;
  readonly displayName: string;
  readonly primaryPeople?: readonly string[];
}

interface MatterSelectionInput {
  readonly matterId: unknown;
}

declare const sealedClientSelectionBrand: unique symbol;
export interface SealedClientSelectionClassification {
  readonly [sealedClientSelectionBrand]: true;
}

declare const sealedMatterScopeRequestBrand: unique symbol;
export interface SealedMatterScopeSelection {
  readonly [sealedMatterScopeRequestBrand]: true;
}

declare const sealedRehydratedSelectionBrand: unique symbol;
export interface SealedRehydratedSelectionClassification {
  readonly [sealedRehydratedSelectionBrand]: true;
}

export type SealedClientBoundary = SealedClientSelectionClassification;

export type SelectionRefusalReason =
  | 'unsealed-client-boundary'
  | 'stale-client-boundary'
  | 'invalid-client-boundary'
  | 'selection-authority-disabled';

export type MatterScopeRefusalReason =
  | 'unsealed-matter-scope-request'
  | 'stale-matter-scope-request'
  | 'missing-matter'
  | 'archived-matter'
  | 'invalid-matter-input'
  | 'selection-authority-disabled';

export type RehydrationRefusalReason =
  | 'unsealed-rehydration-request'
  | 'stale-rehydration-request'
  | 'selection-authority-disabled';

export type SelectionResult =
  | { readonly kind: 'selected'; readonly client: SharedClientIdentity | null }
  | {
      readonly kind: 'routed-dark';
      readonly client: SharedClientIdentity | null;
    }
  | { readonly kind: 'refused'; readonly reason: SelectionRefusalReason };

export type MatterScopeSelectionResult =
  | {
      readonly kind: 'selected';
      readonly client: SharedClientIdentity | null;
      readonly scope: MatterScopeSelection;
    }
  | {
      readonly kind: 'routed-dark';
      readonly projectedMatterId: string | null;
    }
  | { readonly kind: 'refused'; readonly reason: MatterScopeRefusalReason };

export type RehydratedSelectionResult =
  | {
      readonly kind: 'selected';
      readonly client: SharedClientIdentity | null;
      readonly scope: MatterScopeSelection;
    }
  | { readonly kind: 'refused'; readonly reason: RehydrationRefusalReason };

export interface ClientContextState {
  readonly client: SharedClientIdentity | null;
  readonly scope: MatterScopeSelection;
  readonly followerStatus: FollowerStatus;
  readonly selectionRevision: number;
  /** A restart hint only. It is always classified again before use. */
  readonly persistenceHint: PersistedSelectionHint;
}

type FieldTreatment = 'consumed' | 'normalized' | 'hint-only';

const MATTER_SELECTION_INPUT_FIELDS = {
  matterId: 'normalized',
} satisfies Record<keyof MatterSelectionInput, FieldTreatment>;
void MATTER_SELECTION_INPUT_FIELDS;

const SHARED_CLIENT_SELECTION_INPUT_FIELDS = {
  provider: 'normalized',
  householdId: 'normalized',
  displayName: 'normalized',
  primaryPeople: 'normalized',
} satisfies Record<keyof SharedClientSelectionInput, FieldTreatment>;
void SHARED_CLIENT_SELECTION_INPUT_FIELDS;

const PERSISTED_SELECTION_HINT_FIELDS = {
  'specific-matter': {
    version: 'consumed',
    source: 'consumed',
    matterId: 'normalized',
    client: 'normalized',
  },
  'shared-client': {
    version: 'consumed',
    source: 'consumed',
    client: 'normalized',
  },
  'explicit-all-matters': {
    version: 'consumed',
    source: 'consumed',
    client: 'normalized',
  },
  'blocked/refused': {
    version: 'consumed',
    source: 'consumed',
    matterId: 'normalized',
    client: 'normalized',
  },
} satisfies {
  [Source in PersistedSelectionHint['source']]: Record<
    keyof Extract<PersistedSelectionHint, { source: Source }>,
    FieldTreatment
  >;
};
void PERSISTED_SELECTION_HINT_FIELDS;

const REHYDRATED_SELECTION_INPUT_FIELDS = {
  'persisted-hint': {
    kind: 'consumed',
    value: 'normalized',
  },
  'legacy-follower': {
    kind: 'consumed',
    activeMatterId: 'normalized',
  },
} satisfies {
  [Kind in RehydratedSelectionInput['kind']]: Record<
    keyof Extract<RehydratedSelectionInput, { kind: Kind }>,
    FieldTreatment
  >;
};
void REHYDRATED_SELECTION_INPUT_FIELDS;

function assertNever(value: never): never {
  throw new Error(`Unreachable selection classifier arm: ${String(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProvider(value: unknown): CrmProviderId | null {
  return value === 'wealthbox' ? value : null;
}

function normalizeHouseholdId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeClientInput(value: unknown): SharedClientIdentity | null {
  if (!isRecord(value)) return null;
  const provider = normalizeProvider(value['provider']);
  const householdId = normalizeHouseholdId(value['householdId']);
  if (!provider || !householdId) return null;
  const displayName =
    typeof value['displayName'] === 'string' && value['displayName'].trim()
      ? value['displayName'].trim()
      : householdId;
  const rawPeople = value['primaryPeople'];
  const primaryPeople = Array.isArray(rawPeople)
    ? rawPeople
        .filter((person): person is string => typeof person === 'string')
        .map((person) => person.trim())
        .filter(Boolean)
    : undefined;
  return Object.freeze({
    provider,
    householdId,
    displayName,
    ...(primaryPeople ? { primaryPeople: Object.freeze(primaryPeople) } : {}),
  });
}

function normalizeLegacyClient(
  client: SharedClientIdentity
): SharedClientIdentity {
  const householdId = client.householdId.trim();
  if (!householdId)
    throw new Error('Shared client context requires a household id.');
  return {
    provider: client.provider,
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

interface ProviderDirectory {
  readonly available: boolean;
  readonly households: ReadonlyMap<string, SharedClientIdentity>;
  readonly revision: number;
}

const providerDirectories = new Map<CrmProviderId, ProviderDirectory>();
let classifierDataRevision = 0;

function currentProviderDirectory(provider: CrmProviderId): ProviderDirectory {
  return (
    providerDirectories.get(provider) ?? {
      available: false,
      households: new Map(),
      revision: 0,
    }
  );
}

function providerDirectoryAvailable(provider: CrmProviderId): boolean {
  return currentProviderDirectory(provider).available;
}

/** Provider adapters publish their current live directory; callers never assert liveness. */
export function replaceCanonicalHouseholdDirectory(
  provider: CrmProviderId,
  households: readonly SharedClientSelectionInput[] | null
): void {
  const previous = currentProviderDirectory(provider);
  const normalized = new Map<string, SharedClientIdentity>();
  if (households) {
    for (const household of households) {
      const client = normalizeClientInput(household);
      if (client) {
        normalized.set(client.householdId, client);
      }
    }
  }
  providerDirectories.set(
    provider,
    Object.freeze({
      available: households !== null,
      households: normalized,
      revision: previous.revision + 1,
    })
  );
  classifierDataRevision += 1;
  revalidateCurrentSelection();
}

/**
 * Publish the one built-in local sample only when this provider has not yet
 * published a directory.  This is deliberately not a general bootstrap or
 * merge API: a connected firm's directory is already authoritative and must
 * never be replaced or supplemented by demonstration data.
 */
export function publishLocalSampleHousehold(
  sample: SharedClientSelectionInput
): boolean {
  const provider = normalizeProvider(sample.provider);
  const client = normalizeClientInput(sample);
  if (!provider || !client || currentProviderDirectory(provider).available)
    return false;
  replaceCanonicalHouseholdDirectory(provider, [client]);
  return true;
}

type HouseholdClassificationKind =
  | 'exactly-one-live'
  | 'zero-live'
  | 'ambiguous-live'
  | 'archived-only'
  | 'invalid-household';

export interface HouseholdClassification {
  readonly kind: HouseholdClassificationKind;
  readonly ref: CanonicalHouseholdRef | null;
  readonly client: SharedClientIdentity | null;
  readonly liveMatterIds: readonly string[];
  readonly archivedMatterIds: readonly string[];
  readonly fingerprint: string;
  readonly dataRevision: number;
}

const HOUSEHOLD_CLASSIFICATION_FIELDS = {
  'exactly-one-live': {
    kind: 'consumed',
    ref: 'consumed',
    client: 'consumed',
    liveMatterIds: 'consumed',
    archivedMatterIds: 'consumed',
    fingerprint: 'consumed',
    dataRevision: 'consumed',
  },
  'zero-live': {
    kind: 'consumed',
    ref: 'consumed',
    client: 'consumed',
    liveMatterIds: 'consumed',
    archivedMatterIds: 'consumed',
    fingerprint: 'consumed',
    dataRevision: 'consumed',
  },
  'ambiguous-live': {
    kind: 'consumed',
    ref: 'consumed',
    client: 'consumed',
    liveMatterIds: 'consumed',
    archivedMatterIds: 'consumed',
    fingerprint: 'consumed',
    dataRevision: 'consumed',
  },
  'archived-only': {
    kind: 'consumed',
    ref: 'consumed',
    client: 'consumed',
    liveMatterIds: 'consumed',
    archivedMatterIds: 'consumed',
    fingerprint: 'consumed',
    dataRevision: 'consumed',
  },
  'invalid-household': {
    kind: 'consumed',
    ref: 'consumed',
    client: 'consumed',
    liveMatterIds: 'consumed',
    archivedMatterIds: 'consumed',
    fingerprint: 'consumed',
    dataRevision: 'consumed',
  },
} satisfies Record<
  HouseholdClassificationKind,
  Record<keyof HouseholdClassification, FieldTreatment>
>;
void HOUSEHOLD_CLASSIFICATION_FIELDS;

function providerQualifiedMatterKey(ref: CanonicalHouseholdRef): string {
  return `${ref.provider}:${ref.householdId}`;
}

const householdMatterMatchers = {
  wealthbox: (matter: Matter, householdId: string): boolean =>
    (matter.crmHouseholdKeys ?? []).some((key) => key.trim() === householdId),
} satisfies Record<
  CrmProviderId,
  (matter: Matter, householdId: string) => boolean
>;

function matterMatchesHousehold(
  matter: Matter,
  ref: CanonicalHouseholdRef
): boolean {
  return householdMatterMatchers[ref.provider](matter, ref.householdId);
}

/** Total canonical resolver for every provider-qualified household/data population. */
export function resolveCanonicalHouseholdClassification(
  ref: CanonicalHouseholdRef,
  snapshot: readonly Matter[] = useMatterStore.getState().matters
): HouseholdClassification {
  const untrustedRef = ref as unknown as {
    readonly provider?: unknown;
    readonly householdId?: unknown;
  };
  const provider = normalizeProvider(untrustedRef.provider);
  const householdId = normalizeHouseholdId(untrustedRef.householdId);
  const normalizedRef =
    provider && householdId ? Object.freeze({ provider, householdId }) : null;
  const directory = provider ? currentProviderDirectory(provider) : null;
  const client =
    normalizedRef && directory?.available
      ? (directory.households.get(normalizedRef.householdId) ?? null)
      : null;
  const matching = normalizedRef
    ? snapshot.filter((matter) => matterMatchesHousehold(matter, normalizedRef))
    : [];
  const liveMatterIds = matching
    .filter((matter) => !matter.archived)
    .map((matter) => matter.id)
    .sort();
  const archivedMatterIds = matching
    .filter((matter) => matter.archived)
    .map((matter) => matter.id)
    .sort();
  let kind: HouseholdClassificationKind;
  if (!normalizedRef || !directory?.available || !client) {
    kind = 'invalid-household';
  } else if (liveMatterIds.length === 1) {
    kind = 'exactly-one-live';
  } else if (liveMatterIds.length >= 2) {
    kind = 'ambiguous-live';
  } else if (archivedMatterIds.length > 0) {
    kind = 'archived-only';
  } else {
    kind = 'zero-live';
  }
  const fingerprint = JSON.stringify({
    ref: normalizedRef ? providerQualifiedMatterKey(normalizedRef) : null,
    directoryRevision: directory?.revision ?? 0,
    kind,
    liveMatterIds,
    archivedMatterIds,
  });
  return Object.freeze({
    kind,
    ref: normalizedRef,
    client,
    liveMatterIds: Object.freeze(liveMatterIds),
    archivedMatterIds: Object.freeze(archivedMatterIds),
    fingerprint,
    dataRevision: classifierDataRevision,
  });
}

/** Compatibility reader retained for non-authority callers. */
export function resolveCanonicalHouseholdMatter(
  householdId: string,
  matters: readonly Matter[] = useMatterStore.getState().matters
): Matter | undefined {
  const classification = resolveCanonicalHouseholdClassification(
    { provider: 'wealthbox', householdId },
    matters
  );
  if (classification.kind !== 'exactly-one-live') return undefined;
  const id = classification.liveMatterIds[0];
  return matters.find((matter) => matter.id === id);
}

type MatterClassification =
  | {
      readonly kind: 'full-pair';
      readonly client: SharedClientIdentity;
      readonly matterId: string;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'matter-only';
      readonly matterId: string;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'pre-seal-failure';
      readonly reason:
        | 'missing-matter'
        | 'archived-matter'
        | 'invalid-matter-input';
      readonly fingerprint: string;
    };

const MATTER_CLASSIFICATION_FIELDS = {
  'full-pair': {
    kind: 'consumed',
    client: 'consumed',
    matterId: 'consumed',
    fingerprint: 'consumed',
  },
  'matter-only': {
    kind: 'consumed',
    matterId: 'consumed',
    fingerprint: 'consumed',
  },
  'pre-seal-failure': {
    kind: 'consumed',
    reason: 'consumed',
    fingerprint: 'consumed',
  },
} satisfies {
  [Kind in MatterClassification['kind']]: Record<
    keyof Extract<MatterClassification, { kind: Kind }>,
    FieldTreatment
  >;
};
void MATTER_CLASSIFICATION_FIELDS;

function liveMatter(matterId: string): Matter | null {
  return (
    useMatterStore
      .getState()
      .matters.find((matter) => matter.id === matterId && !matter.archived) ??
    null
  );
}

function classifyMatterSelection(
  input: MatterSelectionInput
): MatterClassification {
  const matterId = normalizeHouseholdId(input.matterId);
  if (!matterId) {
    return Object.freeze({
      kind: 'pre-seal-failure',
      reason: 'invalid-matter-input',
      fingerprint: JSON.stringify({ input: typeof input.matterId }),
    });
  }
  const exact = useMatterStore
    .getState()
    .matters.find((matter) => matter.id === matterId);
  if (!exact) {
    return Object.freeze({
      kind: 'pre-seal-failure',
      reason: 'missing-matter',
      fingerprint: JSON.stringify({ matterId, state: 'missing' }),
    });
  }
  if (exact.archived) {
    return Object.freeze({
      kind: 'pre-seal-failure',
      reason: 'archived-matter',
      fingerprint: JSON.stringify({ matterId, state: 'archived' }),
    });
  }

  const currentClient = useClientContextStore.getState().client;
  if (currentClient) {
    const current = resolveCanonicalHouseholdClassification(currentClient);
    if (
      current.kind === 'exactly-one-live' &&
      current.liveMatterIds[0] === matterId
    ) {
      return Object.freeze({
        kind: 'full-pair',
        client: currentClient,
        matterId,
        fingerprint: JSON.stringify({ matterId, current: current.fingerprint }),
      });
    }
  }

  const candidateClients = new Map<string, SharedClientIdentity>();
  for (const rawKey of exact.crmHouseholdKeys ?? []) {
    const householdId = rawKey.trim();
    if (!householdId) continue;
    const classification = resolveCanonicalHouseholdClassification({
      provider: 'wealthbox',
      householdId,
    });
    if (
      classification.kind === 'exactly-one-live' &&
      classification.liveMatterIds[0] === matterId &&
      classification.client
    ) {
      candidateClients.set(
        providerQualifiedMatterKey(classification.client),
        classification.client
      );
    }
  }
  const candidateKeys = [...candidateClients.keys()].sort();
  const fingerprint = JSON.stringify({
    matterId,
    candidateKeys,
    links: [...(exact.crmHouseholdKeys ?? [])].map((key) => key.trim()).sort(),
  });
  if (candidateKeys.length === 1) {
    const client = candidateClients.get(candidateKeys[0] ?? '');
    if (!client) return assertNever(candidateKeys.length as never);
    return Object.freeze({ kind: 'full-pair', client, matterId, fingerprint });
  }
  return Object.freeze({ kind: 'matter-only', matterId, fingerprint });
}

type ClientClassification =
  | {
      readonly kind: 'full-pair';
      readonly client: SharedClientIdentity;
      readonly matterId: string;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'blocked-unresolved';
      readonly client: SharedClientIdentity | null;
      readonly fingerprint: string;
    };

const CLIENT_CLASSIFICATION_FIELDS = {
  'full-pair': {
    kind: 'consumed',
    client: 'consumed',
    matterId: 'consumed',
    fingerprint: 'consumed',
  },
  'blocked-unresolved': {
    kind: 'consumed',
    client: 'consumed',
    fingerprint: 'consumed',
  },
} satisfies {
  [Kind in ClientClassification['kind']]: Record<
    keyof Extract<ClientClassification, { kind: Kind }>,
    FieldTreatment
  >;
};
void CLIENT_CLASSIFICATION_FIELDS;

function classifyClientSelection(input: unknown): ClientClassification {
  const client = normalizeClientInput(input);
  if (!client) {
    return Object.freeze({
      kind: 'blocked-unresolved',
      client: null,
      fingerprint: JSON.stringify({ state: 'invalid-input' }),
    });
  }
  const classification = resolveCanonicalHouseholdClassification(client);
  if (classification.kind === 'exactly-one-live') {
    return Object.freeze({
      kind: 'full-pair',
      client: classification.client ?? client,
      matterId: classification.liveMatterIds[0] ?? '',
      fingerprint: classification.fingerprint,
    });
  }
  return Object.freeze({
    kind: 'blocked-unresolved',
    client: classification.client,
    fingerprint: classification.fingerprint,
  });
}

interface MatterSealPayload {
  readonly intent: 'specific-matter' | 'explicit-all-matters';
  readonly input?: MatterSelectionInput;
  readonly classification?: MatterClassification;
  readonly issuedAtSelectionRevision: number;
}

interface ClientSealPayload {
  readonly input: SharedClientSelectionInput;
  readonly classification: ClientClassification;
  readonly issuedAtSelectionRevision: number;
}

type RehydratedClassification =
  | {
      readonly kind: 'full-pair';
      readonly client: SharedClientIdentity;
      readonly matterId: string;
      readonly hint: PersistedSelectionHint;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'matter-only';
      readonly matterId: string;
      readonly hint: PersistedSelectionHint;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'all-matters';
      readonly client: SharedClientIdentity | null;
      readonly hint: PersistedSelectionHint;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'blocked-unresolved';
      readonly client: SharedClientIdentity | null;
      readonly hint: PersistedSelectionHint;
      readonly fingerprint: string;
    };

const REHYDRATED_CLASSIFICATION_FIELDS = {
  'full-pair': {
    kind: 'consumed',
    client: 'consumed',
    matterId: 'consumed',
    hint: 'hint-only',
    fingerprint: 'consumed',
  },
  'matter-only': {
    kind: 'consumed',
    matterId: 'consumed',
    hint: 'hint-only',
    fingerprint: 'consumed',
  },
  'all-matters': {
    kind: 'consumed',
    client: 'consumed',
    hint: 'hint-only',
    fingerprint: 'consumed',
  },
  'blocked-unresolved': {
    kind: 'consumed',
    client: 'consumed',
    hint: 'hint-only',
    fingerprint: 'consumed',
  },
} satisfies {
  [Kind in RehydratedClassification['kind']]: Record<
    keyof Extract<RehydratedClassification, { kind: Kind }>,
    FieldTreatment
  >;
};
void REHYDRATED_CLASSIFICATION_FIELDS;

interface RehydrationSealPayload {
  readonly input: RehydratedSelectionInput;
  readonly classification: RehydratedClassification;
  readonly issuedAtSelectionRevision: number;
}

const sealedMatterScopeRequests = new WeakMap<
  SealedMatterScopeSelection,
  MatterSealPayload
>();
const sealedClientSelections = new WeakMap<
  SealedClientSelectionClassification,
  ClientSealPayload
>();
const sealedRehydratedSelections = new WeakMap<
  SealedRehydratedSelectionClassification,
  RehydrationSealPayload
>();

function createOpaqueSeal<Seal extends object>(handle: Seal): Seal {
  Object.defineProperty(handle, 'toJSON', {
    enumerable: false,
    value: () => {
      throw new Error(
        'Selection authority seals are runtime-only and cannot be serialized.'
      );
    },
  });
  return Object.freeze(handle);
}

function freezeScope(scope: MatterScopeSelection): MatterScopeSelection {
  switch (scope.kind) {
    case 'matter':
      return Object.freeze({ kind: 'matter', matterId: scope.matterId });
    case 'matter-only':
      return Object.freeze({ kind: 'matter-only', matterId: scope.matterId });
    case 'all-matters':
      return Object.freeze({ kind: 'all-matters' });
    case 'blocked-unresolved':
      return Object.freeze({ kind: 'blocked-unresolved' });
  }
}

function projectedFollowerValue(scope: MatterScopeSelection): string | null {
  switch (scope.kind) {
    case 'matter':
    case 'matter-only':
      return scope.matterId;
    case 'all-matters':
    case 'blocked-unresolved':
      return null;
  }
}

function followerStatusFor(scope: MatterScopeSelection): FollowerStatus {
  return useMatterStore.getState().activeMatterId ===
    projectedFollowerValue(scope)
    ? 'converged'
    : 'stale';
}

let matterDataFingerprint = '';
let stopMatterLivenessSubscription: (() => void) | null = null;

function selectionAuthorityEnabled(): boolean {
  const enabled = isFlagEnabled('selection-authority-boot-gate');
  if (!enabled) {
    authorityBootValidated = false;
    stopMatterLivenessSubscription?.();
    stopMatterLivenessSubscription = null;
  } else {
    ensureMatterLivenessSubscription();
  }
  return enabled;
}

let sourceBasisFingerprint: string | null = null;
let reconciliationPending = false;
let failedReconciliationAttempts = 0;
const MAX_RECONCILIATION_RETRIES = 3;
let authorityBootValidated = false;

function applyFollowerProjection(projection: string | null): void {
  // The only production call site that writes the legacy follower.
  useMatterStore.getState().setActiveMatter(projection);
}

function updateFollowerStatus(): void {
  const state = useClientContextStore.getState();
  const followerStatus = followerStatusFor(state.scope);
  if (state.followerStatus === followerStatus) return;
  try {
    clientContextStore.setState({ followerStatus });
  } catch (error) {
    void error;
  }
}

function reconcileFollower(): void {
  reconciliationPending = false;
  if (!selectionAuthorityEnabled()) return;
  const source = useClientContextStore.getState();
  try {
    applyFollowerProjection(projectedFollowerValue(source.scope));
  } catch (error) {
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

function scheduleFollowerReconciliation(delayMs = 0): void {
  if (reconciliationPending) return;
  reconciliationPending = true;
  setTimeout(reconcileFollower, delayMs);
}

function hintForSelection(
  client: SharedClientIdentity | null,
  scope: MatterScopeSelection,
  source:
    | 'specific-matter'
    | 'shared-client'
    | 'explicit-all-matters'
    | 'blocked/refused'
): PersistedSelectionHint {
  switch (source) {
    case 'specific-matter':
      if (scope.kind !== 'matter' && scope.kind !== 'matter-only') {
        return assertNever(scope.kind as never);
      }
      return Object.freeze({
        version: 1,
        source,
        matterId: scope.matterId,
        ...(client ? { client } : {}),
      });
    case 'shared-client':
      if (!client) return assertNever(client as never);
      return Object.freeze({ version: 1, source, client });
    case 'explicit-all-matters':
      return Object.freeze({
        version: 1,
        source,
        ...(client ? { client } : {}),
      });
    case 'blocked/refused':
      return Object.freeze({
        version: 1,
        source,
        ...(scope.kind === 'matter' || scope.kind === 'matter-only'
          ? { matterId: scope.matterId }
          : {}),
        ...(client ? { client } : {}),
      });
  }
}

let writeSourceSelection: (
  client: SharedClientIdentity | null,
  scope: MatterScopeSelection,
  hint: PersistedSelectionHint,
  basisFingerprint: string | null
) => void;

const bootScope = freezeScope({ kind: 'all-matters' });
const bootHint = hintForSelection(null, bootScope, 'explicit-all-matters');

const clientContextStore = create<ClientContextState>()((set) => {
  writeSourceSelection = (client, scope, hint, basisFingerprint) => {
    if (scope.kind === 'blocked-unresolved' && !selectionAuthorityEnabled())
      return;
    const nextScope = freezeScope(scope);
    sourceBasisFingerprint = basisFingerprint;
    failedReconciliationAttempts = 0;
    try {
      set((state) => ({
        client,
        scope: nextScope,
        followerStatus: followerStatusFor(nextScope),
        selectionRevision: state.selectionRevision + 1,
        persistenceHint: hint,
      }));
    } catch (error) {
      void error;
    } finally {
      scheduleFollowerReconciliation();
    }
  };
  return {
    client: null,
    scope: bootScope,
    followerStatus: 'converged',
    selectionRevision: 0,
    persistenceHint: bootHint,
  };
});

// Declared here — immediately after the underlying store is created and BEFORE
// any code that can run during module evaluation (notably the
// `registerSelectionWriterBridge(...)` call further down, which synchronously
// flushes a queued rehydration when `matterStore` hydrated persisted data with
// the boot gate on). Keeping this binding above that flush is load-bearing:
// the rehydration path reads `useClientContextStore.getState()`, so a
// bottom-of-file declaration left it in the temporal dead zone and threw
// `Cannot access 'useClientContextStore' before initialization` at boot — in
// dev AND in the production bundle — whenever a returning user booted with the
// flag on. Do not move it back below the bridge registration.
export const useClientContextStore = Object.assign(
  <Selection>(selector: (state: ClientContextState) => Selection): Selection =>
    clientContextStore(selector),
  {
    getState: clientContextStore.getState,
    subscribe: clientContextStore.subscribe,
  }
);

function writeBlockedSourceSelection(
  client: SharedClientIdentity | null
): void {
  if (!selectionAuthorityEnabled()) return;
  const scope = freezeScope({ kind: 'blocked-unresolved' });
  writeSourceSelection(
    client,
    scope,
    hintForSelection(client, scope, 'blocked/refused'),
    null
  );
}

function writeLegacyClient(client: SharedClientIdentity | null): void {
  clientContextStore.setState({
    client: client ? normalizeLegacyClient(client) : null,
  });
}

function isClientLive(client: SharedClientIdentity): boolean {
  const classification = resolveCanonicalHouseholdClassification(client);
  return classification.client !== null;
}

function decodePersistedHint(value: unknown): PersistedSelectionHint | null {
  if (!isRecord(value) || value['version'] !== 1) return null;
  const source = value['source'];
  if (source === 'specific-matter') {
    const matterId = normalizeHouseholdId(value['matterId']);
    if (!matterId) return null;
    const client =
      value['client'] === undefined
        ? null
        : normalizeClientInput(value['client']);
    if (value['client'] !== undefined && !client) return null;
    return Object.freeze({
      version: 1,
      source,
      matterId,
      ...(client ? { client } : {}),
    });
  }
  if (source === 'shared-client') {
    const client = normalizeClientInput(value['client']);
    return client ? Object.freeze({ version: 1, source, client }) : null;
  }
  if (source === 'explicit-all-matters') {
    const client =
      value['client'] === undefined
        ? null
        : normalizeClientInput(value['client']);
    if (value['client'] !== undefined && !client) return null;
    return Object.freeze({ version: 1, source, ...(client ? { client } : {}) });
  }
  if (source === 'blocked/refused') {
    const matterId =
      value['matterId'] === undefined
        ? null
        : normalizeHouseholdId(value['matterId']);
    const client =
      value['client'] === undefined
        ? null
        : normalizeClientInput(value['client']);
    if (value['matterId'] !== undefined && !matterId) return null;
    if (value['client'] !== undefined && !client) return null;
    return Object.freeze({
      version: 1,
      source,
      ...(matterId ? { matterId } : {}),
      ...(client ? { client } : {}),
    });
  }
  return null;
}

function blockedRehydrationHint(): PersistedSelectionHint {
  return Object.freeze({ version: 1, source: 'blocked/refused' });
}

function classifyRehydration(input: unknown): RehydratedClassification {
  if (
    !isRecord(input) ||
    (input['kind'] !== 'legacy-follower' && input['kind'] !== 'persisted-hint')
  ) {
    return Object.freeze({
      kind: 'blocked-unresolved',
      client: null,
      hint: blockedRehydrationHint(),
      fingerprint: JSON.stringify({ source: 'invalid-rehydration-input' }),
    });
  }
  const normalizedInput = input as unknown as RehydratedSelectionInput;
  switch (normalizedInput.kind) {
    case 'legacy-follower': {
      if (normalizedInput.activeMatterId === null) {
        const hint = Object.freeze({
          version: 1,
          source: 'explicit-all-matters',
        }) satisfies PersistedSelectionHint;
        return Object.freeze({
          kind: 'all-matters',
          client: null,
          hint,
          fingerprint: JSON.stringify({
            source: 'legacy-follower',
            value: null,
          }),
        });
      }
      const matterId = normalizeHouseholdId(normalizedInput.activeMatterId);
      const matter = matterId ? liveMatter(matterId) : null;
      if (matter && matterId) {
        const hint = Object.freeze({
          version: 1,
          source: 'specific-matter',
          matterId,
        }) satisfies PersistedSelectionHint;
        return Object.freeze({
          kind: 'matter-only',
          matterId,
          hint,
          fingerprint: JSON.stringify({ source: 'legacy-follower', matterId }),
        });
      }
      return Object.freeze({
        kind: 'blocked-unresolved',
        client: null,
        hint: blockedRehydrationHint(),
        fingerprint: JSON.stringify({
          source: 'legacy-follower',
          state: 'invalid',
        }),
      });
    }
    case 'persisted-hint': {
      const hint = decodePersistedHint(normalizedInput.value);
      if (!hint) {
        return Object.freeze({
          kind: 'blocked-unresolved',
          client: null,
          hint: blockedRehydrationHint(),
          fingerprint: JSON.stringify({
            source: 'persisted-hint',
            state: 'corrupt',
          }),
        });
      }
      switch (hint.source) {
        case 'specific-matter': {
          const matter = liveMatter(hint.matterId);
          if (!matter) {
            return Object.freeze({
              kind: 'blocked-unresolved',
              client: null,
              hint: blockedRehydrationHint(),
              fingerprint: JSON.stringify({ hint, state: 'matter-invalid' }),
            });
          }
          if (
            hint.client &&
            !providerDirectoryAvailable(hint.client.provider)
          ) {
            return Object.freeze({
              kind: 'blocked-unresolved',
              client: null,
              hint,
              fingerprint: JSON.stringify({
                hint,
                state: 'provider-directory-unavailable',
              }),
            });
          }
          if (!hint.client) {
            return Object.freeze({
              kind: 'matter-only',
              matterId: matter.id,
              hint,
              fingerprint: JSON.stringify({ hint, state: 'live-matter-only' }),
            });
          }
          const pair = resolveCanonicalHouseholdClassification(hint.client);
          if (
            pair.kind === 'exactly-one-live' &&
            pair.liveMatterIds[0] === matter.id
          ) {
            return Object.freeze({
              kind: 'full-pair',
              client: pair.client ?? hint.client,
              matterId: matter.id,
              hint,
              fingerprint: JSON.stringify({ hint, pair: pair.fingerprint }),
            });
          }
          return Object.freeze({
            kind: 'blocked-unresolved',
            client: pair.client,
            hint: blockedRehydrationHint(),
            fingerprint: JSON.stringify({ hint, pair: pair.fingerprint }),
          });
        }
        case 'shared-client': {
          if (!providerDirectoryAvailable(hint.client.provider)) {
            return Object.freeze({
              kind: 'blocked-unresolved',
              client: null,
              hint,
              fingerprint: JSON.stringify({
                hint,
                state: 'provider-directory-unavailable',
              }),
            });
          }
          const classified = classifyClientSelection(hint.client);
          if (classified.kind === 'full-pair') {
            return Object.freeze({
              kind: 'full-pair',
              client: classified.client,
              matterId: classified.matterId,
              hint,
              fingerprint: classified.fingerprint,
            });
          }
          return Object.freeze({
            kind: 'blocked-unresolved',
            client: null,
            hint: blockedRehydrationHint(),
            fingerprint: classified.fingerprint,
          });
        }
        case 'explicit-all-matters': {
          if (
            hint.client &&
            !providerDirectoryAvailable(hint.client.provider)
          ) {
            return Object.freeze({
              kind: 'all-matters',
              client: null,
              hint,
              fingerprint: JSON.stringify({
                hint,
                state: 'provider-directory-unavailable',
              }),
            });
          }
          const client =
            hint.client && isClientLive(hint.client) ? hint.client : null;
          return Object.freeze({
            kind: 'all-matters',
            client,
            hint: Object.freeze({
              version: 1,
              source: 'explicit-all-matters',
              ...(client ? { client } : {}),
            }),
            fingerprint: JSON.stringify({ hint, clientLive: client !== null }),
          });
        }
        case 'blocked/refused': {
          const client =
            hint.client && isClientLive(hint.client) ? hint.client : null;
          return Object.freeze({
            kind: 'blocked-unresolved',
            client,
            hint: Object.freeze({
              version: 1,
              source: 'blocked/refused',
              ...(hint.matterId ? { matterId: hint.matterId } : {}),
              ...(client ? { client } : {}),
            }),
            fingerprint: JSON.stringify({ hint, clientLive: client !== null }),
          });
        }
      }
    }
  }
}

function sameClassificationFingerprint(
  left: { readonly kind: string; readonly fingerprint: string },
  right: { readonly kind: string; readonly fingerprint: string }
): boolean {
  return left.kind === right.kind && left.fingerprint === right.fingerprint;
}

/** Total issuer: every specific-matter value returns one opaque sealed classification. */
export function issueMatterScopeSelection(
  matterId: string
): SealedMatterScopeSelection {
  ensureAuthorityBootValidated();
  const input = Object.freeze({ matterId });
  const classification = classifyMatterSelection(input);
  const request = createOpaqueSeal({} as SealedMatterScopeSelection);
  sealedMatterScopeRequests.set(
    request,
    Object.freeze({
      intent: 'specific-matter',
      input,
      classification,
      issuedAtSelectionRevision:
        useClientContextStore.getState().selectionRevision,
    })
  );
  return request;
}

export function issueAllMattersScopeSelection(): SealedMatterScopeSelection {
  ensureAuthorityBootValidated();
  const request = createOpaqueSeal({} as SealedMatterScopeSelection);
  sealedMatterScopeRequests.set(
    request,
    Object.freeze({
      intent: 'explicit-all-matters',
      issuedAtSelectionRevision:
        useClientContextStore.getState().selectionRevision,
    })
  );
  return request;
}

export const sealAllMattersScopeSelection = issueAllMattersScopeSelection;

/** Compatibility alias now delegates to the total matter classifier and never returns null. */
export function sealMatterScopeSelection(identity: {
  readonly matterId: string;
}): SealedMatterScopeSelection {
  return issueMatterScopeSelection(identity.matterId);
}

/** Total client-intent issuer. The caller cannot name an arm or matter id. */
export function issueSharedClientSelection(
  input: SharedClientSelectionInput
): SealedClientSelectionClassification {
  ensureAuthorityBootValidated();
  const classification = classifyClientSelection(input);
  const request = createOpaqueSeal({} as SealedClientSelectionClassification);
  sealedClientSelections.set(
    request,
    Object.freeze({
      input,
      classification,
      issuedAtSelectionRevision:
        useClientContextStore.getState().selectionRevision,
    })
  );
  return request;
}

/** Compatibility alias: old callers supplied a pair, but the classifier ignores the claimed matter. */
export function sealResolvedClientBoundary(identity: {
  readonly householdRef: string;
  readonly displayName?: string;
}): SealedClientSelectionClassification {
  return issueSharedClientSelection({
    provider: 'wealthbox',
    householdId: identity.householdRef,
    displayName: identity.displayName ?? identity.householdRef,
  });
}

export function issueRehydratedSelection(
  input: RehydratedSelectionInput
): SealedRehydratedSelectionClassification {
  const classification = classifyRehydration(input);
  const request = createOpaqueSeal(
    {} as SealedRehydratedSelectionClassification
  );
  sealedRehydratedSelections.set(
    request,
    Object.freeze({
      input,
      classification,
      issuedAtSelectionRevision:
        useClientContextStore.getState().selectionRevision,
    })
  );
  return request;
}

function routeDarkMatterSelection(
  classification: MatterClassification
): MatterScopeSelectionResult {
  switch (classification.kind) {
    case 'full-pair':
    case 'matter-only':
      applyFollowerProjection(classification.matterId);
      return {
        kind: 'routed-dark',
        projectedMatterId: classification.matterId,
      };
    case 'pre-seal-failure':
      return { kind: 'refused', reason: classification.reason };
  }
}

function consumeMatterScopeSelection(
  request: SealedMatterScopeSelection
): MatterScopeSelectionResult {
  const sealed = sealedMatterScopeRequests.get(request);
  if (!sealed || !Object.isFrozen(request)) {
    writeBlockedSourceSelection(useClientContextStore.getState().client);
    return { kind: 'refused', reason: 'unsealed-matter-scope-request' };
  }
  if (sealed.intent === 'explicit-all-matters') {
    if (!selectionAuthorityEnabled()) {
      applyFollowerProjection(null);
      return { kind: 'routed-dark', projectedMatterId: null };
    }
    if (
      sealed.issuedAtSelectionRevision !==
      useClientContextStore.getState().selectionRevision
    ) {
      writeBlockedSourceSelection(useClientContextStore.getState().client);
      return { kind: 'refused', reason: 'stale-matter-scope-request' };
    }
    const client = useClientContextStore.getState().client;
    const scope = freezeScope({ kind: 'all-matters' });
    writeSourceSelection(
      client,
      scope,
      hintForSelection(client, scope, 'explicit-all-matters'),
      null
    );
    return { kind: 'selected', client, scope };
  }
  const current = classifyMatterSelection(
    sealed.input ?? { matterId: undefined }
  );
  if (
    !sealed.classification ||
    sealed.issuedAtSelectionRevision !==
      useClientContextStore.getState().selectionRevision ||
    !sameClassificationFingerprint(sealed.classification, current)
  ) {
    writeBlockedSourceSelection(useClientContextStore.getState().client);
    return { kind: 'refused', reason: 'stale-matter-scope-request' };
  }
  if (!selectionAuthorityEnabled()) return routeDarkMatterSelection(current);
  switch (current.kind) {
    case 'pre-seal-failure':
      writeBlockedSourceSelection(null);
      return { kind: 'refused', reason: current.reason };
    case 'full-pair': {
      const scope = freezeScope({ kind: 'matter', matterId: current.matterId });
      writeSourceSelection(
        current.client,
        scope,
        hintForSelection(current.client, scope, 'specific-matter'),
        current.fingerprint
      );
      return { kind: 'selected', client: current.client, scope };
    }
    case 'matter-only': {
      const scope = freezeScope({
        kind: 'matter-only',
        matterId: current.matterId,
      });
      writeSourceSelection(
        null,
        scope,
        hintForSelection(null, scope, 'specific-matter'),
        current.fingerprint
      );
      return { kind: 'selected', client: null, scope };
    }
  }
}

export function requestMatterScopeSelection(
  request: SealedMatterScopeSelection
): Promise<MatterScopeSelectionResult> {
  try {
    return Promise.resolve(consumeMatterScopeSelection(request));
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

function consumeSharedClientSelection(
  request: SealedClientSelectionClassification
): SelectionResult {
  const sealed = sealedClientSelections.get(request);
  if (!sealed || !Object.isFrozen(request)) {
    writeBlockedSourceSelection(null);
    return { kind: 'refused', reason: 'unsealed-client-boundary' };
  }
  const current = classifyClientSelection(sealed.input);
  if (
    sealed.issuedAtSelectionRevision !==
      useClientContextStore.getState().selectionRevision ||
    !sameClassificationFingerprint(sealed.classification, current)
  ) {
    writeBlockedSourceSelection(useClientContextStore.getState().client);
    return { kind: 'refused', reason: 'stale-client-boundary' };
  }
  if (!selectionAuthorityEnabled()) {
    if (current.client) writeLegacyClient(current.client);
    return current.client
      ? { kind: 'routed-dark', client: current.client }
      : { kind: 'refused', reason: 'invalid-client-boundary' };
  }
  switch (current.kind) {
    case 'full-pair': {
      const scope = freezeScope({ kind: 'matter', matterId: current.matterId });
      writeSourceSelection(
        current.client,
        scope,
        hintForSelection(current.client, scope, 'shared-client'),
        current.fingerprint
      );
      return { kind: 'selected', client: current.client };
    }
    case 'blocked-unresolved':
      writeBlockedSourceSelection(current.client);
      return current.client
        ? { kind: 'selected', client: current.client }
        : { kind: 'refused', reason: 'invalid-client-boundary' };
  }
}

export function requestSharedClientSelection(
  request: SealedClientSelectionClassification
): Promise<SelectionResult> {
  try {
    return Promise.resolve(consumeSharedClientSelection(request));
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export function requestClearClientSelection(): SelectionResult {
  if (!selectionAuthorityEnabled()) {
    writeLegacyClient(null);
    return { kind: 'routed-dark', client: null };
  }
  ensureAuthorityBootValidated();
  const source = useClientContextStore.getState();
  const hint =
    source.scope.kind === 'matter' || source.scope.kind === 'matter-only'
      ? hintForSelection(null, source.scope, 'specific-matter')
      : source.scope.kind === 'all-matters'
        ? hintForSelection(null, source.scope, 'explicit-all-matters')
        : hintForSelection(null, source.scope, 'blocked/refused');
  writeSourceSelection(null, source.scope, hint, sourceBasisFingerprint);
  return { kind: 'selected', client: null };
}

function consumeRehydratedSelection(
  request: SealedRehydratedSelectionClassification
): RehydratedSelectionResult {
  const sealed = sealedRehydratedSelections.get(request);
  if (!sealed || !Object.isFrozen(request)) {
    writeBlockedSourceSelection(null);
    return { kind: 'refused', reason: 'unsealed-rehydration-request' };
  }
  if (!selectionAuthorityEnabled()) {
    return { kind: 'refused', reason: 'selection-authority-disabled' };
  }
  const current = classifyRehydration(sealed.input);
  if (
    sealed.issuedAtSelectionRevision !==
      useClientContextStore.getState().selectionRevision ||
    !sameClassificationFingerprint(sealed.classification, current)
  ) {
    writeBlockedSourceSelection(null);
    return { kind: 'refused', reason: 'stale-rehydration-request' };
  }
  authorityBootValidated = true;
  switch (current.kind) {
    case 'full-pair': {
      const scope = freezeScope({ kind: 'matter', matterId: current.matterId });
      writeSourceSelection(
        current.client,
        scope,
        current.hint,
        current.fingerprint
      );
      return { kind: 'selected', client: current.client, scope };
    }
    case 'matter-only': {
      const scope = freezeScope({
        kind: 'matter-only',
        matterId: current.matterId,
      });
      writeSourceSelection(null, scope, current.hint, current.fingerprint);
      return { kind: 'selected', client: null, scope };
    }
    case 'all-matters': {
      const scope = freezeScope({ kind: 'all-matters' });
      writeSourceSelection(
        current.client,
        scope,
        current.hint,
        current.fingerprint
      );
      return { kind: 'selected', client: current.client, scope };
    }
    case 'blocked-unresolved': {
      const scope = freezeScope({ kind: 'blocked-unresolved' });
      writeSourceSelection(
        current.client,
        scope,
        current.hint,
        current.fingerprint
      );
      return { kind: 'selected', client: current.client, scope };
    }
  }
}

export function requestRehydratedSelection(
  request: SealedRehydratedSelectionClassification
): Promise<RehydratedSelectionResult> {
  try {
    return Promise.resolve(consumeRehydratedSelection(request));
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

function ensureAuthorityBootValidated(): void {
  if (!selectionAuthorityEnabled() || authorityBootValidated) return;
  authorityBootValidated = true;
  const request = issueRehydratedSelection({
    kind: 'legacy-follower',
    activeMatterId: useMatterStore.getState().activeMatterId,
  });
  consumeRehydratedSelection(request);
}

function revalidateCurrentSelection(): void {
  if (!selectionAuthorityEnabled() || !authorityBootValidated) return;
  const source = useClientContextStore.getState();
  switch (source.scope.kind) {
    case 'matter': {
      if (!source.client) {
        if (!liveMatter(source.scope.matterId))
          writeBlockedSourceSelection(null);
        return;
      }
      const pair = resolveCanonicalHouseholdClassification(source.client);
      if (
        pair.kind !== 'exactly-one-live' ||
        pair.liveMatterIds[0] !== source.scope.matterId
      ) {
        writeBlockedSourceSelection(pair.client);
      }
      return;
    }
    case 'matter-only': {
      const current = classifyMatterSelection({
        matterId: source.scope.matterId,
      });
      if (
        current.kind !== 'matter-only' ||
        sourceBasisFingerprint === null ||
        current.fingerprint !== sourceBasisFingerprint
      ) {
        writeBlockedSourceSelection(null);
      }
      return;
    }
    case 'all-matters':
      if (
        !source.client &&
        source.persistenceHint.source === 'explicit-all-matters' &&
        source.persistenceHint.client
      ) {
        consumeRehydratedSelection(
          issueRehydratedSelection({
            kind: 'persisted-hint',
            value: source.persistenceHint,
          })
        );
        return;
      }
      if (source.client && !isClientLive(source.client)) {
        writeSourceSelection(
          null,
          source.scope,
          hintForSelection(null, source.scope, 'explicit-all-matters'),
          null
        );
      }
      return;
    case 'blocked-unresolved':
      if (
        source.persistenceHint.source === 'shared-client' ||
        (source.persistenceHint.source === 'specific-matter' &&
          source.persistenceHint.client)
      ) {
        consumeRehydratedSelection(
          issueRehydratedSelection({
            kind: 'persisted-hint',
            value: source.persistenceHint,
          })
        );
        return;
      }
      if (source.client && !isClientLive(source.client)) {
        writeBlockedSourceSelection(null);
      }
      return;
  }
}

function matterLivenessFingerprint(matters: readonly Matter[]): string {
  return JSON.stringify(
    matters.map((matter) => ({
      id: matter.id,
      archived: matter.archived === true,
      crmHouseholdKeys: [...(matter.crmHouseholdKeys ?? [])],
    }))
  );
}

function ensureMatterLivenessSubscription(): void {
  if (stopMatterLivenessSubscription) return;
  matterDataFingerprint = matterLivenessFingerprint(
    useMatterStore.getState().matters
  );
  stopMatterLivenessSubscription = useMatterStore.subscribe((state) => {
    const nextFingerprint = matterLivenessFingerprint(state.matters);
    if (nextFingerprint === matterDataFingerprint) return;
    matterDataFingerprint = nextFingerprint;
    classifierDataRevision += 1;
    revalidateCurrentSelection();
  });
}

registerSelectionWriterBridge({
  rehydrate: (input) => {
    if (!selectionAuthorityEnabled()) return;
    authorityBootValidated = true;
    consumeRehydratedSelection(issueRehydratedSelection(input));
  },
  readPersistenceHint: () => useClientContextStore.getState().persistenceHint,
});

// This is presentation synchronization only. Native Rust validates every pair
// against SQLCipher and keeps the actual lease private.
installNativeActiveClientContextBridge({
  getState: useClientContextStore.getState,
  subscribe: useClientContextStore.subscribe,
  clearBrowserSelection: () => {
    requestClearClientSelection();
  },
});

export function bootstrapSelectionAuthorityFromPersistedFollower(): MatterScopeSelection {
  ensureAuthorityBootValidated();
  return useClientContextStore.getState().scope;
}

/** Test/lifecycle seam: re-enter saved data through the one total classifier. */
export function rehydrateSelectionHint(input: RehydratedSelectionInput): void {
  rehydrateSelectionFromData(input);
}

export function readSharedClientContext<Context>(
  adapter: SharedClientContextAdapter<Context>
): Context {
  return adapter.derive(useClientContextStore.getState().client);
}

export function readAuthoritativeMatterScope(): MatterScopeSelection {
  ensureAuthorityBootValidated();
  return useClientContextStore.getState().scope;
}
