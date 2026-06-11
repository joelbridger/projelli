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
 */

import { describe, expect, it, vi } from 'vitest';

import {
  groundQuoteToChunk,
  runContradictionAnalysis,
  type RetrievedChunk,
} from '@/modules/workflow/legalAnalysis';
import { createMockProvider } from '@/modules/models/MockProvider';
import type { Provider } from '@/modules/models/Provider';
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
