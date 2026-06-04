// @draft: Advisor Practice Pack v1.0
// Requires advisor review before shipping. Do not expose to users without advisor sign-off.

import { ClientFinancialPlanSummary } from './ClientFinancialPlanSummary';
import { MeetingPrepAndSuitabilityNotes } from './MeetingPrepAndSuitabilityNotes';
import { AnnualReviewPacket } from './AnnualReviewPacket';
import { ConfidentialClientDataInventory } from './ConfidentialClientDataInventory';

import type { WorkflowTemplate } from '@/types/workflow';

export const ADVISOR_TEMPLATES: WorkflowTemplate[] = [
  ClientFinancialPlanSummary,
  MeetingPrepAndSuitabilityNotes,
  AnnualReviewPacket,
  ConfidentialClientDataInventory,
];

export {
  ClientFinancialPlanSummary,
  MeetingPrepAndSuitabilityNotes,
  AnnualReviewPacket,
  ConfidentialClientDataInventory,
};
