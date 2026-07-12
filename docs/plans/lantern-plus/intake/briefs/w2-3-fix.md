# CODEX FIX BRIEF — Wave 2, Lane 3 (nudge) fix round

You are a Codex fix agent in worktree /home/jameson/lp-w2-3 (branch lp/intake-w2-3). Your nudge build (commit c7a085e4) is well-tested in isolation, but an adversarial review found the feature is not actually reachable/correct in the running app. Fix the two code-level P1s below, TDD, then commit on this branch. Do NOT push. (A third finding — wiring the nudge slot into `MattersHome` — is the lead's job at merge; do NOT touch `MattersHome.tsx` or `OnboardingBoard.tsx`.)

## Read first
- `src/features/intake/OnboardingTab.tsx` `copyLink` + `src/platform/intake/advisorIntakeLink.ts` `reconstructAdvisorIntakeLink({ intakeId, publicKeyRawB64 })` — the canonical way to get a working link when `intake.link` is absent.
- `src/platform/intake/intakeStore.ts` `partializeIntakeStateForPersistence` — confirms `link` is stripped from persisted state (so after restart, active intakes have no `link`, only `publicKeyRawB64`).
- `src/features/email/emailAuditLog.ts` (`setEmailAuditEmitter`) + how `App.tsx` registers it — mirror this for the nudge audit emitter.
- `src/platform/intake/nudgeAudit.ts` — your `setIntakeNudgeAuditEmitter`/`logIntakeNudgeAudit` (the emitter is only set in tests today).

## Fixes (do BOTH)

### [P1-1] The nudge draft must contain a WORKING onboarding link, even after restart — `src/platform/intake/nudgeDraft.ts` (~line 184)
Today the link merge field falls back to `''` when `intake.link` is absent. After an app restart the store strips `link`, so a drafted nudge would go out with NO onboarding link — defeating the nudge. Fix: when `intake.link` is missing, reconstruct it via `reconstructAdvisorIntakeLink({ intakeId, publicKeyRawB64: intake.publicKeyRawB64 })` (as `OnboardingTab.copyLink` does) before building/saving the draft. If no link can be produced at all (no `publicKeyRawB64`), do NOT save a linkless nudge — surface a clear error / block the save. Add a test: build a draft for an intake with `link` absent but `publicKeyRawB64` present → assert the draft body contains the reconstructed link; and the no-link case blocks/does not save. (Reconstruction may be async — thread it through the draft build/save path.)

### [P1-2] Register the intake nudge audit emitter in the app — `App.tsx` (+ `src/platform/intake/nudgeAudit.ts` if needed)
`logIntakeNudgeAudit` no-ops unless `activeIntakeNudgeAuditEmitter` is set, and nothing sets it outside tests — so in the real app every nudge intent/outcome row (and the AI-rewrite egress row) is silently dropped, breaking the compliance record. Fix: in `App.tsx`, register the intake-nudge audit emitter into the live Activity Log, mirroring exactly how the email audit emitter (`setEmailAuditEmitter`) and/or the matter audit emitter are registered there (same durable audit sink). Ensure it's set on mount and cleaned up like the others. If a small signature tweak to `nudgeAudit.ts` makes the App wiring match the email pattern, that's fine. Verify by inspection that a nudge save in the running app would now reach the same audit state the email drafts do; if feasible, add/extend a test asserting the emitter, once registered the way App does it, receives an intent row then an outcome row.

## Done bar
- No silent loss: a nudge is saved only with a working link, and every save writes its intent+outcome audit rows to the live log.
- No `mailSend`, ever. No restricted values / no email body in audit rows. Light theme, tokens, client/household copy, no em dashes, no time estimates.
- Do NOT touch `MattersHome.tsx`, `OnboardingBoard.tsx`, Lane-0 files, backend/, or intake-page/.
- GREEN before done: `npx vitest run src/features/intake src/platform/intake`; `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`. Commit on this branch with a clear message. Do NOT push.
