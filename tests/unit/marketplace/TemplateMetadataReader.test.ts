import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TemplateMetadataReader,
  COMMUNITY_TEMPLATE_ID_PREFIX,
} from '@/features/workflows/marketplace/svc/TemplateMetadataReader';
import type { FSBackend } from '@/modules/workspace/types';
import type { InstalledEntry } from '@/features/workflows/types/marketplace';
import type { TemplateManifest } from '@/features/workflows/types/templateManifest';
import type { MarketplaceService } from '@/features/workflows/marketplace/svc/MarketplaceService';
import { AuditService } from '@/modules/audit/AuditService';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_MANIFEST: TemplateManifest = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  version: '1.2.3',
  apiVersion: '1.0',
  author: { name: 'Jameson Daines' },
  description: 'Monthly update template for early-stage investors',
  category: 'planning',
  tags: ['investor'],
  files: [
    { path: 'manifest.json', type: 'markdown' },
    { path: 'workflow.json', type: 'workflow-definition' },
  ],
  minKeepanceVersion: '2.0.0',
};

const VALID_WORKFLOW = {
  name: 'Monthly Investor Update',
  description: 'Generates a monthly update doc for investors',
  version: '1.2.3',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Collect inputs',
      config: {
        questions: [
          {
            id: 'period',
            question: 'What period?',
            type: 'text',
            required: true,
          },
        ],
      },
    },
    {
      id: 'generate',
      type: 'generate',
      name: 'Generate doc',
      config: {
        outputFile: 'investor-update.md',
        promptTemplate: 'Write an update for {{period}}',
      },
    },
  ],
  requiredInputs: ['period'],
  outputs: ['investor-update.md'],
};

function makeInstalled(
  id: string,
  installedPath: string,
  overrides: Partial<InstalledEntry> = {},
): InstalledEntry {
  return {
    id,
    name: id,
    description: 'desc',
    version: '1.2.3',
    author: { name: 'x' },
    category: 'misc',
    tags: [],
    installUrl: `http://e/${id}.tar.gz`,
    manifestUrl: `http://e/${id}/manifest.json`,
    minKeepanceVersion: '2.0.0',
    publishedAt: '2026-04-28',
    updatedAt: '2026-04-28',
    installedAt: '2026-05-03',
    installedPath,
    provenance: 'community',
    manifestVersion: '1.0',
    ...overrides,
  };
}

interface FakeFs {
  fs: FSBackend;
  files: Map<string, string>;
}

function makeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map<string, string>(Object.entries(initial));
  const fs = {
    read: vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    }),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    readBinary: vi.fn(),
    writeBinary: vi.fn(),
    exists: vi.fn(async (p: string) => files.has(p)),
    delete: vi.fn(async (p: string) => {
      files.delete(p);
    }),
    move: vi.fn(),
    copy: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    list: vi.fn(),
    stat: vi.fn(),
    isSymlink: vi.fn(),
    resolveSymlink: vi.fn(),
    getRootPath: vi.fn(() => '/ws'),
    setRootPath: vi.fn(),
  } as unknown as FSBackend;
  return { fs, files };
}

function fsForInstall(
  installedPath: string,
  manifest: unknown,
  workflow: unknown,
  questions?: unknown,
): FakeFs {
  const files: Record<string, string> = {
    [`${installedPath}/manifest.json`]: JSON.stringify(manifest),
    [`${installedPath}/workflow.json`]: JSON.stringify(workflow),
  };
  if (questions !== undefined) {
    files[`${installedPath}/questions.json`] = JSON.stringify(questions);
  }
  return makeFs(files);
}

// Stub MarketplaceService — TemplateMetadataReader.list only calls
// `listInstalled()`, so we mock just that method.
function makeServiceWithInstalled(
  entries: InstalledEntry[],
): MarketplaceService {
  return {
    listInstalled: vi.fn(async () => entries),
  } as unknown as MarketplaceService;
}

// ---------------------------------------------------------------------------
// readInstalled
// ---------------------------------------------------------------------------

describe('TemplateMetadataReader.readInstalled', () => {
  it('returns a valid WorkflowTemplate from manifest + workflow.json', async () => {
    const path = '/ws/.keepance/templates/investor-update-v1';
    const { fs } = fsForInstall(path, VALID_MANIFEST, VALID_WORKFLOW);
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('investor-update-v1', path);

    const tpl = await reader.readInstalled(entry);

    expect(tpl.id).toBe(`${COMMUNITY_TEMPLATE_ID_PREFIX}investor-update-v1`);
    expect(tpl.name).toBe('Monthly Investor Update');
    expect(tpl.provenance).toBe('community');
    expect(tpl.sourceId).toBe('investor-update-v1');
    expect(tpl.steps).toHaveLength(2);
    expect(tpl.category).toBe('planning');
    expect(tpl.requiredInputs).toEqual(['period']);
  });

  it('falls back to manifest fields when workflow.json omits them', async () => {
    const path = '/ws/.keepance/templates/min';
    const minimalWorkflow = { steps: [] };
    const { fs } = fsForInstall(path, VALID_MANIFEST, minimalWorkflow);
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('min', path);

    const tpl = await reader.readInstalled(entry);

    expect(tpl.name).toBe(VALID_MANIFEST.name);
    expect(tpl.description).toBe(VALID_MANIFEST.description);
    expect(tpl.version).toBe(VALID_MANIFEST.version);
  });

  it('coerces unknown category values to "custom"', async () => {
    const path = '/ws/.keepance/templates/odd';
    const oddWorkflow = { ...VALID_WORKFLOW, category: 'something-else' };
    const { fs } = fsForInstall(path, VALID_MANIFEST, oddWorkflow);
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('odd', path);

    const tpl = await reader.readInstalled(entry);

    expect(tpl.category).toBe('custom');
  });

  it('injects questions.json into the first interview step when its question list is empty', async () => {
    const path = '/ws/.keepance/templates/q';
    const workflowWithEmptyInterview = {
      ...VALID_WORKFLOW,
      steps: [
        {
          id: 'interview',
          type: 'interview',
          name: 'Collect inputs',
          config: { questions: [] },
        },
      ],
    };
    const questions = [
      {
        id: 'period',
        question: 'Period?',
        type: 'text',
        required: true,
      },
    ];
    const { fs } = fsForInstall(
      path,
      VALID_MANIFEST,
      workflowWithEmptyInterview,
      questions,
    );
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('q', path);

    const tpl = await reader.readInstalled(entry);

    expect(tpl.steps[0]?.type).toBe('interview');
    const cfg = tpl.steps[0]?.config as { questions: unknown[] };
    expect(cfg.questions).toHaveLength(1);
  });

  it('throws when manifest is missing', async () => {
    const path = '/ws/.keepance/templates/missing';
    const { fs } = makeFs({
      [`${path}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
    });
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('missing', path);

    await expect(reader.readInstalled(entry)).rejects.toThrow();
  });

  it('throws when workflow.json is missing', async () => {
    const path = '/ws/.keepance/templates/no-workflow';
    const { fs } = makeFs({
      [`${path}/manifest.json`]: JSON.stringify(VALID_MANIFEST),
    });
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('no-workflow', path);

    await expect(reader.readInstalled(entry)).rejects.toThrow();
  });

  it('throws when manifest fails Zod validation', async () => {
    const path = '/ws/.keepance/templates/corrupt';
    const corrupt = { id: 'corrupt' }; // missing every other required field
    const { fs } = fsForInstall(path, corrupt, VALID_WORKFLOW);
    const reader = new TemplateMetadataReader({ fs });
    const entry = makeInstalled('corrupt', path);

    await expect(reader.readInstalled(entry)).rejects.toThrow(/Manifest invalid/);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('TemplateMetadataReader.list', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('iterates and returns each successfully read template', async () => {
    const pathA = '/ws/.keepance/templates/a';
    const pathB = '/ws/.keepance/templates/b';
    const files: Record<string, string> = {
      [`${pathA}/manifest.json`]: JSON.stringify({ ...VALID_MANIFEST, id: 'a' }),
      [`${pathA}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
      [`${pathB}/manifest.json`]: JSON.stringify({ ...VALID_MANIFEST, id: 'b' }),
      [`${pathB}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
    };
    const { fs } = makeFs(files);
    const reader = new TemplateMetadataReader({ fs });
    const service = makeServiceWithInstalled([
      makeInstalled('a', pathA),
      makeInstalled('b', pathB),
    ]);

    const templates = await reader.list(service);

    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.sourceId).sort()).toEqual(['a', 'b']);
  });

  it('skips entries whose workflow.json is missing and audits the failure', async () => {
    const goodPath = '/ws/.keepance/templates/good';
    const badPath = '/ws/.keepance/templates/bad';
    const files: Record<string, string> = {
      [`${goodPath}/manifest.json`]: JSON.stringify(VALID_MANIFEST),
      [`${goodPath}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
      // bad: only manifest, no workflow.json
      [`${badPath}/manifest.json`]: JSON.stringify(VALID_MANIFEST),
    };
    const { fs } = makeFs(files);
    const auditService = new AuditService(`mp-test-${Date.now()}`);
    const reader = new TemplateMetadataReader({ fs, auditService });
    const service = makeServiceWithInstalled([
      makeInstalled('good', goodPath),
      makeInstalled('bad', badPath),
    ]);

    const templates = await reader.list(service);

    expect(templates).toHaveLength(1);
    expect(templates[0]?.sourceId).toBe('good');
    expect(warnSpy).toHaveBeenCalled();
    const audit = auditService.getAll();
    const failed = audit.filter((e) => e.action === 'template_install_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.metadata).toMatchObject({ templateId: 'bad' });
  });

  it('skips entries with corrupt manifests and audits the failure', async () => {
    const goodPath = '/ws/.keepance/templates/g';
    const corruptPath = '/ws/.keepance/templates/c';
    const files: Record<string, string> = {
      [`${goodPath}/manifest.json`]: JSON.stringify(VALID_MANIFEST),
      [`${goodPath}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
      [`${corruptPath}/manifest.json`]: '{not valid json',
      [`${corruptPath}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
    };
    const { fs } = makeFs(files);
    const auditService = new AuditService(`mp-test-${Date.now()}`);
    const reader = new TemplateMetadataReader({ fs, auditService });
    const service = makeServiceWithInstalled([
      makeInstalled('g', goodPath),
      makeInstalled('c', corruptPath),
    ]);

    const templates = await reader.list(service);

    expect(templates).toHaveLength(1);
    const failed = auditService
      .getAll()
      .filter((e) => e.action === 'template_install_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.metadata).toMatchObject({ templateId: 'c' });
  });

  it('returns an empty array when service.listInstalled() is empty', async () => {
    const { fs } = makeFs();
    const reader = new TemplateMetadataReader({ fs });
    const service = makeServiceWithInstalled([]);

    const templates = await reader.list(service);

    expect(templates).toEqual([]);
  });

  it('does not stop iteration when one entry fails', async () => {
    const okA = '/ws/.keepance/templates/ok-a';
    const broken = '/ws/.keepance/templates/broken';
    const okB = '/ws/.keepance/templates/ok-b';
    const files: Record<string, string> = {
      [`${okA}/manifest.json`]: JSON.stringify({ ...VALID_MANIFEST, id: 'ok-a' }),
      [`${okA}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
      // broken: missing both files
      [`${okB}/manifest.json`]: JSON.stringify({ ...VALID_MANIFEST, id: 'ok-b' }),
      [`${okB}/workflow.json`]: JSON.stringify(VALID_WORKFLOW),
    };
    const { fs } = makeFs(files);
    const reader = new TemplateMetadataReader({ fs });
    const service = makeServiceWithInstalled([
      makeInstalled('ok-a', okA),
      makeInstalled('broken', broken),
      makeInstalled('ok-b', okB),
    ]);

    const templates = await reader.list(service);

    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.sourceId).sort()).toEqual(['ok-a', 'ok-b']);
  });
});
