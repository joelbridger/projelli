import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle } from '@/platform/firm/contract';

const mocks = vi.hoisted(() => ({
  clearMatterKey: vi.fn(), storeMatterKey: vi.fn(), getDevice: vi.fn(), unwrap: vi.fn(),
  setStatus: vi.fn(), firmState: { seatToken: 'seat-token' as string | null },
}));

vi.mock('@/platform/firm/matterKeyService', () => ({ obtainMatterKey: vi.fn() }));
vi.mock('@/platform/firm/firmKeychain', () => ({ clearMatterKey: mocks.clearMatterKey, storeMatterKey: mocks.storeMatterKey }));
vi.mock('@/platform/firm/deviceKeys', () => ({ getOrCreateDeviceKeypair: mocks.getDevice }));
vi.mock('@/platform/firm/keyWrap', () => ({ unwrapMatterKey: mocks.unwrap }));
vi.mock('@/platform/firm/FirmApiClient', () => ({ FirmApiError: class FirmApiError extends Error { status = 500; } }));
vi.mock('@/platform/firm/MatterSyncClient', () => ({ MatterSyncClient: function MatterSyncClient() {} }));
vi.mock('@/platform/firm/firmMatterPrivateIndex', () => ({ readFirmMatterPrivateIndex: vi.fn() }));
vi.mock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({}) } }));
vi.mock('@/platform/matter/matterSyncStore', () => ({ useMatterSyncStore: { getState: () => ({ setStatus: mocks.setStatus, clearMatter: vi.fn() }) } }));
vi.mock('@/platform/firm/firmStore', () => ({ useFirmStore: { getState: () => mocks.firmState, subscribe: vi.fn() } }));

import { handleKeyEpochAdvanced } from './matterNotesSync';

describe('matterNotesSync key rotation race', () => {
  beforeEach(() => {
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
});
