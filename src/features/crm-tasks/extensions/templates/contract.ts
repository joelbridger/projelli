import type { TaskPriority } from '@/features/crm-tasks';

export interface TaskTemplate {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly priority: TaskPriority;
  readonly category: string | null;
  readonly due: string | null;
  readonly dueTime: string | null;
  /** A human prompt shown before the normal task editor opens. */
  readonly relationPrompt: string | null;
  /** Stable firm tag IDs only; display details stay in the tag catalog. */
  readonly tagIds: readonly string[];
  readonly retired: boolean;
}

export interface SaveTaskTemplateInput {
  name: string;
  title: string;
  body?: string;
  priority?: TaskPriority;
  category?: string | null;
  due?: string | null;
  dueTime?: string | null;
  relationPrompt?: string | null;
  tagIds?: readonly string[];
}

export interface AppliedTaskTemplate {
  readonly template: TaskTemplate;
  readonly taskInput: {
    readonly title: string;
    readonly body: string;
    readonly priority: TaskPriority;
    readonly category?: string;
    readonly due?: string;
    readonly dueTime?: string;
    readonly tagIds: readonly string[];
  };
}

export interface TaskTemplateStore {
  list(): Promise<readonly TaskTemplate[]>;
  create(input: SaveTaskTemplateInput): Promise<TaskTemplate>;
  update(id: string, input: SaveTaskTemplateInput): Promise<TaskTemplate>;
  retire(id: string): Promise<TaskTemplate>;
  apply(id: string): Promise<AppliedTaskTemplate>;
}

export type TaskTemplateErrorCode =
  | 'workspace_unavailable'
  | 'persistence_failed'
  | 'invalid_template'
  | 'template_not_found'
  | 'template_retired';

export class TaskTemplateError extends Error {
  readonly code: TaskTemplateErrorCode;

  constructor(code: TaskTemplateErrorCode, message: string) {
    super(message);
    this.name = 'TaskTemplateError';
    this.code = code;
  }
}
