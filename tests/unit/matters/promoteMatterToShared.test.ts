import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the matter store so we can assert link/unlink calls and matter lookups.
const linkFirmMatter = vi.fn();
const unlinkFirmMatter = vi.fn();
let storeMatters: Array<{ id: string; firmMatterId?: string }> = [];
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: { getState: () => ({ linkFirmMatter, unlinkFirmMatter, matters: storeMatters }) },
}));

// Mock the key service (the crypto/relay side) — we assert it is called, not its internals.
const getOrCreateMatterKey = vi.fn().mockResolvedValue(undefined);
const publishMatterKeyToMembers = vi.fn().mockResolvedValue(undefined);
vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: (...a: unknown[]) => getOrCreateMatterKey(...a),
  publishMatterKeyToMembers: (...a: unknown[]) => publishMatterKeyToMembers(...a),
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

const makeClient = () => ({
  createMatter: vi.fn().mockResolvedValue({ matter: { matter_id: 'fm_1', org_id: 'org_1', key_epoch: 3 } }),
});

beforeEach(() => {
  vi.clearAllMocks();
  storeMatters = [{ id: 'm1' }];
});

describe('promoteMatterToShared', () => {
  it('shares a matter: creates the firm shell, links, publishes the key once, audits', async () => {
    const client = makeClient();
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'shared', matterId: 'm1', firmMatterId: 'fm_1', orgId: 'org_1' });
    expect(client.createMatter).toHaveBeenCalledWith('Acme');
    expect(linkFirmMatter).toHaveBeenCalledWith('m1', { firmMatterId: 'fm_1', orgId: 'org_1', role: 'owner' });
    expect(getOrCreateMatterKey).toHaveBeenCalledWith('fm_1');
    expect(registerDevice).toHaveBeenCalledWith(client);
    expect(publishMatterKeyToMembers).toHaveBeenCalledTimes(1);
    expect(publishMatterKeyToMembers).toHaveBeenCalledWith(client, 'fm_1', 3);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'matter_shared' }));
  });

  it('rolls back the link on failure and returns a failed result', async () => {
    const client = makeClient();
    publishMatterKeyToMembers.mockRejectedValueOnce(new Error('relay down'));
    storeMatters = [{ id: 'm1', firmMatterId: 'fm_1' }]; // link was set before the failure
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'failed', matterId: 'm1', error: 'relay down' });
    expect(unlinkFirmMatter).toHaveBeenCalledWith('m1');
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
