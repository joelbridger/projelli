import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';

const mocks = vi.hoisted(() => ({
  linkFirmMatter: vi.fn(), createLocalMatterKey: vi.fn(), forgetMatterKey: vi.fn(),
  publishMatterKeyToMembers: vi.fn(), registerDevice: vi.fn(), append: vi.fn(),
  promotionPending: null as Record<string, unknown> | null, storePromotionPending: vi.fn(), clearPromotionPending: vi.fn(),
  firmState: { seatToken: 'seat' as string | null, session: { org: { org_id: 'org' } } },
}));

vi.mock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({ linkFirmMatter: mocks.linkFirmMatter }) } }));
vi.mock('@/platform/firm/matterKeyService', () => ({ createLocalMatterKey: mocks.createLocalMatterKey, forgetMatterKey: mocks.forgetMatterKey, publishMatterKeyToMembers: mocks.publishMatterKeyToMembers }));
vi.mock('@/platform/firm/deviceKeys', () => ({ registerDevice: mocks.registerDevice }));
vi.mock('@/features/matters/matterManagerDialogHelpers', () => ({ audit: { append: mocks.append } }));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => mocks.firmState },
}));
vi.mock('@/platform/firm/firmKeychain', () => ({
  loadPromotionPending: async () => mocks.promotionPending,
  storePromotionPending: async (_id: string, value: Record<string, unknown>) => { mocks.promotionPending = value; mocks.storePromotionPending(value); },
  clearPromotionPending: async () => { mocks.promotionPending = null; mocks.clearPromotionPending(); },
}));

import { promoteMatterToShared } from './promoteMatterToShared';

const matterHandle = parseMatterHandle(`mh2_${'P'.repeat(43)}`);
const rootStreamHandle = parseStreamHandle(`sh2_${'Q'.repeat(43)}`);

async function generatedKey(): Promise<string> {
  return (await import('@/platform/firm/matterCrypto')).generateMatterKey();
}

function successfulClient() {
  return {
    createMatter: vi.fn(() => Promise.resolve({ matter_handle: matterHandle, root_stream_handle: rootStreamHandle, key_epoch: 1 as const, status: 'provisioning' as const })),
    pushUpdate: vi.fn(() => Promise.resolve({ ok: true as const, cursor: 1, blob_id: 'x', key_epoch: 1, duplicate: false })),
    activateMatter: vi.fn(() => Promise.resolve({ ok: true as const })),
    archiveMatter: vi.fn(() => Promise.resolve({ ok: true as const })),
  };
}

async function expectFailedThenRetryable(
  client: ReturnType<typeof successfulClient>,
  expectedError: string,
) {
  const failed = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);
  expect(failed).toMatchObject({ status: 'failed', matterId: 'local-matter-77', error: expectedError });
  expect(mocks.linkFirmMatter).not.toHaveBeenCalled();

  const retried = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);
  expect(retried.status).toBe('shared');
  expect(mocks.linkFirmMatter).toHaveBeenCalledTimes(1);
}

describe('promoteMatterToShared v2 ordering', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.firmState.seatToken = 'seat';
    mocks.createLocalMatterKey.mockResolvedValue(await generatedKey());
    mocks.forgetMatterKey.mockResolvedValue(undefined);
    mocks.publishMatterKeyToMembers.mockResolvedValue({ published: 1, skippedWalled: 0 });
    mocks.registerDevice.mockResolvedValue(undefined);
    mocks.promotionPending = null;
  });

  it('activates before its first relay write, then seals the encrypted root details', async () => {
    const order: string[] = [];
    const client = {
      createMatter: vi.fn(() => { order.push('provision'); return Promise.resolve({ matter_handle: matterHandle, root_stream_handle: rootStreamHandle, key_epoch: 1, status: 'provisioning' as const }); }),
      pushUpdate: vi.fn(() => { order.push('root-index'); return Promise.resolve({ ok: true, cursor: 1, blob_id: 'x', key_epoch: 1, duplicate: false }); }),
      activateMatter: vi.fn(() => { order.push('activate'); return Promise.resolve({ ok: true }); }),
    };
    const result = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);
    expect(result.status).toBe('shared');
    expect(order).toEqual(['provision', 'activate', 'root-index']);
    expect(JSON.stringify(client.pushUpdate.mock.calls)).not.toContain('CLIENT_SECRET_NIMBUS');
    expect(mocks.linkFirmMatter).toHaveBeenCalledWith('local-matter-77', expect.objectContaining({ firmMatterId: matterHandle, rootStreamHandle }));
  });

  it('keeps a resumable record when its first root-write response is lost', async () => {
    const client = {
      createMatter: vi.fn(() => Promise.resolve({ matter_handle: matterHandle, root_stream_handle: rootStreamHandle, key_epoch: 1, status: 'provisioning' as const })),
      pushUpdate: vi.fn(() => Promise.reject(new Error('root write failed'))),
      activateMatter: vi.fn(),
      archiveMatter: vi.fn(() => Promise.resolve({ ok: true })),
    };
    const result = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);
    expect(result.status).toBe('failed');
    expect(client.activateMatter).toHaveBeenCalledWith(matterHandle);
    expect(mocks.linkFirmMatter).not.toHaveBeenCalled();
    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(mocks.forgetMatterKey).not.toHaveBeenCalled();
    expect(mocks.promotionPending).toEqual(expect.objectContaining({ matterHandle, keyB64: expect.any(String) }));
  });

  it('keeps a failed provision invisible and allows a clean retry', async () => {
    const client = successfulClient();
    client.createMatter.mockRejectedValueOnce(new Error('provision failed'));

    await expectFailedThenRetryable(client, 'provision failed');

    expect(client.pushUpdate).toHaveBeenCalledTimes(1);
    expect(client.activateMatter).toHaveBeenCalledTimes(1);
    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(mocks.forgetMatterKey).not.toHaveBeenCalled();
  });

  it('keeps a failed local key creation invisible and allows a clean retry', async () => {
    const client = successfulClient();
    mocks.createLocalMatterKey.mockRejectedValueOnce(new Error('key creation failed'));

    await expectFailedThenRetryable(client, 'key creation failed');

    expect(client.pushUpdate).toHaveBeenCalledTimes(1);
    expect(client.activateMatter).toHaveBeenCalledTimes(1);
    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(mocks.forgetMatterKey).not.toHaveBeenCalled();
  });

  it('keeps a failed encrypted root-index write invisible and allows a clean retry', async () => {
    const client = successfulClient();
    client.pushUpdate.mockRejectedValueOnce(new Error('root write failed'));

    await expectFailedThenRetryable(client, 'root write failed');

    expect(client.activateMatter).toHaveBeenCalledTimes(2);
    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(mocks.publishMatterKeyToMembers).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed activation invisible and allows a clean retry', async () => {
    const client = successfulClient();
    client.activateMatter.mockRejectedValueOnce(new Error('activation failed'));

    await expectFailedThenRetryable(client, 'activation failed');

    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(mocks.publishMatterKeyToMembers).toHaveBeenCalledTimes(1);
  });

  it('archives a shell when key publishing fails, then allows a clean retry', async () => {
    const client = successfulClient();
    mocks.publishMatterKeyToMembers.mockRejectedValueOnce(new Error('key publish failed'));

    await expectFailedThenRetryable(client, 'key publish failed');

    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(client.activateMatter).toHaveBeenCalledTimes(2);
  });

  it('checks the seat before provisioning, so a retry cannot leave an extra shell', async () => {
    mocks.firmState.seatToken = null;
    const client = successfulClient();

    const result = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);

    expect(result).toMatchObject({ status: 'failed', error: 'A valid firm seat is required to share a client.' });
    expect(client.createMatter).not.toHaveBeenCalled();
    expect(client.archiveMatter).not.toHaveBeenCalled();
  });
});
