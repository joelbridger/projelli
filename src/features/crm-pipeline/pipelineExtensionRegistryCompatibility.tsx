import type {
  OpportunityFieldDescriptor,
  PipelineViewDescriptor,
} from './pipelineExtensionRegistry';
import { PipelineHome, PipelineSettings } from './CrmPipelineSurface';

declare module './pipelineExtensionRegistry' {
  interface PipelineViewIdMap {
    pipeline: true;
    'pipeline-settings': true;
  }

  interface OpportunityFieldIdMap {
    'legacy.core-opportunity-fields': true;
  }
}

export const legacyPipelineViews: readonly PipelineViewDescriptor[] = [
  {
    id: 'pipeline',
    order: 10,
    mount: ({ data, onNavigate, addRequest, onAddRequestConsumed }) => (
      <PipelineHome
        data={data}
        onNavigate={onNavigate}
        {...(addRequest ? { addRequest } : {})}
        {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
      />
    ),
  },
  {
    id: 'pipeline-settings',
    order: 20,
    mount: ({ data, onNavigate }) => (
      <PipelineSettings data={data} onNavigate={onNavigate} />
    ),
  },
];

export const legacyOpportunityFields: readonly OpportunityFieldDescriptor[] = [
  {
    id: 'legacy.core-opportunity-fields',
    order: 10,
    mount: ({ compatibilityMount }) => compatibilityMount,
  },
];
