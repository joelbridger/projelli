/**
 * M8 — Multi-interview synthesis tests.
 *
 * Uses MockProvider with overridden `structuredOutput` to verify:
 *   - Phase A runs once per transcript (parallel)
 *   - Phase B receives all Phase A summaries
 *   - The final shape matches the declared schema
 *   - `splitPastedTranscripts` handles --- dividers correctly
 */

import { describe, it, expect } from 'vitest';
import { MockProvider } from '@/platform/providers/MockProvider';
import {
  runMultiInterviewSynthesis,
  splitPastedTranscripts,
  type MultiInterviewSynthesisResult,
  type TranscriptInput,
  type TranscriptSummary,
} from '@/platform/analysis/MultiInterviewSynthesis';

function synthesisResultFixture(): MultiInterviewSynthesisResult {
  return {
    themes: [
      { name: 'Invoicing pain', frequency: 3, quotes: ['I hate invoicing'] },
    ],
    killer_quotes: ['I hate invoicing'],
    contradictions: [
      {
        statement_a: 'I love spreadsheets',
        statement_b: 'Spreadsheets are a nightmare',
        sources: ['Interview 1', 'Interview 3'],
      },
    ],
    jtbd_frameworks: [
      {
        job: 'Bill clients on time',
        current_solution: 'Manual spreadsheets',
        friction: 'Forgetting to send invoices',
      },
    ],
    priority_ranked_features: [
      {
        feature: 'Auto-invoice after time entry',
        frequency: 3,
        urgency: 'high',
        supporting_quotes: ['Just bill me automatically'],
      },
    ],
  };
}

/**
 * Wraps MockProvider so `structuredOutput` returns stage-specific shapes:
 *   - a per-transcript summary for Phase A
 *   - a full synthesis for Phase B (detected by the phrase "synthesizing")
 */
function providerWithSynthesisResponses() {
  const provider = new MockProvider();
  const phaseACalls: string[] = [];
  let phaseBPrompt = '';

  provider.structuredOutput = (async (prompt: string) => {
    if (prompt.includes('synthesizing findings across')) {
      phaseBPrompt = prompt;
      return synthesisResultFixture();
    }
    // Phase A — extract the source line to return a distinguishable summary.
    const match = prompt.match(/Source: (.+)/);
    const source = match?.[1] ?? 'unknown';
    phaseACalls.push(source);
    const summary: TranscriptSummary = {
      source,
      key_quotes: [`"${source} says hi"`],
      themes: [`theme-from-${source}`],
      jtbd: [`jtbd-from-${source}`],
    };
    return summary;
  }) as typeof provider.structuredOutput;

  return {
    provider,
    getPhaseACalls: () => phaseACalls,
    getPhaseBPrompt: () => phaseBPrompt,
  };
}

describe('runMultiInterviewSynthesis', () => {
  const transcripts: TranscriptInput[] = [
    { source: 'I1', content: 'Interview 1 content about invoicing.' },
    { source: 'I2', content: 'Interview 2 content about time tracking.' },
    { source: 'I3', content: 'Interview 3 content about contracts.' },
  ];

  it('runs Phase A once per transcript', async () => {
    const { provider, getPhaseACalls } = providerWithSynthesisResponses();
    await runMultiInterviewSynthesis(provider, transcripts);
    expect(getPhaseACalls().sort()).toEqual(['I1', 'I2', 'I3']);
  });

  it('runs Phase A in parallel (fires all three before any resolve)', async () => {
    // Make each structuredOutput take >20ms; measure wall time.
    const provider = new MockProvider();
    let inFlight = 0;
    let maxInFlight = 0;
    let phaseBSeen = false;
    provider.structuredOutput = (async (prompt: string) => {
      if (prompt.includes('synthesizing findings across')) {
        phaseBSeen = true;
        return synthesisResultFixture();
      }
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight--;
      const match = prompt.match(/Source: (.+)/);
      const source = match?.[1] ?? 'x';
      return {
        source,
        key_quotes: ['q'],
        themes: ['t'],
        jtbd: ['j'],
      } as TranscriptSummary;
    }) as typeof provider.structuredOutput;

    await runMultiInterviewSynthesis(provider, transcripts);
    expect(maxInFlight).toBe(3);
    expect(phaseBSeen).toBe(true);
  });

  it('Phase B receives all Phase A summaries in the prompt', async () => {
    const { provider, getPhaseBPrompt } = providerWithSynthesisResponses();
    await runMultiInterviewSynthesis(provider, transcripts);
    const prompt = getPhaseBPrompt();
    expect(prompt).toContain('theme-from-I1');
    expect(prompt).toContain('theme-from-I2');
    expect(prompt).toContain('theme-from-I3');
  });

  it('returns a fully-populated structured result', async () => {
    const { provider } = providerWithSynthesisResponses();
    const { phaseA, phaseB } = await runMultiInterviewSynthesis(provider, transcripts);
    expect(phaseA).toHaveLength(3);
    expect(phaseB.themes).toHaveLength(1);
    expect(phaseB.killer_quotes).toContain('I hate invoicing');
    expect(phaseB.contradictions[0]?.sources).toEqual(['Interview 1', 'Interview 3']);
    expect(phaseB.jtbd_frameworks[0]?.job).toMatch(/Bill/);
    expect(phaseB.priority_ranked_features[0]?.urgency).toBe('high');
  });

  it('throws when zero transcripts are provided', async () => {
    const { provider } = providerWithSynthesisResponses();
    await expect(runMultiInterviewSynthesis(provider, [])).rejects.toThrow(/at least one/i);
  });
});

describe('splitPastedTranscripts', () => {
  it('splits on --- dividers and trims segments', () => {
    const result = splitPastedTranscripts('A\n---\nB\n----\nC\n');
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.content)).toEqual(['A', 'B', 'C']);
    expect(result[0]?.source).toBe('Pasted transcript 1');
  });

  it('returns a single transcript when no dividers present', () => {
    const result = splitPastedTranscripts('only one');
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('only one');
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(splitPastedTranscripts('   \n  \n')).toEqual([]);
  });
});
