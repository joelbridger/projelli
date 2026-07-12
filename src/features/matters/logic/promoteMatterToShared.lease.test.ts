import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';

const MATTER = parseMatterHandle(`mh2_${'L'.repeat(43)}`);
const ROOT = parseStreamHandle(`sh2_${'S'.repeat(43)}`);

/** Load the promotion module in a fresh JS context, while preserving the one
 * shared durable shelf a pair of real app windows would use. */
async function freshWindow(durable: Map<string, Record<string, unknown>>, linked: Array<string>) {
  vi.resetModules();
  vi.doMock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({ linkFirmMatter: (_id: string, link: { firmMatterId: string }) => linked.push(link.firmMatterId) }) } }));
  vi.doMock('@/platform/firm/firmStore', () => ({ useFirmStore: { getState: () => ({ seatToken: 'seat', session: { org: { org_id: 'org' } } }) } }));
  vi.doMock('@/platform/firm/firmKeychain', () => ({
    claimPromotionPending: async (id: string) => {
      const current = durable.get(id);
      if (!current) {
        const record = { provisioningNonce: `pn2_${'N'.repeat(43)}`, leaseOwnerId: `owner-${id}`, leaseExpiresAt: Date.now() + 30_000 };
        durable.set(id, record);
        return { record, ownerId: `owner-${id}`, owned: true };
      }
      if (current['completed']) return { record: current, ownerId: `observer-${id}`, owned: false };
      if (Number(current['leaseExpiresAt']) <= Date.now()) {
        const adopted = { ...current, leaseOwnerId: `takeover-${id}`, leaseExpiresAt: Date.now() + 30_000 };
        durable.set(id, adopted);
        return { record: adopted, ownerId: `takeover-${id}`, owned: true };
      }
      return { record: current, ownerId: `observer-${id}`, owned: false };
    },
    storePromotionPending: async (id: string, record: Record<string, unknown>) => { durable.set(id, record); },
    releasePromotionPendingLease: async (id: string) => {
      const record = durable.get(id);
      if (record && !record['completed']) {
        const { leaseOwnerId: _owner, leaseExpiresAt: _expiry, ...unleased } = record;
        durable.set(id, unleased);
      }
    },
    completePromotionPending: async (id: string, _owner: string, record: Record<string, unknown>, orgId: string) => {
      durable.set(id, { provisioningNonce: record['provisioningNonce'], matterHandle: record['matterHandle'], rootStreamHandle: record['rootStreamHandle'], keyEpoch: record['keyEpoch'], rootWriteAccepted: true, completed: true, orgId });
    },
    clearPromotionPending: async (id: string) => { durable.delete(id); },
  }));
  vi.doMock('@/platform/firm/matterKeyService', () => ({ createLocalMatterKey: vi.fn(async () => 'key'), forgetMatterKey: vi.fn(), publishMatterKeyToMembers: vi.fn(async () => ({ published: 1, skippedWalled: 0 })) }));
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
      provisioningNonce: `pn2_${'T'.repeat(43)}`, matterHandle: MATTER, rootStreamHandle: ROOT, keyEpoch: 1,
      keyB64: 'key', rootBlobId: `ob2_${'B'.repeat(43)}`, rootCiphertextB64: 'ciphertext', leaseOwnerId: 'crashed', leaseExpiresAt: Date.now() - 1,
    }]]);
    const linked: string[] = [];
    const window = await freshWindow(durable, linked);
    const client = { createMatter: vi.fn(), activateMatter: vi.fn(async () => ({ ok: true })), pushUpdate: vi.fn(async () => ({ ok: true })), archiveMatter: vi.fn() };
    await expect(window.promoteMatterToShared('local-stale', 'Client', client as never)).resolves.toMatchObject({ status: 'shared', firmMatterId: MATTER });
    expect(client.createMatter).not.toHaveBeenCalled();
    expect(linked).toEqual([MATTER]);
  });

});
