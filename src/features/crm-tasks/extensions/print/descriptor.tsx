import type { TaskActionDescriptor } from '@/features/crm-tasks';
import { TaskListPrintAction } from './TaskListPrintAction';

declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskActionIdMap {
    'task-list-print.toolbar': true;
  }
}

/** The single task-toolbar print action owned by this feature. */
export const taskListPrintAction: TaskActionDescriptor = {
  id: 'task-list-print.toolbar',
  order: 40,
  mount: (context) => <TaskListPrintAction {...context} />,
};
