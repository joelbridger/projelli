export * from './contracts';
// NOTE: the shared-client owner binding (`createAskSharedClientOwner` in
// ./owner) is deliberately NOT re-exported here. Setting/replacing the client
// reader is an owner-only capability; an ordinary `@/features/ask` consumer must
// not be able to bind or freeze it.
export {
  askScopeBuilder,
  askScopeIsCurrent,
  askScopeSnapshotsMatch,
  assertAskScopeCurrent,
  askSourceBelongsToScope,
  AskScopeError,
  resolveAskScope,
} from './scope';
export {
  askActionRegistry,
  askAnswerActionRegistry,
  askModeRegistry,
  askSourceRegistry,
  collectAskSourceCandidates,
  listAskAnswerActions,
  listAskModes,
  listAskSourceAdapters,
  registerAskAnswerAction,
  registerAskMode,
  registerAskSource,
  validateAskAnswerActionRegistry,
  validateAskModeRegistry,
  validateAskSourceRegistry,
} from './registry';
export {
  askCitationBelongsToScope,
  buildAskCitation,
  buildAskRetrievalPlan,
  noLocalAnswer,
  resolveAskCitationOpenPath,
  sealAskOpenPath,
} from './retrieval';
export {
  askConversationLiveRecord,
  createAskConversationStore,
  useAskConversation,
  type AskConversationPort,
  type AskConversationStoreOptions,
} from './conversation';
