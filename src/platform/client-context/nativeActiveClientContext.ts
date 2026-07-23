import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ClientContextState } from './clientContextStore';

export interface NativeActiveClientContextReceipt {
  /** Display status only. It is never native authority. */
  activated: boolean;
  reason?: string | null;
  workspaceRevision: number;
  selectionRevision: number;
}

export interface NativeActiveClientContextStore {
  getState(): ClientContextState;
  subscribe(listener: (state: ClientContextState) => void): () => void;
  clearBrowserSelection(): void;
}

function isSettledFullPair(
  state: ClientContextState
): state is ClientContextState & {
  client: NonNullable<ClientContextState['client']>;
  scope: { readonly kind: 'matter'; readonly matterId: string };
} {
  return state.client !== null && state.scope.kind === 'matter';
}

/**
 * Mirrors browser presentation into the private native context. Calls are
 * serialized so a late activation cannot overtake a later clear. A failed
 * native activation clears the browser selection too; browser state never
 * grants native authority.
 */
export function installNativeActiveClientContextBridge(
  store: NativeActiveClientContextStore
): () => void {
  if (!isTauri()) return () => undefined;

  let disposed = false;
  let queued = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    queued = queued.then(operation, operation);
  };

  const synchronize = (state: ClientContextState) => {
    const expectedRevision = state.selectionRevision;
    if (!isSettledFullPair(state)) {
      enqueue(async () => {
        await invoke<NativeActiveClientContextReceipt>(
          'crm_clear_active_client_context'
        );
      });
      return;
    }
    const { householdId } = state.client;
    const { matterId } = state.scope;
    enqueue(async () => {
      try {
        const receipt = await invoke<NativeActiveClientContextReceipt>(
          'crm_request_active_client',
          {
            householdId,
            matterId,
          }
        );
        if (
          !receipt.activated &&
          !disposed &&
          store.getState().selectionRevision === expectedRevision
        ) {
          store.clearBrowserSelection();
        }
      } catch {
        if (
          !disposed &&
          store.getState().selectionRevision === expectedRevision
        ) {
          store.clearBrowserSelection();
        }
      }
    });
  };

  const unsubscribe = store.subscribe(synchronize);
  synchronize(store.getState());
  const clearForTeardown = () => {
    enqueue(async () => {
      await invoke<NativeActiveClientContextReceipt>(
        'crm_clear_active_client_context'
      );
    });
  };
  window.addEventListener('beforeunload', clearForTeardown);

  return () => {
    disposed = true;
    unsubscribe();
    window.removeEventListener('beforeunload', clearForTeardown);
    clearForTeardown();
  };
}
