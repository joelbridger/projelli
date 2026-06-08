// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import { EngagementLetterBuilder } from './EngagementLetterBuilder';
import { PreReviewChecklist } from './PreReviewChecklist';
import { Section7216ConsentTemplate } from './Section7216ConsentTemplate';
import { TaxResearchMemo } from './TaxResearchMemo';
import { ClientDocumentInventory } from './ClientDocumentInventory';
import { AuditDefenseFileBuilder } from './AuditDefenseFileBuilder';
import { QuarterlyEstimateReminder } from './QuarterlyEstimateReminder';
import { NoticeResponseDrafter } from './NoticeResponseDrafter';
import { RepresentationKit } from './RepresentationKit';
import { CollectionNoticeResponse } from './CollectionNoticeResponse';
import { SCorpReasonableCompMemo } from './SCorpReasonableCompMemo';
import { EntityElectionAnalysis } from './EntityElectionAnalysis';
import { WISPBuilder } from './WISPBuilder';

import type { WorkflowTemplate } from '@/types/workflow';

export const TAX_TEMPLATES: WorkflowTemplate[] = [
  EngagementLetterBuilder,
  PreReviewChecklist,
  Section7216ConsentTemplate,
  TaxResearchMemo,
  ClientDocumentInventory,
  AuditDefenseFileBuilder,
  QuarterlyEstimateReminder,
  NoticeResponseDrafter,
  RepresentationKit,
  CollectionNoticeResponse,
  SCorpReasonableCompMemo,
  EntityElectionAnalysis,
  WISPBuilder,
];

export {
  EngagementLetterBuilder,
  PreReviewChecklist,
  Section7216ConsentTemplate,
  TaxResearchMemo,
  ClientDocumentInventory,
  AuditDefenseFileBuilder,
  QuarterlyEstimateReminder,
  NoticeResponseDrafter,
  RepresentationKit,
  CollectionNoticeResponse,
  SCorpReasonableCompMemo,
  EntityElectionAnalysis,
  WISPBuilder,
};
