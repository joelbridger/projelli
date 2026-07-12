/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-non-null-assertion -- cross-window test doubles deliberately use minimal async callbacks. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';
import { FirmApiError } from '@/platform/firm/FirmApiClient';

const MATTER = parseMatterHandle(`mh2_${'L'.repeat(43)}`);
const ROOT = parseStreamHandle(`sh2_${'S'.repeat(43)}`);

/** Load the promotion module in a fresh JS context, while preserving the one
 * shared durable shelf a pair of real app windows would use. */
async function freshWindow(durable: Map<string, Record<string, unknown>>, linked: Array<string>, forgotten: string[] = []) {
  vi.resetModules();
  vi.doMock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({ linkFirmMatter: (_id: string, link: { firmMatterId: string }) => linked.push(link.firmMatterId) }) } }));
  vi.doMock('@/platform/firm/firmStore', () => ({ useFirmStore: { getState: () => ({ seatToken: 'seat', session: { userId: 'user', org: { org_id: 'org' } } }) } }));
  vi.doMock('@/platform/firm/firmKeychain', () => ({
    claimPromotionPending: async (context: { localMatterId: string }, forceTakeover = false) => {
      const id = context.localMatterId;
      const current = durable.get(id);
      if (!current) {
        const record = { ...context, userId: 'user', orgId: 'org', provisioningNonce: `pn2_${'N'.repeat(43)}`, leaseOwnerId: 'a'.repeat(32), leaseExpiresAt: Date.now() + 30_000 };
        durable.set(id, record);
        return { record, ownerId: 'a'.repeat(32), owned: true };
      }
      if (current['completed']) return { record: current, ownerId: 'b'.repeat(32), owned: false };
      if (Number(current['leaseExpiresAt']) <= Date.now() || forceTakeover) {
        const adopted = { ...current, leaseOwnerId: 'b'.repeat(32), leaseExpiresAt: Date.now() + 30_000 };
        durable.set(id, adopted);
        return { record: adopted, ownerId: 'b'.repeat(32), owned: true };
      }
      return { record: current, ownerId: 'b'.repeat(32), owned: false };
    },
    storePromotionPending: async (context: { localMatterId: string }, owner: string, record: Record<string, unknown>) => {
      const current = durable.get(context.localMatterId);
      if (!current || current['completed'] || current['leaseOwnerId'] !== owner) throw new Error('lost lease');
      const next = { ...record, leaseOwnerId: owner, leaseExpiresAt: Date.now() + 30_000 };
      durable.set(context.localMatterId, next);
      return next;
    },
    renewPromotionPendingLease: async (context: { localMatterId: string }, owner: string) => { const current = durable.get(context.localMatterId)!; const next = { ...current, leaseOwnerId: owner, leaseExpiresAt: Date.now() + 30_000 }; durable.set(context.localMatterId, next); return next; },
    releasePromotionPendingLease: async (context: { localMatterId: string }) => {
      const id = context.localMatterId;
      const record = durable.get(id);
      if (record && !record['completed']) {
        const { leaseOwnerId: _owner, leaseExpiresAt: _expiry, ...unleased } = record;
        durable.set(id, unleased);
      }
    },
    completePromotionPending: async (context: { localMatterId: string }, owner: string, record: Record<string, unknown>, orgId: string) => {
      const current = durable.get(context.localMatterId);
      if (!current || current['completed'] || current['leaseOwnerId'] !== owner) throw new Error('lost lease');
      durable.set(context.localMatterId, { ...record, rootWriteAccepted: true, completed: true, orgId });
    },
    beginPromotionPendingCleanup: async (context: { localMatterId: string }, owner: string) => {
      const current = durable.get(context.localMatterId);
      if (!current || current['completed'] || current['rootWriteAccepted'] || current['leaseOwnerId'] !== owner) throw new Error('lost lease');
      const cleanup = { ...current, cleanupPending: true };
      durable.set(context.localMatterId, cleanup);
      return cleanup;
    },
    clearPromotionPendingAfterCleanup: async (_context: unknown, _owner: string) => {},
  }));
  vi.doMock('@/platform/firm/matterKeyService', () => ({ createLocalMatterKey: vi.fn(async () => 'key'), forgetMatterKey: vi.fn(async (handle: string) => { forgotten.push(handle); }), publishMatterKeyToMembers: vi.fn(async () => ({ published: 1, skippedWalled: 0 })) }));
  vi.doMock('@/platform/firm/deviceKeys', () => ({ registerDevice: vi.fn(async () => {}) }));
  vi.doMock('@/features/matters/matterManagerDialogHelpers', () => ({ audit: { append: vi.fn() } }));
  vi.doMock('@/platform/firm/matterCrypto', () => ({ importMatterKey: vi.fn(async () => ({})), encryptUpdateV2: vi.fn(async () => 'ciphertext') }));
  vi.doMock('@/platform/firm/firmMatterPrivateIndex', () => ({ writeFirmMatterPrivateIndex: vi.fn() }));
  return import('./promoteMatterToShared');
}

afterEach(() => {
  vi.doUnmock('@/platform/matter/matterStore');
  vi.doUnmock('@/platform/firm/firmStore');
  vi.doUnmock('@/platform/firm/firmKeychain');
  vi.doUnmock('@/platform/firm/matterKeyService');
  vi.doUnmock('@/platform/firm/deviceKeys');
  vi.doUnmock('@/features/matters/matterManagerDialogHelpers');
  vi.doUnmock('@/platform/firm/matterCrypto');
  vi.doUnmock('@/platform/firm/firmMatterPrivateIndex');
});

describe('promotion durable lease', () => {
  it('separate windows adopt one receipt and create exactly one relay shell', async () => {
    const durable = new Map<string, Record<string, unknown>>();
    const linked: string[] = [];
    const first = await freshWindow(durable, linked);
    let releaseProvision!: () => void;
    const client = {
      createMatter: vi.fn(() => new Promise((resolve) => { releaseProvision = () => resolve({ matter_handle: MATTER, root_stream_handle: ROOT, key_epoch: 1, status: 'provisioning' }); })),
      activateMatter: vi.fn(async () => ({ ok: true })), pushUpdate: vi.fn(async () => ({ ok: true })), archiveMatter: vi.fn(async () => ({ ok: true })),
    };
    const a = first.promoteMatterToShared('local-1', 'Client', client as never);
    await vi.waitFor(() => expect(client.createMatter).toHaveBeenCalledTimes(1));

    const second = await freshWindow(durable, linked);
    const b = second.promoteMatterToShared('local-1', 'Client', client as never);
    releaseProvision();
    const [aResult, bResult] = await Promise.all([a, b]);

    expect(client.createMatter).toHaveBeenCalledTimes(1);
    expect(aResult).toMatchObject({ status: 'shared', firmMatterId: MATTER });
    expect(bResult).toMatchObject({ status: 'shared', firmMatterId: MATTER });
    expect(linked).toEqual([MATTER, MATTER]);
  });

  it('takes over a stale lease by resuming its saved shell, never by allocating another', async () => {
    const durable = new Map<string, Record<string, unknown>>([['local-stale', {
      localMatterId: 'local-stale', userId: 'user', orgId: 'org', provisioningNonce: `pn2_${'T'.repeat(43)}`, matterHandle: MATTER, rootStreamHandle: ROOT, keyEpoch: 1,
      keyB64: 'key', rootBlobId: `bh2_${'B'.repeat(43)}`, rootCiphertextB64: 'ciphertext', leaseOwnerId: 'c'.repeat(32), leaseExpiresAt: Date.now() - 1,
    }]]);
    const linked: string[] = [];
    const window = await freshWindow(durable, linked);
    const client = { createMatter: vi.fn(), activateMatter: vi.fn(async () => ({ ok: true })), pushUpdate: vi.fn(async () => ({ ok: true })), archiveMatter: vi.fn() };
    await expect(window.promoteMatterToShared('local-stale', 'Client', client as never)).resolves.toMatchObject({ status: 'shared', firmMatterId: MATTER });
    expect(client.createMatter).not.toHaveBeenCalled();
    expect(linked).toEqual([MATTER]);
  });

  it('fences an expired window after its successor shares: the old 4xx cleanup cannot archive, forget, or clear the new receipt', async () => {
    const durable = new Map<string, Record<string, unknown>>();
    const linked: string[] = [];
    const forgotten: string[] = [];
    const first = await freshWindow(durable, linked, forgotten);
    let rejectFirstRoot!: (error: Error) => void;
    const firstClient = {
      createMatter: vi.fn(async () => ({ matter_handle: MATTER, root_stream_handle: ROOT, key_epoch: 1, status: 'provisioning' as const })),
      activateMatter: vi.fn(async () => ({ ok: true })),
      pushUpdate: vi.fn(() => new Promise((_resolve, reject) => { rejectFirstRoot = reject; })),
      archiveMatter: vi.fn(async () => ({ ok: true })),
    };
    const a = first.promoteMatterToShared('local-fenced', 'Client', firstClient as never);
    await vi.waitFor(() => expect(firstClient.pushUpdate).toHaveBeenCalledTimes(1));

    const stale = durable.get('local-fenced')!;
    durable.set('local-fenced', { ...stale, leaseExpiresAt: Date.now() - 1 });
    const second = await freshWindow(durable, linked, forgotten);
    const secondClient = {
      createMatter: vi.fn(), activateMatter: vi.fn(async () => ({ ok: true })),
      pushUpdate: vi.fn(async () => ({ ok: true })), archiveMatter: vi.fn(async () => ({ ok: true })),
    };
    const b = await second.promoteMatterToShared('local-fenced', 'Client', secondClient as never);
    rejectFirstRoot(new FirmApiError(400, 'invalid_v2_payload', 'old write rejected'));
    const aResult = await a;

    expect(b).toMatchObject({ status: 'shared', firmMatterId: MATTER });
    expect(aResult).toMatchObject({ status: 'failed' });
    expect(firstClient.archiveMatter).not.toHaveBeenCalled();
    expect(forgotten).toEqual([]);
    expect(durable.get('local-fenced')).toMatchObject({ completed: true, matterHandle: MATTER });

    const retried = await first.promoteMatterToShared('local-fenced', 'Client', firstClient as never);
    expect(retried).toMatchObject({ status: 'shared', firmMatterId: MATTER });
    expect(secondClient.createMatter).not.toHaveBeenCalled();
  });

});
