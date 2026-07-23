export { AIChatViewer } from './AIChatViewer';
export { Ask } from './Ask';
export { useAsk } from './useAsk';
export {
  askSharedClientContextAdapter,
  type AskSharedClientContext,
} from './sharedClientContext';
/**
 * The REAL shared-client owner wiring. Publicizes ONLY the safe zero-argument
 * establish doorway plus the pure identity adapter and snapshot mapper. The
 * owner socket itself (`createAskSharedClientOwner`) stays off this surface, and
 * nothing here lets a consumer inject an arbitrary client reader.
 */
export {
  establishAskSharedClientContext,
  readAskSharedClientSnapshot,
  useAskSharedClientSnapshot,
  askClientIdentityAdapter,
} from './sharedClientContextOwner';
/**
 * The public local-first foundation. New Ask consumers must use these shapes
 * rather than the legacy send-pipeline descriptors below.
 */
export * from './foundation';
export type {
  AskAnswerActionId,
  AskModeId,
  AskPromptFormatContract,
  AskSendContext,
  AskSendContextInput,
  AskSendContextProvider,
  AskSourceId,
} from './public';
export { registerAskSendContextProvider } from './public';
export { getAskSource, openAskSource } from './registry/askRegistries';
