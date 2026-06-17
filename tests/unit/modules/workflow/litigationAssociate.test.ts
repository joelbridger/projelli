/**
 * WS-D — Litigation associate (Deposition Contradiction Finder) tests.
 *
 * Covers the three load-bearing guarantees, with the provider, retrieval, and
 * citation verification all MOCKED (no Tauri, no network):
 *
 *   1. The contradiction-finder pipeline produces structured findings, each
 *      carrying a citation, and marks unverified findings clearly.
 *   2. The WorkflowEngine `analyze` step emits a real `.docx` deliverable
 *      (PK-zip bytes) via writeFileBinary, calls retrieval with the ACTIVE
 *      matter scope, and persists a RunRecord that captures the findings.
 *   3. The generic generate → Office pattern: a `generate` step whose
 *      outputFile is `.docx` writes Word bytes, not markdown.
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';

import {
  WorkflowEngine,
  type FileOperations,
  type InterviewHandler,
  type AnalyzeDeps,
} from '@/features/workflows/engine/WorkflowEngine';
import {
  runContradictionAnalysis,
  type RetrievedChunk,
} from '@/features/workflows/engine/legalAnalysis';
import { serializeContradictionsDocx } from '@/utils/docx-io';
import { createMockProvider } from '@/platform/providers/MockProvider';
import type { Provider, ProviderResponse } from '@/platform/providers/Provider';
import type {
  WorkflowTemplate,
  AnalyzeStepConfig,
  GenerateStepConfig,
  InterviewStepConfig,
  ContradictionAnalysisResult,
} from '@/types/workflow';
import type { RetrievalScope } from '@/utils/tauri-commands';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Two matter-scoped chunks the contradiction finder grounds its findings in. */
function fixtureChunks(): RetrievedChunk[] {
  return [
    {
      path: '/matter/smith-depo.docx',
      chunkText: 'I never received the email from Mr. Johnson.',
      paragraphIndex: 42,
      id: 'chunk-A',
      matterId: 'matter_smith',
      sourceId: '/matter/smith-depo.docx',
      sourceType: 'text',
    },
    {
      path: '/matter/affidavit.docx',
      chunkText: 'I received the email and forwarded it to my supervisor.',
      paragraphIndex: 7,
      id: 'chunk-B',
      matterId: 'matter_smith',
      sourceId: '/matter/affidavit.docx',
      sourceType: 'text',
    },
  ];
}

/** A provider whose structuredOutput returns a fixed contradiction pointing at
 *  the two fixture chunks (sources [1] and [2]). */
function fakeContradictionProvider(): Provider {
  const base = createMockProvider();
  base.structuredOutput = (async () => ({
    findings: [
      {
        topic: 'Receipt of the email',
        statementA: { sourceNumber: 1, quote: 'I never received the email from Mr. Johnson.' },
        statementB: { sourceNumber: 2, quote: 'I received the email and forwarded it to my supervisor.' },
        conflictRationale: 'The witness denies receiving the email but the affidavit admits receiving and forwarding it.',
        followUpQuestions: ['When did you first see the email?'],
      },
    ],
  })) as Provider['structuredOutput'];
  return base;
}

const passInterpolate = (tpl: string, values: Record<string, unknown>): string =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = values[k];
    return v === undefined ? `{{${k}}}` : String(v);
  });

const MATTER_SCOPE: RetrievalScope = { kind: 'matter', matterId: 'matter_smith' };

// ---------------------------------------------------------------------------
// 1) Pipeline: findings carry citations; unverified findings are marked
// ---------------------------------------------------------------------------

describe('runContradictionAnalysis (grounded + cited pipeline)', () => {
  const config: AnalyzeStepConfig = {
    analyzeKind: 'contradictions',
    outputFile: 'out.docx',
    retrievalQueryTemplate: 'testimony by {{witnessName}}',
    promptTemplate: 'Analyze.\n{{retrievedContext}}',
    topK: 8,
  };

  it('produces a finding that carries a citation on BOTH statements', async () => {
    const retrieve = vi.fn(async () => fixtureChunks());
    const verify = vi.fn(async () => 'verified' as const);

    const { result } = await runContradictionAnalysis({
      provider: fakeContradictionProvider(),
      config,
      inputs: { witnessName: 'Jane Doe' },
      scope: MATTER_SCOPE,
      retrieve,
      verify,
      interpolate: passInterpolate,
    });

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    // Every finding carries a citation id + locator + matter on each side.
    expect(f.statementA.citationId).toBe('chunk-A');
    expect(f.statementA.matterId).toBe('matter_smith');
    expect(f.statementA.locator).toContain('smith-depo.docx');
    expect(f.statementB.citationId).toBe('chunk-B');
    expect(f.statementB.locator).toContain('affidavit.docx');
    // Both verified → the finding is verified.
    expect(f.statementA.verdict).toBe('verified');
    expect(f.statementB.verdict).toBe('verified');
    expect(f.verified).toBe(true);
    expect(result.verifiedCount).toBe(1);
    expect(result.unverifiedCount).toBe(0);
  });

  it('retrieves with the ACTIVE matter scope (privilege excluded by the retrieve fn)', async () => {
    const retrieve = vi.fn(async () => fixtureChunks());
    const verify = vi.fn(async () => 'verified' as const);

    await runContradictionAnalysis({
      provider: fakeContradictionProvider(),
      config,
      inputs: { witnessName: 'Jane Doe' },
      scope: MATTER_SCOPE,
      retrieve,
      verify,
      interpolate: passInterpolate,
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    const [query, topK, scope] = retrieve.mock.calls[0]!;
    expect(query).toContain('Jane Doe');
    expect(topK).toBe(8);
    expect(scope).toEqual(MATTER_SCOPE);
  });

  it('marks a finding UNVERIFIED when a citation does not verify', async () => {
    const retrieve = vi.fn(async () => fixtureChunks());
    // statementB will fail verification (textMismatch).
    const verify = vi.fn(async (id: string) =>
      id === 'chunk-B' ? ('textMismatch' as const) : ('verified' as const),
    );

    const { result } = await runContradictionAnalysis({
      provider: fakeContradictionProvider(),
      config,
      inputs: { witnessName: 'Jane Doe' },
      scope: MATTER_SCOPE,
      retrieve,
      verify,
      interpolate: passInterpolate,
    });

    const f = result.findings[0]!;
    expect(f.statementA.verdict).toBe('verified');
    expect(f.statementB.verdict).toBe('textMismatch');
    // A single unverified side flips the whole finding to unverified.
    expect(f.verified).toBe(false);
    expect(result.verifiedCount).toBe(0);
    expect(result.unverifiedCount).toBe(1);
  });

  it('flags an ungrounded (hallucinated) source as unverified and never calls verify for it', async () => {
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({
      findings: [
        {
          topic: 'Phantom',
          // sourceNumber 0 = the model could not ground this in retrieval.
          statementA: { sourceNumber: 0, quote: 'Something not in the record.' },
          statementB: { sourceNumber: 1, quote: 'I never received the email from Mr. Johnson.' },
          conflictRationale: 'n/a',
        },
      ],
    })) as Provider['structuredOutput'];

    const retrieve = vi.fn(async () => fixtureChunks());
    const verify = vi.fn(async () => 'verified' as const);

    const { result } = await runContradictionAnalysis({
      provider,
      config,
      inputs: { witnessName: 'Jane Doe' },
      scope: MATTER_SCOPE,
      retrieve,
      verify,
      interpolate: passInterpolate,
    });

    const f = result.findings[0]!;
    expect(f.statementA.citationId).toBeUndefined();
    expect(f.statementA.verdict).toBe('unverified');
    expect(f.verified).toBe(false);
    // verify was only ever called for the grounded side (chunk-A), never the phantom.
    for (const call of verify.mock.calls) {
      expect(call[0]).not.toBe(0);
    }
  });

  it('returns an empty, honest result when nothing was retrieved', async () => {
    const retrieve = vi.fn(async () => [] as RetrievedChunk[]);
    const verify = vi.fn(async () => 'verified' as const);
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({ findings: [] })) as Provider['structuredOutput'];

    const { result, chunks } = await runContradictionAnalysis({
      provider,
      config,
      inputs: { witnessName: 'Jane Doe' },
      scope: MATTER_SCOPE,
      retrieve,
      verify,
      interpolate: passInterpolate,
    });

    expect(chunks).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2) Renderer: structured findings → real .docx with verification framing
// ---------------------------------------------------------------------------

describe('serializeContradictionsDocx (structured Word deliverable)', () => {
  const result: ContradictionAnalysisResult = {
    findings: [
      {
        topic: 'Receipt',
        statementA: { locator: 'depo.docx paragraph 42', quote: 'I never received it.', verdict: 'verified' },
        statementB: { locator: 'affidavit.docx paragraph 7', quote: 'I received it.', verdict: 'unverified' },
        conflictRationale: 'Denies then admits.',
        verified: false,
      },
    ],
    totalCount: 1,
    verifiedCount: 0,
    unverifiedCount: 1,
  };

  it('emits valid OOXML (PK-zip) bytes containing the document body', async () => {
    const bytes = await serializeContradictionsDocx(result, {
      title: 'Deposition Contradiction Analysis: Jane Doe',
      matterName: 'Smith v. Acme',
      witnessName: 'Jane Doe',
      verificationBanner: 'Verify before relying.',
    });

    // PK zip magic.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const zip = await JSZip.loadAsync(bytes.slice().buffer);
    const docXml = await zip.file('word/document.xml')!.async('string');
    // The verification framing and a flagged finding are present in the doc.
    expect(docXml).toContain('VERIFY BEFORE RELYING');
    expect(docXml).toContain('UNVERIFIED');
    expect(docXml).toContain('Jane Doe');
  });
});

// ---------------------------------------------------------------------------
// 3) Engine: analyze step → .docx via writeFileBinary + RunRecord + scope
// ---------------------------------------------------------------------------

function analyzeTemplate(): WorkflowTemplate {
  return {
    id: 'legal-deposition-contradiction-finder',
    name: 'Deposition Contradiction Finder',
    description: '',
    version: '2.0.0',
    category: 'legal',
    requiresVerification: true,
    verificationNote: 'Verify every contradiction.',
    steps: [
      {
        id: 'interview',
        type: 'interview',
        name: 'Details',
        config: { questions: [] } as InterviewStepConfig,
      },
      {
        id: 'analyze-contradictions',
        type: 'analyze',
        name: 'Flag Contradictions',
        config: {
          analyzeKind: 'contradictions',
          outputFile: 'Deposition Contradiction Analysis.docx',
          retrievalQueryTemplate: 'testimony by {{witnessName}}',
          promptTemplate: 'Analyze.\n{{retrievedContext}}',
          documentTitle: 'Deposition Contradiction Analysis: {{witnessName}}',
        } as AnalyzeStepConfig,
      },
    ],
    requiredInputs: [],
    outputs: ['Deposition Contradiction Analysis.docx'],
  };
}

function makeAnalyzeDeps(overrides: Partial<AnalyzeDeps> = {}): {
  deps: AnalyzeDeps;
  retrieve: ReturnType<typeof vi.fn>;
  serialize: ReturnType<typeof vi.fn>;
} {
  const retrieve = vi.fn(async () => fixtureChunks());
  const serialize = vi.fn(async () => serializeContradictionsDocx(
    { findings: [], totalCount: 0, verifiedCount: 0, unverifiedCount: 0 },
    { title: 't', verificationBanner: 'b' },
  ));
  const deps: AnalyzeDeps = {
    getScope: () => MATTER_SCOPE,
    retrieve,
    verifyCitation: async () => 'verified',
    serializeContradictions: serialize,
    ...overrides,
  };
  return { deps, retrieve, serialize };
}

describe('WorkflowEngine analyze step (Office output + scope + RunRecord)', () => {
  it('writes a .docx deliverable via writeFileBinary and records the findings', async () => {
    const writeFileBinary = vi.fn(async () => {});
    const fileOps: FileOperations = {
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => ''),
      writeFileBinary,
    };
    const interview: InterviewHandler = async () => ({ witnessName: 'Jane Doe' });
    const { deps, retrieve, serialize } = makeAnalyzeDeps();

    const engine = new WorkflowEngine(fakeContradictionProvider(), fileOps, interview, undefined, {
      analyzeDeps: deps,
    });

    const record = await engine.execute(analyzeTemplate());

    // A .docx was written (binary, not markdown).
    expect(writeFileBinary).toHaveBeenCalledTimes(1);
    const [outPath, bytes] = writeFileBinary.mock.calls[0]!;
    expect(outPath).toBe('Deposition Contradiction Analysis.docx');
    expect((bytes as Uint8Array)[0]).toBe(0x50); // PK
    expect((bytes as Uint8Array)[1]).toBe(0x4b);
    expect(serialize).toHaveBeenCalledTimes(1);

    // Retrieval used the active matter scope.
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0]![2]).toEqual(MATTER_SCOPE);

    // A completed RunRecord was produced, scoped + carrying the structured findings.
    expect(record.status).toBe('completed');
    expect(record.workflow).toBe('legal-deposition-contradiction-finder');
    const findings = record.outputs['analyze-contradictions_findings'];
    expect(Array.isArray(findings)).toBe(true);
    expect((findings as unknown[]).length).toBe(1);
    expect(record.outputs['analyze-contradictions_scope']).toEqual(MATTER_SCOPE);
    expect(record.outputs['analyze-contradictions_file']).toBe('Deposition Contradiction Analysis.docx');

    // The analyze tool call is auditable: scope + counts captured.
    const analyzeCall = record.tool_calls.find((c) => c.tool === 'analyze');
    expect(analyzeCall).toBeDefined();
    expect((analyzeCall!.params as { scope: unknown }).scope).toEqual(MATTER_SCOPE);
    expect((analyzeCall!.result as { totalFindings: number }).totalFindings).toBe(1);
  });

  it('fails the analyze step cleanly when analyzeDeps is not wired', async () => {
    const fileOps: FileOperations = {
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => ''),
      writeFileBinary: vi.fn(async () => {}),
    };
    const engine = new WorkflowEngine(
      fakeContradictionProvider(),
      fileOps,
      async () => ({ witnessName: 'Jane Doe' }),
    );

    const record = await engine.execute(analyzeTemplate());
    expect(record.status).toBe('failed');
    expect(record.error).toMatch(/matter-scoped retrieval/i);
  });
});

// ---------------------------------------------------------------------------
// 4) Generic generate → Office pattern (the pattern all templates inherit)
// ---------------------------------------------------------------------------

describe('WorkflowEngine generate step → Office output', () => {
  function generateTemplate(outputFile: string): WorkflowTemplate {
    return {
      id: 'gen',
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

  it('renders a .docx (binary) when the output file ends in .docx', async () => {
    const writeFileBinary = vi.fn(async () => {});
    const writeFile = vi.fn(async () => {});
    const provider = createMockProvider();
    provider.sendMessage = (async (): Promise<ProviderResponse> => ({
      content: '# Heading\n\nA paragraph of generated text.',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'mock',
    })) as Provider['sendMessage'];

    const engine = new WorkflowEngine(
      provider,
      { writeFile, readFile: async () => '', writeFileBinary },
      async () => ({}),
    );
    await engine.execute(generateTemplate('Result.docx'));

    expect(writeFileBinary).toHaveBeenCalledTimes(1);
    const [path, bytes] = writeFileBinary.mock.calls[0]!;
    expect(path).toBe('Result.docx');
    expect((bytes as Uint8Array)[0]).toBe(0x50); // PK zip → real Word file
    // The markdown writeFile path was NOT used for the .docx deliverable.
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('still writes markdown for a non-.docx output file (backward compatible)', async () => {
    const writeFile = vi.fn(async () => {});
    const provider = createMockProvider();
    provider.sendMessage = (async (): Promise<ProviderResponse> => ({
      content: 'plain output',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'mock',
    })) as Provider['sendMessage'];

    const engine = new WorkflowEngine(
      provider,
      { writeFile, readFile: async () => '' },
      async () => ({}),
    );
    await engine.execute(generateTemplate('OUTPUT.md'));

    expect(writeFile).toHaveBeenCalledWith('OUTPUT.md', 'plain output');
  });
});
