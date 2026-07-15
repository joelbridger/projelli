---
name: add-ask-mode-source-action
description: Add a typed Ask mode, source, or reviewable answer action through the Ask registries.
---

# Add an Ask mode, source, or answer action

Ask extensions own their descriptor next to their feature code. Do not add a
new scope, source-opening branch, or answer-action switch to `useAsk`.

1. Augment the relevant closed map in `@/platform/types/ask` beside the
   descriptor. A misspelled id must fail TypeScript.
2. A mode owns `buildRetrievalPlan` and `promptFormat`; preserve the returned
   retrieval scope as the confidentiality boundary.
3. A source owns `matches` and `open`. It must use the supplied opener context,
   never bypass the existing client-isolation route.
4. An answer action owns its reviewable metadata and `execute` function. It may
   navigate or prepare a task, note, or draft, but must not auto-create one.
5. Append the descriptor without reordering existing registry entries. Registry
   modules hold metadata and mount functions only.
6. Add focused tests for duplicate ids, invalid metadata, and independent dummy
   registration. Run typecheck, boundary, i18n, and the architecture DAG guard.
