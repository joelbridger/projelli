import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: tauri.invoke,
}));

function policyStatus(offlineMode: boolean, generation: number) {
  return {
    offlineMode,
    generation,
    hydrated: true,
    loadError: null,
  };
}

describe('native Network Lockdown bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    tauri.invoke.mockReset();
  });

  it('restart: stays unknown and paused until the native guard reports its enforced state', async () => {
    let confirmNative: (() => void) | undefined;
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'set_offline_mode') {
        return new Promise<void>((resolve) => { confirmNative = resolve; });
      }
      if (command === 'network_policy_status') return policyStatus(false, 1);
      throw new Error(`Unexpected command: ${command}`);
    });
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
      status: 'unknown',
      blocked: true,
      pending: false,
    });

    bridge.requestNativeNetworkLockdown(false);
    expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
      status: 'unknown',
      blocked: true,
      pending: true,
      error: null,
    });

    await vi.waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('set_offline_mode', { enabled: false });
    });
    confirmNative?.();
    await vi.waitFor(() => {
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        status: 'off',
        blocked: false,
        pending: false,
        error: null,
      });
    });
  });

  it('failure: displays the enforced native state instead of the rejected choice', async () => {
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'set_offline_mode') {
        return Promise.reject(new Error('policy file is read-only'));
      }
      if (command === 'network_policy_status') return policyStatus(true, 2);
      throw new Error(`Unexpected command: ${command}`);
    });
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);

    await vi.waitFor(() => {
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        status: 'on',
        blocked: true,
        pending: false,
      });
      expect(bridge.getNativeNetworkLockdownBridgeState().error).toMatch(/still on/i);
    });
  });

  it('BUG-21 RELEASE: retries a failed release and reopens without a restart', async () => {
    let setAttempts = 0;
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'set_offline_mode') {
        setAttempts += 1;
        return setAttempts === 1
          ? Promise.reject(new Error('policy file is temporarily locked'))
          : Promise.resolve();
      }
      if (command === 'network_policy_status') {
        return policyStatus(setAttempts < 2, setAttempts);
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);
    await vi.waitFor(() => {
      expect(bridge.getNativeNetworkLockdownBridgeState().error).toMatch(/still on/i);
    });

    bridge.retryNativeNetworkLockdown();

    await vi.waitFor(() => {
      expect(setAttempts).toBe(2);
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        status: 'off',
        blocked: false,
        pending: false,
        error: null,
      });
    });
  });

  it('serializes quick choices and ends on the last native enforced value', async () => {
    let finishFirst: (() => void) | undefined;
    let setAttempts = 0;
    tauri.invoke.mockImplementation((command: string, args?: { enabled?: boolean }) => {
      if (command === 'set_offline_mode') {
        setAttempts += 1;
        if (setAttempts === 1) {
          return new Promise<void>((resolve) => { finishFirst = resolve; });
        }
        return Promise.resolve();
      }
      if (command === 'network_policy_status') {
        return policyStatus(args?.enabled ?? setAttempts > 1, setAttempts);
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);
    bridge.requestNativeNetworkLockdown(true);
    await vi.waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('set_offline_mode', { enabled: false });
    });
    finishFirst?.();

    await vi.waitFor(() => {
      expect(
        tauri.invoke.mock.calls
          .filter(([command]) => command === 'set_offline_mode')
          .map(([, args]) => args),
      ).toEqual([{ enabled: false }, { enabled: true }]);
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        status: 'on',
        blocked: true,
        pending: false,
        error: null,
      });
    });
  });
});
