---
name: calendar-write-provider-adapter
description: Add or extend a calendar write provider adapter (Outlook, Google, or a new one). Use when a feature must create/update an event on a provider calendar, or when adding a provider that can write. Covers the request-building and response-boundary contract every adapter must follow.
---

# Calendar write provider adapters

A provider write adapter has exactly two jobs and holds no policy:

1. **Build** the provider-specific request from a proposal (`buildWriteRequest`,
   `buildVerifyQuery`) — the body shape and the idempotency mechanism.
2. **Interpret** the provider's response THROUGH the shared boundary
   (`interpretWriteResponse` / `interpretReconcileResponse`) — the only place a
   response becomes trusted.

An adapter never decides whether a write is *allowed* (the orchestrator and
`limits.ts` do), never touches egress policy beyond naming the operation it must
go through, and never reads a field out of a response except the opaque event id
and version. Everything else — an `error`, a `message`, a token — is ignored by
construction, which is why no secret can reach a receipt.

## The contract

```ts
export interface CalendarWriteProviderAdapter {
  readonly provider: CalendarWriteProviderId;   // never 'ics'
  readonly egressOperationId: string;           // a REGISTERED egress op id
  readonly identityFields: ProviderIdentityFields; // { idField, versionField }
  buildWriteRequest(proposal): ProviderWriteRequest;
  buildVerifyQuery(proposal): ProviderVerifyQuery;
  interpretWrite(raw: unknown): VerifiedWriteResult;
  interpretReconcile(raw: unknown): VerifiedReconcileResult;
}
```

## Adding a provider

1. **Declare the egress first.** Add a `connector-write` operation for the
   provider in `src/platform/privacy/egressModules/calendar.ts` (exact host, no
   wildcard, `requiresFinalApproval: true`, `dataClasses` including `credential`)
   and its native mirror in `src-tauri/src/network_policy/operations/calendar.rs`
   — the host allowlist and data classes must agree across both layers. Extend
   the parity goldens by exactly those operations. An adapter whose
   `egressOperationId` is not registered is a bug: the call has nowhere to go.
2. **Pick an idempotency mechanism** that makes a replayed create a no-op:
   - Outlook uses the Graph `transactionId` on the event body.
   - Google assigns the event `id` (our 32-char hex key is a valid base32hex id).
   - Whatever you pick, the SAME `proposal.idempotencyKey` must be presented on
     every attempt, so a retry after a timeout reconciles instead of duplicating.
3. **Guard updates with the version.** A reschedule is a conditional update
   (`If-Match` on the ETag). A version mismatch must surface as a `conflict`
   transport so the boundary maps it to `stale` — never a blind overwrite.
4. **Read only id + version.** Give the boundary your `identityFields`; do not
   parse anything else out of the body. If the provider needs a different failure
   mapping, extend `coerceFailure`'s closed set — never add a free-text field.
5. **Register** the adapter in `./registry.ts`. Nothing in the orchestrator
   changes.

## What an adapter must never do

- Return a provider error string, URL, or token in any field.
- Treat a non-2xx or an id-less 2xx as success — that is `ambiguous`, meaning
  verify, not `written`.
- Add ICS. `CalendarWriteProviderId` excludes it and SC-022 keeps it read-only;
  an ICS adapter does not type-check, and that is on purpose.

## Prove it

```bash
npx vitest run src/features/calendarWrite/
```
