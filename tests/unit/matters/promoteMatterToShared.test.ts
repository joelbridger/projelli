import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the matter store so we can assert link/unlink calls and matter lookups.
const linkFirmMatter = vi.fn();
const unlinkFirmMatter = vi.fn();
let storeMatters: Array<{ id: string; firmMatterId?: string }> = [];
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: { getState: () => ({ linkFirmMatter, unlinkFirmMatter, matters: storeMatters }) },
}));

// Mock the key service (the crypto/relay side) — we assert it is called, not its internals.
const createLocalMatterKey = vi.fn().mockResolvedValue('key-b64');
const forgetMatterKey = vi.fn().mockResolvedValue(undefined);
const publishMatterKeyToMembers = vi.fn().mockResolvedValue(undefined);
vi.mock('@/platform/firm/matterKeyService', () => ({
  createLocalMatterKey: (...a: unknown[]) => createLocalMatterKey(...a),
  forgetMatterKey: (...a: unknown[]) => forgetMatterKey(...a),
  publishMatterKeyToMembers: (...a: unknown[]) => publishMatterKeyToMembers(...a),
}));

const encryptUpdateV2 = vi.fn().mockResolvedValue('encrypted-root-index');
vi.mock('@/platform/firm/matterCrypto', () => ({
  importMatterKey: vi.fn().mockResolvedValue({}),
  encryptUpdateV2: (...a: unknown[]) => encryptUpdateV2(...a),
}));

const writeFirmMatterPrivateIndex = vi.fn();
vi.mock('@/platform/firm/firmMatterPrivateIndex', () => ({
  writeFirmMatterPrivateIndex: (...a: unknown[]) => writeFirmMatterPrivateIndex(...a),
}));

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => ({ seatToken: 'seat-token', session: { org: { org_id: 'org_1' } } }) },
}));

// registerDevice lives in deviceKeys (confirmed against the live MatterManagerDialog imports).
const registerDevice = vi.fn().mockResolvedValue(undefined);
vi.mock('@/platform/firm/deviceKeys', () => ({
  registerDevice: (...a: unknown[]) => registerDevice(...a),
}));

// The dialog uses a shared `audit` instance from matterManagerDialogHelpers
// (new AuditService('firm')). promoteMatterToShared reuses that SAME instance,
// so we mock it at that module to assert the audit call without touching crypto.
const append = vi.fn();
vi.mock('@/features/matters/matterManagerDialogHelpers', () => ({
  audit: { append: (...a: unknown[]) => append(...a) },
}));

import { promoteMatterToShared } from '@/features/matters/logic/promoteMatterToShared';
import type { MatterHandle, StreamHandle } from '@/platform/firm/contract';

const MATTER = `mh2_${'m'.repeat(43)}` as MatterHandle;
const ROOT = `sh2_${'r'.repeat(43)}` as StreamHandle;

const makeClient = () => ({
  createMatter: vi.fn().mockResolvedValue({ matter_handle: MATTER, root_stream_handle: ROOT, key_epoch: 1, status: 'provisioning' }),
  pushUpdate: vi.fn().mockResolvedValue({ ok: true }),
  activateMatter: vi.fn().mockResolvedValue({ ok: true }),
  archiveMatter: vi.fn().mockResolvedValue({ ok: true }),
});

beforeEach(() => {
  vi.clearAllMocks();
  storeMatters = [{ id: 'm1' }];
});

describe('promoteMatterToShared', () => {
  it('shares a matter in private order: provision, key, root index, activate, then publish', async () => {
    const client = makeClient();
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'shared', matterId: 'm1', firmMatterId: MATTER, orgId: 'org_1' });
    expect(client.createMatter).toHaveBeenCalledWith();
    expect(createLocalMatterKey).toHaveBeenCalledWith(MATTER);
    expect(writeFirmMatterPrivateIndex).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      streams: { _notes: { streamHandle: ROOT, kind: 'notes' } },
    }));
    expect(client.pushUpdate).toHaveBeenCalledWith(ROOT, expect.any(String), 'encrypted-root-index', 'seat-token', 1);
    expect(client.activateMatter).toHaveBeenCalledWith(MATTER);
    expect(linkFirmMatter).toHaveBeenCalledWith('m1', { firmMatterId: MATTER, rootStreamHandle: ROOT, orgId: 'org_1', role: 'owner' });
    expect(registerDevice).toHaveBeenCalledWith(client);
    expect(publishMatterKeyToMembers).toHaveBeenCalledTimes(1);
    expect(publishMatterKeyToMembers).toHaveBeenCalledWith(client, MATTER, 1);
    expect(client.createMatter.mock.invocationCallOrder[0]).toBeLessThan(createLocalMatterKey.mock.invocationCallOrder[0]!);
    expect(createLocalMatterKey.mock.invocationCallOrder[0]).toBeLessThan(client.pushUpdate.mock.invocationCallOrder[0]!);
    expect(client.pushUpdate.mock.invocationCallOrder[0]).toBeLessThan(client.activateMatter.mock.invocationCallOrder[0]!);
    expect(client.activateMatter.mock.invocationCallOrder[0]).toBeLessThan(registerDevice.mock.invocationCallOrder[0]!);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'matter_shared' }));
  });

  it('rolls back the link on failure and returns a failed result', async () => {
    const client = makeClient();
    publishMatterKeyToMembers.mockRejectedValueOnce(new Error('relay down'));
    storeMatters = [{ id: 'm1', firmMatterId: MATTER }];
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'failed', matterId: 'm1', error: 'relay down' });
    expect(client.archiveMatter).toHaveBeenCalledWith(MATTER);
    expect(forgetMatterKey).toHaveBeenCalledWith(MATTER);
  });

  it('does not unlink on failure if the link was never set', async () => {
    const client = makeClient();
    client.createMatter.mockRejectedValueOnce(new Error('create failed'));
    storeMatters = [{ id: 'm1' }]; // no firmMatterId — link never happened
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'failed', matterId: 'm1', error: 'create failed' });
    expect(unlinkFirmMatter).not.toHaveBeenCalled();
  });
});
