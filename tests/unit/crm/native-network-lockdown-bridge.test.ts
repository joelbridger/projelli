import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
  setOfflineMode: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@/platform/privacy/offlineMode', () => ({
  setOfflineMode: controls.setOfflineMode,
}));

describe('native Network Lockdown bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    controls.setOfflineMode.mockReset();
  });

  it('keeps CRM blocked until native confirms that lockdown reopened', async () => {
    let confirmNative: (() => void) | undefined;
    controls.setOfflineMode.mockImplementation(
      () => new Promise<void>((resolve) => { confirmNative = resolve; }),
    );
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);
    expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
      blocked: true,
      pending: true,
      error: null,
    });

    await vi.waitFor(() => {
      expect(controls.setOfflineMode).toHaveBeenCalledWith(false);
    });
    confirmNative?.();
    await vi.waitFor(() => {
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        blocked: false,
        pending: false,
        error: null,
      });
    });
  });

  it('stays blocked and shows an honest error when reopening fails', async () => {
    controls.setOfflineMode.mockRejectedValue(new Error('policy file is read-only'));
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);

    await vi.waitFor(() => {
      const state = bridge.getNativeNetworkLockdownBridgeState();
      expect(state.blocked).toBe(true);
      expect(state.pending).toBe(false);
      expect(state.error).toMatch(/still on/i);
    });
  });

  it('retries a failed release and unblocks after native confirms success', async () => {
    controls.setOfflineMode
      .mockRejectedValueOnce(new Error('policy file is temporarily locked'))
      .mockResolvedValueOnce(undefined);
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);
    await vi.waitFor(() => {
      expect(bridge.getNativeNetworkLockdownBridgeState().error).toMatch(/still on/i);
    });

    bridge.retryNativeNetworkLockdown();

    await vi.waitFor(() => {
      expect(controls.setOfflineMode.mock.calls.map(([value]) => value)).toEqual([
        false,
        false,
      ]);
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        blocked: false,
        pending: false,
        error: null,
      });
    });
  });

  it('serializes quick choices so an older unlock cannot arrive last', async () => {
    let finishFirst: (() => void) | undefined;
    controls.setOfflineMode
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { finishFirst = resolve; }),
      )
      .mockResolvedValueOnce(undefined);
    const bridge = await import('@/platform/privacy/nativeNetworkLockdownBridge');

    bridge.requestNativeNetworkLockdown(false);
    bridge.requestNativeNetworkLockdown(true);
    await vi.waitFor(() => {
      expect(controls.setOfflineMode).toHaveBeenCalledWith(false);
    });
    finishFirst?.();

    await vi.waitFor(() => {
      expect(controls.setOfflineMode.mock.calls.map(([value]) => value)).toEqual([
        false,
        true,
      ]);
      expect(bridge.getNativeNetworkLockdownBridgeState()).toMatchObject({
        blocked: true,
        pending: false,
        error: null,
      });
    });
  });
});
