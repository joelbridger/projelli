# Ask local-first foundation

Use `@/features/ask` as the only public doorway for new Ask work.

1. Build a scope with `askScopeBuilder`, then call `resolveAskScope` before
   listing a source, preparing retrieval, opening a citation, or offering an
   action. Current-client scope is unavailable without the shared client and
   its matching revision.
2. Append one ordered source adapter, mode, or answer action with
   `registerAskSource`, `registerAskMode`, or `registerAskAnswerAction`.
   Registry entries must have stable IDs/orders and reject duplicates.
3. Make a retrieval plan with `buildAskRetrievalPlan`; make every answer
   citation with `buildAskCitation`. Both re-check the resolved scope.
4. Add a small public import fixture outside Ask for each consumer. Source and
   destination modules remain unavailable until their exact public doorway is
   landed; do not use a deep import or a temporary substitute.
5. Persist only conversation metadata, saved scopes, source selections, and
   review drafts through `useAskConversation`. Streaming and typing state stays
   private to the UI.

Outside model providers, connectors, credentials, retrieval over external
sources, sending, and committed writes are Part B. They are not Ask foundation
extensions and need a coordinator/Jameson decision.
