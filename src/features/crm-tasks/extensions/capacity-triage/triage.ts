import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home';
import type {
  CapacityTriageInput,
  CapacityTriagePreference,
  CapacityTriageResult,
} from './contract';

export const DEFAULT_CAPACITY_TRIAGE_PREFERENCE: CapacityTriagePreference =
  Object.freeze({
    assignee: 'all',
    duePressure: 'all',
    priority: 'all',
    tagIds: Object.freeze([]),
  });

const priorityRank = { high: 0, normal: 1, low: 2 } as const;

function calendarDay(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function isOpen(status: CrmTask['status']): boolean {
  return status !== 'done' && status !== 'cancelled';
}

function dueRank(item: CrmTask | CrmWorkflowWorkItem, today: string): number {
  const due = calendarDay(item.dueAt);
  if (!due) return 3;
  if (due < today) return 0;
  if (due === today) return 1;
  return 2;
}

function matchesPreference(
  item: CrmTask | CrmWorkflowWorkItem,
  preference: CapacityTriagePreference,
  today: string
): boolean {
  if (
    preference.assignee === 'unassigned'
      ? item.assigneeUserId !== null
      : preference.assignee !== 'all' &&
        item.assigneeUserId !== preference.assignee.slice('user:'.length)
  ) {
    return false;
  }
  if (preference.priority !== 'all' && item.priority !== preference.priority) {
    return false;
  }
  const due = calendarDay(item.dueAt);
  if (
    (preference.duePressure === 'due_now' && (!due || due > today)) ||
    (preference.duePressure === 'scheduled' && !due) ||
    (preference.duePressure === 'unscheduled' && due)
  ) {
    return false;
  }
  return preference.tagIds.every((tagId) => item.tagIds.includes(tagId));
}

/**
 * Applies saved filters and a deterministic urgency order to current work.
 * Selected tags use AND semantics: every selected stable tag ID must be on an
 * item before it appears.
 */
export function buildCapacityTriage(
  input: CapacityTriageInput
): CapacityTriageResult {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const open: (CrmTask | CrmWorkflowWorkItem)[] = [
    ...input.tasks,
    ...input.workflowWorkItems,
  ].filter((item) => isOpen(item.status));
  const ranked = open
    .filter((item) => matchesPreference(item, input.preference, today))
    .sort((left, right) => {
      const urgency = dueRank(left, today) - dueRank(right, today);
      if (urgency) return urgency;
      const priority =
        priorityRank[left.priority] - priorityRank[right.priority];
      if (priority) return priority;
      const due = (calendarDay(left.dueAt) ?? '9999-12-31').localeCompare(
        calendarDay(right.dueAt) ?? '9999-12-31'
      );
      return (
        due ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
      );
    });

  return {
    openCount: open.length,
    shownCount: ranked.length,
    unscheduledCount: open.filter((item) => !calendarDay(item.dueAt)).length,
    unassignedCount: open.filter((item) => item.assigneeUserId === null).length,
    ranked,
  };
}
