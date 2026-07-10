# CODEX FIX BRIEF — Wave 2, coordinator final-pass fixes (2 P2 + 1 P3)

You are a Codex fix agent in worktree /home/jameson/lp-w2-cf (branch lp/intake-w2-cf), a checkout of the merged Wave-2 tree. The coordinator's independent review found no P1s but three issues to fix before Wave 3. Fix all three, TDD, commit on this branch. Do NOT push. TS-only — do NOT touch backend/ or intake-page/.

## Read first
- `src/features/intake/NudgeReviewModal.tsx` — `handleSave` (mailbox path: runs stale + eligibility checks, then `saveNudgeDraftToMailbox` which writes the audit intent/outcome pair + `recordNudgeAttempt`) vs `handleCopy` (the no-mailbox "Copy message" fallback: does NEITHER — just copies to clipboard).
- `src/platform/intake/nudgeSave.ts` — `saveNudgeDraftToMailbox` (audit intent → `mailSaveDraft` → outcome + `recordNudgeAttempt({channel:'email_draft'})`) and the call-suggestion recorder. Mirror these for the copy path.
- `src/features/matters/MatterHub.tsx` — `handleRegenerateIntake` (~line 300+): currently persists the new link secret (`updateIntakeLinkSecret(new)`) BEFORE calling the relay, with a try/catch rollback.
- `src/features/intake/LinkLifecyclePanel.tsx` (~line 152) — renders `t('intake.link.local-note')`. Locale in `src/locales/{en,de,es}.json` under `intake.link.*`.

## Fixes (do ALL)

### [P2a] The "Copy message" nudge fallback must run the same eligibility guard AND write the same audit record as the mailbox send path — `NudgeReviewModal.tsx` `handleCopy` (+ `nudgeSave.ts`)
Today `handleCopy` copies subject+body to the clipboard with no stale check, no cadence/eligibility check, and no audit/attempt record. So an advisor with no draft-capable mailbox can copy-nudge repeatedly, evading the ≤1-per-4-days cadence cap, leaving no compliance trail. Fix:
- Before copying, run the SAME guards `handleSave` runs against the live intake: recompute `deriveOnboardingRow(latestIntake, now, DEFAULT_ONBOARDING_CONFIG)`, block on stale (`missingItemIdsMatch` fails → stale-error) and on `!liveRow.nudgeEligibility.eligible` (not-eligible error). Only copy if it passes.
- Add a recorder in `nudgeSave.ts` (e.g. `recordNudgeCopiedToClipboard`) mirroring `saveNudgeDraftToMailbox`: write the audit **intent** row (phase intent, auditPairId, matterId, requestId, sequence, missingItemIds — NO body/values), perform the clipboard copy path's success, write the **outcome** row (same auditPairId; note the channel was a copied message, no provider draft id, recipient count), and `recordNudgeAttempt({..., channel:'email_draft'})` so it counts toward cadence exactly like a saved draft (it IS an email the advisor will paste-send). On failure write a failed outcome and do NOT record the attempt. `handleCopy` calls this recorder instead of doing a bare clipboard write.
- Test: a copy on an ineligible/cadence-blocked row is blocked (no clipboard write, no attempt recorded); a copy on an eligible row writes intent+outcome audit rows + records the attempt (so a second copy is then cadence-blocked). Keep the existing copy-unavailable (no clipboard API) behavior.

### [P2b] Regenerate must not persist the new link secret until the relay accepts the new bundle — `MatterHub.tsx` `handleRegenerateIntake`
Reorder so the relay commit happens BEFORE the local secret is persisted, closing the crash gap where a crash after `updateIntakeLinkSecret(new)` but before/around the relay call leaves the keychain on the NEW secret while the relay still holds the OLD token — so "copy link" then reconstructs a link the relay rejects (advisor hands out a dead link), with no rollback on crash. New order:
1. compute `regenerated = await regenerateIntakeLink({...})` (in-memory, no persistence — unchanged),
2. `await makeIntakeRelay().regenerateIntake(intakeId, { token_b64: regenerated.tokenB64, checklist_ciphertext_b64, state_ciphertext_b64 })` FIRST — if it throws, nothing was persisted; the old secret + old link stay valid; just rethrow (no rollback needed),
3. ONLY after the relay resolves: `await updateIntakeLinkSecret(intakeId, regenerated.linkSecretB64)`,
4. then `updateIntake(intakeId, { link, status:'active', checklist/stateCiphertextB64 })`.
Remove the now-unnecessary pre-persist + rollback branch. Add/adjust a test: if the relay call rejects, `updateIntakeLinkSecret` is NEVER called with the new secret (the persisted secret stays the old one) and the old link still reconstructs.

### [P3] Make the link panel's local-only status honest in UI copy — `intake.link.local-note` (en/de/es)
The panel's link status is derived from THIS device's local records, not a live relay check, so it can lag a change made elsewhere (e.g. expiry/revocation). Update `intake.link.local-note` copy to say so plainly — e.g. that the status reflects what this device last recorded and may not show a change made on another device — in warm, plain, client/household voice (no jargon, no em dashes, no time estimates). Update all three locales (en/de/es) with real translations. If the en text length changes the namespace key count, DO NOT change key counts (edit the value only, not the key set), so `en-json-snapshot` stays valid.

## Done bar
- No cadence/audit bypass: every nudge that leaves the app (saved draft OR copied message) passes eligibility and writes an intent+outcome audit pair + records the attempt. No `mailSend` ever. No body/restricted values in audit rows.
- Regenerate never persists a secret the relay didn't accept.
- Light theme, tokens, client/household copy, no em dashes, no time estimates.
- GREEN before done: `npx vitest run src/features/intake src/platform/intake`; `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`; `npx vitest run tests/unit/i18n/en-json-snapshot.test.ts`. Commit on this branch with a clear message. Do NOT push.
