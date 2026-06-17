/**
 * M7 — Chain execution through a mock provider.
 *
 * Verifies that a two-step chain:
 *   - runs the first template,
 *   - extracts a named output from the RunRecord,
 *   - injects the output into the second template's inputs via inputMap,
 *   - produces a terminal ChainRunRecord with completed status.
 */

import { describe, it, expect } from 'vitest';
import { MockProvider } from '@/modules/models/MockProvider';
import { runChain } from '@/features/workflows/engine/WorkflowChainEngine';
import type {
  WorkflowChain,
  WorkflowTemplate,
  InterviewStepConfig,
  GenerateStepConfig,
} from '@/types/workflow';

function makeStep1(): WorkflowTemplate {
  const interview: InterviewStepConfig = {
    questions: [
      { id: 'businessName', question: 'Name?', type: 'text', required: true },
    ],
  };
  const generate: GenerateStepConfig = {
    outputFile: 'OUT1.md',
    promptTemplate: 'Business: {{businessName}}. List three competitors.',
  };
  return {
    id: 'tpl-one',
    name: 'Template one',
    description: '',
    version: '1.0.0',
    category: 'research',
    steps: [
      { id: 'q', type: 'interview', name: 'Interview', config: interview },
      { id: 'gen', type: 'generate', name: 'Gen', config: generate },
    ],
    requiredInputs: [],
    outputs: ['OUT1.md'],
    namedOutputs: [{ id: 'competitors', name: 'Competitors' }],
  };
}

function makeStep2(): WorkflowTemplate {
  const generate: GenerateStepConfig = {
    outputFile: 'OUT2.md',
    promptTemplate: 'Based on competitors {{competitors}}, propose pricing.',
  };
  return {
    id: 'tpl-two',
    name: 'Template two',
    description: '',
    version: '1.0.0',
    category: 'planning',
    steps: [{ id: 'gen', type: 'generate', name: 'Gen', config: generate }],
    requiredInputs: [],
    outputs: ['OUT2.md'],
    namedInputs: [
      {
        id: 'competitors',
        name: 'Competitors',
        acceptsOutputFrom: ['competitors'],
      },
    ],
  };
}

describe('runChain — two-step pipeline', () => {
  it('runs each step and forwards named outputs to later steps', async () => {
    // Arrange a simple in-memory filesystem so we can inspect writes.
    const files = new Map<string, string>();
    const fileOps = {
      writeFile: async (p: string, c: string) => {
        files.set(p, c);
      },
      readFile: async (p: string) => files.get(p) ?? '',
    };

    const provider = new MockProvider('mock-model', 0.001, 1);
    provider.setDefaultResponse({
      content: 'Competitors: Asana, Monday, Trello.',
      delay: 1,
    });

    const step1 = makeStep1();
    const step2 = makeStep2();
    const templateLookup = (id: string) =>
      [step1, step2].find((t) => t.id === id);

    const chain: WorkflowChain = {
      schemaVersion: 1,
      id: 'chain_under_test',
      name: 'step1 → step2',
      steps: [
        { templateId: step1.id },
        {
          templateId: step2.id,
          inputMap: [
            { fromStepIndex: 0, fromOutputId: 'competitors', toInputId: 'competitors' },
          ],
        },
      ],
      createdAt: '',
      updatedAt: '',
    };

    // Answers for the single interview in step 1.
    const onInterview = async () => ({ businessName: 'TaskFlow' });

    const result = await runChain({
      chain,
      resolveTemplate: templateLookup,
      provider,
      fileOps,
      onInterview,
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(2);
    // Step 1 wrote its artifact.
    expect(files.has('OUT1.md')).toBe(true);
    // Step 1's generate step exposed a named output.
    const step1Result = result.steps[0];
    expect(step1Result?.outputs.competitors).toBeTruthy();
    // Step 2 received that output as an input and ran.
    expect(files.has('OUT2.md')).toBe(true);
    // The mock provider was called twice (one per generate step).
    expect(provider.getCallCount()).toBe(2);
  });

  it('marks the chain failed when a template is missing from the catalog', async () => {
    const provider = new MockProvider();
    const chain: WorkflowChain = {
      schemaVersion: 1,
      id: 'c',
      name: 'broken',
      steps: [{ templateId: 'missing-template' }],
      createdAt: '',
      updatedAt: '',
    };
    const result = await runChain({
      chain,
      resolveTemplate: () => undefined,
      provider,
      fileOps: { writeFile: async () => {}, readFile: async () => '' },
      onInterview: async () => ({}),
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Template not found/);
  });
});
