// @draft — Consulting Practice Pack v2.3
// Can ship without formal advisor review (no statutory claims).

import { ClientDiscoverySynthesizer } from './ClientDiscoverySynthesizer';
import { ConfidentialResearchMemo } from './ConfidentialResearchMemo';
import { StakeholderMapGenerator } from './StakeholderMapGenerator';
import { NdaSafeSlideOutliner } from './NdaSafeSlideOutliner';
import { EngagementRetrospectiveBuilder } from './EngagementRetrospectiveBuilder';
import { StatementOfWorkDrafter } from './StatementOfWorkDrafter';

import type { WorkflowTemplate } from '@/types/workflow';

export const CONSULTING_TEMPLATES: WorkflowTemplate[] = [
  StatementOfWorkDrafter,
  ClientDiscoverySynthesizer,
  ConfidentialResearchMemo,
  StakeholderMapGenerator,
  NdaSafeSlideOutliner,
  EngagementRetrospectiveBuilder,
];

export {
  StatementOfWorkDrafter,
  ClientDiscoverySynthesizer,
  ConfidentialResearchMemo,
  StakeholderMapGenerator,
  NdaSafeSlideOutliner,
  EngagementRetrospectiveBuilder,
};
