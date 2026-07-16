import { isEnabled } from '@/platform/flags';
import type {
  WorkflowAuthoringLibraryContext,
  WorkflowAuthoringLibraryDescriptor,
} from '../authoring/workflowAuthoringExtensionPoints';
import type { WorkflowTemplateRecord } from '../workflowTemplateStore';
import { EMPTY_WORKFLOW_FILTERS, type WorkflowFilterState } from './contract';
import {
  WorkflowFilterControl,
  WorkflowTemplateDetail,
} from './WorkflowFiltersView';

function matchesTemplate(
  template: WorkflowTemplateRecord,
  filters: WorkflowFilterState
): boolean {
  if (filters.status !== 'all' && template.status !== filters.status) {
    return false;
  }
  const query = filters.query.trim().toLocaleLowerCase();
  if (!query) return true;
  return (
    template.name.toLocaleLowerCase().includes(query) ||
    template.steps.some((step) =>
      step.title.toLocaleLowerCase().includes(query)
    )
  );
}

/**
 * The flag is checked by the host before any canonical template is copied into
 * this feature. The mounts repeat the check so direct callers stay inert too.
 */
function mountFilterControl(
  context: WorkflowAuthoringLibraryContext<WorkflowFilterState>
) {
  if (!isEnabled('workflow-filters')) return null;
  return <WorkflowFilterControl context={context} />;
}

function renderDetail(
  context: WorkflowAuthoringLibraryContext<WorkflowFilterState>
) {
  if (!isEnabled('workflow-filters')) return null;
  return <WorkflowTemplateDetail context={context} />;
}

export const workflowFiltersAuthoringExtension: WorkflowAuthoringLibraryDescriptor<WorkflowFilterState> =
  {
    id: 'workflow-filters.library',
    order: 20,
    isEnabled: () => isEnabled('workflow-filters'),
    mountFilterControl,
    filter: (template, context) =>
      matchesTemplate(template, context.state.get() ?? EMPTY_WORKFLOW_FILTERS),
    renderDetail,
  };
