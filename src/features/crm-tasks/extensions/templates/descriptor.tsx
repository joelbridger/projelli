import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';
import type { CrmTask } from '@/features/crm-home/types';
import type { TaskTemplateDescriptor } from '@/features/crm-tasks/taskExtensionRegistry';
import { TaskTemplateLibrary } from './TaskTemplateLibrary';

declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskTemplateIdMap {
    'templates.library': true;
  }
}

/** Required only by the legacy synchronous registry shape; applying a saved template uses the task-store doorway. */
function blankTaskDraft(addRequest?: CrmHouseholdAddRequest): CrmTask {
  const household = addRequest?.kind === 'task' ? addRequest : undefined;
  return {
    id: `new-task-${crypto.randomUUID()}`,
    title: '',
    body: '',
    ...(household ? { householdId: household.householdId, householdLabel: household.householdLabel } : {}),
    assigneeUserId: null,
    status: 'open',
    priority: 'normal',
    tagIds: [],
    contextRefs: household ? [household.householdId] : [],
  };
}

export const taskTemplatesLibrary: TaskTemplateDescriptor = {
  id: 'templates.library',
  order: 20,
  create: blankTaskDraft,
  mount: (context) => <TaskTemplateLibrary {...context} />,
};
