/**
 * Ask answer-quality eval harness.
 *
 * `runAskCase` reproduces the app's Ask path up to the model boundary: it turns
 * a case's (document, paragraph) selections into real `RagHit`s, builds the SAME
 * `<workspace_context>` block and the SAME system prompt the product ships
 * (`buildWorkspaceContextBlock` + `buildAskSystemPrompt`), then asks the given
 * provider the question. Swap the provider to change what is under test:
 *   - MockProvider with a scripted answer → the deterministic gate (free, fast).
 *   - A real provider (OpenAI/Claude) → the nightly drift run.
 *
 * Grading is two-layer: the deterministic `gradeAnswer` (citations/keywords/
 * decline) is the primary pass/fail signal; an optional LLM-as-judge adds a
 * quality opinion for the nightly run. The gate uses only the deterministic
 * layer so it never depends on a model.
 *
 * Note: the harness calls `sendMessage` (non-streaming). The app prefers
 * streaming, but the final answer text — which is all the grader sees — is
 * identical, and non-streaming keeps the gate fast and deterministic.
 */

import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { buildAskSystemPrompt, scopeHintForMatter } from '@/features/ask/askPrompt';
import type { Provider, OutputSchema } from '@/platform/providers/Provider';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { buildHits } from './corpus';
import { gradeAnswer, type GradeResult } from './grade';
import type { EvalCase } from './cases';

export interface RunResult {
  hits: RagHit[];
  systemPrompt: string;
  answer: string;
}

/** Build the prompt exactly as the app would and ask the provider. */
export async function runAskCase(
  c: EvalCase,
  provider: Provider,
  opts: { scopeLabel?: string | null } = {},
): Promise<RunResult> {
  const hits = buildHits(c.sources);
  const workspaceBlock = hits.length > 0 ? buildWorkspaceContextBlock(hits) : '';
  const systemPrompt = buildAskSystemPrompt({
    scopeHint: scopeHintForMatter(opts.scopeLabel ?? null),
    workspaceBlock,
    historyBlock: '',
  });
  const resp = await provider.sendMessage(c.question, { systemPrompt });
  return { hits, systemPrompt, answer: resp.content };
}

/* ----------------------------- LLM-as-judge ------------------------------- */

export interface JudgeVerdict {
  verdict: 'pass' | 'fail';
  score: number;
  reasoning: string;
}

const JUDGE_SCHEMA: OutputSchema = {
  type: 'object',
  required: ['verdict', 'score', 'reasoning'],
  properties: {
    verdict: { type: 'string', description: 'Exactly "pass" or "fail".' },
    score: { type: 'number', description: 'Answer quality from 0 (terrible) to 1 (ideal).' },
    reasoning: { type: 'string', description: 'One or two sentences justifying the verdict.' },
  },
};

const JUDGE_SYSTEM_PROMPT = [
  'You are a strict grader for a legal AI assistant that must answer ONLY from a',
  'provided context block and cite its sources, or decline when the answer is not',
  'in the context. You are given the retrieved context, the question, the expected',
  'behavior, a rubric, and the assistant answer. Judge ONLY whether the answer',
  'meets the rubric. Fail the answer if it states a fact not supported by the',
  'context, fails to cite a fact it should, answers when it should have declined,',
  'or declines when the context clearly supports an answer. Reward a correct',
  'decline on an unanswerable question as a pass.',
].join(' ');

/** Run the LLM-as-judge for one answer. Throws if the provider can't do
 *  structured output; callers in the nightly catch and mark the judge absent. */
export async function judgeAnswer(
  c: EvalCase,
  run: RunResult,
  judge: Provider,
): Promise<JudgeVerdict> {
  const userPrompt = [
    '--- RETRIEVED CONTEXT ---',
    run.hits.length > 0 ? buildWorkspaceContextBlock(run.hits) : '(no context retrieved)',
    '--- QUESTION ---',
    c.question,
    '--- EXPECTED BEHAVIOR ---',
    c.expect === 'decline'
      ? 'The answer is NOT in the context. The assistant should decline (say it could not find it) and must not invent facts.'
      : 'The answer IS in the context. The assistant should answer and cite the supporting source(s).',
    '--- RUBRIC ---',
    c.rubric,
    '--- ASSISTANT ANSWER ---',
    run.answer,
  ].join('\n\n');

  const out = await judge.structuredOutput<JudgeVerdict>(userPrompt, {
    schema: JUDGE_SCHEMA,
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    temperature: 0,
  });
  const verdict = String(out.verdict).toLowerCase().includes('pass') ? 'pass' : 'fail';
  const score = typeof out.score === 'number' && Number.isFinite(out.score)
    ? Math.max(0, Math.min(1, out.score))
    : verdict === 'pass' ? 1 : 0;
  return { verdict, score, reasoning: String(out.reasoning ?? '') };
}

/* ----------------------------- per-case outcome --------------------------- */

export interface CaseOutcome {
  id: string;
  tags: string[];
  expect: EvalCase['expect'];
  answer: string;
  grade: GradeResult;
  judge?: JudgeVerdict | { error: string } | undefined;
  /** Overall pass = deterministic grade passes. The judge is advisory. */
  pass: boolean;
}

/** Run + grade one case. If `judge` is supplied (nightly), also LLM-judge it. */
export async function evaluateCase(
  c: EvalCase,
  provider: Provider,
  opts: { judge?: Provider | undefined } = {},
): Promise<CaseOutcome> {
  const run = await runAskCase(c, provider);
  const grade = gradeAnswer(c, run.answer, run.hits);

  let judge: CaseOutcome['judge'];
  if (opts.judge) {
    try {
      judge = await judgeAnswer(c, run, opts.judge);
    } catch (err) {
      judge = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    id: c.id,
    tags: c.tags ?? [],
    expect: c.expect,
    answer: run.answer,
    grade,
    judge,
    pass: grade.pass,
  };
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  failures: { id: string; failed: string[] }[];
  /** Mean judge score across cases that were judged (nightly only). */
  judgeMeanScore: number | null;
  judgeDisagreements: { id: string; deterministic: boolean; judge: string }[];
}

export function summarize(outcomes: CaseOutcome[]): EvalSummary {
  const passed = outcomes.filter((o) => o.pass).length;
  const judged = outcomes.filter(
    (o): o is CaseOutcome & { judge: JudgeVerdict } =>
      !!o.judge && typeof (o.judge as JudgeVerdict).verdict === 'string',
  );
  const judgeMeanScore = judged.length
    ? judged.reduce((s, o) => s + o.judge.score, 0) / judged.length
    : null;
  const judgeDisagreements = judged
    .filter((o) => (o.judge.verdict === 'pass') !== o.pass)
    .map((o) => ({ id: o.id, deterministic: o.pass, judge: o.judge.verdict }));

  return {
    total: outcomes.length,
    passed,
    failed: outcomes.length - passed,
    passRate: outcomes.length ? passed / outcomes.length : 1,
    failures: outcomes.filter((o) => !o.pass).map((o) => ({ id: o.id, failed: o.grade.failed })),
    judgeMeanScore,
    judgeDisagreements,
  };
}
