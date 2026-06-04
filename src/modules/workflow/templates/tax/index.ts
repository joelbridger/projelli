// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import { EngagementLetterBuilder } from './EngagementLetterBuilder';
import { PreReviewChecklist } from './PreReviewChecklist';
import { Section7216ConsentTemplate } from './Section7216ConsentTemplate';
import { TaxResearchMemo } from './TaxResearchMemo';
import { ClientDocumentInventory } from './ClientDocumentInventory';
import { AuditDefenseFileBuilder } from './AuditDefenseFileBuilder';
import { QuarterlyEstimateReminder } from './QuarterlyEstimateReminder';
import { NoticeResponseDrafter } from './NoticeResponseDrafter';

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
};
