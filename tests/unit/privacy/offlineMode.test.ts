import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import {
  hydrateOfflineMode,
  setOfflineMode,
  useOfflineModeStore,
} from '@/platform/privacy/offlineMode';

describe('offlineMode', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockReset();
    useOfflineModeStore.setState({
      offlineMode: false,
      generation: 0,
      hydrated: false,
      isHydrating: false,
      hydrationError: null,
    });
  });

  it('hydrates the display mirror from the native policy status', async () => {
    invokeMock.mockResolvedValueOnce({ offlineMode: true, generation: 7 });

    await expect(hydrateOfflineMode()).resolves.toEqual({
      offlineMode: true,
      generation: 7,
    });
    expect(invokeMock).toHaveBeenCalledWith('network_policy_status');
    expect(useOfflineModeStore.getState()).toMatchObject({
      offlineMode: true,
      generation: 7,
      hydrated: true,
      hydrationError: null,
    });
  });

  it('keeps startup graceful when native hydration fails', async () => {
    invokeMock.mockRejectedValueOnce('policy record could not be read');

    await expect(hydrateOfflineMode()).resolves.toBeNull();
    expect(useOfflineModeStore.getState()).toMatchObject({
      hydrated: false,
      isHydrating: false,
      hydrationError: 'policy record could not be read',
    });
  });

  it('changes native policy first and then mirrors its authoritative generation', async () => {
    invokeMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ offlineMode: true, generation: 8 });

    await setOfflineMode(true);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'set_offline_mode', {
      enabled: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'network_policy_status');
    expect(useOfflineModeStore.getState()).toMatchObject({
      offlineMode: true,
      generation: 8,
      hydrated: true,
    });
  });
});
