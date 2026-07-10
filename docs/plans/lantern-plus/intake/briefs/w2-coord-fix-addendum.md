# CODEX FIX ADDENDUM — regenerate: don't lose the accepted secret on keychain failure

You are a Codex fix agent in worktree /home/jameson/lp-w2-cf (branch lp/intake-w2-cf). The P2b regenerate reorder (relay-before-persist) is in place, but an adversarial review found a mirror gap: if the relay ACCEPTS the new bundle and then `updateIntakeLinkSecret(new)` fails (e.g. OS keychain unavailable), the code throws and the only copy of the accepted new secret is lost — relay now on the new token, keychain still on the old, copied links dead until manual recovery. Close this ONE gap. TS-only, single file + test.

## Scope — `src/features/matters/MatterHub.tsx` `handleRegenerateIntake` (+ its test in `tests/unit/matter/matterHub.test.tsx`)
Keep the current order: `regenerateIntakeLink` (in-memory) → `makeIntakeRelay().regenerateIntake(new bundle)` (relay first) → persist. Change only the persist step:

1. After the relay accepts, attempt `updateIntakeLinkSecret(intakeId, regenerated.linkSecretB64)` with a small bounded RETRY (e.g. up to 3 attempts) to ride out a transient keychain error.
2. If the persist STILL fails after retries, perform a best-effort **compensating relay rollback** so the system returns to a fully consistent OLD state (old link keeps working):
   - old token: `const oldToken = (await deriveAuthToken(b64ToBytes(oldSecretB64))).tokenB64;` (import `deriveAuthToken` from `@/platform/intake/intakeCrypto`).
   - call `await makeIntakeRelay().regenerateIntake(intakeId, { token_b64: oldToken, checklist_ciphertext_b64: current.checklistCiphertextB64, state_ciphertext_b64: current.stateCiphertextB64 })` (the pre-regenerate ciphertexts are already sealed under the OLD k_page, so this restores exactly the prior link).
   - wrap the rollback in its own try/catch (best-effort; if it also fails, proceed to throw).
   - then `throw` a clear, plain-language error: the link was regenerated on the server but could not be saved to this device's secure storage, so the previous link was restored and still works — try regenerate again once secure storage is available. (Locale copy is fine, or a plain string; keep it client/household voice, no jargon, no em dashes.)
3. On successful persist (first try or a retry), continue exactly as now: `updateIntake(intakeId, { link, status:'active', checklist/stateCiphertextB64 })`.

Do NOT change the happy path behavior or the existing "relay fails → nothing persisted, old secret intact, rethrow" behavior (that stays — the relay call is still first).

## Tests (extend `matterHub.test.tsx`)
- Keep the existing two tests (relay-before-persist ordering; relay-reject → `updateIntakeLinkSecret` not called).
- Add: relay ACCEPTS but `updateIntakeLinkSecret` rejects on every attempt → assert the compensating rollback relay call is made with the OLD token + the pre-regenerate ciphertexts, and the function throws (the store is NOT left claiming the new link as saved). Optionally: a transient persist failure that succeeds on retry completes normally (store updated to the new link).

## Done bar
- No accepted secret silently lost: a persist failure after relay-accept either retries to success, or rolls the relay back to the consistent old state and surfaces a clear error.
- No `mailSend`. Light theme / tokens / client-household voice / no em dashes / no time estimates (only if you touch copy).
- GREEN: `npx vitest run tests/unit/matter/matterHub.test.tsx src/features/intake src/platform/intake`; `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`. Commit on this branch (amend or new commit, your choice). Do NOT push.
