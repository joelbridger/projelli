import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkPolicyStatus } from '@/platform/privacy/offlineMode';

type OfflineModeListener = (status: NetworkPolicyStatus) => void;

const controls = vi.hoisted(() => ({
  isTauri: vi.fn<() => boolean>(),
  getStatus: vi.fn<() => Promise<NetworkPolicyStatus>>(),
  subscribe: vi.fn<(listener: OfflineModeListener) => () => void>(),
  granted: vi.fn<(deviceId: string) => Promise<{ intakes: never[] }>>(),
  getDevice: vi.fn<() => Promise<{ deviceId: string; publicJwk: JsonWebKey }>>(),
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
  FirmApiClient: vi.fn(),
}));
vi.mock('./IntakeRelayClient', () => ({
  IntakeRelayClient: class IntakeRelayClient {
    listGrantedIntakes = controls.granted;
  },
}));

import { useFirmStore } from '@/platform/firm/firmStore';
import { useIntakeInboxSync } from './useIntakeInboxSync';

describe('useIntakeInboxSync Offline Mode wiring', () => {
  let onPolicyChange: OfflineModeListener | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    controls.isTauri.mockReturnValue(true);
    controls.getStatus.mockResolvedValue({
      offlineMode: false,
      generation: 1,
      hydrated: true,
      loadError: null,
    });
    controls.getDevice.mockResolvedValue({
      deviceId: 'device-1',
      publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    });
    controls.granted.mockResolvedValue({ intakes: [] });
    controls.subscribe.mockImplementation((listener) => {
      onPolicyChange = listener;
      return () => {
        onPolicyChange = undefined;
      };
    });
    useFirmStore.setState({ seatToken: 'seat-token', accessToken: 'access-token' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useFirmStore.setState({ seatToken: null, accessToken: null });
  });

  it('stops the relay timer and focus sync immediately when Offline Mode turns on', async () => {
    const { unmount } = renderHook(() => {
      useIntakeInboxSync({
        workspaceService: {} as never,
        intervalMs: 30_000,
      });
    });

    await act(async () => {
      await Promise.resolve();
      vi.runAllTicks();
    });
    expect(controls.granted).toHaveBeenCalledTimes(1);
    expect(onPolicyChange).toBeDefined();

    act(() => onPolicyChange?.({
      offlineMode: true,
      generation: 2,
      hydrated: true,
      loadError: null,
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
      window.dispatchEvent(new Event('focus'));
      vi.runAllTicks();
    });

    expect(controls.granted).toHaveBeenCalledTimes(1);
    unmount();
  });
});
