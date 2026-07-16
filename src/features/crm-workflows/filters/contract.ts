import type { WorkflowTemplateStatus } from '../workflowTemplateStore';

export type WorkflowStatusFilter = 'all' | WorkflowTemplateStatus;

export type WorkflowFilterState = Readonly<{
  status: WorkflowStatusFilter;
  query: string;
}>;

export const EMPTY_WORKFLOW_FILTERS: WorkflowFilterState = {
  status: 'all',
  query: '',
};
