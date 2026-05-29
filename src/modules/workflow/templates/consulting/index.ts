// @draft — Consulting Practice Pack v2.3
// Can ship without formal advisor review (no statutory claims).

import { ClientDiscoverySynthesizer } from './ClientDiscoverySynthesizer';
import { ConfidentialResearchMemo } from './ConfidentialResearchMemo';
import { StakeholderMapGenerator } from './StakeholderMapGenerator';
import { NdaSafeSlideOutliner } from './NdaSafeSlideOutliner';
import { EngagementRetrospectiveBuilder } from './EngagementRetrospectiveBuilder';

import type { WorkflowTemplate } from '@/types/workflow';

export const CONSULTING_TEMPLATES: WorkflowTemplate[] = [
  ClientDiscoverySynthesizer,
  ConfidentialResearchMemo,
  StakeholderMapGenerator,
  NdaSafeSlideOutliner,
  EngagementRetrospectiveBuilder,
];

export {
  ClientDiscoverySynthesizer,
  ConfidentialResearchMemo,
  StakeholderMapGenerator,
  NdaSafeSlideOutliner,
  EngagementRetrospectiveBuilder,
};
