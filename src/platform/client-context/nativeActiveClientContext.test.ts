import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientContextState } from './clientContextStore';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { installNativeActiveClientContextBridge } from './nativeActiveClientContext';

function state(
  selectionRevision: number,
  kind: ClientContextState['scope']['kind'],
  pair: { householdId: string; matterId: string } | null = null,
  matterId = 'matter-a'
): ClientContextState {
  return {
    client: pair
      ? {
          provider: 'wealthbox',
          householdId: pair.householdId,
          displayName: pair.householdId,
        }
      : null,
    scope: (() => {
      if (kind === 'matter')
        return { kind, matterId: pair?.matterId ?? matterId };
      if (kind === 'matter-only') return { kind, matterId };
      return { kind } as ClientContextState['scope'];
    })(),
    followerStatus: 'converged',
    selectionRevision,
    persistenceHint: { version: 1, source: 'explicit-all-matters' },
  };
}

function bridgeStore(initial: ClientContextState) {
  let current = initial;
  const listeners = new Set<(next: ClientContextState) => void>();
  const clearBrowserSelection = vi.fn(() => {
    current = state(current.selectionRevision + 1, 'blocked-unresolved');
    for (const listener of listeners) listener(current);
  });
  return {
    store: {
      getState: () => current,
      subscribe: (listener: (next: ClientContextState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      clearBrowserSelection,
    },
    transition(next: ClientContextState) {
      current = next;
      for (const listener of listeners) listener(next);
    },
    clearBrowserSelection,
  };
}

afterEach(() => {
  invoke.mockReset();
});

describe('native active-client bridge', () => {
  it('activates only a settled full pair and clears client-clear, Whole Firm, matter-only, and blocked transitions', async () => {
    invoke.mockResolvedValue({
      activated: true,
      workspaceRevision: 1,
      selectionRevision: 1,
    });
    const fixture = bridgeStore(
      state(0, 'matter', { householdId: 'household-a', matterId: 'matter-a' })
    );
    const stop = installNativeActiveClientContextBridge(fixture.store);

    fixture.transition(state(1, 'matter', null));
    fixture.transition(state(2, 'all-matters'));
    fixture.transition(state(3, 'matter-only'));
    fixture.transition(state(4, 'blocked-unresolved'));

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('crm_request_active_client', {
        householdId: 'household-a',
        matterId: 'matter-a',
      });
    });
    expect(invoke.mock.calls).toEqual([
      [
        'crm_request_active_client',
        { householdId: 'household-a', matterId: 'matter-a' },
      ],
      ['crm_clear_active_client_context'],
      ['crm_clear_active_client_context'],
      ['crm_clear_active_client_context'],
      ['crm_clear_active_client_context'],
    ]);
    stop();
  });

  it('clears an already-live native lease when the renderer explicitly clears its client', async () => {
    invoke.mockResolvedValue({
      activated: true,
      workspaceRevision: 1,
      selectionRevision: 1,
    });
    const fixture = bridgeStore(
      state(0, 'matter', { householdId: 'household-a', matterId: 'matter-a' })
    );
    const stop = installNativeActiveClientContextBridge(fixture.store);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('crm_request_active_client', {
        householdId: 'household-a',
        matterId: 'matter-a',
      });
    });
    fixture.transition(state(1, 'matter', null));
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenLastCalledWith(
        'crm_clear_active_client_context'
      );
    });
    stop();
  });

  it('fails closed after a native refusal and sends the resulting clear natively too', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'crm_request_active_client') {
        return Promise.resolve({
          activated: false,
          reason: 'household-matter-not-exact',
          workspaceRevision: 4,
          selectionRevision: 8,
        });
      }
      return Promise.resolve({
        activated: false,
        reason: 'cleared',
        workspaceRevision: 4,
        selectionRevision: 9,
      });
    });
    const fixture = bridgeStore(state(0, 'all-matters'));
    const stop = installNativeActiveClientContextBridge(fixture.store);
    fixture.transition(
      state(1, 'matter', { householdId: 'household-a', matterId: 'matter-a' })
    );

    await vi.waitFor(() => {
      expect(fixture.clearBrowserSelection).toHaveBeenCalledTimes(1);
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === 'crm_clear_active_client_context'
        ).length
      ).toBeGreaterThanOrEqual(2);
    });
    stop();
  });

  it('sends a native clear when the window begins to close', async () => {
    invoke.mockResolvedValue({
      activated: false,
      reason: 'cleared',
      workspaceRevision: 4,
      selectionRevision: 9,
    });
    const fixture = bridgeStore(state(0, 'all-matters'));
    const stop = installNativeActiveClientContextBridge(fixture.store);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
    stop();
  });
});
