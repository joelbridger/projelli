/**
 * The REAL shared-client owner wiring for Ask.
 *
 * The Ask foundation ships an owner-only socket (`createAskSharedClientOwner`
 * in `./foundation/owner`) that is deliberately off the public `@/features/ask`
 * surface and boundary-guarded, so no ordinary consumer can set, replace, or
 * freeze the live client reader. Until a real owner establishes the binding,
 * every client-scoped Ask doorway fails closed.
 *
 * This module is that owner. It is co-located inside the Ask feature (the only
 * place allowed to reach the socket), and it binds the socket to the ONE true
 * shared client selection: the shared client store in the PLATFORM layer
 * (`@/platform/client-context`). That is the same store `@/features/client-bar`
 * reads and writes, and that its `useSharedClientContext` publishes — so the
 * client bar and this binding observe the exact same live selection, never a
 * parallel copy. Depending on the platform store (not on the client-bar
 * feature) also keeps the layer DAG intact: a feature may import platform, but
 * not another feature outside the documented allowlist.
 *
 * Because the bound reader consults the live store on every call, a client
 * switch or clear propagates to every use-time Ask guard immediately, and no
 * state resolved under a prior client survives the switch.
 *
 * It exposes only a zero-argument establish doorway (which binds the real store
 * and nothing else) and the pure identity adapter / snapshot mapper. It exposes
 * NO way to inject an arbitrary client reader: there is no public `bind(access)`
 * here, and the underlying socket refuses a second binder at runtime
 * (establish-once). An ordinary consumer therefore cannot restore a stale
 * client through this module.
 */
import {
  useClientContextStore,
  type SharedClientIdentity,
} from '@/platform/client-context';
import type {
  AskClientSnapshot,
  AskClientUseAccess,
  AskOwnerIdentityAdapter,
} from './foundation/contracts';
import { createAskSharedClientOwner } from './foundation/owner';

/**
 * The Ask binding's client reference is the platform shared-client identity —
 * the true source of the active client. `@/features/client-bar` publishes this
 * same identity to consumers as `SharedClientContext` (a structurally identical
 * view of the same store); this wiring binds against the platform type directly
 * so the Ask feature depends only on the platform layer, not on another feature.
 */
type AskClientReference = SharedClientIdentity;

/**
 * This owner owns the CLIENT identity only. There is no meetings owner at this
 * base, so no value is ever a valid meeting reference here and meeting-scoped
 * Ask doorways stay fail-closed (consistent with the Meetings owner being
 * absent). The meeting operations are unreachable placeholders that satisfy the
 * adapter shape; they are never called because `isMeetingReference` is always
 * false.
 */
type NoMeetingReference = never;

/**
 * The shared-client revision for a selection. It bumps whenever the identity
 * content changes, so a scope resolved under one client is refused after the
 * shared selection moves to a different client (or the same household with
 * changed identity). Whole-firm (`null`) has no revision.
 */
function revisionOf(client: AskClientReference): string {
  const people = client.primaryPeople ? [...client.primaryPeople].join('|') : '';
  return `${client.householdId}::${client.displayName}::${people}`;
}

/**
 * Map the live shared client into the exact snapshot the Ask binding needs.
 *
 * Until a dedicated matters owner lands, one household is its own matter scope
 * (`matterId === householdId`). This is the honest minimal mapping from the
 * only real client data available; it is NOT a lookalike CRM/matter owner
 * contract, only the required snapshot fields filled from the shared selection.
 */
export function toAskClientSnapshot(
  client: AskClientReference | null
): AskClientSnapshot<AskClientReference> | null {
  if (!client) return null;
  return {
    contactRef: client,
    matterId: client.householdId,
    revision: revisionOf(client),
  };
}

/** The live snapshot of the current shared client, or `null` for whole-firm. */
export function readAskSharedClientSnapshot(): AskClientSnapshot<AskClientReference> | null {
  return toAskClientSnapshot(useClientContextStore.getState().client);
}

/**
 * The client-identity operations the Ask foundation uses to validate and
 * compare clients. Pure; carries no binding capability.
 */
export const askClientIdentityAdapter: AskOwnerIdentityAdapter<
  AskClientReference,
  NoMeetingReference
> = {
  isClientReference: (value): value is AskClientReference =>
    !!value &&
    typeof value === 'object' &&
    'householdId' in value &&
    typeof (value as { householdId: unknown }).householdId === 'string' &&
    (value as { householdId: string }).householdId.trim().length > 0,
  clientMatterId: (reference) => reference.householdId,
  sameClient: (left, right) => left.householdId === right.householdId,
  isMeetingReference: (_value): _value is NoMeetingReference => false,
  meetingId: () => {
    throw new Error('Ask meetings owner is not bound.');
  },
  meetingMatterId: () => {
    throw new Error('Ask meetings owner is not bound.');
  },
  sameMeeting: () => false,
};

/**
 * The live access the socket binds. `readCurrentClient` reads the shared store
 * at EVERY call (never a captured snapshot), so use-time guards always see the
 * live selection.
 */
const liveAccess: AskClientUseAccess<AskClientReference, NoMeetingReference> = {
  readCurrentClient: () => readAskSharedClientSnapshot(),
  owners: askClientIdentityAdapter,
};

let activeRelease: (() => void) | null = null;

/**
 * Establish the real shared-client owner binding for Ask, wiring the foundation
 * socket to the live shared client selection. Returns a disposer that detaches
 * the binding (after which client-scoped Ask doorways fail closed again).
 *
 * Establish-once: if a binding is already established, the underlying socket
 * throws. This is intentional — it means no second caller can overwrite the
 * live reader to restore a stale client.
 */
export function establishAskSharedClientContext(): () => void {
  const owner = createAskSharedClientOwner<
    AskClientReference,
    NoMeetingReference
  >();
  // Throws 'already established' if another owner already holds the binding.
  owner.bind(liveAccess);
  const release = () => {
    owner.release();
    if (activeRelease === release) activeRelease = null;
  };
  activeRelease = release;
  return release;
}
