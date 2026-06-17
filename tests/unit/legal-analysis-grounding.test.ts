/**
 * F-507(b) — quote-grounding recovery for the contradiction finder.
 *
 * The wedge-proof leg-3 runs (RESULTS.md claim 10) showed llama3.1:8b
 * returning `sourceNumber: None` on EVERY finding even when the quotes were
 * verbatim from the numbered context, so "0 verified; 3 flagged unverified"
 * every run. `groundQuoteToChunk` recovers the source by normalized quote
 * containment against the retrieved chunks — the "quote match" half the
 * legalAnalysis module docstring always promised. Fabricated quotes must
 * still match nothing (verification is never weakened).
 *
 * VG-3b — honest fallback when retrieval is UNAVAILABLE (throws): analyze the
 * attorney's pasted excerpts and report `retrievalUnavailable: true` so the
 * deliverable can say so; refuse only when there is genuinely nothing to
 * analyze (retrieval down AND nothing pasted). Empty-but-working retrieval
 * stays `retrievalUnavailable: false`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildRetrievedContextBlock,
  groundQuoteToChunk,
  runContradictionAnalysis,
  type RetrievedChunk,
} from '@/features/workflows/engine/legalAnalysis';
import { createMockProvider } from '@/platform/providers/MockProvider';
import type { Provider } from '@/platform/providers/Provider';
import type { AnalyzeStepConfig } from '@/types/workflow';
import type { RetrievalScope } from '@/utils/tauri-commands';

const chunks: RetrievedChunk[] = [
  {
    path: '/ws/depo.txt',
    paragraphIndex: 3,
    chunkText:
      'Q. What did you do with the files? A. I forwarded them to my personal email for safekeeping.',
    id: 'a'.repeat(64),
    matterId: 'm1',
    sourceId: '/ws/depo.txt',
  },
  {
    path: '/ws/policy.md',
    paragraphIndex: 7,
    chunkText:
      'All relevant documents remained on company servers only, per the retention policy.',
    id: 'b'.repeat(64),
    matterId: 'm1',
    sourceId: '/ws/policy.md',
  },
];

describe('sourceLocator labels transcript chunks "Tr. page:line" (VG-3c)', () => {
  it('prefers the page:line locator for transcript chunks in the numbered context', () => {
    const transcriptChunk: RetrievedChunk = {
      path: '/ws/depo-weston-certified.txt',
      paragraphIndex: 2,
      chunkText: 'A. The litigation hold notice went out to the team.',
      sourceType: 'transcript',
      locator: '2:14-2:16',
      id: 'c'.repeat(64),
      matterId: 'm1',
      sourceId: '/ws/depo-weston-certified.txt',
    };
    const block = buildRetrievedContextBlock([transcriptChunk]);
    // The vision's locator: lawyers cite "Tr. 45:12", not "paragraph 2".
    expect(block).toContain('depo-weston-certified.txt Tr. 2:14-2:16');
    expect(block).not.toContain('paragraph 2');
  });

  it('keeps the paragraph label when a transcript chunk has no locator (legacy rows)', () => {
    const legacy: RetrievedChunk = {
      path: '/ws/depo.txt',
      paragraphIndex: 5,
      chunkText: 'Q. And then?',
      sourceType: 'transcript',
    };
    const block = buildRetrievedContextBlock([legacy]);
    expect(block).toContain('depo.txt paragraph 5');
  });
});

describe('groundQuoteToChunk (F-507b)', () => {
  it('grounds a verbatim quote to its chunk', () => {
    expect(
      groundQuoteToChunk('I forwarded them to my personal email for safekeeping', chunks),
    ).toBe(0);
  });

  it('survives curly quotes and whitespace drift', () => {
    expect(
      groundQuoteToChunk('all relevant documents  remained on company servers only', chunks),
    ).toBe(1);
  });

  it('refuses fabricated quotes and too-short needles', () => {
    expect(groundQuoteToChunk('You didn’t save any documents at all.', chunks)).toBe(-1);
    expect(groundQuoteToChunk('the files', chunks)).toBe(-1);
  });
});

describe('runContradictionAnalysis recovers omitted sourceNumber by quote (F-503/F-507b)', () => {
  it('verifies findings whose quotes are verbatim even when sourceNumber is missing', async () => {
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({
      findings: [
        {
          topic: 'Document handling',
          // sourceNumber omitted on both sides — the llama3.1:8b failure shape.
          statementA: { quote: 'I forwarded them to my personal email for safekeeping' },
          statementB: { quote: 'All relevant documents remained on company servers only' },
          conflictRationale: 'Same documents, two locations.',
        },
      ],
    })) as Provider['structuredOutput'];

    const config: AnalyzeStepConfig = {
      analyzeKind: 'contradictions',
      retrievalQueryTemplate: 'q',
      promptTemplate: 'p',
      outputFile: 'o.docx',
    };
    const scope: RetrievalScope = { kind: 'matter', matterId: 'm1' };
    const verify = vi.fn(async () => 'verified' as const);

    const { result } = await runContradictionAnalysis({
      provider,
      config,
      inputs: {},
      scope,
      retrieve: vi.fn(async () => chunks),
      verify,
      interpolate: (tpl) => tpl,
    });

    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledWith('a'.repeat(64), 'm1', expect.any(String));
    expect(result.verifiedCount).toBe(1);
  });
});

describe('runContradictionAnalysis forwards the per-source diversity cap (F-510)', () => {
  it('passes config.perSourceCap through to retrieve', async () => {
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({ findings: [] })) as Provider['structuredOutput'];

    const config: AnalyzeStepConfig = {
      analyzeKind: 'contradictions',
      retrievalQueryTemplate: 'q',
      promptTemplate: 'p',
      outputFile: 'o.docx',
      perSourceCap: 4,
    };
    const scope: RetrievalScope = { kind: 'matter', matterId: 'm1' };
    const retrieve = vi.fn(async () => chunks);

    await runContradictionAnalysis({
      provider,
      config,
      inputs: {},
      scope,
      retrieve,
      verify: vi.fn(async () => 'verified' as const),
      interpolate: (tpl) => tpl,
    });

    // The finder's feed gets the diversity cap (4) alongside its topK (12
    // default) and scope; callers without a cap keep the old behavior.
    expect(retrieve).toHaveBeenCalledWith('q', 12, scope, 4);
  });
});

describe('runContradictionAnalysis honest fallback when retrieval is unavailable (VG-3b)', () => {
  const scope: RetrievalScope = { kind: 'matter', matterId: 'm1' };

  function pastedConfig(): AnalyzeStepConfig {
    return {
      analyzeKind: 'contradictions',
      retrievalQueryTemplate: 'q',
      promptTemplate: 'p',
      outputFile: 'o.docx',
      pastedInputIds: ['depositionExcerpts', 'priorStatements'],
    };
  }

  function findingProvider(): Provider {
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({
      findings: [
        {
          topic: 'Email receipt',
          statementA: { sourceNumber: 0, quote: 'I never received the email from Mr. Johnson.' },
          statementB: { sourceNumber: 0, quote: 'I received it and forwarded it to my supervisor.' },
          conflictRationale: 'Denies receipt, then admits it.',
        },
      ],
    })) as Provider['structuredOutput'];
    return provider;
  }

  it('falls back to the pasted excerpts when retrieve throws, and reports it', async () => {
    const retrieve = vi.fn(async (): Promise<RetrievedChunk[]> => {
      throw new Error('embedding model not ready');
    });

    const { result, chunks: returnedChunks, retrievalUnavailable } = await runContradictionAnalysis({
      provider: findingProvider(),
      config: pastedConfig(),
      inputs: {
        depositionExcerpts: 'P. 42:3-18\nQ: Did you receive the email?\nA: No, never.',
      },
      scope,
      retrieve,
      verify: vi.fn(async () => 'verified' as const),
      interpolate: (tpl) => tpl,
    });

    expect(retrievalUnavailable).toBe(true);
    expect(returnedChunks).toEqual([]);
    // The model still analyzed the pasted material…
    expect(result.findings).toHaveLength(1);
    // …but with no retrieved record nothing can claim verification — the
    // Avianca-trap discipline is never weakened by the fallback.
    expect(result.verifiedCount).toBe(0);
    expect(result.findings[0]!.verified).toBe(false);
  });

  it('refuses when retrieval is down AND nothing was pasted (never answer from nothing)', async () => {
    const retrieve = vi.fn(async (): Promise<RetrievedChunk[]> => {
      throw new Error('vector store offline');
    });

    await expect(
      runContradictionAnalysis({
        provider: findingProvider(),
        config: pastedConfig(),
        // Whitespace-only counts as nothing pasted.
        inputs: { depositionExcerpts: '   ' },
        scope,
        retrieve,
        verify: vi.fn(async () => 'verified' as const),
        interpolate: (tpl) => tpl,
      }),
    ).rejects.toThrow(/nothing to analyze from/);
  });

  it('keeps retrievalUnavailable false on EMPTY (but working) retrieval', async () => {
    const provider = createMockProvider();
    provider.structuredOutput = (async () => ({ findings: [] })) as Provider['structuredOutput'];

    const { chunks: returnedChunks, retrievalUnavailable } = await runContradictionAnalysis({
      provider,
      config: pastedConfig(),
      inputs: { depositionExcerpts: 'P. 42: some excerpt' },
      scope,
      retrieve: vi.fn(async () => [] as RetrievedChunk[]),
      verify: vi.fn(async () => 'verified' as const),
      interpolate: (tpl) => tpl,
    });

    expect(retrievalUnavailable).toBe(false);
    expect(returnedChunks).toHaveLength(0);
  });
});
