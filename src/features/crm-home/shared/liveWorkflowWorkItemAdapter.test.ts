import { describe, expect, it } from 'vitest';
import { createTemplate, startWorkflow, updateWorkflowTemplate } from '../workflowLive';
import { projectCrmWorkflowWorkItem } from './liveWorkflowWorkItemAdapter';

describe('live workflow work-item projection', () => {
  it('exposes copied stable tag IDs without copied display data', () => {
    const template = createTemplate('Annual review', ['Prepare']);
    const tagged = updateWorkflowTemplate(template, {
      steps: template.steps.map((step) => ({ ...step, tagIds: ['tag:prep'] })),
    });
    const instance = structuredClone(startWorkflow(tagged, { id: 'household-1', label: 'River household' }));
    const step = Object.values(instance.snapshot.steps)[0];
    if (!step) throw new Error('Expected a workflow step.');

    const item = projectCrmWorkflowWorkItem(instance, step);

    expect(item.tagIds).toEqual(['tag:prep']);
    expect(item.workflowLabel).toBe('Annual review');
    expect(item).not.toHaveProperty('tagNames');
    expect(item).not.toHaveProperty('tagColors');
  });
});
