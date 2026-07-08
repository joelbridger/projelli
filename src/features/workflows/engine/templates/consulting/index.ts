// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).

import { ClientDiscoverySynthesizer } from './ClientDiscoverySynthesizer';
import { ConfidentialResearchMemo } from './ConfidentialResearchMemo';
import { StakeholderMapGenerator } from './StakeholderMapGenerator';
import { NdaSafeSlideOutliner } from './NdaSafeSlideOutliner';
import { EngagementRetrospectiveBuilder } from './EngagementRetrospectiveBuilder';
import { StatementOfWorkDrafter } from './StatementOfWorkDrafter';
import { CompetitiveLandscapeBuilder } from './CompetitiveLandscapeBuilder';
import { FindingsSynthesizer } from './FindingsSynthesizer';
import { WorkshopBoardPrep } from './WorkshopBoardPrep';

import type { WorkflowTemplate } from '@/platform/types/workflow';
import { brandValue } from '@/config/brandText';

export const CONSULTING_TEMPLATES: WorkflowTemplate[] = brandValue([
  StatementOfWorkDrafter,
  ClientDiscoverySynthesizer,
  ConfidentialResearchMemo,
  StakeholderMapGenerator,
  NdaSafeSlideOutliner,
  EngagementRetrospectiveBuilder,
  CompetitiveLandscapeBuilder,
  FindingsSynthesizer,
  WorkshopBoardPrep,
]);

export {
  StatementOfWorkDrafter,
  ClientDiscoverySynthesizer,
  ConfidentialResearchMemo,
  StakeholderMapGenerator,
  NdaSafeSlideOutliner,
  EngagementRetrospectiveBuilder,
  CompetitiveLandscapeBuilder,
  FindingsSynthesizer,
  WorkshopBoardPrep,
};
