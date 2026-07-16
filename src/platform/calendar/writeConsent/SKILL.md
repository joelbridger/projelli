---
name: calendar-write-consent
description: Use the calendar write-consent contract — check a grant before a provider write, drive the read-to-write upgrade, or implement/extend the native consent port. Use when a feature needs to create or update an event in Outlook or Google Calendar, or when adding a calendar provider that can write.
---

# Calendar write consent

A calendar connection in Lantern is **read-only until someone explicitly
approves write access**. This contract is the only path from a read grant to a
write grant, and the only thing that may declare a grant write-capable.

Public doorway: `@/platform/calendar/writeConsent`. Never deep-import a file
inside this folder.

## The rule that everything else follows

> A grant's capability comes from the scopes the **provider said it granted**,
> never from the scopes we asked for.

Both providers can hand back less than was requested — Google's consent screen
lets a person untick individual permissions. A grant requested as write can
arrive read-only. Trusting the request would mark the connection write-capable
when it is not, and the person would be told their calendar is ready to write
right before the first write fails at the API.

## Before any provider write

```ts
import { assertCalendarWriteAllowed } from '@/platform/calendar/writeConsent';

assertCalendarWriteAllowed(grant); // throws unless capability === 'write'
await outlookCreateEvent(/* … */);
```

This is a hard gate, not advice. It throws on a read grant and on a missing
grant, so a writer that forgets the check fails loudly instead of quietly
attempting a write the person never approved.

## Driving the upgrade from a consent UI

```ts
import { requestCalendarWriteConsent } from '@/platform/calendar/writeConsent';

const { grant, receipt } = await requestCalendarWriteConsent({
  provider: 'outlook',
  currentGrant,          // the existing READ grant; an upgrade needs one
  port: nativeConsentPort,
});

if (receipt.outcome === 'upgraded') {
  // grant.capability === 'write'
} else {
  // Every other ending left `currentGrant` exactly as it was. The calendar is
  // still connected and still reading. Show what happened, offer a retry.
}
```

Outcomes, all of which except `upgraded` leave the old read grant in force:

| outcome | what happened |
|---|---|
| `upgraded` | Provider verified write scope; the grant is now write-capable and its version bumped. |
| `denied` | The person declined at the provider. |
| `insufficient_scope` | Sign-in completed, but write scope was not granted (e.g. the box was unticked). The new grant is discarded. |
| `failed` | The attempt errored. `receipt.reason` is a fixed code. |
| `unsupported_provider` | ICS. No consent request was made. |
| `no_existing_read_grant` | Nothing to upgrade. No consent request was made. |
| `already_write` | Already write-capable. No consent request was made. |

**Write consent is an upgrade, never a first connect.** A fresh connect stays
read-only; the person connects, sees reading work, and only then approves write.
This is why `currentGrant` is required, and it keeps the existing connect flow
untouched.

## What may never appear here

No token, refresh token, consent URL, PKCE verifier, client id, or provider
error string. None of these are *representable* in the exported shapes:

- a newly issued grant is referenced by an opaque `StagedGrantRef`; the native
  layer holds the secret and the renderer never sees it;
- a failure is a closed enum (`CalendarConsentFailureReason`), so a provider
  error string — which routinely embeds the consent URL and its `client_id`,
  `state`, and `code_challenge` — is mapped to a code and dropped;
- a receipt carries only **recognized** scope tokens; anything the provider
  sends that is not on the allowlist is discarded rather than echoed.

If you find yourself wanting to widen one of these to "improve the error
message", that is a policy change. Bring it to a security review.

## Nothing the port says is believed until it is checked

The list above says a provider error string is not *representable*. Read that
precisely: it is not representable in a **conforming** port's response. Types are
erased at runtime, so a port that returns `err.to_string()` as its `reason`
compiles and runs, and that string would land on a receipt this contract calls
safe to persist and show.

So every field of a port response is validated at runtime, in one place:

```ts
import { verifyConsentAttempt } from '@/platform/calendar/writeConsent';

const verified = verifyConsentAttempt(provider, await port.requestWriteConsent(/* … */));
// verified.reason is a code this contract defined, whatever the port sent.
// verified.capability and verified.recognizedScopes came from ONE read.
```

Two rules, both load-bearing:

- **Validate, don't trust the type.** `coerceFailureReason` replaces anything
  outside the closed enum with `'internal'`. An unrecognized outcome, an
  unusable staged handle, or a non-string scope token fails closed too.
- **Read each field exactly once.** An untrusted response is not a stable value.
  Reading `grantedScopes` twice — once for the scopes to carry, once to evaluate
  capability — lets the two come from different evidence and mints a write grant
  whose own scopes are read-only. Derive both from one normalized array
  (`capabilityOfRecognizedScopes`).

If you add a field to the port, it gets validated here in the same commit.

## Adding a provider that can write

1. Add it to `CalendarWriteProviderId` (i.e. remove it from the `Exclude`) in
   `types.ts`. **ICS must stay excluded** — SC-022 keeps the ICS feed read-only.
2. Add its entries to `WRITE_SCOPE` and `RECOGNIZED_SCOPES` in
   `scopeEvaluation.ts`, and a `writeConsentScopeRequest` branch.
   - Pick the **least privilege that can create/update an event** — for Google
     that is `calendar.events`, not the full `calendar` scope.
   - Never request a scope that reaches calendars the advisor does not own
     (Outlook's `Calendars.ReadWrite.Shared`); SC-014 says own calendars only.
   - The request must include the provider's existing **read** scopes, so an
     upgrade never comes back narrower than the read grant it replaces.
3. Match scope tokens **exactly**. Never use `includes`/`startsWith` on a scope
   string: `calendar.events.readonly` contains `calendar.events`, so a loose
   match reads a read-only grant as write. There is a test for exactly this.
4. Add the provider to `isWriteCapableProvider` in `upgrade.ts`.
5. Extend `scopeEvaluation.test.ts` with that provider's read/write/partial
   cases, including its own substring trap.

## Still to build (not in this contract)

This lane delivered the renderer-side contract. A follow-up lane, with a
coordinator reservation, must build:

- **The native consent port.** Today `src-tauri/src/commands/calendar/oauth.rs`
  hard-wires read-only scopes (`MS_SCOPES`, `GOOGLE_SCOPE`) into token exchange
  and refresh, and the keychain stores a refresh token with **no record of the
  scope tier it was issued under**. The port needs scope tiers, staged-vs-
  committed grant storage, and persisted capability facts, and it must reuse the
  exported scope rules rather than restating them. New native commands and any
  migration need a coordinator-reserved order — do not invent one.
  - **A staged grant is inert and must expire.** Only `commitStagedGrant` may
    ever promote one; the native layer must never auto-promote or resurrect a
    staged grant. The renderer discards on a best effort precisely because a
    staged grant that outlives the call can do nothing — that is an obligation on
    the port, not an observation about it.
- **The write egress operations.** A provider write is a new off-device call and
  needs its own declared operation on both layers before it can run. Follow
  `src/platform/privacy/egressModules/SKILL.md`; the calendar slices carry a
  note where they belong. Never weaken an existing read operation to stand in
  for a write.

## Prove it

```bash
npx vitest run src/platform/calendar/writeConsent/ \
               tests/unit/calendar-write-consent-public.test.ts
npm run typecheck && npm run typecheck:tests
```

## Reviewer checklist

- [ ] Capability is derived from granted scopes, never from the request.
- [ ] Scope matching is exact; no substring/prefix test on a scope string.
- [ ] Every non-`upgraded` ending leaves the previous grant byte-identical.
- [ ] A staged grant is committed only after write scope is verified.
- [ ] No new free-text field on the receipt, the failure reason, or the port.
- [ ] ICS is still unable to hold a write grant.
- [ ] No secret is representable in any exported shape.
- [ ] Every value the port hands back is validated at runtime, not only typed.
- [ ] No field of a port response is read twice.
