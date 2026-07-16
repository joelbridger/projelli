import { isEnabled } from '@/platform/flags';
import type { WorkflowRecordStartDescriptor } from '@/features/crm-workflows';
import { WorkflowRecordQuickAdd } from './WorkflowRecordQuickAdd';

/** Mount metadata only; the enabled child owns canonical list/start behavior. */
export const workflowRecordQuickAddDescriptor: WorkflowRecordStartDescriptor = {
  id: 'workflow-record-quickadd.start',
  order: 10,
  isEnabled: () => isEnabled('workflow-record-quickadd'),
  mount: (context) => <WorkflowRecordQuickAdd {...context} />,
};
