// Workflow Module
// Workflow engine and run record management

export * from './WorkflowEngine';
export * from './RunRecordService';

// Workflow Templates
export { NewBusinessKickoff } from './templates/NewBusinessKickoff';
export { CompetitorAnalysis } from './templates/CompetitorAnalysis';
export { CustomerPersona } from './templates/CustomerPersona';
export { PricingStrategy } from './templates/PricingStrategy';
export { GoToMarketPlan } from './templates/GoToMarketPlan';
export { PitchDeck } from './templates/PitchDeck';
export { ContentStrategy } from './templates/ContentStrategy';
export { UserInterviews } from './templates/UserInterviews';
export { MVPScope } from './templates/MVPScope';
export { FinancialModel } from './templates/FinancialModel';
export { LandingPage } from './templates/LandingPage';
export { WeeklyReviewWorkflow } from './templates/WeeklyReviewWorkflow';

// All workflows collection
import { NewBusinessKickoff } from './templates/NewBusinessKickoff';
import { CompetitorAnalysis } from './templates/CompetitorAnalysis';
import { CustomerPersona } from './templates/CustomerPersona';
import { PricingStrategy } from './templates/PricingStrategy';
import { GoToMarketPlan } from './templates/GoToMarketPlan';
import { PitchDeck } from './templates/PitchDeck';
import { ContentStrategy } from './templates/ContentStrategy';
import { UserInterviews } from './templates/UserInterviews';
import { MVPScope } from './templates/MVPScope';
import { FinancialModel } from './templates/FinancialModel';
import { LandingPage } from './templates/LandingPage';
import { WeeklyReviewWorkflow } from './templates/WeeklyReviewWorkflow';

export const allWorkflows = [
  NewBusinessKickoff,
  CompetitorAnalysis,
  CustomerPersona,
  PricingStrategy,
  GoToMarketPlan,
  PitchDeck,
  ContentStrategy,
  UserInterviews,
  MVPScope,
  FinancialModel,
  LandingPage,
  WeeklyReviewWorkflow,
];
