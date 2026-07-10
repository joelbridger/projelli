# Scoped privacy fix — remove matter_id from the relay-create payload (P1)

**Branch:** `lp/intake-w4-privacy-matterid` (checked out for you off the current lp/intake tip).
**You are Codex.** Small, scoped, backward-safe fix. Build, test, commit. Do NOT push.

## The problem (P1 privacy leak)
`src/platform/intake/createIntake.ts` (~line 54) sends `matter_id: options.matterId` IN CLEAR to the relay in the create-intake payload. The internal `matter_id` (the client/household identifier) must never leave the advisor machine in plaintext. An independent review confirmed the backend never reads it (`backend/src/routes/intake.ts`), so removing it is backward-safe.

## Fix
1. Remove `matter_id` from the payload sent in `createIntake.ts` (`options.relay.createIntake({...})`). Keep `matterId` as an INPUT to `createAdvisorIntake` if it is used locally (e.g. for keychain/secret storage or return value) — only stop SENDING it to the relay.
2. Remove `matter_id` from the `createIntake` request type on the client relay client (`src/platform/intake/IntakeRelayClient.ts`) and from the shared wire contract type wherever the create-intake request body is defined (search for the type: `backend/src/intakeContract.ts`, `backend/src/routes/intake.ts`, and any shared contract module). The relay must not declare or persist `matter_id` for intake-create.
3. VERIFY the backend truly ignores it: confirm `routes/intake.ts` create handler does not read/store `matter_id`. If it currently destructures or persists it, remove that too. Do not change how intakes are keyed (intake_id remains the key).
4. Do NOT touch the SEALED manifest or any encrypted field — those are fine. Do NOT touch semantic item-id handles (that is Wave 7). ONLY the plaintext `matter_id` in the create payload.

## Tests
- Add/extend a test asserting the relay create payload NEVER contains `matter_id` (and no `matterId`): assert the object passed to `relay.createIntake` (or the serialized request body in the backend contract test `backend/test/intake-e2e.test.ts`) has no `matter_id` key. Prefer asserting at the real call boundary, not a hand-built object.
- Keep the existing intake create/round-trip tests green (`backend/test/intake-e2e.test.ts`, any `createIntake`/`IntakeRelayClient` unit tests).

## Non-negotiables
`matter`/`matter_id` names are NEVER renamed (this removes a leaked FIELD, it does not rename the concept). Light theme/tokens/no em dashes (no UI here). Backward-safe: older servers ignore the absent field; older clients that still send it are harmless.

## Verify (report exact pass/fail)
```
npx vitest run src/platform/intake
cd backend && bun test ; cd ..
npx tsc --noEmit
node scripts/eslint-gate.mjs
npm run test:contracts
```

## Finish
Commit on `lp/intake-w4-privacy-matterid` with a message containing `W4-PRIVACY-STRIP-MATTERID-FROM-RELAY`. Do NOT push. Report exact check results and confirm the tree is clean. (The dispatcher detects completion by your process exiting.)
