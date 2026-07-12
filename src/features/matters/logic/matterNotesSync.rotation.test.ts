import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle } from '@/platform/firm/contract';
import { FirmApiError } from '@/platform/firm/FirmApiClient';

const mocks = vi.hoisted(() => ({
  obtainMatterKey: vi.fn(), clearMatterKey: vi.fn(), storeMatterKey: vi.fn(), getDevice: vi.fn(), unwrap: vi.fn(), createClient: vi.fn(),
  setStatus: vi.fn(), firmState: { seatToken: 'seat-token' as string | null, client: vi.fn() },
}));

vi.mock('@/platform/firm/matterKeyService', () => ({ obtainMatterKey: mocks.obtainMatterKey }));
vi.mock('@/platform/firm/firmKeychain', () => ({ clearMatterKey: mocks.clearMatterKey, storeMatterKey: mocks.storeMatterKey }));
vi.mock('@/platform/firm/deviceKeys', () => ({ getOrCreateDeviceKeypair: mocks.getDevice }));
vi.mock('@/platform/firm/keyWrap', () => ({ unwrapMatterKey: mocks.unwrap }));
vi.mock('@/platform/firm/FirmApiClient', () => ({ FirmApiError: class FirmApiError extends Error { status: number; constructor(status = 500) { super(); this.status = status; } } }));
vi.mock('@/platform/firm/MatterSyncClient', () => ({
  MatterSyncClient: function MatterSyncClient(options: unknown): { start: () => Promise<void>; stop: () => void } {
    return mocks.createClient(options) as { start: () => Promise<void>; stop: () => void };
  },
}));
vi.mock('@/platform/firm/firmMatterPrivateIndex', () => ({ readFirmMatterPrivateIndex: vi.fn() }));
vi.mock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({}) } }));
vi.mock('@/platform/matter/matterSyncStore', () => ({ useMatterSyncStore: { getState: () => ({ setStatus: mocks.setStatus, clearMatter: vi.fn() }) } }));
vi.mock('@/platform/firm/firmStore', () => ({ useFirmStore: { getState: () => mocks.firmState, subscribe: vi.fn() } }));

import { ensureMatterSync, getMatterSyncClient, handleKeyEpochAdvanced, stopAll } from './matterNotesSync';

describe('matterNotesSync key rotation race', () => {
  beforeEach(() => {
    stopAll();
    vi.clearAllMocks();
    mocks.getDevice.mockResolvedValue({ deviceId: 'device' });
    mocks.unwrap.mockImplementation((_wrapped: string, epoch: number) => Promise.resolve(`key-${String(epoch)}`));
    mocks.clearMatterKey.mockResolvedValue(undefined);
    mocks.storeMatterKey.mockResolvedValue(undefined);
  });

  it('uses the fetched key epoch and retries when the relay advances again during rotation', async () => {
    const handle = parseMatterHandle(`mh2_${'T'.repeat(43)}`);
    const rotateKey = vi.fn().mockResolvedValue(undefined);
    const fetchMatterKeys = vi.fn()
      .mockResolvedValueOnce({ epoch: 3, wrapped_key_b64: 'wrapped-3' })
      .mockResolvedValueOnce({ epoch: 4, wrapped_key_b64: 'wrapped-4' });
    const matterMine = vi.fn()
      .mockResolvedValueOnce({ matters: [{ matter_handle: handle, key_epoch: 4 }] })
      .mockResolvedValueOnce({ matters: [{ matter_handle: handle, key_epoch: 4 }] });

    await handleKeyEpochAdvanced('local-client', handle, { fetchMatterKeys, matterMine } as never, { rotateKey } as never, 2);

    expect(rotateKey).toHaveBeenNthCalledWith(1, 'key-3', 3);
    expect(rotateKey).toHaveBeenNthCalledWith(2, 'key-4', 4);
    expect(fetchMatterKeys).toHaveBeenCalledTimes(2);
    expect(mocks.storeMatterKey).toHaveBeenNthCalledWith(1, handle, 'key-3');
  });

  it('stops after rotating to the fetched epoch when a relay hint is unreachable', async () => {
    const handle = parseMatterHandle(`mh2_${'U'.repeat(43)}`);
    const rotateKey = vi.fn().mockResolvedValue(undefined);
    const fetchMatterKeys = vi.fn().mockResolvedValue({ epoch: 1, wrapped_key_b64: 'wrapped-1' });
    const matterMine = vi.fn();

    await handleKeyEpochAdvanced('local-client', handle, { fetchMatterKeys, matterMine } as never, { rotateKey } as never, 999);

    expect(rotateKey).toHaveBeenCalledExactlyOnceWith('key-1', 1);
    expect(fetchMatterKeys).toHaveBeenCalledTimes(1);
    expect(matterMine).not.toHaveBeenCalled();
  });

  it('does not cache a client when a newer epoch is denied while its first start is still pending', async () => {
    const handle = parseMatterHandle(`mh2_${'S'.repeat(43)}`);
    const localMatter = {
      id: 'startup-race-matter', shared: true, firmMatterId: handle, rootStreamHandle: `sh2_${'R'.repeat(43)}`,
      name: 'Private client', client: 'Client',
    };
    const firmClient = {
      fetchMatterKeys: vi.fn().mockRejectedValue(new FirmApiError(403, 'forbidden', 'denied')),
      matterMine: vi.fn(),
    };
    mocks.firmState.client.mockReturnValue(firmClient);
    mocks.obtainMatterKey.mockResolvedValueOnce('initial-key').mockResolvedValueOnce(null);

    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const stop = vi.fn();
    mocks.createClient.mockImplementation((options: { callbacks: { onKeyEpochAdvanced?: (epoch: number) => void } }) => ({
      start: vi.fn(async () => {
        options.callbacks.onKeyEpochAdvanced?.(2);
        await startGate;
      }),
      stop,
    }));

    const firstOpen = ensureMatterSync(localMatter as never, 1);
    await vi.waitFor(() => { expect(firmClient.fetchMatterKeys).toHaveBeenCalledOnce(); });
    await vi.waitFor(() => { expect(stop).toHaveBeenCalledOnce(); });
    expect(mocks.setStatus).toHaveBeenCalledWith(localMatter.id, 'error');

    releaseStart?.();
    await expect(firstOpen).resolves.toBeNull();
    expect(getMatterSyncClient(localMatter.id)).toBeNull();

    await expect(ensureMatterSync(localMatter as never, 1)).resolves.toBeNull();
    expect(getMatterSyncClient(localMatter.id)).toBeNull();
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});
