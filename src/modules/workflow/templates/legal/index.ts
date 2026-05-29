// @draft — Legal Practice Pack v2.1
// Requires attorney review before shipping. Do not expose to users without advisor sign-off.

import { DepositionContradictionFinder } from './DepositionContradictionFinder';
import { EvidenceGapAnalyzer } from './EvidenceGapAnalyzer';
import { CaseTimelineBuilder } from './CaseTimelineBuilder';
import { PrivilegeLogDrafter } from './PrivilegeLogDrafter';
import { DiscoveryDocumentTriage } from './DiscoveryDocumentTriage';
import { PatentDisclosureDraft } from './PatentDisclosureDraft';
import { ClientIntakeSynthesizer } from './ClientIntakeSynthesizer';

import type { WorkflowTemplate } from '@/types/workflow';

export const LEGAL_TEMPLATES: WorkflowTemplate[] = [
  DepositionContradictionFinder,
  EvidenceGapAnalyzer,
  CaseTimelineBuilder,
  PrivilegeLogDrafter,
  DiscoveryDocumentTriage,
  PatentDisclosureDraft,
  ClientIntakeSynthesizer,
];

export {
  DepositionContradictionFinder,
  EvidenceGapAnalyzer,
  CaseTimelineBuilder,
  PrivilegeLogDrafter,
  DiscoveryDocumentTriage,
  PatentDisclosureDraft,
  ClientIntakeSynthesizer,
};
