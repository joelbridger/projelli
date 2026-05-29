// Workflow Module
// Workflow engine and run record management

export * from './WorkflowEngine';
export * from './RunRecordService';

// Profession template packs
export { LEGAL_TEMPLATES } from './templates/legal/index';
export { TAX_TEMPLATES } from './templates/tax/index';
export { CONSULTING_TEMPLATES } from './templates/consulting/index';

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
import { CompetitorAnalysis } from './templates/CompetitorAnalysis';
import { CustomerPersona } from './templates/CustomerPersona';
import { UserInterviews } from './templates/UserInterviews';
import { UserInterviewsSynthesis } from './templates/UserInterviewsSynthesis';
import { WeeklyReviewWorkflow } from './templates/WeeklyReviewWorkflow';
import { BoardMeetingPrep } from './templates/BoardMeetingPrep';
import { FinancialModel } from './templates/FinancialModel';
import { FirstHirePlaybook } from './templates/FirstHirePlaybook';

// The legal and tax packs ship as Preview until a practicing attorney / CPA
// signs off. We mark them at the registry level so we don't have to touch the
// 14 template files, and prepend a pending-review note to the description so
// the existing card UI shows it without any component changes. Consulting and
// the general templates carry no statutory claims and ship un-marked.
const PREVIEW_NOTE = 'Preview, pending review by a practicing professional. ';
const markPreview = <T extends import('@/types/workflow').WorkflowTemplate>(t: T): T => ({
  ...t,
  preview: true,
  description: t.description.startsWith('Preview,') ? t.description : PREVIEW_NOTE + t.description,
});

export const allWorkflows = [
  ...LEGAL_TEMPLATES.map(markPreview),
  ...TAX_TEMPLATES.map(markPreview),
  ...CONSULTING_TEMPLATES,
  CompetitorAnalysis,
  CustomerPersona,
  UserInterviews,
  UserInterviewsSynthesis,
  WeeklyReviewWorkflow,
  BoardMeetingPrep,
  FinancialModel,
  FirstHirePlaybook,
];
