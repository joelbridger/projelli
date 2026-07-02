/**
 * Unit tests for WorkflowEngine.availableTemplates() — the Stream C1 surface
 * that combines built-in templates with marketplace-installed templates
 * supplied by an injected `getCommunityTemplates` callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorkflowEngine,
  createWorkflowEngine,
  type InterviewHandler,
  type FileOperations,
  type AnalyzeDeps,
} from '@/features/workflows/engine/WorkflowEngine';
import { createMockProvider } from '@/platform/providers/MockProvider';
import type {
  WorkflowTemplate,
  GenerateStepConfig,
  AnalyzeStepConfig,
  InterviewStepConfig,
} from '@/platform/types/workflow';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';

function makeTemplate(id: string, overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id,
    name: id,
    description: '',
    version: '1.0.0',
    category: 'custom',
    steps: [],
    requiredInputs: [],
    outputs: [],
    ...overrides,
  };
}

const noopFileOps: FileOperations = {
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ''),
};

const noopInterview: InterviewHandler = vi.fn(async () => ({}));

describe('WorkflowEngine.availableTemplates', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns built-ins only when no community-template provider is supplied', async () => {
    const builtIns = [makeTemplate('built-a'), makeTemplate('built-b')];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      { builtInTemplates: builtIns }
    );

    const all = await engine.availableTemplates();

    expect(all.map((t) => t.id)).toEqual(['built-a', 'built-b']);
  });

  it('appends community templates after built-ins', async () => {
    const builtIns = [makeTemplate('built-a')];
    const community = [
      makeTemplate('community:investor', { provenance: 'community', sourceId: 'investor' }),
    ];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: builtIns,
        getCommunityTemplates: async () => community,
      }
    );

    const all = await engine.availableTemplates();

    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe('built-a');
    expect(all[1]?.id).toBe('community:investor');
    expect(all[1]?.provenance).toBe('community');
  });

  it('falls back to built-ins when getCommunityTemplates throws', async () => {
    const builtIns = [makeTemplate('built-a')];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: builtIns,
        getCommunityTemplates: async () => {
          throw new Error('disk read failure');
        },
      }
    );

    const all = await engine.availableTemplates();

    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('built-a');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back to built-ins when getCommunityTemplates returns a rejected promise', async () => {
    const builtIns = [makeTemplate('built-a')];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: builtIns,
        getCommunityTemplates: () => Promise.reject(new Error('offline')),
      }
    );

    const all = await engine.availableTemplates();

    expect(all.map((t) => t.id)).toEqual(['built-a']);
  });

  it('returns an empty array when no built-ins and no community templates', async () => {
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
    );

    const all = await engine.availableTemplates();

    expect(all).toEqual([]);
  });

  it('createWorkflowEngine factory accepts options and wires getCommunityTemplates', async () => {
    const community = [makeTemplate('community:x', { provenance: 'community', sourceId: 'x' })];
    const engine = createWorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: [makeTemplate('built-a')],
        getCommunityTemplates: async () => community,
      }
    );

    const all = await engine.availableTemplates();

    expect(all.map((t) => t.id)).toEqual(['built-a', 'community:x']);
  });

  it('does not crash existing constructor calls that omit options', async () => {
    // Backward compatibility: existing tests + App.tsx call sites pass only
    // the original 4 args. The 5th arg defaults to {} and the engine acts as
    // before (built-ins empty, community resolver returns []).
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
    );

    const all = await engine.availableTemplates();

    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BUG F3(1a) — `outputFile` interpolation (+ sanitization) for generate/
// analyze steps.
// ---------------------------------------------------------------------------

describe('WorkflowEngine outputFile interpolation (BUG F3-1a)', () => {
  function generateTemplateWithOutputFile(outputFile: string): WorkflowTemplate {
    return {
      id: 'gen-outputfile',
      name: 'Gen',
      description: '',
      version: '1.0.0',
      category: 'custom',
      steps: [
        {
          id: 'g',
          type: 'generate',
          name: 'Generate',
          config: {
            outputFile,
            promptTemplate: 'Write something.',
          } as GenerateStepConfig,
        },
      ],
      requiredInputs: [],
      outputs: [outputFile],
    };
  }

  it('interpolates {{var}} placeholders in a generate step outputFile before writing', async () => {
    const writeFile = vi.fn(async (_path: string, _content: string) => {});
    const engine = new WorkflowEngine(
      createMockProvider(),
      { writeFile, readFile: async () => '' },
      async () => ({}),
    );

    const record = await engine.execute(
      generateTemplateWithOutputFile('{{matterName}}/Report.docx'.replace('.docx', '.md')),
      { matterName: 'Acme Corp' },
    );

    expect(record.status).toBe('completed');
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path] = writeFile.mock.calls[0]!;
    expect(path).toBe('Acme Corp/Report.md');
  });

  it('interpolates a .docx generate outputFile (writeFileBinary path) too', async () => {
    const writeFileBinary = vi.fn(async (_path: string, _bytes: Uint8Array) => {});
    const engine = new WorkflowEngine(
      createMockProvider(),
      { writeFile: vi.fn(async () => {}), readFile: async () => '', writeFileBinary },
      async () => ({}),
    );

    await engine.execute(
      generateTemplateWithOutputFile('{{matterName}}/Report.docx'),
      { matterName: 'Acme Corp' },
    );

    expect(writeFileBinary).toHaveBeenCalledTimes(1);
    const [path] = writeFileBinary.mock.calls[0]!;
    expect(path).toBe('Acme Corp/Report.docx');
  });

  it('sanitizes a substituted value containing "/" instead of injecting extra path segments', async () => {
    // Documented sanitization choice: `/` (and `\`) in a SUBSTITUTED VALUE
    // become `-`, e.g. "Smith / Jones" -> "Smith - Jones". The template's own
    // `/` folder separator is untouched.
    const writeFile = vi.fn(async (_path: string, _content: string) => {});
    const engine = new WorkflowEngine(
      createMockProvider(),
      { writeFile, readFile: async () => '' },
      async () => ({}),
    );

    await engine.execute(
      generateTemplateWithOutputFile('{{matterName}}/Report.md'),
      { matterName: 'Smith / Jones' },
    );

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path] = writeFile.mock.calls[0]!;
    expect(path).toBe('Smith - Jones/Report.md');
    // Never a literal 3-segment path from the raw "/" in the value.
    expect(path).not.toBe('Smith / Jones/Report.md');
  });

  it('sanitizes a value containing ".." + "/" so it cannot read as a traversal segment', async () => {
    const writeFile = vi.fn(async (_path: string, _content: string) => {});
    const engine = new WorkflowEngine(
      createMockProvider(),
      { writeFile, readFile: async () => '' },
      async () => ({}),
    );

    await engine.execute(
      generateTemplateWithOutputFile('{{matterName}}/Report.md'),
      { matterName: '../../etc' },
    );

    const [path] = writeFile.mock.calls[0]!;
    // The "/" characters inside the substituted value are stripped/replaced,
    // so no new "/" segments come from the value — only the template's own
    // single "/" separator remains.
    expect(path).toBe('..-..-etc/Report.md');
    expect((path.match(/\//g) ?? []).length).toBe(1);
  });

  it('sanitizes Windows-forbidden filename characters in a substituted value (Codex review)', async () => {
    // A realistic contract type/client name containing `:`, `?`, `*`, `"`,
    // `<`, `>`, or `|` would otherwise produce a filename that fails to save
    // on the app's primary Windows target — after the AI generation work is
    // already done. Same forbidden set as `PathValidator.validateName`.
    const writeFile = vi.fn(async (_path: string, _content: string) => {});
    const engine = new WorkflowEngine(
      createMockProvider(),
      { writeFile, readFile: async () => '' },
      async () => ({}),
    );

    await engine.execute(
      generateTemplateWithOutputFile('{{matterName}}/Report.md'),
      { matterName: 'NDA: Vendor? "Deal" <A|B>*' },
    );

    const [path] = writeFile.mock.calls[0]!;
    expect(path).toBe('NDA- Vendor- -Deal- -A-B--/Report.md');
    expect(path).not.toMatch(/[:?*"<>|]/);
  });
});

// ---------------------------------------------------------------------------
// Bug 3 (isolation/data-leak) — an `analyze` step must fail closed when no
// client/matter is active (scope.kind !== 'matter'), rather than silently
// retrieving across every client.
// ---------------------------------------------------------------------------

describe('WorkflowEngine analyze step — matter-scope guard (Bug 3)', () => {
  function analyzeOnlyTemplate(): WorkflowTemplate {
    return {
      id: 'analyze-scope-guard',
      name: 'Analyze',
      description: '',
      version: '1.0.0',
      category: 'legal',
      steps: [
        {
          id: 'interview',
          type: 'interview',
          name: 'Details',
          config: { questions: [] } as InterviewStepConfig,
        },
        {
          id: 'analyze-step',
          type: 'analyze',
          name: 'Analyze',
          config: {
            analyzeKind: 'contradictions',
            outputFile: 'Out.docx',
            retrievalQueryTemplate: 'testimony',
            promptTemplate: 'Analyze.\n{{retrievedContext}}',
          } as AnalyzeStepConfig,
        },
      ],
      requiredInputs: [],
      outputs: ['Out.docx'],
    };
  }

  it('fails the run instead of retrieving when getScope() returns allMatters', async () => {
    const retrieve = vi.fn(async () => []);
    const fileOps: FileOperations = {
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => ''),
      writeFileBinary: vi.fn(async () => {}),
    };
    const analyzeDeps: AnalyzeDeps = {
      getScope: (): RetrievalScope => ({ kind: 'allMatters' }),
      retrieve,
      verifyCitation: async () => 'verified',
      serializeContradictions: vi.fn(async () => new Uint8Array([0x50, 0x4b])),
    };

    const engine = new WorkflowEngine(
      createMockProvider(),
      fileOps,
      async () => ({}),
      undefined,
      { analyzeDeps },
    );

    const record = await engine.execute(analyzeOnlyTemplate());

    expect(record.status).toBe('failed');
    expect(record.error).toMatch(/active client/i);
    // Retrieval must never run — this is the actual confidentiality guard.
    expect(retrieve).not.toHaveBeenCalled();
    expect(fileOps.writeFileBinary).not.toHaveBeenCalled();
  });

  it('still proceeds normally when a matter scope IS active', async () => {
    const retrieve = vi.fn(async () => []);
    const writeFileBinary = vi.fn(async () => {});
    const fileOps: FileOperations = {
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => ''),
      writeFileBinary,
    };
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({ findings: [] })) as typeof provider.structuredOutput;
    const analyzeDeps: AnalyzeDeps = {
      getScope: (): RetrievalScope => ({ kind: 'matter', matterId: 'matter_1' }),
      retrieve,
      verifyCitation: async () => 'verified',
      serializeContradictions: vi.fn(async () => new Uint8Array([0x50, 0x4b])),
    };

    const engine = new WorkflowEngine(provider, fileOps, async () => ({}), undefined, { analyzeDeps });

    const record = await engine.execute(analyzeOnlyTemplate());

    expect(record.status).toBe('completed');
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(writeFileBinary).toHaveBeenCalledTimes(1);
  });
});
