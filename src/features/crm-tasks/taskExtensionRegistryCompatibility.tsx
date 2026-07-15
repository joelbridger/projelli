import { Plus } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';
import type { CrmTask } from '@/features/crm-home/types';
import type {
  TaskActionDescriptor,
  TaskFieldDescriptor,
  TaskTemplateDescriptor,
} from './taskExtensionRegistry';

declare module './taskExtensionRegistry' {
  interface TaskFieldIdMap {
    'legacy.core-fields': true;
  }

  interface TaskActionIdMap {
    'legacy.save-view': true;
  }

  interface TaskTemplateIdMap {
    'legacy.blank-task': true;
  }
}

export function createLegacyTaskDraft(
  addRequest?: CrmHouseholdAddRequest
): CrmTask {
  const household = addRequest?.kind === 'task' ? addRequest : undefined;
  return {
    id: `new-task-${crypto.randomUUID()}`,
    title: '',
    body: '',
    ...(household
      ? {
          householdId: household.householdId,
          householdLabel: household.householdLabel,
        }
      : {}),
    assigneeUserId: null,
    status: 'open',
    priority: 'normal',
    contextRefs: household ? [household.householdId] : [],
  };
}

export const legacyTaskFields: readonly TaskFieldDescriptor[] = [
  {
    id: 'legacy.core-fields',
    order: 10,
    mount: ({ compatibilityMount }) => compatibilityMount,
  },
];

export const legacyTaskActions: readonly TaskActionDescriptor[] = [
  {
    id: 'legacy.save-view',
    order: 10,
    mount: ({ compatibilityMount }) => compatibilityMount,
  },
];

export const legacyTaskTemplates: readonly TaskTemplateDescriptor[] = [
  {
    id: 'legacy.blank-task',
    order: 10,
    create: createLegacyTaskDraft,
    mount: ({ addRequest, onCreate }) => (
      <Button
        data-testid="crm-task-new"
        iconLeft={Plus}
        onClick={() => {
          onCreate(createLegacyTaskDraft(addRequest));
        }}
      >
        New task
      </Button>
    ),
  },
];
