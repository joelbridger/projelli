// Workflow Module
// Workflow engine and run record management

export * from './WorkflowEngine';
export * from './RunRecordService';

// Profession template packs
export { LEGAL_TEMPLATES } from './templates/legal/index';
export { TAX_TEMPLATES } from './templates/tax/index';
export { CONSULTING_TEMPLATES } from './templates/consulting/index';
export { ADVISOR_TEMPLATES } from './templates/advisors/index';

// General templates (profession-neutral)
export { CompetitorAnalysis } from './templates/CompetitorAnalysis';
export { CustomerPersona } from './templates/CustomerPersona';
export { UserInterviews } from './templates/UserInterviews';
export { UserInterviewsSynthesis } from './templates/UserInterviewsSynthesis';
export { WeeklyReviewWorkflow } from './templates/WeeklyReviewWorkflow';
export { BoardMeetingPrep } from './templates/BoardMeetingPrep';
export { FinancialModel } from './templates/FinancialModel';
export { FirstHirePlaybook } from './templates/FirstHirePlaybook';

// All workflows collection
import { LEGAL_TEMPLATES } from './templates/legal/index';
import { TAX_TEMPLATES } from './templates/tax/index';
import { CONSULTING_TEMPLATES } from './templates/consulting/index';
import { ADVISOR_TEMPLATES } from './templates/advisors/index';
import { CompetitorAnalysis } from './templates/CompetitorAnalysis';
import { CustomerPersona } from './templates/CustomerPersona';
import { UserInterviews } from './templates/UserInterviews';
import { UserInterviewsSynthesis } from './templates/UserInterviewsSynthesis';
import { WeeklyReviewWorkflow } from './templates/WeeklyReviewWorkflow';
import { BoardMeetingPrep } from './templates/BoardMeetingPrep';
import { FinancialModel } from './templates/FinancialModel';
import { FirstHirePlaybook } from './templates/FirstHirePlaybook';

// All packs ship as available. Advisor review (a practicing attorney / CPA
// signing off) still proceeds in parallel, but per the 2026-06-01 operating
// directive it no longer gates shipping or messaging: we present the packs as
// production-ready rather than "Preview, pending review." The legal and tax
// packs used to be wrapped in a markPreview() helper here; that gating was
// removed when the directive landed.
export const allWorkflows = [
  ...LEGAL_TEMPLATES,
  ...TAX_TEMPLATES,
  ...CONSULTING_TEMPLATES,
  ...ADVISOR_TEMPLATES,
  CompetitorAnalysis,
  CustomerPersona,
  UserInterviews,
  UserInterviewsSynthesis,
  WeeklyReviewWorkflow,
  BoardMeetingPrep,
  FinancialModel,
  FirstHirePlaybook,
];
