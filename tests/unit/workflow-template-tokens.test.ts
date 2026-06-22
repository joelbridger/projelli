import { describe, expect, it } from 'vitest';
import { allWorkflows } from '@/features/workflows/engine';
import type {
  AnalyzeStepConfig,
  GenerateStepConfig,
  InterviewStepConfig,
  ReviewStepConfig,
  WorkflowStep,
  WorkflowTemplate,
} from '@/platform/types/workflow';

const TOKEN_PATTERN = /\{\{([^}]+)\}\}/g;
const BARE_TOKEN_PATTERN = /^\w+$/;
const ENGINE_INPUT_IDS = new Set(['content', 'retrievedContext']);

function interviewInputIds(template: WorkflowTemplate): Set<string> {
  const ids = new Set<string>();

  for (const step of template.steps) {
    if (step.type !== 'interview') continue;
    const config = step.config as InterviewStepConfig;
    for (const question of config.questions) {
      ids.add(question.id);
    }
  }

  return ids;
}

function promptStringsForStep(step: WorkflowStep): Array<{ name: string; value: string }> {
  if (step.type === 'generate') {
    const config = step.config as GenerateStepConfig;
    return [{ name: 'promptTemplate', value: config.promptTemplate }];
  }

  if (step.type === 'review') {
    const config = step.config as ReviewStepConfig;
    return [{ name: 'reviewPrompt', value: config.reviewPrompt }];
  }

  if (step.type === 'analyze') {
    const config = step.config as AnalyzeStepConfig;
    return [
      { name: 'retrievalQueryTemplate', value: config.retrievalQueryTemplate },
      { name: 'promptTemplate', value: config.promptTemplate },
      ...(config.documentTitle
        ? [{ name: 'documentTitle', value: config.documentTitle }]
        : []),
    ];
  }

  return [];
}

describe('workflow template tokens', () => {
  it('uses only bare, real input tokens in built-in workflow prompts', () => {
    const failures: string[] = [];

    for (const template of allWorkflows) {
      const allowedIds = new Set([...interviewInputIds(template), ...ENGINE_INPUT_IDS]);

      for (const step of template.steps) {
        for (const prompt of promptStringsForStep(step)) {
          for (const match of prompt.value.matchAll(TOKEN_PATTERN)) {
            const token = match[1]!;
            const location = `${template.id} > ${step.id} > ${prompt.name}`;

            if (!BARE_TOKEN_PATTERN.test(token)) {
              failures.push(`${location}: {{${token}}} is not a bare {{wordName}} token`);
              continue;
            }

            if (!allowedIds.has(token)) {
              failures.push(`${location}: {{${token}}} is not an interview question id`);
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
