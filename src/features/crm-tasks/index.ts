/**
 * Public doorway for canonical CRM tasks.
 *
 * Consumers create, update, and remove tasks only through `useTaskRecordStore()`. The
 * adapter is reactive, async, and writes through the existing encrypted live
 * CRM record and trash routes. It exposes no raw record writer or copied tag
 * display data.
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
