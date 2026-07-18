import type { TaskTemplateDescriptor } from '../../taskExtensionRegistry';
import { TaskCreateTemplateMount } from './TaskCreateTemplate';

declare module '../../taskExtensionRegistry' {
  interface TaskTemplateIdMap {
    'task-create-v1.composer': true;
  }
}

function createTaskCreateV1Draft(
  addRequest?: Parameters<NonNullable<TaskTemplateDescriptor['create']>>[0]
): ReturnType<NonNullable<TaskTemplateDescriptor['create']>> {
  const related = addRequest?.kind === 'task' ? addRequest : undefined;
  return {
    id: `new-task-${crypto.randomUUID()}`,
    title: '',
    body: '',
    ...(related
      ? {
          householdId: related.householdId,
          householdLabel: related.householdLabel,
          contextRefs: [related.householdId],
          ...(related.contextRefs
            ? { originatingContextRefs: related.contextRefs }
            : {}),
        }
      : { contextRefs: [] }),
    assigneeUserId: null,
    status: 'open',
    priority: 'normal',
    tagIds: [],
  };
}

/** Flag-gated v1 task composer mounted through the task starting-point seam. */
export const taskCreateV1Template: TaskTemplateDescriptor = {
  id: 'task-create-v1.composer',
  order: 20,
  create: createTaskCreateV1Draft,
  mount: (context) => <TaskCreateTemplateMount context={context} />,
};
