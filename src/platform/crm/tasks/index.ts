/**
 * Small, pure helpers for the shared daily work list. The live-record bridge
 * remains the source of truth; this module only turns current records into a
 * view-time plan.
 */
export type WorkPriority = 'high' | 'normal' | 'low';

export interface DailyWorkItem {
  id: string;
  title: string;
  kind: 'task' | 'workflow_step';
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: WorkPriority;
  dueAt?: string | undefined;
  assigneeUserId: string | null;
}

export interface CapacityTriagePlan<T extends DailyWorkItem> {
  ranked: readonly T[];
  fitsToday: readonly T[];
  suggestedLater: readonly T[];
  activeMemberCount: number;
  hasCapacitySignal: boolean;
}

const priorityScore = (priority: WorkPriority) => priority === 'high' ? 0 : priority === 'normal' ? 1 : 2;
const day = (value: string | undefined) => value?.slice(0, 10);

/**
 * Capacity is intentionally based only on records available to this device:
 * one focused next item for each active firm member. We never invent hours,
 * estimates, meetings, or a fake team size.
 */
export function buildCapacityTriage<T extends DailyWorkItem>(items: readonly T[], activeMemberIds: readonly string[], today = new Date().toISOString().slice(0, 10)): CapacityTriagePlan<T> {
  const open = items.filter((item) => item.status !== 'done' && item.status !== 'cancelled');
  const ranked = [...open].sort((left, right) => {
    const leftDay = day(left.dueAt);
    const rightDay = day(right.dueAt);
    const leftUrgency = leftDay && leftDay <= today ? 0 : leftDay ? 1 : 2;
    const rightUrgency = rightDay && rightDay <= today ? 0 : rightDay ? 1 : 2;
    if (leftUrgency !== rightUrgency) return leftUrgency - rightUrgency;
    if (left.status === 'blocked' !== (right.status === 'blocked')) return left.status === 'blocked' ? 1 : -1;
    if (priorityScore(left.priority) !== priorityScore(right.priority)) return priorityScore(left.priority) - priorityScore(right.priority);
    return (leftDay ?? '9999-12-31').localeCompare(rightDay ?? '9999-12-31') || left.title.localeCompare(right.title);
  });
  const memberIds = new Set(activeMemberIds);
  const capacity = memberIds.size;
  return {
    ranked,
    fitsToday: capacity ? ranked.slice(0, capacity) : [],
    suggestedLater: capacity ? ranked.slice(capacity) : ranked,
    activeMemberCount: capacity,
    hasCapacitySignal: capacity > 0,
  };
}

/** Explains the same saved fact that placed an item in the daily order. */
export function dailyWorkReason(item: DailyWorkItem, today = new Date().toISOString().slice(0, 10)): string {
  const due = day(item.dueAt);
  if (due && due < today) return 'Overdue';
  if (due === today) return 'Due today';
  if (item.status === 'blocked') return 'Needs attention: blocked';
  if (item.priority === 'high') return 'Marked high priority';
  if (due) return `Due ${due}`;
  if (item.status === 'in_progress') return 'Already in progress';
  return 'Next open item';
}

export function nextRecurringDue(due: string | undefined, recurrence: { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number }): string | undefined {
  if (!due) return undefined;
  const date = new Date(`${due.slice(0, 10)}T12:00:00Z`);
  const interval = Math.max(1, recurrence.interval);
  if (recurrence.freq === 'daily') date.setUTCDate(date.getUTCDate() + interval);
  else if (recurrence.freq === 'weekly') date.setUTCDate(date.getUTCDate() + interval * 7);
  else if (recurrence.freq === 'monthly') date.setUTCMonth(date.getUTCMonth() + interval);
  else date.setUTCFullYear(date.getUTCFullYear() + interval);
  return date.toISOString().slice(0, 10);
}
