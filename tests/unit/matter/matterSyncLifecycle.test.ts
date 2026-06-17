/**
 * matterNotesSync lifecycle unit tests.
 *
 * Tests:
 *   1. ensureMatterSync forwards the provided keyEpoch to MatterSyncClient.
 *   2. ensureMatterSync defaults keyEpoch to 1 when not provided.
 *   3. ensureMatterSync returns null for an unshared matter (guard enforcement).
 *   4. ensureMatterSync returns null when shared=true but firmMatterId missing.
 *   5. stopMatterSync is idempotent on an unstarted matter.
 *   6. stopMatterSync calls stop() on the cached client and removes it.
 *   7. stopAll calls stop() on every cached client and clears the cache.
 *   8. ensureMatterSync is idempotent (returns cached client on second call).
 *   9. CONCURRENT: two simultaneous calls construct exactly one client.
 *  10. epoch-advance 403 → clearMatterKey + client stopped + next ensureMatterSync null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.hoisted runs before any import hoisting)
// ---------------------------------------------------------------------------
const { startMock, stopMock, rotateMock, MockMatterSyncClient, getLastCallbacks } = vi.hoisted(() => {
  const startMock = vi.fn(async () => undefined);
  const stopMock = vi.fn();
  const rotateMock = vi.fn(async () => undefined);

  let lastCallbacks: Record<string, unknown> | null = null;

  const mapStore = new Map<string, unknown>();
  const fakeDoc = {
    getMap: () => ({
      get: (k: string) => mapStore.get(k),
      set: (k: string, v: unknown) => { mapStore.set(k, v); },
    }),
    transact: (fn: () => void) => fn(),
  };

  const MockMatterSyncClient = vi.fn(function (
    this: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) {
    this.__capturedEpoch = opts.keyEpoch;
    this.start = startMock;
    this.stop = stopMock;
    this.rotateKey = rotateMock;
    this.getStatus = () => 'live';
    this.doc = fakeDoc;
    lastCallbacks = opts.callbacks as Record<string, unknown>;
  });

  const getLastCallbacks = () => lastCallbacks;

  return { startMock, stopMock, rotateMock, MockMatterSyncClient, getLastCallbacks };
});

vi.mock('@/modules/firm/MatterSyncClient', () => ({
  MatterSyncClient: MockMatterSyncClient,
}));

vi.mock('@/modules/firm/firmKeychain', () => ({
  loadMatterKey: vi.fn(async () => 'b64-mock-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
  storeMatterKey: vi.fn(async () => undefined),
  clearMatterKey: vi.fn(async () => undefined),
}));

vi.mock('@/modules/firm/deviceKeys', () => ({
  getOrCreateDeviceKeypair: vi.fn(async () => ({ deviceId: 'device-test', publicJwk: {} })),
}));

vi.mock('@/modules/firm/keyWrap', () => ({
  unwrapMatterKey: vi.fn(async () => 'new-b64-mock-key-BBB='),
}));

const { MockFirmApiError } = vi.hoisted(() => {
  class MockFirmApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'FirmApiError';
    }
  }
  return { MockFirmApiError };
});

vi.mock('@/modules/firm/FirmApiClient', () => ({
  FirmApiError: MockFirmApiError,
}));

vi.mock('@/stores/firmStore', () => ({
  useFirmStore: {
    getState: () => ({
      seatToken: 'seat-token-test',
      client: () => ({
        // fetchMatterKeys throws 403 — used by handleKeyEpochAdvanced
        fetchMatterKeys: vi.fn(async () => { throw new MockFirmApiError('Forbidden', 403); }),
        matterMine: vi.fn(async () => ({ matters: [] })),
      }),
    }),
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock('@/modules/firm/matterKeyService', () => ({
  obtainMatterKey: vi.fn(async () => 'b64-mock-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
}));

vi.mock('@/stores/matterSyncStore', () => ({
  useMatterSyncStore: {
    getState: () => ({
      setStatus: vi.fn(),
      clearMatter: vi.fn(),
    }),
  },
}));

// Also mock @/i18n so openMatterNotes doesn't fail to find it in this test env
vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'matter.notes.tab-title' && opts?.name) return `${String(opts.name)}: Shared notes`;
      return key;
    },
  },
}));

import {
  ensureMatterSync,
  stopMatterSync,
  stopAll,
  getMatterSyncClient,
} from '@/features/matters/logic/matterNotesSync';
import { clearMatterKey } from '@/modules/firm/firmKeychain';
import type { Matter } from '@/types/matter';

function makeMatter(overrides?: Partial<Matter>): Matter {
  return {
    id: 'local-1',
    name: 'Test Matter',
    client: 'Test Corp',
    shared: true,
    firmMatterId: 'firm-1',
    role: 'owner',
    folderPaths: [],
    privileged: false,
    ...overrides,
  };
}

describe('matterNotesSync lifecycle', () => {
  beforeEach(() => {
    stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopAll();
  });

  it('ensureMatterSync passes the provided keyEpoch to MatterSyncClient', async () => {
    const matter = makeMatter();
    const client = await ensureMatterSync(matter, 7);
    expect(client).not.toBeNull();
    expect(MockMatterSyncClient).toHaveBeenCalledOnce();
    const ctorArg = MockMatterSyncClient.mock.calls[0]![0] as Record<string, unknown>;
    expect(ctorArg.keyEpoch).toBe(7);
  });

  it('ensureMatterSync defaults keyEpoch to 1 when not provided', async () => {
    const matter = makeMatter({ id: 'local-2', firmMatterId: 'firm-2' });
    await ensureMatterSync(matter);
    const ctorArg = MockMatterSyncClient.mock.calls[0]![0] as Record<string, unknown>;
    expect(ctorArg.keyEpoch).toBe(1);
  });

  it('ensureMatterSync returns null for an unshared matter', async () => {
    const matter = makeMatter({ shared: false, firmMatterId: undefined });
    const client = await ensureMatterSync(matter);
    expect(client).toBeNull();
  });

  it('ensureMatterSync returns null for shared=true but no firmMatterId', async () => {
    const matter = makeMatter({ shared: true, firmMatterId: undefined });
    const client = await ensureMatterSync(matter);
    expect(client).toBeNull();
  });

  it('stopMatterSync is idempotent on an unstarted matter', () => {
    expect(() => stopMatterSync('never-started')).not.toThrow();
  });

  it('stopMatterSync calls stop() on the cached client and removes it', async () => {
    const matter = makeMatter({ id: 'local-3', firmMatterId: 'firm-3' });
    await ensureMatterSync(matter, 2);
    expect(getMatterSyncClient('local-3')).not.toBeNull();
    stopMatterSync('local-3');
    expect(stopMock).toHaveBeenCalledOnce();
    expect(getMatterSyncClient('local-3')).toBeNull();
  });

  it('stopAll calls stop() on every cached client and clears the cache', async () => {
    const m1 = makeMatter({ id: 'stop-all-1', firmMatterId: 'firm-stop-1' });
    const m2 = makeMatter({ id: 'stop-all-2', firmMatterId: 'firm-stop-2' });
    await ensureMatterSync(m1, 1);
    await ensureMatterSync(m2, 1);
    expect(getMatterSyncClient('stop-all-1')).not.toBeNull();
    expect(getMatterSyncClient('stop-all-2')).not.toBeNull();

    stopAll();
    expect(stopMock).toHaveBeenCalledTimes(2);
    expect(getMatterSyncClient('stop-all-1')).toBeNull();
    expect(getMatterSyncClient('stop-all-2')).toBeNull();
  });

  it('ensureMatterSync is idempotent (returns cached client on second call)', async () => {
    const matter = makeMatter({ id: 'idem-1', firmMatterId: 'firm-idem-1' });
    const first = await ensureMatterSync(matter, 3);
    const second = await ensureMatterSync(matter, 3);
    expect(first).toBe(second);
    expect(MockMatterSyncClient).toHaveBeenCalledOnce();
  });

  it('CONCURRENT: two simultaneous ensureMatterSync calls construct exactly one client', async () => {
    const matter = makeMatter({ id: 'concurrent-1', firmMatterId: 'firm-concurrent-1' });
    // Fire both at the same time (no await between them).
    const [c1, c2] = await Promise.all([
      ensureMatterSync(matter, 5),
      ensureMatterSync(matter, 5),
    ]);
    // Both must resolve to the same client object.
    expect(c1).not.toBeNull();
    expect(c1).toBe(c2);
    // Constructor invoked only once despite two concurrent callers.
    expect(MockMatterSyncClient).toHaveBeenCalledOnce();
  });

  it('epoch-advance 403 → clearMatterKey called, client stopped, next ensureMatterSync returns null', async () => {
    // Arrange: build a client. The firmStore mock returns a client whose
    // fetchMatterKeys throws 403, simulating the walled-user path.
    // obtainMatterKey succeeds for the initial ensureMatterSync but returns null
    // on the retry (after clearMatterKey, key is gone).
    const { obtainMatterKey } = await import('@/modules/firm/matterKeyService');
    vi.mocked(obtainMatterKey)
      .mockResolvedValueOnce('b64-mock-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') // initial call
      .mockResolvedValueOnce(null); // retry after 403 clears the key

    const matter = makeMatter({ id: 'epoch-403-1', firmMatterId: 'firm-epoch-403-1' });
    await ensureMatterSync(matter, 2);
    expect(getMatterSyncClient('epoch-403-1')).not.toBeNull();

    // Trigger the epoch-advance callback (captured by getLastCallbacks() from hoisted mock).
    const callbacks = getLastCallbacks() as { onKeyEpochAdvanced: (e: number) => Promise<void> } | null;
    expect(callbacks).not.toBeNull();
    // The callback calls getOrCreateDeviceKeypair → firmClient.fetchMatterKeys (mocked to 403
    // via @/stores/firmStore mock's client()) → FirmApiError thrown → clearMatterKey + stop.
    await callbacks!.onKeyEpochAdvanced(3);

    // clearMatterKey must have been called (drops the stale key from keychain).
    expect(clearMatterKey).toHaveBeenCalledWith('firm-epoch-403-1');
    // Client must have been stopped and evicted from cache.
    expect(getMatterSyncClient('epoch-403-1')).toBeNull();
    // A subsequent ensureMatterSync returns null because obtainMatterKey now returns null.
    const retry = await ensureMatterSync(matter, 3);
    expect(retry).toBeNull();
  });
});
