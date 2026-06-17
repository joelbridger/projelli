/**
 * M7 — Workflow chain definition tests.
 *
 * Covers:
 *   - Serialize / deserialize round-trip
 *   - Save / load via the workflowChains storage adapter
 *   - Named-output resolution from a RunRecord
 *   - Input-mapping application for chain steps
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  serializeChain,
  deserializeChain,
  extractNamedOutputs,
  applyInputMap,
  emptyChain,
} from '@/features/workflows/engine/WorkflowChainEngine';
import {
  saveChain,
  getChain,
  listChains,
  deleteChain,
  setChainStorage,
} from '@/features/workflows/engine/workflowChains';
import type {
  WorkflowChain,
  WorkflowTemplate,
  RunRecord,
} from '@/platform/types/workflow';

function templateFixture(partial: Partial<WorkflowTemplate> & { id: string }): WorkflowTemplate {
  return {
    name: partial.name ?? partial.id,
    description: partial.description ?? 'desc',
    version: partial.version ?? '1.0.0',
    category: partial.category ?? 'planning',
    steps: partial.steps ?? [],
    requiredInputs: partial.requiredInputs ?? [],
    outputs: partial.outputs ?? [],
    ...partial,
  };
}

function runRecordFixture(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: 'run_test_1',
    workflow: 'test',
    model: 'mock-model',
    inputs: {},
    outputs: {},
    tool_calls: [],
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    status: 'completed',
    error: undefined,
    ...overrides,
  };
}

// In-memory storage for test isolation.
function memoryStorage() {
  let store: string | null = null;
  return {
    read: () => store,
    write: (v: string) => {
      store = v;
    },
    clear: () => {
      store = null;
    },
  };
}

describe('WorkflowChain — round-trip', () => {
  it('serializes and deserializes to the same shape', () => {
    const chain: WorkflowChain = {
      schemaVersion: 1,
      id: 'chain_abc',
      name: 'Research → Pricing',
      description: 'Competitor landscape, then pricing.',
      steps: [
        { templateId: 'competitor-analysis', inputMap: [] },
        {
          templateId: 'pricing-strategy',
          inputMap: [
            { fromStepIndex: 0, fromOutputId: 'competitors', toInputId: 'competitor_list' },
          ],
        },
      ],
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };
    const json = serializeChain(chain);
    const parsed = deserializeChain(json);
    expect(parsed).toEqual(chain);
  });

  it('rejects an unsupported schema version', () => {
    const bad = JSON.stringify({ schemaVersion: 99, id: 'x', name: 'x', steps: [] });
    expect(() => deserializeChain(bad)).toThrow(/schema version/);
  });

  it('emptyChain stamps timestamps and produces a valid chain', () => {
    const c = emptyChain('New chain');
    expect(c.schemaVersion).toBe(1);
    expect(c.steps).toEqual([]);
    expect(typeof c.createdAt).toBe('string');
    expect(new Date(c.createdAt).toString()).not.toBe('Invalid Date');
  });
});

describe('WorkflowChain — save/load', () => {
  beforeEach(() => {
    setChainStorage(memoryStorage());
  });

  it('saveChain persists, getChain finds it, listChains returns it', () => {
    const c = emptyChain('My chain');
    c.steps.push({ templateId: 'competitor-analysis' });
    const saved = saveChain(c);

    expect(getChain(saved.id)).toEqual(saved);
    expect(listChains()).toHaveLength(1);
    expect(listChains()[0]?.name).toBe('My chain');
  });

  it('deleteChain removes the record', () => {
    const c = saveChain(emptyChain('X'));
    deleteChain(c.id);
    expect(getChain(c.id)).toBeUndefined();
    expect(listChains()).toHaveLength(0);
  });

  it('saveChain updates updatedAt when the id already exists', async () => {
    const a = saveChain(emptyChain('A'));
    // Ensure wall-clock ticks past millisecond resolution.
    await new Promise((r) => setTimeout(r, 5));
    const b = saveChain({ ...a, name: 'A (edited)' });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('A (edited)');
    expect(b.updatedAt >= a.updatedAt).toBe(true);
    expect(listChains()).toHaveLength(1);
  });
});

describe('WorkflowChain — named output resolution', () => {
  const template = templateFixture({
    id: 'competitor-analysis',
    namedOutputs: [
      { id: 'competitors', name: 'Competitors' },
      { id: 'key_gaps', name: 'Key gaps' },
    ],
  });

  it('resolves a named output from the run.inputs accumulator', () => {
    const run = runRecordFixture({
      inputs: {
        competitors: ['Asana', 'Monday'],
        something_else: 42,
      },
    });
    const out = extractNamedOutputs(template, run);
    expect(out.competitors).toEqual(['Asana', 'Monday']);
  });

  it('matches a suffixed key when the direct key is absent', () => {
    const run = runRecordFixture({
      outputs: {
        'generate-battle-cards_key_gaps': ['No mobile app', 'High price'],
      },
    });
    const out = extractNamedOutputs(template, run);
    expect(out.key_gaps).toEqual(['No mobile app', 'High price']);
  });

  it('omits outputs that cannot be located', () => {
    const run = runRecordFixture({ inputs: {} });
    const out = extractNamedOutputs(template, run);
    expect(out).toEqual({});
  });
});

describe('WorkflowChain — input mapping', () => {
  const priorStep = {
    templateId: 'competitor-analysis',
    run: runRecordFixture(),
    outputs: { competitors: ['Asana'] },
    warnings: [],
  };

  it('copies mapped outputs into the next step\'s inputs', () => {
    const { inputs, warnings } = applyInputMap(
      {
        templateId: 'pricing-strategy',
        inputMap: [
          { fromStepIndex: 0, fromOutputId: 'competitors', toInputId: 'competitor_list' },
        ],
      },
      [priorStep]
    );
    expect(inputs.competitor_list).toEqual(['Asana']);
    expect(warnings).toHaveLength(0);
  });

  it('records a warning if the source step has not run', () => {
    const { inputs, warnings } = applyInputMap(
      {
        templateId: 'pricing-strategy',
        inputMap: [
          { fromStepIndex: 2, fromOutputId: 'competitors', toInputId: 'competitor_list' },
        ],
      },
      [priorStep]
    );
    expect(inputs.competitor_list).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Step 2 not available/);
  });

  it('records a warning if the named output is missing upstream', () => {
    const { warnings } = applyInputMap(
      {
        templateId: 'pricing-strategy',
        inputMap: [
          { fromStepIndex: 0, fromOutputId: 'not_produced', toInputId: 'competitor_list' },
        ],
      },
      [priorStep]
    );
    expect(warnings[0]).toMatch(/Upstream output "not_produced" missing/);
  });

  it('merges the seed inputs for the first step', () => {
    const { inputs } = applyInputMap(
      {
        templateId: 'competitor-analysis',
        inputMap: [],
      },
      [],
      { businessName: 'TaskFlow' }
    );
    expect(inputs.businessName).toBe('TaskFlow');
  });
});
