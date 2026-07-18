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
 * and nothing else), the sealed live readers, and the pure identity adapter. It exposes
 * NO way to inject an arbitrary client reader: there is no public `bind(access)`
 * here, and the underlying socket refuses a second binder at runtime
 * (establish-once). An ordinary consumer therefore cannot restore a stale
 * client through this module.
 */
import { useClientContextStore } from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  resolveHouseholdMatterId,
} from '@/features/crm-clients';
import type { ContactRef } from '@/features/crm-contacts';
import type {
  AskClientSnapshot,
  AskClientUseAccess,
  AskOwnerIdentityAdapter,
} from './foundation/contracts';
import { createAskSharedClientOwner } from './foundation/owner';
import { mintAskClientSnapshot } from './foundation/clientSnapshotAuthority';

/**
 * Ask authority is the real CRM ContactRef, never the client-bar household
 * projection. The selected household is only the input to the canonical CRM
 * matter resolver.
 */
type AskClientReference = ContactRef;

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
 * The shared-client revision includes the canonical matter. A household remap
 * therefore invalidates every retained client-scoped handle. Whole-firm
 * (`null`) has no revision.
 */
function revisionOf(householdId: string, matterId: string): string {
  return `${householdId}::${matterId}`;
}

/**
 * Map the live selected household through the canonical CRM matter resolver.
 * Missing and ambiguous links deliberately produce no client authority.
 */
function snapshotFromLiveState(
  client: ReturnType<typeof useClientContextStore.getState>['client'],
  matters: ReturnType<typeof useMatterStore.getState>['matters']
): AskClientSnapshot<ContactRef> | null {
  if (!client) return null;
  const matterId = resolveHouseholdMatterId({ id: client.householdId }, matters);
  if (!matterId) return null;
  const label = client.displayName.trim();
  const contactRef: ContactRef = {
    kind: 'household',
    id: client.householdId,
    matterId,
    ...(label ? { label } : {}),
  };
  return mintAskClientSnapshot({
    contactRef,
    matterId,
    revision: revisionOf(client.householdId, matterId),
  });
}

/** The live snapshot of the current shared client, or `null` for whole-firm. */
export function readAskSharedClientSnapshot(): AskClientSnapshot<ContactRef> | null {
  return snapshotFromLiveState(
    useClientContextStore.getState().client,
    useMatterStore.getState().matters
  );
}

/**
 * Reactive counterpart to the live read. Both the selected household and the
 * matter mapping are read at render time, so an A→B/none switch or a remap
 * produces a new sealed snapshot (or null) immediately.
 */
export function useAskSharedClientSnapshot(): AskClientSnapshot<ContactRef> | null {
  const client = useClientContextStore((state) => state.client);
  const matters = useMatterStore((state) => state.matters);
  return snapshotFromLiveState(client, matters);
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
    (value as ContactRef).kind === 'household' &&
    typeof (value as ContactRef).id === 'string' &&
    (value as ContactRef).id.trim().length > 0 &&
    typeof (value as ContactRef).matterId === 'string' &&
    (value as ContactRef).matterId.trim().length > 0,
  clientMatterId: (reference) => reference.matterId,
  sameClient: (left, right) =>
    left.kind === right.kind &&
    left.id === right.id &&
    left.matterId === right.matterId,
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
