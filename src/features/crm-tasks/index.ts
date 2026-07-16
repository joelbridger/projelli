/**
 * Public doorway for canonical CRM tasks.
 *
 * Consumers create and update tasks only through `useTaskRecordStore()`. The
 * adapter is reactive, async, and writes through the existing encrypted live
 * CRM record route. It exposes no raw record writer or copied tag display data.
 */
export { useTaskRecordStore } from './taskRecordStore';
export type {
  TaskActionContext,
  TaskActionDescriptor,
} from './taskExtensionRegistry';
export type {
  CreateTaskRecordInput,
  TaskDocumentRef,
  TaskContextRef,
  TaskHouseholdRef,
  TaskPriority,
  TaskRecord,
  TaskRecordStore,
  TaskStatus,
  UpdateTaskRecordPatch,
} from './taskRecordStore';
export { taskTemplatesAdminSettingsPanel } from './extensions/templates-admin';
