# Wave 9 Review-R1 Fix — Return-URL Pinning (last outstanding P2)

**Branch:** `lp/intake-w9-r2-returnurl`, branched from `lp/intake-w9` @ `30e50037`. Worktree: `/home/jameson/lp-w9-r2-returnurl` (already created, checked out on this branch — work directly in it).
**You are Codex, the builder.** Build the fix, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications; never invoke `notify-jameson`.

## Context

`prep/W9-REVIEW-R1-codex.log` (independent adversarial review of `lp/intake-w9`) found 8 P1s and 3 P2s. All 8 P1s and 2 of the 3 P2s (launch-URL one-shot consumption, atomic artifact filing) were fixed by two prior fix lanes (`W9-REVIEW-R1-BACKEND-FIX`, `W9-REVIEW-R1-FRONTEND-FIX`, both already merged into `lp/intake-w9`). The third P2 was never assigned to either brief and remains unfixed. This brief covers only that one finding.

**The finding (verbatim from the review log):**

> [P2] The browser return is safely non-authoritative, but its exact return URL is not enforced in the adapter. The return URL is accepted from the caller without comparison to the broker's allowed URL.

**Verified still true in the current merged code** (re-confirmed by direct grep, not just trusting the review log):
- `backend/src/lib/config.ts` already resolves and requires `signingConfig.allowedReturnUrl` (env `DOCUSIGN_SIGNING_ALLOWED_RETURN_URL`) and `jwtGrant.ts`'s `assertSigningGrantConfiguration` already fails closed (`docusign_signing_not_configured`) if it's missing — so the broker already holds the authoritative allow-listed return URL.
- But `handleIssueSigningCapability` (`backend/src/routes/docusignSigning.ts:166-192`) never puts that value in its JSON response — the response only has `access_token`, `account_id`, `base_uri`, `expires_at` (plus legacy `capability`/`expires_in`).
- `src/features/matters/MatterHub.tsx:257` builds `returnUrl: \`${window.location.origin}/docusign-signing-return\`` entirely client-side and passes it straight through `startDocusignSignature` (`signatureWorkflow.ts:36,108`) into `DirectDocusignAdapter.createEnvelopeAndRecipientView` (`docusignAdapter.ts:79-96`), which sends it to DocuSign's recipient-view API with **no comparison to anything broker-issued.**

This matters because the recipient-view `returnUrl` is where DocuSign sends the client's browser back to after signing (or cancelling/declining). W9-PREP §4.4 requires "an allow-listed, exact Lantern return URL." Right now that allow-list exists only in backend config and is never actually checked against what gets sent to DocuSign — a compromised or misconfigured desktop build could point the return URL anywhere.

## Fix required

Make the broker-issued capability the single source of truth for the return URL, and make the adapter refuse to proceed if the caller-supplied `returnUrl` doesn't match it exactly.

### 1. Backend: include the allowed return URL in the capability response

`backend/src/routes/docusignSigning.ts`, `handleIssueSigningCapability` (~line 166-192): add `return_url: signingConfig.allowedReturnUrl` to the JSON response, alongside the existing fields. Do not rename or remove any existing field (additive only, matching the R1 backend fix's own convention). `signingConfig.allowedReturnUrl` is already guaranteed non-null by the time a capability is successfully issued (see `assertSigningGrantConfiguration`) — no new fail-closed check needed here, but add one test asserting the field is present and correct in a successful response.

### 2. Frontend: parse it, and enforce it before calling DocuSign

1. `src/platform/docusignSigning/docusignAdapter.ts`: add `allowedReturnUrl: string` to the `DocusignAuthorization` interface (~line 4-9), with a one-line comment noting it is the broker's pinned, allow-listed return URL, authoritative over anything the caller passes.
2. `src/platform/docusignSigning/capabilityClient.ts`: parse `parsed['return_url']` the same way the other required string fields are parsed (`validText` check, included in the "response was incomplete" failure path), and include `allowedReturnUrl: parsed['return_url']` in the returned object.
3. `src/platform/docusignSigning/docusignAdapter.ts`, `createEnvelopeAndRecipientView` (~line 79-96): inside `withAuthorization`'s callback, immediately after obtaining `authorization` (before the envelope-creation `fetchFn` call), compare `input.returnUrl` to `authorization.allowedReturnUrl`. If they are not exactly equal (string equality, no normalization/trimming — an unpinned mismatch should fail loudly, not be silently coerced), throw a clear error (e.g. `'DocuSign return URL is not the broker-allowed URL.'`) and make no DocuSign network call at all — the envelope-creation `fetchFn` call must not happen if this check fails.
4. Do not change where `MatterHub.tsx` constructs `returnUrl` — that's a legitimate second contributor to a defense-in-depth check (the caller's own return URL matching Lantern's own origin), not the fix itself. The broker-issued `allowedReturnUrl` is now the authoritative check; the caller-supplied value is what gets compared against it.

### 3. Update existing tests that construct a full `DocusignAuthorization` fixture

Grep `src/platform/docusignSigning/*.test.ts` and `src/features/matters/*.test.tsx` (or wherever `DocusignAuthorization`-shaped fixtures are built for adapter/workflow tests) for every place a mock authorization object is constructed, and add `allowedReturnUrl` matching whatever `returnUrl` the corresponding test's envelope input already uses — otherwise every existing passing test that calls `createEnvelopeAndRecipientView` will start failing on the new mismatch check. This is expected and correct; make the fixtures consistent rather than weakening the check.

## Tests to add

- Backend (`backend/test/docusignSigning.test.ts`): a successful capability response includes `return_url` equal to the configured `DOCUSIGN_SIGNING_ALLOWED_RETURN_URL`.
- Frontend adapter (`src/platform/docusignSigning/docusignAdapter.test.ts`): 
  - `createEnvelopeAndRecipientView` succeeds when `input.returnUrl === authorization.allowedReturnUrl`.
  - `createEnvelopeAndRecipientView` throws and makes **zero** `fetch` calls when `input.returnUrl !== authorization.allowedReturnUrl` (assert the mock fetch spy was never invoked — this proves the check runs before any network call, not just that the promise rejects).
- Frontend capability client (`src/platform/docusignSigning/capabilityClient.test.ts`): a response missing `return_url` is treated as incomplete (same failure path as a response missing `access_token`).

## Non-negotiables (a reviewer will check these)

- No document bytes, recipient details, or `matter_id` are added to the capability request/response — this fix only adds one already-server-known string (the pinned return URL) to an existing response.
- The mismatch check must run before the envelope-creation network call, not after — a mismatch must produce zero DocuSign traffic, not a wasted envelope.
- Every existing passing test outside the ones you're deliberately updating for the new required field must still pass unchanged.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 300 bun test backend/test/docusignSigning.test.ts
timeout 300 bun test backend
timeout 120 npx tsc --noEmit -p backend
timeout 300 npx vitest run src/platform/docusignSigning src/features/matters
timeout 180 npx tsc --noEmit
timeout 240 node scripts/eslint-gate.mjs
```

## Finish

Commit on this branch (`lp/intake-w9-r2-returnurl`) with a conventional message containing `W9-REVIEW-R1-RETURNURL-FIX`. Do NOT push. Do NOT merge. Report exact check results, the exact final JSON field name/shape you used, and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
