import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';

const mocks = vi.hoisted(() => ({
  linkFirmMatter: vi.fn(), createLocalMatterKey: vi.fn(), forgetMatterKey: vi.fn(),
  publishMatterKeyToMembers: vi.fn(), registerDevice: vi.fn(), append: vi.fn(),
}));

vi.mock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({ linkFirmMatter: mocks.linkFirmMatter }) } }));
vi.mock('@/platform/firm/matterKeyService', () => ({ createLocalMatterKey: mocks.createLocalMatterKey, forgetMatterKey: mocks.forgetMatterKey, publishMatterKeyToMembers: mocks.publishMatterKeyToMembers }));
vi.mock('@/platform/firm/deviceKeys', () => ({ registerDevice: mocks.registerDevice }));
vi.mock('@/features/matters/matterManagerDialogHelpers', () => ({ audit: { append: mocks.append } }));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => ({ seatToken: 'seat', session: { org: { org_id: 'org' } } }) },
}));

import { promoteMatterToShared } from './promoteMatterToShared';

const matterHandle = parseMatterHandle(`mh2_${'P'.repeat(43)}`);
const rootStreamHandle = parseStreamHandle(`sh2_${'Q'.repeat(43)}`);

async function generatedKey(): Promise<string> {
  return (await import('@/platform/firm/matterCrypto')).generateMatterKey();
}

function successfulClient() {
  return {
    createMatter: vi.fn(async () => ({ matter_handle: matterHandle, root_stream_handle: rootStreamHandle, key_epoch: 1 as const, status: 'provisioning' as const })),
    pushUpdate: vi.fn(async () => ({ ok: true as const, cursor: 1, blob_id: 'x', key_epoch: 1, duplicate: false })),
    activateMatter: vi.fn(async () => ({ ok: true as const })),
    archiveMatter: vi.fn(async () => ({ ok: true as const })),
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
    mocks.createLocalMatterKey.mockResolvedValue(await generatedKey());
    mocks.forgetMatterKey.mockResolvedValue(undefined);
    mocks.publishMatterKeyToMembers.mockResolvedValue({ published: 1, skippedWalled: 0 });
    mocks.registerDevice.mockResolvedValue(undefined);
  });

  it('seals encrypted root details before activating the opaque shell', async () => {
    const order: string[] = [];
    const client = {
      createMatter: vi.fn(async () => { order.push('provision'); return { matter_handle: matterHandle, root_stream_handle: rootStreamHandle, key_epoch: 1, status: 'provisioning' as const }; }),
      pushUpdate: vi.fn(async () => { order.push('root-index'); return { ok: true, cursor: 1, blob_id: 'x', key_epoch: 1, duplicate: false }; }),
      activateMatter: vi.fn(async () => { order.push('activate'); return { ok: true }; }),
    };
    const result = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);
    expect(result.status).toBe('shared');
    expect(order).toEqual(['provision', 'root-index', 'activate']);
    expect(JSON.stringify(client.pushUpdate.mock.calls)).not.toContain('CLIENT_SECRET_NIMBUS');
    expect(mocks.linkFirmMatter).toHaveBeenCalledWith('local-matter-77', expect.objectContaining({ firmMatterId: matterHandle, rootStreamHandle }));
  });

  it('does not activate or link a failed provisioning record', async () => {
    const client = {
      createMatter: vi.fn(async () => ({ matter_handle: matterHandle, root_stream_handle: rootStreamHandle, key_epoch: 1, status: 'provisioning' as const })),
      pushUpdate: vi.fn(async () => { throw new Error('root write failed'); }),
      activateMatter: vi.fn(),
    };
    const result = await promoteMatterToShared('local-matter-77', 'CLIENT_SECRET_NIMBUS', client as never);
    expect(result.status).toBe('failed');
    expect(client.activateMatter).not.toHaveBeenCalled();
    expect(mocks.linkFirmMatter).not.toHaveBeenCalled();
    expect(mocks.forgetMatterKey).toHaveBeenCalledWith(matterHandle);
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
    expect(mocks.forgetMatterKey).toHaveBeenCalledWith(matterHandle);
  });

  it('keeps a failed encrypted root-index write invisible and allows a clean retry', async () => {
    const client = successfulClient();
    client.pushUpdate.mockRejectedValueOnce(new Error('root write failed'));

    await expectFailedThenRetryable(client, 'root write failed');

    expect(client.activateMatter).toHaveBeenCalledTimes(1);
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

    expect(client.archiveMatter).toHaveBeenCalledTimes(1);
    expect(client.archiveMatter).toHaveBeenCalledWith(matterHandle);
    expect(client.activateMatter).toHaveBeenCalledTimes(2);
  });
});
