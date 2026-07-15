import type {
  WorkflowRuleDescriptor,
  WorkflowStepExtensionDescriptor,
} from './workflowExtensionRegistry';

declare module './workflowExtensionRegistry' {
  interface WorkflowStepExtensionIdMap {
    'legacy.step-controls': true;
  }

  interface WorkflowRuleIdMap {
    'legacy.schedule-and-outcomes': true;
  }
}

export const legacyWorkflowStepExtensions: readonly WorkflowStepExtensionDescriptor[] =
  [
    {
      id: 'legacy.step-controls',
      order: 10,
      mount: ({ compatibilityMount }) => compatibilityMount,
    },
  ];

export const legacyWorkflowRules: readonly WorkflowRuleDescriptor[] = [
  {
    id: 'legacy.schedule-and-outcomes',
    order: 10,
    mount: ({ compatibilityMount }) => compatibilityMount,
  },
];
