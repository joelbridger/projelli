import type { TaskTemplateDescriptor } from '@/features/crm-tasks/taskExtensionRegistry';
import { TaskTemplateLibrary } from './TaskTemplateLibrary';

declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskTemplateIdMap {
    'templates.library': true;
  }
}

export const taskTemplatesLibrary: TaskTemplateDescriptor = {
  id: 'templates.library',
  order: 20,
  mount: (context) => <TaskTemplateLibrary {...context} />,
};
