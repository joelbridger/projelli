import type { AskClientUseAccess } from './contracts';

/**
 * The single shared-client binding, OWNED by the foundation.
 *
 * This module is intentionally NOT re-exported from the public `@/features/ask`
 * surface. An ordinary consumer cannot obtain a `AskSharedClientOwner` handle,
 * so it cannot set, replace, or freeze the client reader — there is no free
 * `bind(access)` on any public surface. Only the real shared-client owner wiring
 * (co-located inside this feature; absent at the current base) and the
 * foundation's own internal tests can establish the binding. The feature-
 * boundary guard forbids any outside module from deep-importing this file.
 *
 * When no owner is established, every client-scoped use-time doorway fails
 * closed. This is the correct base state: the real owner is absent.
 */
let boundAccess: AskClientUseAccess<unknown, unknown> | null = null;
let activeOwner: object | null = null;

export interface AskSharedClientOwner<ClientReference, MeetingReference> {
  /** Point the foundation at the live shared-client access. */
  readonly bind: (
    access: AskClientUseAccess<ClientReference, MeetingReference>
  ) => void;
  /** Detach; client-scoped doorways fail closed again. */
  readonly release: () => void;
}

/**
 * Create the shared-client owner capability. Off-barrel and boundary-guarded:
 * only feature-internal code can call it. The returned handle is the ONLY way to
 * establish or change the binding. There is no standalone `bind(access)`.
 */
export function createAskSharedClientOwner<
  ClientReference,
  MeetingReference,
>(): AskSharedClientOwner<ClientReference, MeetingReference> {
  const token = {};
  return {
    bind: (access) => {
      // Establish-once at RUNTIME (does not depend on the import-boundary guard):
      // while one owner holds the binding, a second `bind` is refused. So even a
      // caller that reached this capability through a boundary blind spot cannot
      // overwrite the active owner's reader to restore a stale client. Only the
      // holding owner can `release`, and only then may a new owner establish.
      if (activeOwner !== null && activeOwner !== token) {
        throw new Error(
          'Ask shared-client owner is already established; release it first.'
        );
      }
      activeOwner = token;
      boundAccess = access as unknown as AskClientUseAccess<unknown, unknown>;
    },
    release: () => {
      if (activeOwner === token) {
        activeOwner = null;
        boundAccess = null;
      }
    },
  };
}

/** Internal: the live bound access for the foundation's use-time guards. */
export function readOwnerBoundAccess<ClientReference, MeetingReference>():
  | AskClientUseAccess<ClientReference, MeetingReference>
  | null {
  return boundAccess as unknown as AskClientUseAccess<
    ClientReference,
    MeetingReference
  > | null;
}

/** Internal: is a shared-client owner currently established? */
export function askSharedClientOwnerEstablished(): boolean {
  return activeOwner !== null && boundAccess !== null;
}
