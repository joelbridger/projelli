/**
 * Public workflow-authoring contract for later workflow-rule packages.
 *
 * Templates own their stable IDs and ordered step IDs. Tag references are IDs
 * only: callers resolve the current tag label and colour through the public
 * firm-tag doorway.
 */
export type WorkflowAuthoringStatus = 'draft' | 'published';

export interface WorkflowAuthoringStep {
  readonly id: string;
  readonly title: string;
  readonly position: number;
  readonly tagIds: readonly string[];
}

export interface WorkflowAuthoringTemplate {
  readonly id: string;
  readonly title: string;
  readonly status: WorkflowAuthoringStatus;
  readonly tagIds: readonly string[];
  readonly steps: readonly WorkflowAuthoringStep[];
}

export interface WorkflowAuthoringStart {
  readonly id: string;
  readonly templateId: string;
  readonly householdId: string;
}

export interface CreateWorkflowAuthoringTemplateInput {
  title: string;
  tagIds?: readonly string[];
  steps?: readonly { title: string; tagIds?: readonly string[] }[];
}

export interface UpdateWorkflowAuthoringTemplateInput {
  id: string;
  title: string;
  tagIds: readonly string[];
  steps: readonly WorkflowAuthoringStep[];
}

/** The small rule-facing surface; persistence and editor state stay private. */
export interface WorkflowAuthoringStore {
  list(): Promise<readonly WorkflowAuthoringTemplate[]>;
  get(id: string): Promise<WorkflowAuthoringTemplate | null>;
  create(
    input: CreateWorkflowAuthoringTemplateInput
  ): Promise<WorkflowAuthoringTemplate>;
  update(
    input: UpdateWorkflowAuthoringTemplateInput
  ): Promise<WorkflowAuthoringTemplate>;
  publish(id: string): Promise<WorkflowAuthoringTemplate>;
  start(
    templateId: string,
    householdId: string
  ): Promise<WorkflowAuthoringStart>;
}

export type WorkflowAuthoringErrorCode =
  | 'workspace_unavailable'
  | 'persistence_failed'
  | 'invalid_template'
  | 'invalid_tag'
  | 'template_not_found'
  | 'template_not_published'
  | 'invalid_household';

export class WorkflowAuthoringError extends Error {
  readonly code: WorkflowAuthoringErrorCode;

  constructor(code: WorkflowAuthoringErrorCode) {
    super(code);
    this.name = 'WorkflowAuthoringError';
    this.code = code;
  }
}
