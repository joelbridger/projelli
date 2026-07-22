export { CrmHome, type CrmHomeProps, type CrmHomeRoute } from './CrmHome';
export type {
  CrmHouseholdAddRequest,
  CrmOriginatingContextRef,
} from './routes';
export type {
  CrmHomeAdapter,
  CrmFreshnessState,
  CrmTask,
  CrmWorkflowWorkItem,
  PropagationOffer,
} from './types';
export { crmHomeSurfaceRegistry } from './registry';
export { LiveCrmHome, type LiveCrmHomeRuntime } from './shared/LiveCrmHome';
export { CrmHomeSurfaceContext } from './surfaceContext';
export { mergeCrmTaskRecord } from './shared/liveTaskAdapter';
export {
  createMeetingWorkflowProposal,
  createTemplate,
  startWorkflow,
} from './workflowLive';
