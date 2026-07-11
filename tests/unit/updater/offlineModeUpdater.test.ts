import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock, relaunchMock, checkMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  relaunchMock: vi.fn(),
  checkMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: relaunchMock,
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkMock,
}));

import { useOfflineModeStore } from '@/platform/privacy/offlineMode';
import { setNetworkEgressReceiptEmitter } from '@/platform/privacy/networkEgressReceipt';
import { useUpdaterStore } from '@/platform/updater/updaterStore';

describe('updater Offline Mode guards', () => {
  let offlineMode = false;
  const receipts: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    isTauriMock.mockReturnValue(true);
    offlineMode = false;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'network_policy_status') {
        return { offlineMode, generation: offlineMode ? 2 : 1 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    relaunchMock.mockReset();
    checkMock.mockReset();
    setNetworkEgressReceiptEmitter((entry) => receipts.push(entry.metadata));
    receipts.length = 0;
    useOfflineModeStore.setState({
      offlineMode: false,
      generation: 1,
      hydrated: true,
      isHydrating: false,
      hydrationError: null,
    });
    useUpdaterStore.getState().reset();
  });

  it('re-reads native policy immediately before starting download and install', async () => {
    const downloadAndInstall = vi.fn();
    offlineMode = true;
    useUpdaterStore.setState({
      available: { downloadAndInstall } as never,
      status: 'available',
      downloadProgress: { total: 123, downloaded: 45 },
    });

    await useUpdaterStore.getState().downloadAndInstall();

    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState()).toMatchObject({
      status: 'available',
      deferredByOfflineMode: true,
      downloadProgress: { total: 0, downloaded: 0 },
    });
  });

  it('blocks the updater check before the plugin can open its own transport and records the refusal', async () => {
    offlineMode = true;

    await useUpdaterStore.getState().check();

    expect(checkMock).not.toHaveBeenCalled();
    expect(receipts).toContainEqual(expect.objectContaining({
      operationId: 'updater-github-releases',
      result: 'blocked-before-network',
    }));
  });

  it('blocks a manual restart with the standard Offline Mode message', async () => {
    offlineMode = true;
    useUpdaterStore.setState({ status: 'ready-to-restart' });

    await useUpdaterStore.getState().restart();

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState()).toMatchObject({
      deferredByOfflineMode: true,
      error:
        'Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use app updates.',
    });
  });

  it('allows a deliberate retry after Offline Mode is turned back off', async () => {
    const downloadAndInstall = vi.fn(async (onEvent) => {
      onEvent?.({ event: 'Started', data: { contentLength: 10 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 10 } });
      onEvent?.({ event: 'Finished' });
    });
    useUpdaterStore.setState({
      available: { downloadAndInstall } as never,
      status: 'available',
      deferredByOfflineMode: true,
    });

    await useUpdaterStore.getState().downloadAndInstall();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState()).toMatchObject({
      status: 'ready-to-restart',
      deferredByOfflineMode: false,
      downloadProgress: { total: 10, downloaded: 10 },
    });
  });

  it('clears stale progress and availability when Offline Mode flips during a download', () => {
    useUpdaterStore.setState({
      available: { downloadAndInstall: vi.fn() } as never,
      status: 'downloading',
      downloadProgress: { total: 100, downloaded: 50 },
    });

    useOfflineModeStore.setState({ offlineMode: true, generation: 2 });

    expect(useUpdaterStore.getState()).toMatchObject({
      available: null,
      status: 'idle',
      deferredByOfflineMode: true,
      downloadProgress: { total: 0, downloaded: 0 },
    });
  });
});
