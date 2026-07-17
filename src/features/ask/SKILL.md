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

**Use-time client isolation is fail-closed, non-freezable, and owner-only.**
The current client comes from ONE foundation-owned binding. Every use-time
doorway — `askSourceBelongsToScope`, `collectAskSourceCandidates`,
`listAskSourceAdapters`, `listAskModes`, `buildAskRetrievalPlan`,
`buildAskCitation`, `askCitationBelongsToScope`, `resolveAskCitationOpenPath`,
`listAskAnswerActions`, and every registered action's `isAvailable`/`execute` —
reads the current client from that binding, NOT from a value the caller passes.
A scope, source, citation, or action resolved under client A is refused the
instant the owner switches to B or clears the client, even for a handler that
held on to it.

**Only the shared-client OWNER can set the binding.** The capability that
establishes it (`createAskSharedClientOwner` in `foundation/owner.ts`) is NOT on
the public `@/features/ask` surface, and there is no free `bind(access)`
anywhere. An ordinary consumer of `@/features/ask` therefore cannot set,
replace, or freeze the client reader — it cannot restore client A after the
owner moves to B. **Establish-once (runtime):** while one owner holds the
binding, a second `bind` is refused, so even a caller that reached the
capability through an import-boundary blind spot cannot overwrite the active
owner's reader to restore a stale client. The real owner is absent at the
current base, so the binding is unset and every client-scoped doorway fails
closed by default.

> **Enforced (landed):** the general rule that *no* code outside this feature
> may deep-import `foundation/owner` is enforced by the shared feature-boundary
> guard, which inspects importers under `src/features/*`, `src/app/`, and the
> fixtures tree. `ownerImportBoundary.test.ts` asserts that requirement and is
> green against the landed guard. The runtime establish-once defense above
> independently blocks the data leak from every importer.

`useAskConversation({ currentClient, owners })` reads and writes conversation
metadata, review drafts, and saved source selections through encrypted live
records. **The write path re-resolves the active client LIVE at write time**
(from the owner binding, the same source the read guards use), so a save handle
held across a client switch fails closed: it will not persist client-A state
once the active client is B or none. Projection reads use the reactive
`currentClient` prop. It validates every loaded payload, saves, then requires the
record to exist in a fresh canonical reload. It returns `conversations`,
`reviewDrafts`, `sourceSelections`, `saveConversation`, `saveReviewDraft`, and
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
paths exclude dark entries and re-check the live client from the single binding.
`AskAnswerActionContext` carries no client access field: actions registered
through the public append path are wrapped so availability and execution both
re-read the bound client, and a previously listed action expires after a switch.
**Opener tokens are sealed.** A source's `citationOpenPath` is an opaque,
non-actionable sealed reference produced by `sealAskOpenPath({ kind, token })` —
the raw token is never a plain field on a source or a citation, and is never
persisted. The actionable `{ kind, token }` is released ONLY by the use-time-
guarded `resolveAskCitationOpenPath(scope, citation)`, and only while the citation
belongs to the current live client. A retained source or citation therefore
yields no token after the owner switches away: the doorway fails closed.

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
