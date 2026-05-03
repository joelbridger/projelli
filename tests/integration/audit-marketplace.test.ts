/**
 * Audit log spot-check for the Templates Marketplace (Stream C1 Group IX,
 * Task 9.3).
 *
 * Runs install + uninstall + update + failed-install paths against the real
 * `MarketplaceService` and asserts the audit log contains every expected
 * event type, in the right order, with the right metadata shape.
 *
 * Scope:
 *   - `template_installed_from_marketplace` — happy install
 *   - `template_uninstalled` — uninstall
 *   - `template_install_failed` — install with checksum mismatch
 *   - `template_updated` — re-install with `isUpdate: true` carrying both
 *     legacy `version` AND `fromVersion` / `toVersion` fields per spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { MarketplaceService } from '@/modules/marketplace/MarketplaceService';
import { AuditService } from '@/modules/audit/AuditService';
import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry } from '@/types/marketplace';
import type { TemplateManifest } from '@/types/templateManifest';

const mockInvoke = vi.mocked(tauriCore.invoke);

interface FakeFs {
  fs: FSBackend;
  files: Map<string, string>;
  binaryFiles: Map<string, Uint8Array>;
}

function makeFs(): FakeFs {
  const files = new Map<string, string>();
  const binaryFiles = new Map<string, Uint8Array>();
  const fs = {
    read: vi.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    }),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    readBinary: vi.fn(async (p: string) =>
      (binaryFiles.get(p) ?? new Uint8Array()).buffer,
    ),
    writeBinary: vi.fn(async (p: string, b: ArrayBuffer) => {
      binaryFiles.set(p, new Uint8Array(b));
    }),
    exists: vi.fn(async (p: string) => files.has(p) || binaryFiles.has(p)),
    delete: vi.fn(async (p: string) => {
      files.delete(p);
      binaryFiles.delete(p);
    }),
    move: vi.fn(async (from: string, to: string) => {
      const b = binaryFiles.get(from);
      if (b) {
        binaryFiles.set(to, b);
        binaryFiles.delete(from);
      }
      const t = files.get(from);
      if (t !== undefined) {
        files.set(to, t);
        files.delete(from);
      }
    }),
    copy: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(async () => {}),
    list: vi.fn(),
    stat: vi.fn(),
    isSymlink: vi.fn(),
    resolveSymlink: vi.fn(),
    getRootPath: vi.fn(() => '/ws'),
    setRootPath: vi.fn(),
  } as unknown as FSBackend;
  return { fs, files, binaryFiles };
}

const TEMPLATE_ID = 'audit-template';
const INSTALL_ROOT = '/ws/.projelli/templates';
const INSTALL_DIR = `${INSTALL_ROOT}/${TEMPLATE_ID}`;

const ENTRY_V1: CatalogEntry = {
  id: TEMPLATE_ID,
  name: 'Audit Template',
  description: 'Template used for audit log spot-checks.',
  version: '1.0.0',
  author: { name: 'Tester' },
  category: 'misc',
  tags: [],
  installUrl: 'https://example.test/audit-template-1.0.0.tar.gz',
  manifestUrl: 'https://example.test/audit-template-1.0.0/manifest.json',
  minProjelliVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
  checksum: 'goodhash',
};

const ENTRY_V2: CatalogEntry = {
  ...ENTRY_V1,
  version: '2.0.0',
  installUrl: 'https://example.test/audit-template-2.0.0.tar.gz',
};

function makeManifest(version: string): TemplateManifest {
  return {
    id: TEMPLATE_ID,
    name: 'Audit Template',
    version,
    apiVersion: '1.0',
    author: { name: 'Tester' },
    description: 'Template used for audit log spot-checks.',
    category: 'misc',
    tags: [],
    files: [{ path: 'manifest.json', type: 'markdown' }],
    minProjelliVersion: '2.0.0',
  };
}

function fakeStreamingResponse(chunks: Uint8Array[]): Response {
  const queue = [...chunks];
  const reader = {
    read: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) return { done: true, value: undefined };
      return { done: false, value: next };
    }),
    releaseLock: vi.fn(),
  };
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-length' ? String(total) : null,
    },
  } as unknown as Response;
}

function buildService(fakeFs: FakeFs, audit: AuditService): MarketplaceService {
  return new MarketplaceService({
    repoUrl: 'https://example.test',
    catalogPath: 'catalog.json',
    cachePath: '/ws/.projelli/cache/templates.json',
    installRoot: INSTALL_ROOT,
    fs: fakeFs.fs,
    provenance: 'community',
    auditService: audit,
  });
}

/** Wire the happy install path for the supplied catalog entry + manifest. */
function wireHappy(
  fakeFs: FakeFs,
  entry: CatalogEntry,
  manifest: TemplateManifest,
): void {
  const fetchSpy = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.endsWith('catalog.json')) {
      return { ok: true, status: 200, json: async () => [entry] } as unknown as Response;
    }
    if (u.endsWith('.tar.gz')) {
      return fakeStreamingResponse([new Uint8Array([1, 2, 3])]);
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fetchSpy);

  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'sha256_file') return entry.checksum ?? 'goodhash';
    if (cmd === 'extract_tarball') {
      fakeFs.files.set(
        `${INSTALL_DIR}/manifest.json`,
        JSON.stringify(manifest),
      );
      return ['manifest.json'];
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('audit log spot-check: marketplace lifecycle', () => {
  it('emits install + uninstall + failed-install events in order', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`audit-int-${Math.random()}`);
    const service = buildService(fakeFs, audit);

    // Step 1: happy install.
    wireHappy(fakeFs, ENTRY_V1, makeManifest('1.0.0'));
    await service.refresh();
    await service.install(TEMPLATE_ID);

    // Step 2: uninstall.
    await service.uninstall(TEMPLATE_ID);

    // Step 3: failed install (checksum mismatch).
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('catalog.json')) {
        return { ok: true, status: 200, json: async () => [ENTRY_V1] } as unknown as Response;
      }
      if (u.endsWith('.tar.gz')) {
        return fakeStreamingResponse([new Uint8Array([9, 9])]);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'badhash';
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
    await expect(service.install(TEMPLATE_ID)).rejects.toThrow(/Checksum/);

    // ---- Assert event sequence -----------------------------------------
    const actions = audit.getAll().map((e) => e.action);
    const marketplaceActions = actions.filter((a) =>
      a.startsWith('template_'),
    );
    expect(marketplaceActions).toEqual([
      'template_installed_from_marketplace',
      'template_uninstalled',
      'template_install_failed',
    ]);

    const events = audit.getAll();
    const installEvent = events.find(
      (e) => e.action === 'template_installed_from_marketplace',
    );
    expect(installEvent?.metadata).toMatchObject({
      templateId: TEMPLATE_ID,
      version: '1.0.0',
    });

    const uninstallEvent = events.find(
      (e) => e.action === 'template_uninstalled',
    );
    expect(uninstallEvent?.metadata).toMatchObject({
      templateId: TEMPLATE_ID,
      version: '1.0.0',
    });

    const failureEvent = events.find(
      (e) => e.action === 'template_install_failed',
    );
    expect(failureEvent?.metadata).toMatchObject({
      templateId: TEMPLATE_ID,
      version: '1.0.0',
    });
    // Error string must be populated and human-readable.
    expect(typeof failureEvent?.metadata?.error).toBe('string');
    expect(String(failureEvent?.metadata?.error)).toMatch(/Checksum/);
  });

  it('emits template_updated with both legacy `version` and `fromVersion`/`toVersion` fields', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`audit-int-${Math.random()}`);
    const service = buildService(fakeFs, audit);

    // Initial install at v1.0.0.
    wireHappy(fakeFs, ENTRY_V1, makeManifest('1.0.0'));
    await service.refresh();
    await service.install(TEMPLATE_ID);

    // Upgrade to v2.0.0 (catalog refresh + install with isUpdate=true).
    wireHappy(fakeFs, ENTRY_V2, makeManifest('2.0.0'));
    await service.refresh();
    await service.install(TEMPLATE_ID, {
      isUpdate: true,
      fromVersion: '1.0.0',
    });

    const actions = audit.getAll().map((e) => e.action);
    const marketplaceActions = actions.filter((a) =>
      a.startsWith('template_'),
    );
    // First event = initial install. Second = update (NOT
    // template_installed_from_marketplace).
    expect(marketplaceActions).toEqual([
      'template_installed_from_marketplace',
      'template_updated',
    ]);

    const updatedEvent = audit
      .getAll()
      .find((e) => e.action === 'template_updated');
    expect(updatedEvent).toBeDefined();
    // Spec requires BOTH legacy `version` field AND new
    // `fromVersion` / `toVersion` fields so legacy log readers stay working.
    expect(updatedEvent?.metadata).toMatchObject({
      templateId: TEMPLATE_ID,
      version: '2.0.0',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    });
  });

  it('emits template_updated with fromVersion="unknown" if caller forgets it', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`audit-int-${Math.random()}`);
    const service = buildService(fakeFs, audit);

    wireHappy(fakeFs, ENTRY_V1, makeManifest('1.0.0'));
    await service.refresh();
    await service.install(TEMPLATE_ID);

    wireHappy(fakeFs, ENTRY_V2, makeManifest('2.0.0'));
    await service.refresh();
    // isUpdate=true with no fromVersion. Service falls back to "unknown".
    await service.install(TEMPLATE_ID, { isUpdate: true });

    const updatedEvent = audit
      .getAll()
      .find((e) => e.action === 'template_updated');
    expect(updatedEvent?.metadata).toMatchObject({
      fromVersion: 'unknown',
      toVersion: '2.0.0',
      version: '2.0.0',
    });
  });
});
