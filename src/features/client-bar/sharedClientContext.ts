import {
  useClientContextStore,
  type SharedClientIdentity,
} from '@/platform/client-context';

/**
 * The public, read-only view of the ONE active shared client, published by the
 * client bar. This is the single true source of the client the advisor is
 * working on — CRM, Ask, Meetings, and the shell bar all read this same
 * selection. It is intentionally a projection of the shared client store
 * (`@/platform/client-context`), never a parallel copy: switching or clearing
 * the client here is the same switch every other tool observes.
 *
 * `householdId` is authoritative; the remaining fields are display hints.
 */
export interface SharedClientContext {
  readonly householdId: string;
  readonly displayName: string;
  readonly primaryPeople?: readonly string[];
}

function toSharedClientContext(
  client: SharedClientIdentity | null
): SharedClientContext | null {
  if (!client) return null;
  return client.primaryPeople
    ? {
        householdId: client.householdId,
        displayName: client.displayName,
        primaryPeople: client.primaryPeople,
      }
    : {
        householdId: client.householdId,
        displayName: client.displayName,
      };
}

/**
 * React hook: the current shared client, or `null` for whole-firm. Reactive —
 * it re-renders when the shared selection switches or clears, because it reads
 * the real shared client store rather than a feature-local copy.
 */
export function useSharedClientContext(): SharedClientContext | null {
  return useClientContextStore((state) => toSharedClientContext(state.client));
}

/**
 * Non-React live read of the current shared client. Reads the store at call
 * time (no captured snapshot), so a caller that reads through this always sees
 * the live selection. `null` means whole-firm / no client.
 */
export function readSharedClientContext(): SharedClientContext | null {
  return toSharedClientContext(useClientContextStore.getState().client);
}
