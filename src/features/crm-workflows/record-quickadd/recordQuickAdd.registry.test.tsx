import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mountWorkflowRecordStarts,
  workflowRecordStartRegistry,
  type WorkflowRecordStartContext,
} from '@/features/crm-workflows';
import { setDevFlagOverride } from '@/platform/flags';
import { workflowRecordQuickAddDescriptor } from './descriptor';

const context: WorkflowRecordStartContext = {
  request: {
    kind: 'workflow',
    householdId: 'household:river',
    householdLabel: 'River household',
  },
  household: {
    id: 'household:river',
    label: 'River household',
    matterId: 'matter:river',
  },
  onRequestConsumed: () => undefined,
};

describe('workflow record quick-add registry', () => {
  afterEach(() => {
    setDevFlagOverride('workflow-record-quickadd', undefined);
  });

  it('registers exactly once and leaves no host wrapper while dark', () => {
    setDevFlagOverride('workflow-record-quickadd', false);

    expect(
      workflowRecordStartRegistry.filter(
        (descriptor) => descriptor.id === workflowRecordQuickAddDescriptor.id
      )
    ).toEqual([workflowRecordQuickAddDescriptor]);
    const { container } = render(<>{mountWorkflowRecordStarts(context)}</>);
    expect(container).toBeEmptyDOMElement();
  });
});
