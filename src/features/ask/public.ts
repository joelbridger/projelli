/**
 * Public Ask extension contract.
 *
 * Feature modules may depend on this file. The larger Ask implementation stays
 * private so extensions cannot couple themselves to send-hook internals.
 */
export type { AskScope } from './askScope';
export type {
  AskAnswerActionContext,
  AskAnswerActionDescriptor,
  AskAnswerActionId,
  AskModeContext,
  AskModeDescriptor,
  AskModeId,
  AskPromptFormatContract,
  AskRetrievalPlan,
  AskSourceDescriptor,
  AskSourceId,
  AskSourceOpenContext,
  AskSourceReference,
} from './registry/types';
export {
  registerAskAnswerAction,
  registerAskMode,
  registerAskSource,
} from './registry/askRegistries';
export type {
  AskSendContext,
  AskSendContextInput,
  AskSendContextProvider,
} from './pipeline/AskSendPipeline';
export { registerAskSendContextProvider } from './pipeline/AskSendPipeline';
