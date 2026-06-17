/**
 * Integration test for the Templates Marketplace install pipeline (Stream C1
 * Group IX, Task 9.1).
 *
 * Wires the real `MarketplaceService` + `TemplateMetadataReader` +
 * `WorkflowEngine` against:
 *   - mocked `fetch` for catalog + tarball downloads (no real network)
 *   - mocked `@tauri-apps/api/core.invoke` for `sha256_file` + `extract_tarball`
 *   - an in-memory `FSBackend` that captures every read/write
 *   - `MockProvider` driving a generate step end-to-end
 *
 * Asserts:
 *   - filesystem state after install (manifest.json, workflow.json, installed.json)
 *   - audit events emitted
 *   - WorkflowEngine.availableTemplates() includes the installed template under
 *     the `community:` namespace
 *   - the engine can run the installed template through to completion using
 *     MockProvider, producing a generated output file
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { MarketplaceService } from '@/features/workflows/marketplace/svc/MarketplaceService';
import {
  TemplateMetadataReader,
  COMMUNITY_TEMPLATE_ID_PREFIX,
} from '@/features/workflows/marketplace/svc/TemplateMetadataReader';
import { WorkflowEngine, type FileOperations, type InterviewHandler } from '@/features/workflows/engine/WorkflowEngine';
import { createMockProvider } from '@/platform/providers/MockProvider';
import { AuditService } from '@/platform/audit/AuditService';
import type { FSBackend } from '@/platform/fs/types';
import type { CatalogEntry } from '@/features/workflows/types/marketplace';
import type { TemplateManifest } from '@/features/workflows/types/templateManifest';
import type { WorkflowTemplate } from '@/platform/types/workflow';

const mockInvoke = vi.mocked(tauriCore.invoke);

// ---------------------------------------------------------------------------
// In-memory FS double
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Synthetic catalog + manifest + workflow
// ---------------------------------------------------------------------------

const TEMPLATE_ID = 'kickoff-lite';
const INSTALL_ROOT = '/ws/.keepance/templates';
const INSTALL_DIR = `${INSTALL_ROOT}/${TEMPLATE_ID}`;

const CATALOG: CatalogEntry[] = [
  {
    id: TEMPLATE_ID,
    name: 'Kickoff Lite',
    description: 'A lightweight kickoff workflow for community testing.',
    version: '1.0.0',
    author: { name: 'Community', githubUser: 'community' },
    category: 'kickoff',
    tags: ['kickoff', 'community'],
    installUrl: 'https://example.test/kickoff-lite-1.0.0.tar.gz',
    manifestUrl: 'https://example.test/kickoff-lite-1.0.0/manifest.json',
    minKeepanceVersion: '2.0.0',
    publishedAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    checksum: 'abc123checksum',
  },
];

const MANIFEST: TemplateManifest = {
  id: TEMPLATE_ID,
  name: 'Kickoff Lite',
  version: '1.0.0',
  apiVersion: '1.0',
  author: { name: 'Community', githubUser: 'community' },
  description: 'A lightweight kickoff workflow for community testing.',
  category: 'kickoff',
  tags: ['kickoff', 'community'],
  files: [
    { path: 'manifest.json', type: 'markdown' },
    { path: 'workflow.json', type: 'workflow-definition' },
  ],
  minKeepanceVersion: '2.0.0',
};

// Simple two-step workflow: ask one interview question, then generate a
// "vision document" (MockProvider has a built-in handler for this prompt
// keyword so we get realistic output).
const WORKFLOW: Partial<WorkflowTemplate> = {
  name: 'Kickoff Lite',
  description: 'A lightweight kickoff workflow for community testing.',
  version: '1.0.0',
  category: 'kickoff',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Collect inputs',
      config: {
        questions: [
          {
            id: 'idea',
            question: 'What is your business idea?',
            type: 'text',
            required: true,
          },
        ],
      },
    },
    {
      id: 'generate',
      type: 'generate',
      name: 'Generate vision document',
      config: {
        outputFile: 'KICKOFF_VISION.md',
        promptTemplate:
          'Generate a comprehensive vision document for this idea: {{idea}}. Problem: {{idea}}. Solution: prototype. Target Customer: founders. Unique Value: speed. Stage: idea.',
      },
    },
  ],
  requiredInputs: ['idea'],
  outputs: ['KICKOFF_VISION.md'],
};

// ---------------------------------------------------------------------------
// Streaming Response stub for fetch().body.getReader()
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Wire the GitHub mock: catalog.json over fetch, tarball over fetch, Tauri
// invoke checksum + extract.
// ---------------------------------------------------------------------------

function wireMockGitHub(fakeFs: FakeFs): void {
  const fetchSpy = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.endsWith('catalog.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => CATALOG,
      } as unknown as Response;
    }
    if (u.endsWith('.tar.gz')) {
      return fakeStreamingResponse([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]);
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  });
  vi.stubGlobal('fetch', fetchSpy);

  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'sha256_file') return 'abc123checksum';
    if (cmd === 'extract_tarball') {
      // Emulate the Rust extractor: drop manifest.json + workflow.json into
      // the install dir.
      fakeFs.files.set(
        `${INSTALL_DIR}/manifest.json`,
        JSON.stringify(MANIFEST),
      );
      fakeFs.files.set(
        `${INSTALL_DIR}/workflow.json`,
        JSON.stringify(WORKFLOW),
      );
      return ['manifest.json', 'workflow.json'];
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('marketplace install end-to-end', () => {
  it('downloads, extracts, indexes, audits, and the engine can run the template', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`int-test-${Math.random()}`);
    const service = new MarketplaceService({
      repoUrl: 'https://example.test',
      catalogPath: 'catalog.json',
      cachePath: '/ws/.keepance/cache/templates.json',
      installRoot: INSTALL_ROOT,
      fs: fakeFs.fs,
      provenance: 'community',
      auditService: audit,
    });

    wireMockGitHub(fakeFs);

    // Refresh catalog (network mocked).
    await service.refresh();
    expect(await service.list()).toHaveLength(1);

    // Install the template.
    const installed = await service.install(TEMPLATE_ID);

    // ---- Filesystem assertions -----------------------------------------
    expect(installed.id).toBe(TEMPLATE_ID);
    expect(installed.installedPath).toBe(INSTALL_DIR);
    expect(installed.provenance).toBe('community');
    expect(installed.manifestVersion).toBe('1.0');

    expect(fakeFs.files.has(`${INSTALL_DIR}/manifest.json`)).toBe(true);
    expect(fakeFs.files.has(`${INSTALL_DIR}/workflow.json`)).toBe(true);
    expect(fakeFs.files.has(`${INSTALL_ROOT}/.installed.json`)).toBe(true);

    const indexRaw = fakeFs.files.get(`${INSTALL_ROOT}/.installed.json`)!;
    const index = JSON.parse(indexRaw);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe(TEMPLATE_ID);

    // Catalog cache also written.
    expect(fakeFs.files.has('/ws/.keepance/cache/templates.json')).toBe(true);

    // Tarball cleaned up.
    expect(
      fakeFs.binaryFiles.has(`${INSTALL_ROOT}/.tmp/${TEMPLATE_ID}.tar.gz`),
    ).toBe(false);

    // ---- Audit assertions ----------------------------------------------
    const events = audit.getAll();
    const installEvents = events.filter(
      (e) => e.action === 'template_installed_from_marketplace',
    );
    expect(installEvents).toHaveLength(1);
    expect(installEvents[0]?.metadata).toMatchObject({
      templateId: TEMPLATE_ID,
      version: '1.0.0',
    });
    expect(events.some((e) => e.action === 'template_install_failed')).toBe(
      false,
    );

    // ---- Engine integration --------------------------------------------
    const reader = new TemplateMetadataReader({ fs: fakeFs.fs });

    const provider = createMockProvider();
    const writes = new Map<string, string>();
    const fileOps: FileOperations = {
      writeFile: vi.fn(async (path: string, content: string) => {
        writes.set(path, content);
      }),
      readFile: vi.fn(async (path: string) => {
        const v = writes.get(path);
        if (v === undefined) throw new Error(`File not found: ${path}`);
        return v;
      }),
    };
    const interviewHandler: InterviewHandler = vi.fn(async () => ({
      idea: 'Local-first AI workspace for indie founders',
    }));

    const engine = new WorkflowEngine(provider, fileOps, interviewHandler, undefined, {
      builtInTemplates: [],
      getCommunityTemplates: () => reader.list(service),
    });

    const available = await engine.availableTemplates();
    expect(available).toHaveLength(1);
    const communityTemplate = available[0]!;
    expect(communityTemplate.id).toBe(`${COMMUNITY_TEMPLATE_ID_PREFIX}${TEMPLATE_ID}`);
    expect(communityTemplate.provenance).toBe('community');
    expect(communityTemplate.sourceId).toBe(TEMPLATE_ID);

    // Run the template through the engine.
    const runRecord = await engine.execute(communityTemplate);

    expect(runRecord.status).toBe('completed');
    expect(runRecord.workflow).toBe(communityTemplate.id);
    expect(interviewHandler).toHaveBeenCalledTimes(1);
    expect(fileOps.writeFile).toHaveBeenCalledWith(
      'KICKOFF_VISION.md',
      expect.any(String),
    );
    expect(writes.has('KICKOFF_VISION.md')).toBe(true);
    // MockProvider's vision-document handler emits a Markdown doc starting
    // with `# Vision Document`.
    expect(writes.get('KICKOFF_VISION.md')).toContain('# Vision Document');
    expect(runRecord.tool_calls).toHaveLength(1);
    expect(runRecord.tool_calls[0]?.tool).toBe('generate');
  });

  it('rejects a tampered tarball at the checksum step and rolls back cleanly', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`int-test-${Math.random()}`);
    const service = new MarketplaceService({
      repoUrl: 'https://example.test',
      catalogPath: 'catalog.json',
      cachePath: '/ws/.keepance/cache/templates.json',
      installRoot: INSTALL_ROOT,
      fs: fakeFs.fs,
      provenance: 'community',
      auditService: audit,
    });

    // Refresh catalog with the real checksum, then have invoke return a
    // mismatched hash so verifyChecksum throws.
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('catalog.json')) {
        return { ok: true, status: 200, json: async () => CATALOG } as unknown as Response;
      }
      if (u.endsWith('.tar.gz')) {
        return fakeStreamingResponse([new Uint8Array([0xff, 0xff])]);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'WRONG_HASH';
      throw new Error(`Should not invoke ${cmd} after checksum mismatch`);
    });

    await service.refresh();
    await expect(service.install(TEMPLATE_ID)).rejects.toThrow(/Checksum/);

    // No installed entry, no leftover install dir contents.
    expect(fakeFs.files.has(`${INSTALL_ROOT}/.installed.json`)).toBe(false);
    expect(fakeFs.files.has(`${INSTALL_DIR}/manifest.json`)).toBe(false);
    // Tarball temp path was targeted by cleanup.
    expect(fakeFs.fs.delete).toHaveBeenCalledWith(
      `${INSTALL_ROOT}/.tmp/${TEMPLATE_ID}.tar.gz`,
    );

    // Audit failure recorded.
    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('template_install_failed');
    expect(actions).not.toContain('template_installed_from_marketplace');
  });
});
