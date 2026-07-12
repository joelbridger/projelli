import type { DailyWorkItem } from '@/platform/crm/tasks';
import type { CrmTask, CrmWorkflowWorkItem } from '../types';

export type CrmDailyWorkItem =
  | (CrmTask & DailyWorkItem & { kind: 'task' })
  | (CrmWorkflowWorkItem & DailyWorkItem & { kind: 'workflow_step' });

export function dailyWorkItems(tasks: readonly CrmTask[], workflowWorkItems: readonly CrmWorkflowWorkItem[]): CrmDailyWorkItem[] {
  return [
    ...tasks.map((task) => ({ ...task, kind: 'task' as const })),
    ...workflowWorkItems.map((item) => ({ ...item, kind: 'workflow_step' as const })),
  ];
}

export function workLabel(item: CrmDailyWorkItem): string {
  return item.kind === 'workflow_step' ? 'Workflow step' : 'Task';
}

export function workHousehold(item: CrmDailyWorkItem): string | undefined {
  return item.householdLabel;
}
