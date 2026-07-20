import type {
  WealthboxPreparedWrite,
  WealthboxTaskWriteDraft,
} from './types';
import { BRAND } from '@/config/brand';

const BASIC_WORKFLOW_NOTICE =
  `This Wealthbox Basic account does not expose workflow automation here. ${BRAND.name} will not guess a workflow step or claim it was started. Keep this as a reviewed manual handoff until the account and API confirm a workflow launch.`;

const ASSIGNEE_CONFIRMATION_NOTICE =
  `The task is ready, but the assignee field has not been confirmed against this Wealthbox account yet. ${BRAND.name} will not send an assignment until that API field is verified.`;

function baseTaskBody(draft: WealthboxTaskWriteDraft): Record<string, unknown> {
  return {
    name: draft.title.trim(),
    description: draft.description.trim(),
    due_date: draft.dueDate,
    linked_to: [{ id: draft.contactId, type: 'Contact' }],
  };
}

/**
 * Builds the exact *known-safe* task request. Assignee writes are deliberately
 * held rather than guessed: live evidence proves task creation, but not the
 * task-assignee wire key. Workflow targets are a reviewed manual handoff in a
 * Basic-plan account, where workflow creation was explicitly plan-gated.
 */
export function prepareWealthboxWrite(draft: WealthboxTaskWriteDraft): WealthboxPreparedWrite {
  if (draft.workflowTarget) {
    return {
      disposition: 'workflow_manual_handoff',
      target: draft.workflowTarget,
      notice: BASIC_WORKFLOW_NOTICE,
    };
  }

  if (draft.assignee) {
    return {
      disposition: 'needs_assignee_api_confirmation',
      notice: ASSIGNEE_CONFIRMATION_NOTICE,
    };
  }

  return {
    disposition: 'ready_for_task_write',
    request: {
      method: 'POST',
      path: '/tasks',
      body: baseTaskBody(draft),
    },
  };
}

export const wealthboxWorkflowTargetNotice = BASIC_WORKFLOW_NOTICE;
