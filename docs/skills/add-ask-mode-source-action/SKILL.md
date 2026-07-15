---
name: add-ask-mode-source-action
description: Add a typed Ask mode, source, or reviewable answer action through the Ask registries.
---

# Add an Ask mode, source, or answer action

Ask extensions own their descriptor next to their feature code. Import the
small public contract from `@/features/ask`; do not import `askHelpers` or a
send hook. Do not add a new scope, source-opening branch, or answer-action
switch to `useAsk` / `useChatSending`.

1. Augment the relevant closed map in `@/platform/types/ask` beside the
   descriptor. A misspelled id must fail TypeScript.
2. A mode owns `buildRetrievalPlan` and `promptFormat`; preserve the returned
   retrieval scope as the confidentiality boundary.
3. A source owns `matches`, `canOpen`, and `open`, then registers through
   `registerAskSource`. The live citation chip, chat citation, and Sources panel
   all resolve it with `getAskSource` / `openAskSource`. Use the supplied opener
   context; never bypass the existing client-isolation route.
4. An answer action owns its reviewable metadata and `execute` function. It may
   navigate or prepare a task, note, or draft, but must not auto-create one.
5. Register the descriptor without reordering existing entries. Send-time
   client context comes from `AskSendPipeline`; add context with
   `registerAskSendContextProvider` instead of rebuilding matter vs. all-matters
   scope inline.
6. Add focused tests for duplicate ids, invalid metadata, independent dummy
   registration, the real opener route, and client isolation. Run typecheck,
   boundary, i18n, and the architecture DAG guard.
