import { create } from 'zustand';

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

interface ClientContextState {
  client: SharedClientIdentity | null;
  setClient: (client: SharedClientIdentity) => void;
  clearClient: () => void;
}

function normalizeClient(client: SharedClientIdentity): SharedClientIdentity {
  const householdId = client.householdId.trim();
  if (!householdId) {
    throw new Error('Shared client context requires a household id.');
  }

  return {
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

/**
 * One in-memory client selection for CRM, Ask, Meetings, and the shell bar.
 * It intentionally is not persisted: a reopened workspace must establish its
 * own valid household selection rather than inheriting a stale client id.
 */
export const useClientContextStore = create<ClientContextState>()((set) => ({
  client: null,
  setClient: (client) => {
    set({ client: normalizeClient(client) });
  },
  clearClient: () => {
    set({ client: null });
  },
}));

/** Read a feature's narrow view without copying client state into that feature. */
export function readSharedClientContext<Context>(
  adapter: SharedClientContextAdapter<Context>
): Context {
  return adapter.derive(useClientContextStore.getState().client);
}
