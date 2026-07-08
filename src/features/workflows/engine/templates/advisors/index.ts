// Advisor Practice Pack v1.0 (shipped). Built with input from practicing advisors.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import { ClientFinancialPlanSummary } from './ClientFinancialPlanSummary';
import { MeetingPrepAndSuitabilityNotes } from './MeetingPrepAndSuitabilityNotes';
import { AnnualReviewPacket } from './AnnualReviewPacket';
import { ConfidentialClientDataInventory } from './ConfidentialClientDataInventory';
import { RegSPSafeguardsOutline } from './RegSPSafeguardsOutline';
import { BooksRecordsRetentionNote } from './BooksRecordsRetentionNote';
import { RegBIDocumentation } from './RegBIDocumentation';

import type { WorkflowTemplate } from '@/platform/types/workflow';
import { brandValue } from '@/config/brandText';

export const ADVISOR_TEMPLATES: WorkflowTemplate[] = brandValue([
  AnnualReviewPacket,
  MeetingPrepAndSuitabilityNotes,
  RegSPSafeguardsOutline,
  ClientFinancialPlanSummary,
  ConfidentialClientDataInventory,
  BooksRecordsRetentionNote,
  RegBIDocumentation,
]);

export {
  ClientFinancialPlanSummary,
  MeetingPrepAndSuitabilityNotes,
  AnnualReviewPacket,
  ConfidentialClientDataInventory,
  RegSPSafeguardsOutline,
  BooksRecordsRetentionNote,
  RegBIDocumentation,
};
