# Ask local-first foundation

Use `@/features/ask` as the only public doorway for new Ask work. The current
base ships the generic local foundation, not the missing owner integrations.
Read [`FOUNDATION_STATUS.md`](./FOUNDATION_STATUS.md) before launching a
consumer.

## Scope and saved state

Client-bound scopes store the owner contact reference, matter, and shared-
client revision. Pass the current client plus an `AskOwnerIdentityAdapter` to
`resolveAskScope`. Chosen sources, single/selected meetings, and meeting ranges
all fail closed when the current client changes or clears.

`useAskConversation({ currentClient, owners })` reads and writes conversation
metadata, review drafts, and saved source selections through encrypted live
records. It validates every loaded payload, saves, then requires the record to
exist in a fresh canonical reload. It returns `conversations`, `reviewDrafts`,
`sourceSelections`, `saveConversation`, `saveReviewDraft`, and
`saveSourceSelection`.

## Appendable registries

The shipped append API is exactly:

```ts
import {
  askScopeBuilder,
  registerAskAnswerAction,
  registerAskMode,
  registerAskSource,
  type AskAnswerActionDescriptor,
  type AskModeDescriptor,
  type AskSourceAdapter,
} from '@/features/ask';

const source = {
  id: 'my-local-source', order: 100, sourceKinds: ['document'],
  listCandidates: () => [],
} satisfies AskSourceAdapter<MyContactRef, MyMeetingRef>;

const mode = {
  id: 'my-mode', order: 100, responseFormat: 'normal',
  buildScope: askScopeBuilder,
} satisfies AskModeDescriptor<MyContactRef, MyMeetingRef>;

const action = {
  id: 'my-review-action', order: 100,
  isAvailable: (context) => context.authority.allowed,
  execute: () => undefined,
} satisfies AskAnswerActionDescriptor<
  MyContactRef, MyMeetingRef, MyAuthority, MyAudit
>;

registerAskSource(source);
registerAskMode(mode);
registerAskAnswerAction(action);
```

The compiling copy is outside this package at
`src/foundation-contracts/ask/pavedPath.import.ts`. Registry reads use
`collectAskSourceCandidates`, `listAskModes`, and `listAskAnswerActions`; those
paths exclude dark entries and re-check client scope.

## Availability boundary

The base has no exact public client-bar, source-producer, meeting-artifact,
authority, audit, destination, or shell doorway required by the original
manifest. Their registries therefore have no built-in contributor. Do not add
a deep import, local `ContactRef`/`MeetingRef`, permission/audit lookalike, or
temporary destination. The coordinator must land and reconcile those owners
first, including the shell's real `search` ID versus the brief's stale `ask`
ID.

Outside model providers, credentials, connector retrieval, sending, and
committed writes remain Part B and are not reserved.
