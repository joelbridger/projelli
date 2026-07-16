import type { TaskFieldDescriptor } from '@/features/crm-tasks/taskExtensionRegistry';
import { TaskAttachmentsField } from './TaskAttachmentsField';

declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskFieldIdMap {
    'attachments.files': true;
  }
}

/** Task-detail mount for references to existing local Documents files. */
export const taskAttachmentsField: TaskFieldDescriptor = {
  id: 'attachments.files',
  order: 20,
  mount: ({ task, updateTask, setPersistenceBusy, households }) => (
    <TaskAttachmentsField
      task={task}
      updateTask={updateTask}
      {...(setPersistenceBusy ? { setPersistenceBusy } : {})}
      households={households}
    />
  ),
};
