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

import { FirmApiError } from '@/platform/firm/FirmApiClient';
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


// The promotion pending record is DURABLE by design (it is what lets an unknown
// network outcome resume the same shell). That durability leaks across tests, so
// stub it with per-test state — otherwise one test's leftover record makes the
// next test skip creation and silently "succeed".
let pendingRecord: unknown = null;
vi.mock('@/platform/firm/firmKeychain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/firm/firmKeychain')>();
  return {
    ...actual,
    loadPromotionPending: vi.fn(() => Promise.resolve(pendingRecord)),
    storePromotionPending: vi.fn((_id: string, record: unknown) => { pendingRecord = record; return Promise.resolve(); }),
    clearPromotionPending: vi.fn(() => { pendingRecord = null; return Promise.resolve(); }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  pendingRecord = null;
  storeMatters = [{ id: 'm1' }];
});

describe('promoteMatterToShared', () => {
  it('shares a matter in relay-safe order: provision, key, activate, root index, then publish', async () => {
    const client = makeClient();
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'shared', matterId: 'm1', firmMatterId: MATTER, orgId: 'org_1' });
    expect(client.createMatter).toHaveBeenCalledWith();
    expect(createLocalMatterKey).toHaveBeenCalledWith(MATTER);
    expect(writeFirmMatterPrivateIndex).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      streams: { _notes: { streamHandle: ROOT, kind: 'notes' } },
    }));
    expect(client.pushUpdate).toHaveBeenCalledWith(MATTER, ROOT, expect.any(String), 'encrypted-root-index', 'seat-token', 1);
    expect(client.activateMatter).toHaveBeenCalledWith(MATTER);
    expect(linkFirmMatter).toHaveBeenCalledWith('m1', { firmMatterId: MATTER, rootStreamHandle: ROOT, orgId: 'org_1', role: 'owner' });
    expect(registerDevice).toHaveBeenCalledWith(client);
    expect(publishMatterKeyToMembers).toHaveBeenCalledTimes(1);
    expect(publishMatterKeyToMembers).toHaveBeenCalledWith(client, MATTER, 1);
    expect(client.createMatter.mock.invocationCallOrder[0]).toBeLessThan(createLocalMatterKey.mock.invocationCallOrder[0]!);
    expect(createLocalMatterKey.mock.invocationCallOrder[0]).toBeLessThan(client.activateMatter.mock.invocationCallOrder[0]!);
    expect(client.activateMatter.mock.invocationCallOrder[0]).toBeLessThan(client.pushUpdate.mock.invocationCallOrder[0]!);
    expect(client.activateMatter.mock.invocationCallOrder[0]).toBeLessThan(registerDevice.mock.invocationCallOrder[0]!);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'matter_shared' }));
  });

  it('DEFINITE rejection: archives the shell and forgets the key (nothing committed)', async () => {
    const client = makeClient();
    publishMatterKeyToMembers.mockRejectedValueOnce(new FirmApiError(400, 'invalid_v2_payload', 'relay rejected'));
    storeMatters = [{ id: 'm1', firmMatterId: MATTER }];
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toMatchObject({ status: 'failed', matterId: 'm1' });
    expect(client.archiveMatter).toHaveBeenCalledWith(MATTER);
    expect(forgetMatterKey).toHaveBeenCalledWith(MATTER);
  });

  it('UNKNOWN outcome: keeps the shell and the key so a later run can resume', async () => {
    // A timeout/network error may have COMMITTED the write. Archiving on a guess
    // would destroy a live shared client, and forgetting the key would make it
    // unrecoverable. Keep both; the durable pending record resumes the same shell.
    const client = makeClient();
    publishMatterKeyToMembers.mockRejectedValueOnce(new Error('relay down'));
    storeMatters = [{ id: 'm1', firmMatterId: MATTER }];
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'failed', matterId: 'm1', error: 'relay down' });
    expect(client.archiveMatter).not.toHaveBeenCalled();
    expect(forgetMatterKey).not.toHaveBeenCalled();
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
