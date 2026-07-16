/** Public doorway for reusable one-off task templates. */
export { taskTemplatesLibrary } from './descriptor';
export { useTaskTemplateStore } from './taskTemplateStore';
export type {
  AppliedTaskTemplate,
  SaveTaskTemplateInput,
  TaskTemplate,
  TaskTemplateStore,
} from './contract';
export { TaskTemplateError } from './contract';
