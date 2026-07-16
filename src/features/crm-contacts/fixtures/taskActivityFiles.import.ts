import type { ContactRef, ContactPrintProjection } from '@/features/crm-contacts';
import type { TaskRecordStore } from '@/features/crm-tasks';
import type { TimelineRecord } from '@/features/crm-timeline';
import type { WorkspaceDocumentRef } from '@/features/crm-documents';

export type TaskActivityFilesPublicImports = {
  ref: ContactRef;
  print: ContactPrintProjection;
  taskStore: TaskRecordStore;
  timeline: TimelineRecord;
  document: WorkspaceDocumentRef;
};
