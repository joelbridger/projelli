// Workflow Chain Engine (M7)
// Runs a saved WorkflowChain end-to-end by executing each step's template
// sequentially and forwarding mapped outputs into the next step's inputs.
//
// Design notes:
//   - The chain is explicit: every mapping names (fromStepIndex, fromOutputId,
//     toInputId). No inference at runtime, so the chain is reproducible.
//   - Execution reuses the existing WorkflowEngine. Each step is just a
//     single-template run with pre-populated initial inputs — no new engine
//     state-machine logic is needed here.
//   - When a mapping references a fromOutputId that the upstream step never
//     emitted, we record a warning but keep going with the other inputs.
//   - All outputs from a step are surfaced as `{outputs: {...}, raw: {...}}`
//     on the ChainStepResult, so UI can render details or debug a miswiring.
//
// Named output resolution:
//   - A step's named outputs come from two places:
//       (a) `template.namedOutputs[*].id` declared on the template, matched
//           against the run's accumulated inputs by the exact key or a
//           trailing segment (e.g. a chain step that produced `personas`
//           will satisfy a downstream `acceptsOutputFrom: ['personas']`).
//       (b) The step's file artifacts (outputs: string[]) — these are not
//           forwarded automatically but are exposed on ChainStepResult.
//     Keepance keeps the matching shallow on purpose: more complex
//     transformations should be handled by the user in a follow-up chain
//     (out of scope for v1.5).

import type {
  WorkflowChain,
  WorkflowChainStep,
  WorkflowTemplate,
  RunRecord,
} from '@/types/workflow';
import { createWorkflowEngine } from './WorkflowEngine';
import type {
  FileOperations,
  InterviewHandler,
} from './WorkflowEngine';
import type { Provider } from '@/modules/models/Provider';

/**
 * The outcome of running one step inside a chain.
 */
export interface ChainStepResult {
  templateId: string;
  /** The underlying per-step RunRecord returned by WorkflowEngine. */
  run: RunRecord;
  /** Named-output values resolved from the step's accumulated inputs. */
  outputs: Record<string, unknown>;
  /** Warnings from unresolved input mappings (does not stop the chain). */
  warnings: string[];
}

export interface ChainRunRecord {
  chainId: string;
  chainName: string;
  startTime: string;
  endTime: string;
  status: 'completed' | 'failed';
  steps: ChainStepResult[];
  error?: string;
}

export interface RunChainOptions {
  chain: WorkflowChain;
  /** Lookup a template by id. The engine owns the template catalog. */
  resolveTemplate: (templateId: string) => WorkflowTemplate | undefined;
  /** Provider factory — the chain engine doesn't pick the provider itself. */
  provider: Provider;
  fileOps: FileOperations;
  onInterview: InterviewHandler;
  onProgress?: (stepIndex: number, templateId: string, phase: 'started' | 'completed' | 'failed') => void;
  /** Allow the caller to seed the very first step with user-supplied inputs. */
  initialInputs?: Record<string, unknown>;
}

/**
 * Extract named outputs from a finished step's accumulated RunRecord.
 *
 * Matching rules (applied in order, first hit wins):
 *   1. Direct key match on `run.inputs[outputId]` (a template that emitted
 *      structuredOutput with a key matching the id)
 *   2. Suffix match on `_${outputId}` (e.g. `personas_list`)
 *   3. Fallback: the last generate step's `_output` field (plain markdown
 *      content from a non-structured generation). v1.5 chains forward raw
 *      text between templates; structured-output chains are an v2.x
 *      enhancement.
 */
export function extractNamedOutputs(
  template: WorkflowTemplate,
  run: RunRecord
): Record<string, unknown> {
  const named = template.namedOutputs ?? [];
  const resolved: Record<string, unknown> = {};
  // Last generate-step content is shared across all named outputs that
  // couldn't otherwise be matched — v1.5 chain semantics.
  const combined = { ...run.inputs, ...run.outputs };
  const lastOutput = findLastGenerateOutput(combined);

  for (const output of named) {
    const direct = combined[output.id];
    if (direct !== undefined) {
      resolved[output.id] = direct;
      continue;
    }
    const suffix = `_${output.id}`;
    const match = Object.entries(combined).find(([k]) => k.endsWith(suffix));
    if (match !== undefined) {
      resolved[output.id] = match[1];
      continue;
    }
    if (lastOutput !== undefined) {
      resolved[output.id] = lastOutput;
    }
  }
  return resolved;
}

/**
 * Internal: find the final `*_output` entry in a combined inputs/outputs
 * object. Workflow engine names generate steps' result fields this way, so
 * the newest one is always the freshest LLM response in the chain.
 */
function findLastGenerateOutput(combined: Record<string, unknown>): unknown {
  let latest: unknown;
  for (const [k, v] of Object.entries(combined)) {
    if (k.endsWith('_output')) latest = v;
  }
  return latest;
}

/**
 * Apply a chain step's input mapping to build `initialInputs` for the next
 * template run.  Unresolved mappings are returned as warnings so the engine
 * can surface them without aborting the whole chain.
 */
export function applyInputMap(
  step: WorkflowChainStep,
  priorResults: ChainStepResult[],
  seed: Record<string, unknown> = {}
): { inputs: Record<string, unknown>; warnings: string[] } {
  const inputs: Record<string, unknown> = { ...seed };
  const warnings: string[] = [];
  for (const mapping of step.inputMap ?? []) {
    const source = priorResults[mapping.fromStepIndex];
    if (!source) {
      warnings.push(
        `Step ${mapping.fromStepIndex} not available for input "${mapping.toInputId}"`
      );
      continue;
    }
    const value = source.outputs[mapping.fromOutputId];
    if (value === undefined) {
      warnings.push(
        `Upstream output "${mapping.fromOutputId}" missing on step ${mapping.fromStepIndex} (needed for "${mapping.toInputId}")`
      );
      continue;
    }
    inputs[mapping.toInputId] = value;
  }
  return { inputs, warnings };
}

/**
 * Run a chain step-by-step. Any thrown error aborts subsequent steps and
 * the chain is marked `failed`.
 */
export async function runChain(opts: RunChainOptions): Promise<ChainRunRecord> {
  const { chain, resolveTemplate, provider, fileOps, onInterview, onProgress } = opts;
  const startTime = new Date();
  const steps: ChainStepResult[] = [];
  let status: 'completed' | 'failed' = 'completed';
  let error: string | undefined;

  for (let i = 0; i < chain.steps.length; i++) {
    const chainStep = chain.steps[i];
    if (!chainStep) continue;
    const template = resolveTemplate(chainStep.templateId);
    if (!template) {
      status = 'failed';
      error = `Template not found: ${chainStep.templateId}`;
      onProgress?.(i, chainStep.templateId, 'failed');
      break;
    }

    onProgress?.(i, chainStep.templateId, 'started');

    const { inputs, warnings } = applyInputMap(
      chainStep,
      steps,
      i === 0 ? opts.initialInputs : undefined
    );

    try {
      const engine = createWorkflowEngine(provider, fileOps, onInterview);
      const run = await engine.execute(template, inputs);
      const outputs = extractNamedOutputs(template, run);
      steps.push({ templateId: chainStep.templateId, run, outputs, warnings });
      if (run.status === 'failed') {
        status = 'failed';
        error = run.error ?? `Step ${i} failed`;
        onProgress?.(i, chainStep.templateId, 'failed');
        break;
      }
      onProgress?.(i, chainStep.templateId, 'completed');
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
      onProgress?.(i, chainStep.templateId, 'failed');
      break;
    }
  }

  const record: ChainRunRecord = {
    chainId: chain.id,
    chainName: chain.name,
    startTime: startTime.toISOString(),
    endTime: new Date().toISOString(),
    status,
    steps,
  };
  if (error !== undefined) record.error = error;
  return record;
}

/**
 * Serialize a chain to JSON for on-disk persistence. Round-trip-safe.
 */
export function serializeChain(chain: WorkflowChain): string {
  return JSON.stringify(chain, null, 2);
}

export function deserializeChain(raw: string): WorkflowChain {
  const parsed = JSON.parse(raw) as WorkflowChain;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported chain schema version: ${parsed.schemaVersion}`);
  }
  if (!Array.isArray(parsed.steps)) {
    throw new Error('Invalid chain: steps must be an array');
  }
  return parsed;
}

/**
 * Generate a chain id. Exported so the UI and tests can build chains
 * deterministically when needed.
 */
export function createChainId(): string {
  return `chain_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Convenience helper: build an empty chain scaffold the UI can mutate in
 * place before saving.
 */
export function emptyChain(name: string): WorkflowChain {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: createChainId(),
    name,
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
}
