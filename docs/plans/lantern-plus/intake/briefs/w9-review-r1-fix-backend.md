# Wave 9 Review-R1 Fix — Backend Broker (P1s + P2s in backend territory)

**Branch:** `lp/intake-w9` directly (the wave's fully-merged, already-pushed integration branch). Worktree: `/home/jameson/lp-w9-r1-backend` (new worktree branched from `lp/intake-w9`, since two fix lanes run in parallel and must not collide).
**You are Codex, the builder.** Build the fixes, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications; never invoke `notify-jameson`.

## Context

An independent adversarial review of `lp/intake-w9` (full log: `/home/jameson/lantern-coordination/prep/W9-REVIEW-R1-codex.log`, two independent passes, identical conclusions) found real P1/P2 defects. This brief covers every finding whose fix lives in `backend/`. A second, parallel fix lane covers the frontend/client-page findings — its branch is `lp/intake-w9-r1-frontend`, disjoint files, do not coordinate live with it; the exact contract between your work and theirs is specified below and is final, not up for renegotiation mid-build.

Read `/home/jameson/lantern-coordination/prep/W9-PREP.md` again before starting — every fix below must stay inside its non-negotiables (relay stays ciphertext-only, `matter_id` never crosses the broker, broker never receives document/recipient data, demo/production stay hard-separated).

## Fixes required

### 1. [P1] Double `/restapi` will break every real DocuSign call

`backend/src/lib/config.ts`'s `resolveDocusignSigningConfig()` (~line 118-183) resolves `apiBaseUri` **including** a `/restapi` suffix (default `"https://demo.docusign.net/restapi"`, and validation requires `pathname.startsWith("/restapi")`). But `src/platform/docusignSigning/docusignAdapter.ts` (frontend, not yours to edit) already appends `/restapi/v2.1/accounts/...` itself — so the real request becomes `.../restapi/restapi/v2.1/...`.

**Fix:** change the contract to a **bare account API host with no path** (e.g. `https://demo.docusign.net`, no `/restapi`). Update `resolveDocusignSigningConfig()`: default becomes `"https://demo.docusign.net"`; the validation that currently requires `pathname.startsWith("/restapi")` must instead reject any path segment at all (bare origin only) — `new URL(apiBaseUri).pathname` must be `""` or `"/"`. Keep every other check (host must end in `docusign.net`, demo-mode host pinning, https-in-production). The frontend fix lane is being told to keep its single `/restapi` append as-is — this is the one and only place that string appears in a URL now.

### 2. [P1] Nothing actually wires the advisor flow end-to-end — the capability response is incomplete

`requestDocusignSigningCapability()` (`backend/src/lib/docusignSigning/jwtGrant.ts:113-140`) and `handleIssueSigningCapability` (`backend/src/routes/docusignSigning.ts:160-169`) return only `{capability, expires_in}` (renamed `accessToken`/`expiresIn` in the JSON body — check the exact current key names and keep the response **additive**, do not rename existing fields the frontend fix lane may already expect). The frontend adapter's `DocusignAuthorization` type needs `accessToken`, `accountId`, `baseUri`, `expiresAt` (ISO string) — only `accessToken`/`expiresAt`-equivalent exist today; `accountId` and `baseUri` are missing entirely from the response.

**Fix:** `handleIssueSigningCapability`'s JSON response must become:
```json
{ "access_token": "<capability>", "account_id": "<signingConfig.accountId>", "base_uri": "<signingConfig.apiBaseUri>", "expires_at": "<ISO timestamp = now + expires_in seconds>" }
```
Compute `expires_at` from `deps.now()` (already available, already injectable for tests) plus `issued.expiresIn` seconds. If `signingConfig.accountId` or `signingConfig.apiBaseUri` is null/empty at call time (can happen in demo mode before full demo config exists), fail closed with a clear `docusign_signing_not_configured` 503-style error rather than returning a response with an empty `account_id`/`base_uri` — a partially-configured capability response is worse than an explicit failure. Add this exact case to your test coverage.

### 3. [P1] The Connect webhook payload shape doesn't match DocuSign's real Connect notification

`backend/src/lib/docusignSigning/connect.ts`'s `DocusignConnectPayload`/`validateDocusignConnectPayload` (lines 7-14, 40-90) invented a flat shape (`event_id`, `envelope_id`, `event_type`, `occurred_at`, `environment`, `nonce`) that does not match DocuSign's actual Connect JSON notification, which nests envelope data under a `data` object and uses DocuSign's own field names. DocuSign's real "aggregate" Connect JSON notification shape (the standard, documented format) is approximately:

```json
{
  "event": "envelope-completed",
  "apiVersion": "v2.1",
  "uri": "/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}",
  "retryCount": 0,
  "configurationId": 12345,
  "generatedDateTime": "2026-07-11T12:00:00.0000000Z",
  "data": {
    "accountId": "...",
    "envelopeId": "...",
    "envelopeSummary": {
      "status": "completed",
      "statusChangedDateTime": "2026-07-11T12:00:00.0000000Z"
    }
  }
}
```

Rewrite `DocusignConnectPayload` and `validateDocusignConnectPayload` to parse this real shape: top-level `event` (must be exactly `"envelope-completed"` — reject any other value, including any value implying a different lifecycle stage), `generatedDateTime` (the timestamp to clock-skew-check, replacing `occurred_at`), `data.accountId` and `data.envelopeId` (replacing the old flat `envelope_id`), `data.envelopeSummary.status` (must equal `"completed"`). There is no natural `event_id`/`nonce` field in this real shape for replay protection — DocuSign's own recommendation is to dedupe on `(envelopeId, generatedDateTime)` or `retryCount`-aware envelope-status polling; use `data.envelopeId` plus `generatedDateTime` as your replay/idempotency key instead of inventing a `nonce` field that doesn't exist on the wire. Keep the **existing strict-rejection discipline** (`FORBIDDEN_FIELD` regex, `ALLOWED_FIELDS` allow-list) but rebuild both against the real field names above — reject any top-level or nested field not in this real shape, and continue to reject anything document/recipient-shaped (there is no legitimate reason a Connect notification with document inclusion disabled would ever carry one). Update `verifyDocusignConnectSignature`'s caller and `handleDocusignConnectEvent` (`backend/src/routes/docusignSigning.ts:207-236`) to match the new payload shape. Update every test in `backend/test/docusignSigning.test.ts` that constructs a synthetic Connect payload to use the real shape.

**This is the one fix in this brief most likely to still need adjustment against the real DocuSign demo sandbox** (the exact JSON shape can only be fully confirmed by an actual Connect delivery) — get it as close to DocuSign's documented format as you can from what's above, and flag clearly in your report that it should be re-verified the moment live Connect deliveries are observable.

### 4. [P1] Wake-ups leak across every firm/advisor — no tenant scoping

`BlindSigningBrokerStore` (`backend/src/lib/docusignSigning/store.ts:22-59`) keeps one **global** `wakeups` map with no owner. `handleListSignatureWakeups`/`handleAckSignatureWakeups` (`backend/src/routes/docusignSigning.ts:238-260`) take an `intakeId` in the URL and authorize the caller **owns that intake**, but then call `listWakeups()`/`consumeWakeups(eventIds)` with **no intake filter at all** — any authenticated advisor who owns any one intake can list and delete every other firm's wake-up events.

**Fix:** the broker must learn which `envelope_id` belongs to which `intake_id` **without ever learning anything about the document, recipient, or client** — it already doesn't and must continue not to. Add:
- A new store method `registerEnvelope(intakeId: string, envelopeId: string): void` and an internal `Map<envelopeId, intakeId>` (or equivalent) inside `BlindSigningBrokerStore`.
- A new advisor-authed endpoint `POST /docusign-signing/:intakeId/envelope` (body: `{ envelope_id: string }`, opaque-id format validated the same way other opaque ids are elsewhere in this file) that calls `registerEnvelope`. Export its handler as `handleRegisterEnvelope`.
- `listWakeups(intakeId)` and `consumeWakeups(intakeId, eventIds)` on the store must now take `intakeId` and only operate on wake-ups whose `envelope_id` is registered to that exact `intakeId` — an eventId for an unregistered or foreign-intake envelope is invisible and undeletable to a caller who doesn't own it.
- Update `handleListSignatureWakeups`/`handleAckSignatureWakeups` to pass `intakeId` through to the now-scoped store methods.
- The frontend fix lane is being told to call this new `POST /docusign-signing/:intakeId/envelope` endpoint immediately after a successful `createEnvelopeAndRecipientView` — you do not need to build that caller, only the endpoint + scoped store logic + tests.
- Test explicitly: two different `intakeId`s, each with their own registered envelope and wake-up event; caller for intake A cannot list or ack intake B's wake-up, and vice versa; an unregistered `envelope_id`'s wake-up is invisible to everyone (fails closed, not open).

### 5. [P1] Production wall is incomplete — no negative demo-host check in production, no template-approval gate

`resolveDocusignSigningConfig()` (`backend/src/lib/config.ts:118-183`) pins `demo.docusign.net` as the **required** host in demo mode, but has **no equivalent negative check preventing a released production config from pointing at the demo host**. Add: when `environment === "production"` (i.e. `releaseEnabled`), reject an `apiBaseUri` whose hostname is `demo.docusign.net` (or any subdomain containing `demo`) — production must never be able to point at the sandbox, mirroring the existing demo-side protection in the other direction.

Additionally, add a minimal **template-approval gate** enforced in code, not just documented: a new config value `DOCUSIGN_SIGNING_APPROVED_TEMPLATE_IDS` (comma-separated template IDs, parsed into a `Set<string>`), exposed as `config.docusignSigning.approvedTemplateIds`. When `environment === "production"`, `handleIssueSigningCapability` must accept an optional `template_id` field in its request body (add it to `readStrictJson`'s allowed fields) and reject (403, clear error code) issuing a capability for a `template_id` not in `approvedTemplateIds` — demo mode is unrestricted (BUILD-only testing needs no approval gate yet, per the prep pack's build-now/ship-later split). This is intentionally minimal — it is not the full CCO/custodian approval workflow (that's a Jameson SHIP prerequisite, out of code scope), but it makes it structurally impossible for a production release to silently skip the one enforceable check available at this layer. Note in your report that the frontend fix lane's capability-request call will need to pass `template_id` for this to have effect in production — coordinate this only through your test coverage and report, not through live coordination during the build.

### 6. [P1] "One-use capability" is a mislabeled reusable DocuSign bearer token — fix the claim, not the architecture

`jwtGrant.ts`'s own comment already says the right thing ("DocuSign JWT-grant access tokens are not server-enforceable single-use tokens, so the broker never caches or reuses one and makes no stronger claim than that") — but `docusignAdapter.ts`'s `DocusignAuthorization` interface comment (frontend, not yours) still says "Broker-issued, **one-use** authorization." Do not attempt to build a broker-mediated document proxy to make this literally true — that would contradict Wave 9's entire direct-desktop-to-DocuSign design. Your job here: make sure nothing on the backend side documents, logs, or names this as "one-use" — grep your own new/changed code for that phrase and remove it; the accurate framing is "a fresh, short-lived DocuSign bearer minted per explicit advisor send action, never cached or reused by the broker." (The frontend fix lane is independently told to fix its own comment/type doc language to match.)

## Non-negotiables (a reviewer will check these)

- The broker still never receives document bytes, recipient name/email, or `matter_id` — the new `/envelope` registration endpoint accepts only an opaque `envelope_id`, nothing else; validate its request body against an explicit allow-list the same way every other endpoint here does.
- The RSA private key still never appears in a response, log, or error message.
- Every existing passing test in `backend/test/docusignSigning.test.ts` that isn't directly about one of the six fixes above must still pass — update only what the real-shape/contract changes force you to update.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 300 bun test backend/test/docusignSigning.test.ts
timeout 300 bun test backend
timeout 120 npx tsc --noEmit -p backend
```

Do not touch anything outside `backend/`. Do not run the root/frontend `npx tsc`, `npx vitest`, or `eslint-gate` — the frontend fix lane owns that, and running it here against your uncoordinated mid-flight worktree would give a false read anyway.

## Finish

Commit on your new branch (create it as `lp/intake-w9-r1-backend`, branched from `lp/intake-w9`) with a conventional message containing `W9-REVIEW-R1-BACKEND-FIX`. Do NOT push. Do NOT merge. Report exact check results, the exact final JSON shape of `handleIssueSigningCapability`'s response (field names), the exact new `/envelope` endpoint's request/response shape, and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
