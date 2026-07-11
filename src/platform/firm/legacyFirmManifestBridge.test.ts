import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Matter } from '@/platform/types/matter';
import { FirmApiClient } from './FirmApiClient';
import { parseMatterHandle, parseStreamHandle, type LegacyMigrationManifestMatter } from './contract';
import { decryptUpdateV2, generateMatterKey, importMatterKey } from './matterCrypto';
import { readFirmMatterPrivateIndex } from './firmMatterPrivateIndex';
import { type LegacyFirmManifestBridgeOptions, runLegacyFirmManifestBridge } from './legacyFirmManifestBridge';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: () => Promise.resolve(fetch) }));

const matterHandle = parseMatterHandle(`mh2_${'A'.repeat(43)}`);
const rootStreamHandle = parseStreamHandle(`sh2_${'B'.repeat(43)}`);
const documentStreamHandle = parseStreamHandle(`sh2_${'C'.repeat(43)}`);
const extraMatterHandle = parseMatterHandle(`mh2_${'D'.repeat(43)}`);
const extraRootStreamHandle = parseStreamHandle(`sh2_${'E'.repeat(43)}`);

const sentinels = [
  'CLIENT_SECRET_NIMBUS',
  'matter-semantic-123',
  'local-matter-77',
  'doc-advisory-plan.docx',
  'Client plan.docx',
  '/clients/nimbus',
];

function legacyMatter(): Matter {
  return {
    id: 'local-matter-77',
    name: 'Nimbus household',
    client: 'CLIENT_SECRET_NIMBUS',
    folderPaths: ['/clients/nimbus'],
    mailFolderPaths: [],
    createdAt: '2026-01-01T00:00:00Z',
    firmMatterId: 'matter-semantic-123',
    shared: true,
  };
}

function row(overrides: Partial<LegacyMigrationManifestMatter> = {}): LegacyMigrationManifestMatter {
  return {
    legacy_matter_id: 'matter-semantic-123',
    matter_handle: matterHandle,
    root_stream_handle: rootStreamHandle,
    streams: { _notes: rootStreamHandle, 'legacy-document-9': documentStreamHandle },
    ...overrides,
  };
}

interface Traffic { url: string; method: string; body: string; headers: string; }

function clientFor(
  manifest: LegacyMigrationManifestMatter[],
  traffic: Traffic[],
  complete: () => Response = () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
): FirmApiClient {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    traffic.push({ url, method, body: typeof init?.body === 'string' ? init.body : '', headers: JSON.stringify(init?.headers ?? {}) });
    if (url.endsWith('/migration-manifest')) {
      return Promise.resolve(new Response(JSON.stringify({ matters: manifest }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.endsWith('/migration-complete')) return Promise.resolve(complete());
    if (url.endsWith('/updates')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, cursor: 1, blob_id: 'opaque-blob', key_epoch: 1, duplicate: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  return new FirmApiClient({ getAccessToken: () => 'access-token', refreshAccessToken: () => Promise.resolve(null) });
}

function bridgeOptions(
  client: FirmApiClient,
  initialMatters: Matter[],
  keyB64: string,
  placeholders: Matter[],
): {
  options: LegacyFirmManifestBridgeOptions;
  matters: () => Matter[];
  saveMatter: ReturnType<typeof vi.fn>;
  createPlaceholder: ReturnType<typeof vi.fn>;
} {
  let matters = initialMatters;
  const saveMatter = vi.fn((updated: Matter) => {
    matters = matters.map((matter) => matter.id === updated.id ? updated : matter);
  });
  const createPlaceholder = vi.fn(({ matterHandle: handle, rootStreamHandle: root }: { matterHandle: typeof matterHandle; rootStreamHandle: typeof rootStreamHandle }) => {
    const placeholder: Matter = {
      id: `placeholder-${String(placeholders.length + 1)}`,
      name: 'Shared client',
      client: 'Shared client',
      folderPaths: [],
      createdAt: '2026-01-01T00:00:00Z',
      firmMatterId: handle,
      rootStreamHandle: root,
      shared: true,
      sharedDetailsPending: true,
    };
    placeholders.push(placeholder);
    matters = [...matters, placeholder];
  });
  return {
    options: {
      client,
      seatToken: 'seat-token',
      getMatters: () => matters,
      saveMatter,
      createPlaceholder,
      localDocumentIdForLegacyId: (_matter: Matter, legacyDocumentId: string) => legacyDocumentId === 'legacy-document-9' ? 'doc-advisory-plan.docx' : null,
      loadLegacyMatterKey: (_legacyMatterId: string) => Promise.resolve(keyB64),
      storeOpaqueMatterKey: () => Promise.resolve(),
      clearLegacyMatterKey: () => Promise.resolve(),
    },
    matters: () => matters,
    saveMatter,
    createPlaceholder,
  };
}

describe('one-time legacy firm manifest bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the opaque local link, seals the encrypted root index, then acknowledges', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const placeholders: Matter[] = [];
    const fixture = bridgeOptions(clientFor([row()], traffic), [legacyMatter()], keyB64, placeholders);

    const result = await runLegacyFirmManifestBridge(fixture.options);

    expect(result).toMatchObject({ status: 'completed', migratedMatterIds: ['local-matter-77'], placeholderCount: 0, notices: [] });
    expect(fixture.matters()[0]).toMatchObject({ firmMatterId: matterHandle, rootStreamHandle, shared: true });
    expect(fixture.matters()[0]).not.toHaveProperty('legacyFirmMatterId');
    expect(fixture.matters()[0]).not.toHaveProperty('firmMigrationSealed');

    const updateBody = JSON.parse(traffic.find((request) => request.url.endsWith('/updates'))!.body) as { ciphertext_b64: string };
    const key = await importMatterKey(keyB64);
    const opened = await decryptUpdateV2(key, updateBody.ciphertext_b64, { matterHandle, streamHandle: rootStreamHandle, keyEpoch: 1 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('Expected encrypted root index to open.');
    const root = new Y.Doc();
    Y.applyUpdate(root, opened.update);
    expect(readFirmMatterPrivateIndex(root)).toMatchObject({
      clientName: 'CLIENT_SECRET_NIMBUS',
      displayName: 'Nimbus household',
      streams: {
        _notes: { streamHandle: rootStreamHandle, kind: 'notes' },
        'doc-advisory-plan.docx': { streamHandle: documentStreamHandle, kind: 'document' },
      },
    });
    expect(traffic.map((request) => request.url.split('/').pop())).toEqual(['migration-manifest', 'updates', 'migration-complete']);
  });

  it('resumes after a crash after sealing but before acknowledgement without sealing twice', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const placeholders: Matter[] = [];
    let completeAttempts = 0;
    const fixture = bridgeOptions(clientFor([row()], traffic, () => {
      completeAttempts++;
      return completeAttempts === 1
        ? new Response(JSON.stringify({ error: 'temporary' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }), [legacyMatter()], keyB64, placeholders);

    await expect(runLegacyFirmManifestBridge(fixture.options)).rejects.toThrow();
    expect(fixture.matters()[0]).toMatchObject({ firmMatterId: matterHandle, legacyFirmMatterId: 'matter-semantic-123', firmMigrationSealed: true });
    await expect(runLegacyFirmManifestBridge(fixture.options)).resolves.toMatchObject({ status: 'completed' });

    expect(traffic.filter((request) => request.url.endsWith('/updates'))).toHaveLength(1);
    expect(traffic.filter((request) => request.url.endsWith('/migration-manifest'))).toHaveLength(2);
    expect(traffic.filter((request) => request.url.endsWith('/migration-complete'))).toHaveLength(2);
    expect(fixture.matters()[0]).not.toHaveProperty('legacyFirmMatterId');
  });

  it('does not acknowledge until every matched root index was accepted', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const second = { ...legacyMatter(), id: 'local-matter-88', firmMatterId: 'matter-semantic-456', name: 'Orion household', client: 'ORION_SECRET' };
    const secondRow = row({ legacy_matter_id: 'matter-semantic-456', matter_handle: extraMatterHandle, root_stream_handle: extraRootStreamHandle, streams: { _notes: extraRootStreamHandle } });
    const placeholders: Matter[] = [];
    const fixture = bridgeOptions(clientFor([row(), secondRow], traffic), [legacyMatter(), second], keyB64, placeholders);

    await runLegacyFirmManifestBridge(fixture.options);

    const completeIndex = traffic.findIndex((request) => request.url.endsWith('/migration-complete'));
    expect(completeIndex).toBeGreaterThan(traffic.findIndex((request) => request.url.endsWith('/updates')));
    expect(traffic.slice(0, completeIndex).filter((request) => request.url.endsWith('/updates'))).toHaveLength(2);
  });

  it('seals available clients, acknowledges, and resumes a client that is waiting for its key', async () => {
    const traffic: Traffic[] = [];
    const second = {
      ...legacyMatter(),
      id: 'local-matter-88',
      firmMatterId: 'matter-semantic-456',
      name: 'Orion household',
      client: 'ORION_SECRET',
    };
    const secondRow = row({
      legacy_matter_id: 'matter-semantic-456',
      matter_handle: extraMatterHandle,
      root_stream_handle: extraRootStreamHandle,
      streams: { _notes: extraRootStreamHandle },
    });
    const keyB64 = await generateMatterKey();
    const fixture = bridgeOptions(clientFor([row(), secondRow], traffic), [legacyMatter(), second], keyB64, []);
    let firstClientKey: string | null = null;
    const loadLegacyMatterKey = vi.fn((legacyMatterId: string) =>
      Promise.resolve(legacyMatterId === 'matter-semantic-123' ? firstClientKey : keyB64),
    );
    const clearLegacyMatterKey = vi.fn(() => Promise.resolve());
    fixture.options.loadLegacyMatterKey = loadLegacyMatterKey;
    fixture.options.clearLegacyMatterKey = clearLegacyMatterKey;

    await expect(runLegacyFirmManifestBridge(fixture.options)).resolves.toMatchObject({
      status: 'completed',
      migratedMatterIds: ['local-matter-88'],
      notices: ['A shared client is waiting for its encryption key on this device.'],
    });

    expect(fixture.matters()[0]).toMatchObject({
      firmMatterId: matterHandle,
      legacyFirmMatterId: 'matter-semantic-123',
      firmMigrationSealed: false,
    });
    expect(fixture.matters()[1]).toMatchObject({ firmMatterId: extraMatterHandle });
    expect(fixture.matters()[1]).not.toHaveProperty('legacyFirmMatterId');
    expect(clearLegacyMatterKey).toHaveBeenCalledWith('matter-semantic-456');
    expect(clearLegacyMatterKey).not.toHaveBeenCalledWith('matter-semantic-123');
    expect(traffic.filter((request) => request.url.endsWith('/updates'))).toHaveLength(1);
    expect(traffic.filter((request) => request.url.endsWith('/migration-complete'))).toHaveLength(1);

    firstClientKey = await generateMatterKey();
    await expect(runLegacyFirmManifestBridge(fixture.options)).resolves.toMatchObject({
      status: 'completed',
      migratedMatterIds: ['local-matter-77'],
      notices: [],
    });

    expect(fixture.matters()[0]).toMatchObject({ firmMatterId: matterHandle });
    expect(fixture.matters()[0]).not.toHaveProperty('legacyFirmMatterId');
    expect(traffic.filter((request) => request.url.endsWith('/updates'))).toHaveLength(2);
    expect(traffic.filter((request) => request.url.endsWith('/migration-complete'))).toHaveLength(2);
  });

  it('creates a generic pending placeholder for an authorized manifest row with no local match', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const placeholders: Matter[] = [];
    const extra = row({ legacy_matter_id: 'other-legacy-matter', matter_handle: extraMatterHandle, root_stream_handle: extraRootStreamHandle, streams: { _notes: extraRootStreamHandle } });
    const fixture = bridgeOptions(clientFor([row(), extra], traffic), [legacyMatter()], keyB64, placeholders);

    await expect(runLegacyFirmManifestBridge(fixture.options)).resolves.toMatchObject({ placeholderCount: 1 });

    expect(placeholders).toEqual([expect.objectContaining({
      name: 'Shared client', client: 'Shared client', firmMatterId: extraMatterHandle,
      rootStreamHandle: extraRootStreamHandle, sharedDetailsPending: true,
    })]);
  });

  it('does nothing when the device has no legacy link', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const localOnly = { ...legacyMatter(), firmMatterId: matterHandle, rootStreamHandle, shared: true };
    const fixture = bridgeOptions(clientFor([row()], traffic), [localOnly], keyB64, []);

    await expect(runLegacyFirmManifestBridge(fixture.options)).resolves.toEqual({ status: 'noop', migratedMatterIds: [], placeholderCount: 0, notices: [] });
    expect(traffic).toEqual([]);
  });

  it('keeps a missing legacy row local-only and returns a plain non-blocking notice', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const fixture = bridgeOptions(clientFor([], traffic), [legacyMatter()], keyB64, []);

    await expect(runLegacyFirmManifestBridge(fixture.options)).resolves.toMatchObject({
      status: 'completed',
      notices: ['A shared client was not found on this device, so it remains local only.'],
    });
    expect(fixture.matters()[0]).toMatchObject({ id: 'local-matter-77', shared: false });
    expect(fixture.matters()[0]).not.toHaveProperty('firmMatterId');
    expect(traffic.map((request) => request.url.split('/').pop())).toEqual(['migration-manifest', 'migration-complete']);
  });

  it('never places local names or identifiers in either bridge request', async () => {
    const traffic: Traffic[] = [];
    const keyB64 = await generateMatterKey();
    const fixture = bridgeOptions(clientFor([row()], traffic), [legacyMatter()], keyB64, []);

    await runLegacyFirmManifestBridge(fixture.options);

    for (const request of traffic) {
      const url = new URL(request.url, 'http://firm.test');
      for (const sentinel of sentinels) {
        expect(url.pathname).not.toContain(sentinel);
        expect(url.search).not.toContain(sentinel);
        expect(request.headers).not.toContain(sentinel);
        expect(request.body).not.toContain(sentinel);
      }
    }
    const manifestRequest = traffic.find((request) => request.url.endsWith('/migration-manifest'));
    const completeRequest = traffic.find((request) => request.url.endsWith('/migration-complete'));
    expect(manifestRequest?.body).toBe('{}');
    expect(completeRequest?.body).toBe('{}');
  });
});
