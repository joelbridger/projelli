# Wave 9 Lane 4 — Blind JWT Broker, Signature Launch Relay, and DocuSign Connect Wake-Up

**Branch:** `lp/intake-w9-signing-broker`, branched off `lp/intake-w9` **after Lane 1 has merged into it** (confirm with `git log --oneline -5` that your branch point contains a commit with `W9-LANE1-CONTRACT` in its message before starting).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications; never invoke `notify-jameson`.

## Read first

1. `/home/jameson/lantern-coordination/prep/W9-PREP.md` in full, especially §4.2 (JWT auth and key ownership), §4.5 (Connect webhook, retrieval), §7 Lane 4.
2. `backend/src/lib/config.ts` — the existing env-loading pattern (`str()`/`num()` helpers, `resolveSeatKeys()` for RSA key pairs via `loadPem` supporting either an inline PEM env var or a file-path env var, `resolveAuthSecret()`'s fail-loud-in-prod/ephemeral-in-dev pattern). You are adding a parallel, clearly-separated config block for the DocuSign signing integration — do not touch or reuse the existing `resolveSeatKeys`/`authSecret` values, they are for something else entirely.
3. `backend/src/routes/webhooks.ts` — the existing LemonSqueezy webhook handler's `verifyLsSignature` (HMAC-SHA256, timing-safe compare, fail-closed on missing secret). DocuSign Connect's HMAC verification (`X-DocuSign-Signature-1` header, HMAC-SHA256 of the raw request body under a shared "Connect Key" you configure in the DocuSign app) is the same shape — mirror this pattern exactly, do not invent a new one.
4. `backend/src/server.ts` — read `matchIntake`/`matchMatter` (~line 95-106, simple `path.match(/^\/prefix\/([^/]+)(?:\/(.*))?$/)` helpers) and the manual `if (path === ... && method === ...) return handler(...)` dispatch block (~line 140-190) for the intake routes. You add a `matchDocusignSigning(path)` helper the same way and register your new routes the same way, in the same file, as a narrowly-scoped additive block — do not restructure the existing routing.
5. `backend/src/routes/intake.ts` — read (do not edit) `authorizeAdvisorIntake` (seat-token advisor auth, used by `handleReplaceIntakeChecklist`) and `gatePublicIntake` (rate-limited, IP-gated, client-bearer-token public auth, used by `handleIntakeBundle`/`handleSaveIntakeState`). Both are **not exported** — do not import them. Write your own narrow equivalents in your own new files; you may reasonably duplicate a small amount of gating logic rather than couple to `intake.ts`'s internals (that file is explicitly off-limits to you per the prep pack's lane boundaries).
6. Lane 1's final report for exact export names (`SignatureEvent`, `isDuplicateSignatureEvent`, `LocalSignatureRecord`) — you use these for shaping the opaque completion-event data you enqueue, but you never construct or persist a full `LocalSignatureRecord` yourself (that stays Lane 2's, encrypted, local-only).
7. The Wave 9 launch relay contract below (§Launch relay contract) — fixed, cross-lane-agreed, do not redesign.

## Goal (one paragraph)

Build a narrow, deliberately blind backend service with three jobs, all living in one new route file: (1) issue a short-lived DocuSign access token to an authenticated advisor session via the OAuth JWT Grant, using a private key that never leaves this service and is never logged; (2) relay one opaque, sealed signature-launch blob per intake between the advisor app and the client page, never able to read its contents; (3) receive and verify DocuSign Connect webhook events (signed, no document included) and turn a verified completion event into an opaque wake-up signal the advisor app can poll for — never fetching or storing the actual document itself.

## Non-negotiables (a reviewer will check these)

- The RSA private key for the DocuSign signing integration lives only in this service's secret store (env var or file path via `loadPem`, mirroring `resolveSeatKeys`). It is never logged, never included in any response body, never written to a database row in plaintext alongside other queryable data.
- No endpoint in `docusignSigning.ts` accepts document bytes, a readable filename, a client-file path, a recipient name, a recipient email, or `matter_id`. Validate every request body against an explicit allow-list of fields **before** any processing — reject unknown/extra fields, don't just ignore them.
- The token-issuance endpoint checks the authenticated advisor identity (seat token, same as other advisor-authed intake routes) and the production/environment gate **before** ever performing the JWT Grant call to DocuSign. A misconfigured or missing environment/consent/private-key must fail closed with a clear error, never fall back to a default that could accidentally point at production.
- Production traffic is disabled by configuration and code until a single, explicit `DOCUSIGN_SIGNING_PRODUCTION_RELEASE` (or equivalent) flag is set — absent or false, every call resolves against the demo/sandbox host only, regardless of what other config might suggest. This is the prep pack's hard SHIP gate; do not make it possible to accidentally enable production from a partial config.
- The Connect webhook endpoint verifies the DocuSign HMAC signature before parsing anything else from the body; rejects unsigned, expired (clock-skew-bounded), replayed (same event id/nonce seen before), malformed, wrong-environment, or unknown event-type payloads; and rejects (never silently strips) a payload that includes the actual document. It never calls DocuSign to fetch a document and never builds anything resembling a client-to-envelope map — it only ever stores the minimum opaque event id, envelope id, event type, and timestamp needed to wake an authenticated advisor session.
- The launch-relay endpoints never decrypt, inspect, or log the ciphertext blob they carry — they are a dumb, size-capped, ciphertext-only mailbox exactly like the existing intake checklist/state endpoints.
- No bearer token, access token, or private key appears in any log line this lane writes, at any log level, including error paths.

## Launch relay contract (fixed — do not redesign; identical text was given to Lanes 2 and 3)

```
PUT    {firmApiBase}/docusign-signing/{intakeId}/launch
       Auth: advisor seat token (same pattern as authorizeAdvisorIntake)
       Body: { launch_ciphertext_b64: string }   — size-capped (define a constant, mirror MAX_INTAKE_STATE_BYTES's order of magnitude)
       Response: { ok: true }
       Behavior: last-write-wins overwrite, keyed by intakeId alone (Wave 9 supports one active launch per intake at a time)

GET    {firmApiBase}/docusign-signing/{intakeId}/launch
       Auth: public, gated by the client's own intake auth token (your own narrow equivalent of gatePublicIntake — rate-limited, IP-gated)
       Response: { launch_ciphertext_b64: string | null }

DELETE {firmApiBase}/docusign-signing/{intakeId}/launch
       Auth: advisor seat token
       Response: { ok: true }
       Behavior: clears any stored launch for this intake (used for withdrawal/cleanup; your call whether Lane 2 actually needs this or TTL expiry alone is sufficient — implement it either way since Lanes 2/3's briefs assume it exists)
```

Storage: a new, small, dedicated table/map — do not repurpose the existing intake `Store`'s checklist/state storage (`intake.ts`/`db.ts` internals are not yours to touch). The blob is opaque bytes to you; store and return it verbatim.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `backend/src/lib/config.ts` — add a clearly-separated new config block (e.g. a `docusignSigning: { ... }` sub-object or a set of top-level `docusignSigning*` keys, your call, keep it grouped and commented) for: environment (`demo` | `production`), production-release flag, integration key, impersonated user id, account id, API base URI (demo vs production, resolved from environment), the RSA private key (via `loadPem`, both inline-PEM-env and file-path-env variants like `resolveSeatKeys` supports), the DocuSign Connect HMAC shared secret, and the allowed return URL. Fail loud (throw at startup, not silently default) if a required production-only setting is missing while `DOCUSIGN_SIGNING_PRODUCTION_RELEASE` is true; stay convenient for demo/dev otherwise, matching `resolveAuthSecret`'s existing dev-convenience-vs-prod-strictness balance.
- `backend/src/server.ts` — add the `matchDocusignSigning(path)` helper and the narrow route-dispatch block for your new routes, in the same style as the existing intake block. This is the "narrowly scoped backend registration" the prep pack explicitly allows you.

**Create (`backend/src/routes/docusignSigning.ts`):**
- `handleIssueSigningCapability` (or your naming) — POST, advisor-seat-authed. Performs the OAuth JWT Grant against DocuSign (sign a JWT with the private key, POST to the environment-appropriate account-server token endpoint, receive `{access_token, expires_in}`), returns a short-lived capability to the caller. Document your exact interpretation of "one-use": DocuSign's JWT-granted access tokens are not natively single-use, so mint a fresh one per explicit advisor send-action request rather than caching/reusing across requests, and say so plainly in your report — do not claim a stronger one-use guarantee than what's actually enforceable.
- `handlePutSignatureLaunch` / `handleGetSignatureLaunch` / `handleDeleteSignatureLaunch` — the launch relay contract above.
- `handleDocusignConnectEvent` — POST, DocuSign Connect webhook target. HMAC verification first (mirror `verifyLsSignature`'s exact shape: timing-safe compare, fail-closed on missing secret), then environment/event-type/document-inclusion/replay checks, then enqueue an opaque wake-up record.
- A minimal opaque wake-up queue/store the advisor app can poll (e.g. `handleListSignatureWakeups` — GET, advisor-seat-authed, returns unconsumed wake-up records for signature items belonging to that advisor's intakes) plus an ack/consume endpoint so the same wake-up isn't repeatedly re-delivered. Keep this store scoped to `(envelopeId, eventType, eventId, at)` — nothing else.

**Create (`backend/src/lib/docusignSigning/`):**
- JWT signing + grant exchange (pure-ish logic, HTTP call abstracted behind an injectable `HttpPostForm`-style seam like `oidc.ts`'s `HttpPostForm`/`HttpGet` pattern, so tests can inject a fake DocuSign token endpoint).
- Connect signature verification + replay/clock-skew guard.
- The opaque wake-up record type + idempotency helper (you may use Lane 1's `isDuplicateSignatureEvent` shape as your model, but you are deduplicating your OWN opaque wake-up records, not constructing a `LocalSignatureRecord`).

**Create (tests):**
- `backend/test/docusignSigning*.test.ts` per §Acceptance tests below.

Nothing else. Do not touch `backend/src/routes/intake.ts`, `backend/src/lib/intake.ts`, `IntakeRelayClient.ts`, any desktop UI file, or Lane 1's `src/platform/intake/docusignSignature/` (import types from it if genuinely useful, never edit it).

## Deliverables

1. Config block for the DocuSign signing integration, environment-locked, fail-closed on missing production settings.
2. JWT Grant token-issuance endpoint, advisor-seat-authed, production-gated.
3. Launch relay PUT/GET/DELETE per the fixed contract.
4. DocuSign Connect webhook receiver: HMAC-verified, replay-protected, document-inclusion-rejecting, environment-matched.
5. Opaque wake-up queue + consume/ack endpoint for the advisor app.
6. Route registration in `server.ts`.

## Acceptance tests (full list)

- JWT: demo vs. production environment isolation (a demo-configured broker never calls a production DocuSign host and vice versa); missing/absent consent surfaces a clear error, not a raw DocuSign error passthrough; wrong account/base URI configuration is caught at config-resolution time, not mid-call; expired/invalid private key fails closed; **no** secret (private key, access token) appears in any test-captured log output; a capability response is never persisted to disk by this service (verify nothing writes it to your new stores).
- Endpoint contract: every one of `handlePutSignatureLaunch`/`handleGetSignatureLaunch`/`handleIssueSigningCapability`/`handleDocusignConnectEvent` rejects a request body containing document bytes/content, a multipart upload, a recipient name/email, `matter_id`, a filename, a filesystem path, a ceremony URL, or arbitrary extra envelope metadata — one test per endpoint per forbidden field, asserting rejection happens before any DocuSign call (spy the injected HTTP seam).
- Connect webhook: unsigned request rejected; wrong signature rejected; replayed event id rejected; expired/out-of-clock-skew timestamp rejected; malformed body rejected; wrong-environment event rejected; a payload with document content included is rejected outright (not stripped-and-accepted); a valid, correctly-signed, non-duplicate completion event is accepted and produces exactly one opaque wake-up record; delivering the identical event twice produces no second wake-up record (idempotent).
- Service boundary: a test using the injectable HTTP seam proves this service, across every code path in this lane, only ever calls DocuSign's OAuth token endpoint and never any document/envelope-content endpoint — assert the full set of external URLs ever requested by this lane's code is exactly `{token endpoint}`, nothing else.
- Launch relay: PUT then GET round-trips the exact opaque bytes unchanged; GET before any PUT returns `null`/not-found; DELETE clears it; an oversized `launch_ciphertext_b64` is rejected before storage; a request for an unknown/nonexistent `intakeId` returns a clean not-found, not a crash.

## Self-converge requirement

Run the full acceptance list, fix every failure, rerun until green. Skip only genuinely Lane-2/3-blocked integration cases (there should be very few — this lane's tests are mostly self-contained against your own injectable HTTP seam) with an exact `// TODO(w9-gate): ...` naming the missing dependency. Make the most conservative choice on any undecided design point (never trust a header/body value without verifying it; fail closed on ambiguous environment/production config; never log a secret "just for debugging") and document the choice in your report.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout)

```
timeout 300 bun test backend/test/docusignSigning
timeout 300 bun test backend
timeout 120 npx tsc --noEmit -p backend
```

(Confirm the exact test runner and typecheck invocation this backend actually uses — check `backend/package.json` scripts first; use the project's real commands if they differ from the guesses above, and say in your report if you had to adjust them.)

Do not run `npm run gate` or anything touching the frontend/Rust toolchains — this lane is backend-only.

## Finish

Commit on `lp/intake-w9-signing-broker` with a conventional message containing `W9-LANE4-BROKER`. Do NOT push. Do NOT merge. Report exact check results, every new export/endpoint other lanes need (exact paths, request/response shapes), every skipped test with its exact missing dependency, your exact interpretation of "one-use" capability, and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
