import { describe, expect, it } from 'vitest';

import { prepareWealthboxWrite, wealthboxWorkflowTargetNotice } from './writeTargets';

const baseDraft = {
  kind: 'task' as const,
  title: 'Send the recap',
  description: 'Include the agreed next steps.',
  dueDate: '2026-07-15',
  contactId: 67405677,
};

describe('Wealthbox write targets', () => {
  it('builds the proven task request when no unverified target is present', () => {
    expect(prepareWealthboxWrite(baseDraft)).toEqual({
      disposition: 'ready_for_task_write',
      request: {
        method: 'POST',
        path: '/tasks',
        body: {
          name: 'Send the recap',
          description: 'Include the agreed next steps.',
          due_date: '2026-07-15',
          linked_to: [{ id: 67405677, type: 'Contact' }],
        },
      },
    });
  });

  it('does not invent the task-assignee wire field', () => {
    const result = prepareWealthboxWrite({ ...baseDraft, assignee: { kind: 'task_assignee', userId: 391639, displayName: 'Avery' } });
    expect(result.disposition).toBe('needs_assignee_api_confirmation');
    expect(result.notice).toMatch(/will not send an assignment/i);
  });

  it('keeps workflow launch as an honest Basic-plan manual handoff', () => {
    const result = prepareWealthboxWrite({ ...baseDraft, workflowTarget: {
      kind: 'workflow', templateId: 12, templateName: 'Onboarding', contactId: 67405677,
    } });
    expect(result.disposition).toBe('workflow_manual_handoff');
    expect(result.target?.templateName).toBe('Onboarding');
    expect(result.notice).toBe(wealthboxWorkflowTargetNotice);
  });
});
