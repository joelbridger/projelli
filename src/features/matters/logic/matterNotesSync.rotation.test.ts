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

import { ensureMatterSync, getMatterSyncClient, handleKeyEpochAdvanced, stopAll, stopMatterSync } from './matterNotesSync';

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

  it('does not let a torn-down rotation clear or overwrite a newer client key after a denied fetch', async () => {
    const handle = parseMatterHandle(`mh2_${'V'.repeat(43)}`);
    const localMatterId = 'stale-rotation-key';
    const staleFetch = deferred<{ epoch: number; wrapped_key_b64: string }>();
    const clientA = { rotateKey: vi.fn(), stop: vi.fn() };
    const clientB = { rotateKey: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
    const firmClientA = { fetchMatterKeys: vi.fn(() => staleFetch.promise), matterMine: vi.fn() };
    const firmClientB = {
      fetchMatterKeys: vi.fn().mockResolvedValue({ epoch: 2, wrapped_key_b64: 'wrapped-b' }),
      matterMine: vi.fn().mockResolvedValue({ matters: [{ matter_handle: handle, key_epoch: 2 }] }),
    };

    const staleRotation = handleKeyEpochAdvanced(localMatterId, handle, firmClientA as never, clientA as never, 2);
    await vi.waitFor(() => { expect(firmClientA.fetchMatterKeys).toHaveBeenCalledOnce(); });

    stopMatterSync(localMatterId, clientA as never);
    await handleKeyEpochAdvanced(localMatterId, handle, firmClientB as never, clientB as never, 2);

    const clearCallsBeforeStaleFetchSettles = mocks.clearMatterKey.mock.calls.length;
    const storeCallsBeforeStaleFetchSettles = mocks.storeMatterKey.mock.calls.length;
    expect(mocks.storeMatterKey).toHaveBeenLastCalledWith(handle, 'key-2');
    expect(clientB.rotateKey).toHaveBeenCalledExactlyOnceWith('key-2', 2);

    staleFetch.reject(new FirmApiError(403, 'forbidden', 'denied'));
    await staleRotation;

    expect(mocks.clearMatterKey).toHaveBeenCalledTimes(clearCallsBeforeStaleFetchSettles);
    expect(mocks.storeMatterKey).toHaveBeenCalledTimes(storeCallsBeforeStaleFetchSettles);
    expect(clientA.rotateKey).not.toHaveBeenCalled();
    expect(clientA.stop).toHaveBeenCalledOnce();
    expect(clientB.stop).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalledWith(localMatterId, 'error');
  });

  it('keeps a newer pending rotation coalesced when an older rotation finishes', async () => {
    const handle = parseMatterHandle(`mh2_${'W'.repeat(43)}`);
    const localMatterId = 'stale-rotation-cache';
    const staleFetch = deferred<{ epoch: number; wrapped_key_b64: string }>();
    const freshFetch = deferred<{ epoch: number; wrapped_key_b64: string }>();
    const clientA = { rotateKey: vi.fn(), stop: vi.fn() };
    const clientB = { rotateKey: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
    const firmClientA = { fetchMatterKeys: vi.fn(() => staleFetch.promise), matterMine: vi.fn() };
    const firmClientB = {
      fetchMatterKeys: vi.fn()
        .mockImplementationOnce(() => freshFetch.promise)
        .mockResolvedValue({ epoch: 3, wrapped_key_b64: 'wrapped-b-3' }),
      matterMine: vi.fn().mockResolvedValue({ matters: [{ matter_handle: handle, key_epoch: 3 }] }),
    };

    const staleRotation = handleKeyEpochAdvanced(localMatterId, handle, firmClientA as never, clientA as never, 2);
    await vi.waitFor(() => { expect(firmClientA.fetchMatterKeys).toHaveBeenCalledOnce(); });
    stopMatterSync(localMatterId, clientA as never);

    const freshRotation = handleKeyEpochAdvanced(localMatterId, handle, firmClientB as never, clientB as never, 2);
    await vi.waitFor(() => { expect(firmClientB.fetchMatterKeys).toHaveBeenCalledOnce(); });

    staleFetch.reject(new FirmApiError(403, 'forbidden', 'denied'));
    await staleRotation;

    const coalescedRotation = handleKeyEpochAdvanced(localMatterId, handle, firmClientB as never, clientB as never, 3);
    expect(firmClientB.fetchMatterKeys).toHaveBeenCalledOnce();

    freshFetch.resolve({ epoch: 2, wrapped_key_b64: 'wrapped-b-2' });
    await Promise.all([freshRotation, coalescedRotation]);

    // The coalesced notice raises B's target to 3. Its one existing loop then
    // performs the normal sequential follow-up fetch; it never had two loops
    // in flight at once.
    expect(firmClientB.fetchMatterKeys).toHaveBeenCalledTimes(2);
    expect(clientB.rotateKey).toHaveBeenLastCalledWith('key-3', 3);
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

  it('stops and discards a client that finishes starting after sign-out', async () => {
    const localMatter = sharedMatter('sign-out-during-startup');
    const { client: firstClient, start: firstStart } = gatedClient();
    const { client: secondClient } = readyClient();
    mocks.obtainMatterKey.mockResolvedValue('key');
    mocks.firmState.client.mockReturnValue({});
    mocks.createClient.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    const firstOpen = ensureMatterSync(localMatter as never, 1);
    await vi.waitFor(() => { expect(firstStart).toHaveBeenCalledOnce(); });

    stopAll();
    firstStart.release();

    await expect(firstOpen).resolves.toBeNull();
    expect(firstClient.stop).toHaveBeenCalledOnce();
    expect(getMatterSyncClient(localMatter.id)).toBeNull();

    await expect(ensureMatterSync(localMatter as never, 1)).resolves.toBe(secondClient);
    expect(getMatterSyncClient(localMatter.id)).toBe(secondClient);
  });

  it('stops and discards a client that finishes starting after leaving a matter', async () => {
    const localMatter = sharedMatter('leave-during-startup');
    const { client: firstClient, start: firstStart } = gatedClient();
    const { client: secondClient } = readyClient();
    mocks.obtainMatterKey.mockResolvedValue('key');
    mocks.firmState.client.mockReturnValue({});
    mocks.createClient.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    const firstOpen = ensureMatterSync(localMatter as never, 1);
    await vi.waitFor(() => { expect(firstStart).toHaveBeenCalledOnce(); });

    stopMatterSync(localMatter.id);
    firstStart.release();

    await expect(firstOpen).resolves.toBeNull();
    expect(firstClient.stop).toHaveBeenCalledOnce();
    expect(getMatterSyncClient(localMatter.id)).toBeNull();

    await expect(ensureMatterSync(localMatter as never, 1)).resolves.toBe(secondClient);
    expect(getMatterSyncClient(localMatter.id)).toBe(secondClient);
  });

  it('does not let a stale startup overwrite a rapid re-sign-in client', async () => {
    const localMatter = sharedMatter('rapid-resign-in');
    const { client: firstClient, start: firstStart } = gatedClient();
    const { client: secondClient, start: secondStart } = gatedClient();
    mocks.obtainMatterKey.mockResolvedValue('key');
    mocks.firmState.client.mockReturnValue({});
    mocks.createClient.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    const firstOpen = ensureMatterSync(localMatter as never, 1);
    await vi.waitFor(() => { expect(firstStart).toHaveBeenCalledOnce(); });

    stopMatterSync(localMatter.id);
    const secondOpen = ensureMatterSync(localMatter as never, 1);
    await vi.waitFor(() => { expect(secondStart).toHaveBeenCalledOnce(); });

    firstStart.release();
    await expect(firstOpen).resolves.toBeNull();
    expect(firstClient.stop).toHaveBeenCalledOnce();

    secondStart.release();
    await expect(secondOpen).resolves.toBe(secondClient);
    expect(secondClient).not.toBe(firstClient);
    expect(getMatterSyncClient(localMatter.id)).toBe(secondClient);
  });
});

function sharedMatter(id: string): {
  id: string;
  shared: boolean;
  firmMatterId: ReturnType<typeof parseMatterHandle>;
  rootStreamHandle: string;
  name: string;
  client: string;
} {
  return {
    id,
    shared: true,
    firmMatterId: parseMatterHandle(`mh2_${'A'.repeat(43)}`),
    rootStreamHandle: `sh2_${'B'.repeat(43)}`,
    name: 'Private client',
    client: 'Client',
  };
}

function readyClient(): { client: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; doc: ReturnType<typeof testDocument> } } {
  const start = vi.fn().mockResolvedValue(undefined);
  return { client: { start, stop: vi.fn(), doc: testDocument() } };
}

function gatedClient(): {
  client: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; doc: ReturnType<typeof testDocument> };
  start: ReturnType<typeof vi.fn> & { release: () => void };
} {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const start = vi.fn(async () => gate) as ReturnType<typeof vi.fn> & { release: () => void };
  start.release = () => release?.();
  return { client: { start, stop: vi.fn(), doc: testDocument() }, start };
}

function testDocument(): {
  getMap: () => { get: (key: string) => string | undefined; set: (key: string, value: string) => void };
  transact: (callback: () => void) => void;
} {
  const values = new Map<string, string>();
  return {
    getMap: () => ({ get: (key) => values.get(key), set: (key, value) => { values.set(key, value); } }),
    transact: (callback) => { callback(); },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
