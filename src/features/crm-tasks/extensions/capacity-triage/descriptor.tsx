import type { TaskActionDescriptor } from '@/features/crm-tasks';
import { CapacityTriageAction } from './CapacityTriageAction';

declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskActionIdMap {
    'capacity-triage.toolbar': true;
  }
}

/** The single append-only task-toolbar contribution owned by this feature. */
export const capacityTriageTaskAction: TaskActionDescriptor = {
  id: 'capacity-triage.toolbar',
  order: 30,
  mount: (context) => <CapacityTriageAction {...context} />,
};
