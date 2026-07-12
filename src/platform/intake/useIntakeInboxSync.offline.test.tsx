import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
  isTauri: vi.fn(),
  getStatus: vi.fn(),
  subscribe: vi.fn(),
  granted: vi.fn(),
  getDevice: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: controls.isTauri }));
vi.mock('@/platform/privacy/offlineMode', () => ({
  getNetworkPolicyStatus: controls.getStatus,
  subscribeToOfflineModeChanges: controls.subscribe,
}));
vi.mock('@/platform/firm/deviceKeys', () => ({
  getOrCreateDeviceKeypair: controls.getDevice,
}));
vi.mock('@/platform/firm/FirmApiClient', () => ({
  FirmApiClient: class FirmApiClient {},
}));
vi.mock('./IntakeRelayClient', () => ({
  IntakeRelayClient: class IntakeRelayClient {
    listGrantedIntakes = controls.granted;
  },
}));

import { useFirmStore } from '@/platform/firm/firmStore';
import { useIntakeInboxSync } from './useIntakeInboxSync';

describe('useIntakeInboxSync Offline Mode wiring', () => {
  let onPolicyChange: ((status: { offlineMode: boolean; generation: number }) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    controls.isTauri.mockReturnValue(true);
    controls.getStatus.mockResolvedValue({ offlineMode: false, generation: 1 });
    controls.getDevice.mockResolvedValue({ deviceId: 'device-1' });
    controls.granted.mockResolvedValue({ intakes: [] });
    controls.subscribe.mockImplementation((listener) => {
      onPolicyChange = listener;
      return () => { onPolicyChange = undefined; };
    });
    useFirmStore.setState({ seatToken: 'seat-token', accessToken: 'access-token' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useFirmStore.setState({ seatToken: null, accessToken: null });
  });

  it('stops the relay timer and focus sync immediately when Offline Mode turns on', async () => {
    const { unmount } = renderHook(() => useIntakeInboxSync({
      workspaceService: {} as never,
      intervalMs: 30_000,
    }));

    await act(async () => { await vi.runAllTicks(); });
    expect(controls.granted).toHaveBeenCalledTimes(1);
    expect(onPolicyChange).toBeDefined();

    act(() => onPolicyChange?.({ offlineMode: true, generation: 2 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
      window.dispatchEvent(new Event('focus'));
      await vi.runAllTicks();
    });

    expect(controls.granted).toHaveBeenCalledTimes(1);
    unmount();
  });
});
