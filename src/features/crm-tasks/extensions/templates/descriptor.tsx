import type { TaskTemplateDescriptor } from '@/features/crm-tasks/taskExtensionRegistry';
import { createLegacyTaskDraft } from '@/features/crm-tasks/taskExtensionRegistryCompatibility';
import { TaskTemplateLibrary } from './TaskTemplateLibrary';

declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskTemplateIdMap {
    'templates.library': true;
  }
}

export const taskTemplatesLibrary: TaskTemplateDescriptor = {
  id: 'templates.library',
  order: 20,
  create: createLegacyTaskDraft,
  mount: (context) => <TaskTemplateLibrary {...context} />,
};
