import type { ContactRef } from '@/features/crm-contacts';
import type { TaskRecord, TaskRecordStore } from '@/features/crm-tasks';

export function createTaskForContact(
  store: TaskRecordStore,
  contactRef: ContactRef,
): Promise<TaskRecord> {
  return store.create({ title: 'Contact follow-up', contextRefs: [contactRef] });
}
