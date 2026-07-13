# Intake key-sharing merge notes

This branch gives Intake a safe, opaque key-sharing path. It does not bring the
other branch's Intake screens with it. Port those screens onto this contract;
do not restore the old `/intake/:id/keys` route.

## New contract

`IntakeHandle` is a client-generated opaque value shaped like `ih2_` followed
by 43 URL-safe base64 characters. It is defined in
`src/platform/firm/contract.ts` alongside `MatterHandle` and `StreamHandle`.
Use `generateIntakeHandle()` to make one locally and `parseIntakeHandle()` to
validate a stored value. It is not a server-issued intake ID, and no readable
local Intake ID may go over the network.

Both endpoints require the normal Bearer login token. Fetch also requires an
active seat token in the `X-Seat-Token` header.

`matterKeys.ts`'s `handleFetchMatterKey` has the same older missing fetch-rate
limit and is a good small follow-up, but it is not a regression in this branch.

| Purpose | Request | Success response |
| --- | --- | --- |
| Publish wrapped keys | `POST /v2/firm/intake/:intake_handle/keys/publish` with `{ matter_handle, epoch, wrapped: [{ user_id, device_id, wrapped_key_b64 }] }` | `{ ok: true, stored }` |
| Fetch this device's wrapped key | `POST /v2/firm/intake/:intake_handle/keys/fetch` with `{ device_id }` | `{ epoch, wrapped_key_b64 }` |

`matter_handle` must be an existing `mh2_…` handle in the caller's firm. The
publisher must be a firm admin or that matter's owner, and ethical walls still
apply. The first successful key publication binds an `IntakeHandle` to one
matter; later publication through the same handle must use that same matter.
This keeps fetch unambiguous without putting a matter handle in the fetch URL
or body. The wrapped key format is the existing fixed LWK v1 envelope.

The typed client methods are:

```ts
api.publishIntakeKeys(intakeHandle, {
  matter_handle: matterHandle,
  epoch,
  wrapped,
});

api.fetchIntakeKeys(intakeHandle, deviceId, seatToken);
```

## What to change while merging the Intake frontend

I could not see the other branch's `intakeKeyShare.ts`, `FirmAdminConsole`,
`MatterHub`, or `NewClientDialog`. Treat this as a mechanical port checklist:

1. Find every old call to `/intake/:id/keys` and every raw request helper that
   sends `matter_id`.
2. Replace the local intake ID used on the wire with one locally generated
   `generateIntakeHandle()` value. Persist that value only in local encrypted
   intake state if the frontend needs it again; never send the local ID.
3. Resolve the local matter to its already-established `MatterHandle`, using
   the same matter-store handle field and `parseMatterHandle()` pattern used by
   the rest of the firm client.
4. Replace raw/legacy calls with `FirmApiClient.publishIntakeKeys(...)` and
   `FirmApiClient.fetchIntakeKeys(...)`. The publish payload uses
   `matter_handle`, not `matter_id`.
5. Do not add a compatibility endpoint or a fallback to the old address.

Before (unsafe, illustrative only):

```ts
await fetch(`/intake/${localIntakeId}/keys`, {
  method: 'POST',
  body: JSON.stringify({ matter_id: localMatterId, ...keys }),
});
```

After:

```ts
const intakeHandle = generateIntakeHandle();
const matterHandle = parseMatterHandle(localMatter.firm_handle);
await firmApi.publishIntakeKeys(intakeHandle, {
  matter_handle: matterHandle,
  epoch,
  wrapped,
});
```

## **Important assumption to check during the merge**

**These endpoints are authenticated and seat-gated. I could not confirm
whether the real Intake flow ever needs to deliver a key to a prospective
client who has not signed in as a firm seat. If it does, this contract does
not cover that case. Do not weaken these routes or make them public. That need
requires a new, larger security design for an unauthenticated exchange and is
outside this merge.**

**The first successful publish also wins permanently: there is no recovery or
rebind path if another party has already bound that opaque handle. Handles are
cryptographically random and are not sent or listed by this branch, but if the
real Intake flow can leak or reuse one across parties, that limitation needs
its own design pass before shipping.**

## Known follow-up workstream (Jameson-approved, queued post-merge)

This branch does not — and cannot — make the firm relay's key distribution
resistant to a **hostile or compromised relay operator**. A hostile relay can
still insert its own device into a firm and be handed the matter key through
the normal, unauthenticated device-key exchange (see
`prep/HOSTILE-RELAY-ESCALATION.md` in the coordination repo for the full
writeup). This is a pre-existing gap, not something the intake-key work above
introduces, and it applies equally to intake keys and matter keys. Jameson has
approved merging this branch anyway (it is a strict privacy improvement) and
has queued **hostile-relay hardening** — device-key verification / safety
numbers, a tamper-evident hash-chained update log, and AAD-bound authorship —
as the first workstream after this merge lands. Until that ships, avoid
unqualified "end-to-end encrypted" language in anything that references the
intake-key exchange or the firm relay generally.

## Another known gap found in review, NOT fixed here: auth/session-token lifecycle (out of scope, pre-existing)

Round UU's adversarial review reviewed the auth/session layer fresh (a genuinely different security
domain from this branch's E2EE matter-content-privacy scope) and found three real issues, all pre-existing
(`backend/src/lib/services.ts`, `backend/src/routes/admin.ts`, `backend/src/routes/sso.ts` — none touched
by this branch's history). **None are fixed on this branch** — they're login/session-token architecture
work, not matter-privacy work, and fixing them properly needs real new design (atomic refresh-token
consumption, a revocation-check architecture decision), not a small patch. Escalated to Jameson/the
coordinator the same way the hostile-relay-device-key gap was, for a separate follow-up:

1. **Refresh-token double-consumption race** (`services.ts` around the refresh-rotation function, `db.ts`
   around the token-rotation query): two concurrent requests can both read the same refresh token as still
   active before either transaction revokes it, each minting a different valid replacement — a stolen
   refresh token can spawn a parallel long-lived session. Needs the rotation to become one atomic
   read-check-mark-used-then-mint database action.
2. **A removed/deprovisioned user's access token keeps working until it naturally expires** (`admin.ts`'s
   deprovision handler, `sso.ts`): revocation invalidates refresh tokens and seats, but a still-valid
   access token's authorization check only reads the signed token's `role`/claims, not live account status
   — a removed admin can keep acting for up to the token's TTL (currently up to an hour). This is a
   standard short-lived-access-token/revocable-refresh-token tradeoff in many systems, but worth a
   deliberate decision (shorter TTL? per-request liveness check for admin-tier actions?) given this product
   handles confidential client data.
3. **Refresh-token reuse detection doesn't revoke the token family** (`services.ts`): if a rotated-away
   refresh token is replayed after its successor was already issued, the server rejects only that specific
   old token — the successor (which may be in an attacker's hands, if reuse indicates theft) stays valid.
   Detected reuse should revoke every token descended from that family and force a fresh login.

## Another known gap found in review, NOT fixed here: co-editing lifecycle (dead code, pre-existing)

Round NN's adversarial review found that `src/platform/firm/coedit/coeditSession.ts`
has the same class of teardown bugs `matterNotesSync.ts` needed three rounds
(KK/LL/MM) to close: sign-out never calls `closeCoeditSession`, and
`openCoeditSession`/`closeCoeditSession` don't guard against a build still in
flight the way `ensureMatterSync`/`stopAll` now do, so a torn-down co-edit
session could in principle survive teardown and keep a live encrypted channel
open. Separately, its `MatterDocSyncClient` wiring never sets `onKeyEpochAdvanced`
at all, so a walled/removed co-editor's session would never fetch a new key or
stop on denial. **Neither is fixed on this branch** — verified via
`git log 5f697b7e..HEAD -- src/platform/firm/coedit/coeditSession.ts` (empty)
that this file predates the branch, and via a full-tree grep that
`openCoeditSession`/`closeCoeditSession` have zero callers anywhere in the live
app (`DocxEditor.tsx` only imports the `CoeditSession` type for its prop shape;
nothing ever constructs one). This matches the existing `createDocumentStream`
zero-caller precedent already noted elsewhere in this codebase — real
correctness/security gaps in code that is not currently reachable by any user
flow. Worth fixing before co-editing is ever wired up to a real UI entry point;
until then it carries no live exposure.

## Verify the port

1. Run `cd backend && bun test` and confirm `backend/test/intake-keys.test.ts`
   passes.
2. Run the full hostile-client proof (`backend/test/v2-route-inventory-privacy-proof.test.ts`). It drives every field in the executable route inventory with readable test text and checks that no metadata is stored, logged, or echoed.
3. Inspect the browser/network calls: paths contain only `ih2_…` and `mh2_…`
   values; publish bodies contain `matter_handle`, never `matter_id`; fetch
   bodies contain only `device_id`.
4. Re-run the project type checks and the focused `FirmApiClient` tests after
   moving each call site. A correct call site uses the typed client methods,
   not a direct `fetch` to an Intake route.
