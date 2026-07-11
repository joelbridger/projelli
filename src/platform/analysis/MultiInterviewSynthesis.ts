// Multi-Interview Synthesis (M8)
//
// Takes an array of user-interview transcripts and produces a structured
// synthesis: themes + frequency + quotes, killer quotes, contradictions,
// JTBD frameworks, and priority-ranked features.
//
// Processing happens in two phases:
//   Phase A — per-transcript summarization (parallel). Each call pulls the
//     key quotes, themes, and jobs-to-be-done from one transcript.
//   Phase B — cross-transcript synthesis (one call). Receives the A summaries
//     plus the raw quote lists and emits the final structured output.
//
// Uses the active provider's `structuredOutput<T>()` so Claude, OpenAI, and
// Gemini all participate; Ollama can use JSON mode where available.
//
// The UI (MultiInterviewSynthesisPanel.tsx) wires transcripts from:
//   - Upstream `UserInterviews` runs (M7 chain forwarding)
//   - Drag-dropped .md/.txt files
//   - Pasted text separated by `---`

import type { Provider, OutputSchema } from '@/platform/providers/Provider';
import { sendPreparedStructuredWithEgressAudit } from '@/platform/privacy/promptPreparation';

export interface Theme {
  name: string;
  frequency: number;
  quotes: string[];
}

export interface Contradiction {
  statement_a: string;
  statement_b: string;
  sources: string[];
}

export interface JTBDFramework {
  job: string;
  current_solution: string;
  friction: string;
}

export interface PriorityFeature {
  feature: string;
  frequency: number;
  urgency: 'low' | 'medium' | 'high';
  supporting_quotes: string[];
}

/**
 * The structured synthesis output. Mirrored by MULTI_INTERVIEW_SCHEMA below
 * so `structuredOutput<MultiInterviewSynthesisResult>()` returns this shape.
 */
export interface MultiInterviewSynthesisResult {
  themes: Theme[];
  killer_quotes: string[];
  contradictions: Contradiction[];
  jtbd_frameworks: JTBDFramework[];
  priority_ranked_features: PriorityFeature[];
}

/**
 * The per-transcript summary produced in Phase A. Returned by
 * summarizeTranscript so the final Phase B call can receive a dense
 * compressed view of each interview.
 */
export interface TranscriptSummary {
  source: string;
  key_quotes: string[];
  themes: string[];
  jtbd: string[];
}

const TRANSCRIPT_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    key_quotes: { type: 'array', items: { type: 'string' } },
    themes: { type: 'array', items: { type: 'string' } },
    jtbd: { type: 'array', items: { type: 'string' } },
  },
  required: ['key_quotes', 'themes', 'jtbd'],
};

const SYNTHESIS_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          frequency: { type: 'number' },
          quotes: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'frequency', 'quotes'],
      },
    },
    killer_quotes: { type: 'array', items: { type: 'string' } },
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          statement_a: { type: 'string' },
          statement_b: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['statement_a', 'statement_b', 'sources'],
      },
    },
    jtbd_frameworks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          job: { type: 'string' },
          current_solution: { type: 'string' },
          friction: { type: 'string' },
        },
        required: ['job', 'current_solution', 'friction'],
      },
    },
    priority_ranked_features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          frequency: { type: 'number' },
          urgency: { type: 'string' },
          supporting_quotes: { type: 'array', items: { type: 'string' } },
        },
        required: ['feature', 'frequency', 'urgency', 'supporting_quotes'],
      },
    },
  },
  required: [
    'themes',
    'killer_quotes',
    'contradictions',
    'jtbd_frameworks',
    'priority_ranked_features',
  ],
};

export interface TranscriptInput {
  /** Display name (filename or "Interview 1"). */
  source: string;
  /** Raw transcript text. */
  content: string;
}

/**
 * Phase A — summarize a single transcript.
 */
export async function summarizeTranscript(
  provider: Provider,
  transcript: TranscriptInput
): Promise<TranscriptSummary> {
  const prompt = `You are analyzing a single customer interview transcript.
Extract the 3-6 most important direct quotes (keep them verbatim), the
top 3-5 themes the interviewee described, and any clear
jobs-to-be-done. Return structured JSON.

Source: ${transcript.source}

Transcript:
${transcript.content}
`;
  const metadata = provider.getMetadata();
  const result = await sendPreparedStructuredWithEgressAudit<TranscriptSummary>({
    provider,
    providerId: metadata.providerId ?? 'unknown',
    model: metadata.model,
    surface: 'interview_synthesis_summary',
    prompt,
    options: {
      schema: TRANSCRIPT_SCHEMA,
      systemPrompt:
        'You are a customer research analyst. Return only concrete, evidence-based findings sourced from the transcript text.',
    },
    parts: [
      { id: 'prompt', origin: 'workflow_input', label: 'Interview summary request', text: prompt },
      { id: 'transcript', origin: 'meeting', label: 'Interview transcript', text: transcript.content },
    ],
  });
  return { ...result, source: transcript.source };
}

/**
 * Phase B — cross-transcript synthesis.
 */
export async function synthesizeTranscripts(
  provider: Provider,
  summaries: TranscriptSummary[]
): Promise<MultiInterviewSynthesisResult> {
  const body = summaries
    .map(
      (s, i) =>
        `### Interview ${i + 1} — ${s.source}\n` +
        `Themes: ${s.themes.join('; ')}\n` +
        `JTBD: ${s.jtbd.join('; ')}\n` +
        `Quotes:\n${s.key_quotes.map((q) => `- ${q}`).join('\n')}`
    )
    .join('\n\n');

  const prompt = `You are synthesizing findings across ${summaries.length} customer interviews.

Produce:
 - themes (name, frequency = number of interviews mentioning it, quotes)
 - killer_quotes (3-7 strongest standalone quotes)
 - contradictions (genuine disagreements between interviewees, with sources)
 - jtbd_frameworks (job / current solution / friction)
 - priority_ranked_features (feature + frequency + urgency high/medium/low + supporting_quotes)

Use this pre-digested data:

${body}
`;

  const metadata = provider.getMetadata();
  return sendPreparedStructuredWithEgressAudit<MultiInterviewSynthesisResult>({
    provider,
    providerId: metadata.providerId ?? 'unknown',
    model: metadata.model,
    surface: 'interview_synthesis',
    prompt,
    options: {
      schema: SYNTHESIS_SCHEMA,
      systemPrompt:
        'You are a senior product researcher. Identify patterns across interviews and surface both consensus and genuine contradictions.',
    },
    parts: [
      { id: 'prompt', origin: 'workflow_input', label: 'Interview synthesis request', text: prompt },
      { id: 'summaries', origin: 'workflow_input', label: 'Interview summaries', text: body },
    ],
  });
}

/**
 * End-to-end: summarize all transcripts in parallel then synthesize.
 *
 * Exposed as a single call so tests and the UI can drive the full flow
 * without managing phases themselves.
 */
export async function runMultiInterviewSynthesis(
  provider: Provider,
  transcripts: TranscriptInput[]
): Promise<{
  phaseA: TranscriptSummary[];
  phaseB: MultiInterviewSynthesisResult;
}> {
  if (transcripts.length === 0) {
    throw new Error('At least one transcript is required');
  }
  const phaseA = await Promise.all(
    transcripts.map((t) => summarizeTranscript(provider, t))
  );
  const phaseB = await synthesizeTranscripts(provider, phaseA);
  return { phaseA, phaseB };
}

/**
 * Split a pasted blob into separate transcripts using `---` dividers.
 * Exported so the UI and tests can share the same parsing.
 */
export function splitPastedTranscripts(pasted: string): TranscriptInput[] {
  const parts = pasted
    .split(/^---+$/m)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.map((content, i) => ({
    source: `Pasted transcript ${i + 1}`,
    content,
  }));
}
