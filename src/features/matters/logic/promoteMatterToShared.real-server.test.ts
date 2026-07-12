import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { generateMatterKey } from '@/platform/firm/matterCrypto';

const mocks = vi.hoisted(() => ({
  linkFirmMatter: vi.fn(), createLocalMatterKey: vi.fn(), forgetMatterKey: vi.fn(),
  publishMatterKeyToMembers: vi.fn(), registerDevice: vi.fn(), append: vi.fn(),
  firmState: { seatToken: 'placeholder-seat', session: { org: { org_id: 'placeholder-org' } } },
}));

vi.mock('@/platform/matter/matterStore', () => ({ useMatterStore: { getState: () => ({ linkFirmMatter: mocks.linkFirmMatter }) } }));
vi.mock('@/platform/firm/matterKeyService', () => ({ createLocalMatterKey: mocks.createLocalMatterKey, forgetMatterKey: mocks.forgetMatterKey, publishMatterKeyToMembers: mocks.publishMatterKeyToMembers }));
vi.mock('@/platform/firm/deviceKeys', () => ({ registerDevice: mocks.registerDevice }));
vi.mock('@/features/matters/matterManagerDialogHelpers', () => ({ audit: { append: mocks.append } }));
vi.mock('@/platform/firm/firmStore', () => ({ useFirmStore: { getState: () => mocks.firmState } }));

import { FirmApiError } from '@/platform/firm/FirmApiClient';
import { promoteMatterToShared } from './promoteMatterToShared';

type Relay = { base: string; token: string; seatToken: string; orgId: string };
let processHandle: ChildProcess | undefined;
let relay: Relay;

async function startRelay(): Promise<Relay> {
  const child = spawn('bun', ['run', 'test/helpers/promote-real-server.ts'], {
    cwd: `${process.cwd()}/backend`, env: { ...process.env, NODE_ENV: 'test', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle = child;
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => { reject(new Error(`real promotion relay did not start: ${output}`)); }, 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split('\n').find((value) => value.startsWith('{'));
      if (!line) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line) as Relay);
    });
    child.once('error', reject);
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  });
}

function realRelayClient(failRootPush: false | 'unknown' | 'definite' = false) {
  let lastHandle = '';
  let lastRootStream = '';
  const request = async (path: string, body: unknown, seat = false) => {
    const response = await fetch(`${relay.base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'application/json', ...(seat ? { 'x-seat-token': relay.seatToken } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`relay ${String(response.status)}: ${await response.text()}`);
    return await response.json() as Record<string, unknown>;
  };
  return {
    get lastHandle() { return lastHandle; },
    get lastRootStream() { return lastRootStream; },
    createMatter: async () => {
      const response = await request('/v2/firm/matters', {});
      lastHandle = response['matter_handle'] as string;
      lastRootStream = response['root_stream_handle'] as string;
      return response;
    },
    activateMatter: (handle: string) => request(`/v2/firm/matters/${handle}/activate`, {}),
    pushUpdate: (handle: string, stream: string, blobId: string, ciphertext: string, seatToken: string, keyEpoch: number) => {
      if (failRootPush === 'unknown') return Promise.reject(new Error('forced network failure (outcome unknown)'));
      if (failRootPush === 'definite') return Promise.reject(new FirmApiError(400, 'invalid_v2_payload', 'relay rejected the root write'));
      return request(`/v2/firm/matters/${handle}/streams/${stream}/updates`, { blob_id: blobId, ciphertext_b64: ciphertext, seat_token: seatToken, key_epoch: keyEpoch });
    },
    archiveMatter: (handle: string) => request(`/v2/firm/matters/${handle}/archive`, {}),
  };
}

describe('promoteMatterToShared against a real Bun relay', () => {
  beforeAll(async () => {
    relay = await startRelay();
    mocks.firmState.seatToken = relay.seatToken;
    mocks.firmState.session.org.org_id = relay.orgId;
    mocks.createLocalMatterKey.mockImplementation(generateMatterKey);
    mocks.forgetMatterKey.mockResolvedValue(undefined);
    mocks.registerDevice.mockResolvedValue(undefined);
    mocks.publishMatterKeyToMembers.mockResolvedValue({ published: 1, skippedWalled: 0 });
  });

  afterAll(() => processHandle?.kill('SIGTERM'));

  it('activates before the first root write so a new shared client becomes usable, and archives a failed shell', async () => {
    const good = realRelayClient();
    const shared = await promoteMatterToShared('local-new-client', 'CLIENT_SECRET_NIMBUS', good as never);
    expect(shared.status).toBe('shared');
    expect(mocks.linkFirmMatter).toHaveBeenCalledWith('local-new-client', expect.objectContaining({ firmMatterId: good.lastHandle }));
    const pull = await fetch(`${relay.base}/v2/firm/streams/${good.lastRootStream}/updates?since=0`, { headers: { authorization: `Bearer ${relay.token}`, 'x-seat-token': relay.seatToken } });
    expect(pull.status).toBe(200);
    expect((await pull.json() as { updates: unknown[] }).updates).toHaveLength(1);
    const list = await fetch(`${relay.base}/v2/firm/matters/list`, { method: 'POST', headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'application/json' }, body: '{}' });
    const matters = await list.json() as { matters: Array<{ matter_handle: string; status: string }> };
    expect(matters.matters.find((matter) => matter.matter_handle === good.lastHandle)?.status).toBe('active');

    // A DEFINITE relay rejection means nothing committed: archive the shell so it
    // cannot leak or hold quota.
    const rejected = realRelayClient('definite');
    await expect(promoteMatterToShared('local-rejected-client', 'CLIENT_SECRET_NIMBUS', rejected as never)).resolves.toMatchObject({ status: 'failed' });
    const afterReject = await (await fetch(`${relay.base}/v2/firm/matters/list`, { method: 'POST', headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'application/json' }, body: '{}' })).json() as { matters: Array<{ matter_handle: string; status: string }> };
    expect(afterReject.matters.find((matter) => matter.matter_handle === rejected.lastHandle)?.status).toBe('archived');

    // An UNKNOWN outcome (network) may have committed the root write. Archiving on
    // a guess would destroy a live shared client, so the shell must SURVIVE and stay
    // resumable from the durable pending record.
    const unknown = realRelayClient('unknown');
    await expect(promoteMatterToShared('local-unknown-client', 'CLIENT_SECRET_NIMBUS', unknown as never)).resolves.toMatchObject({ status: 'failed' });
    const afterUnknown = await (await fetch(`${relay.base}/v2/firm/matters/list`, { method: 'POST', headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'application/json' }, body: '{}' })).json() as { matters: Array<{ matter_handle: string; status: string }> };
    expect(afterUnknown.matters.find((matter) => matter.matter_handle === unknown.lastHandle)?.status).not.toBe('archived');
  });
});
