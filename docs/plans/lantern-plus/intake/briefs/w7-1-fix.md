# Wave 7 Lane 1 — Combined Fix Round

**Branch:** `lp/intake-w7-core` (same worktree as the original build, `/home/jameson/lp-w7-core`). Your prior commit `60f18b88 feat(intake): W7-LANE1-CORE-ROUTING receiver-owned requests` is already there. Work on top of it — do not start over.
**You are Codex, the builder.** Fix the findings below, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Context

Your original build was reviewed two ways: a lead diff read, and an independent adversarial `codex-review --base lp/intake-w7`. Both found the same core regression from different angles, plus three more issues. This is one combined fix brief — batch findings, no drip-feed. Fix all four below in one pass.

## Finding 1 (P1, confirmed two ways — fix this first, it's the most severe)

**A single transient ack failure can permanently stall an intake's entire inbox sync, and legitimate at-least-once redelivery gets misclassified as an attack.**

Root cause: in `src/platform/intake/useIntakeInboxSync.ts`, `syncOneIntake` wires `hasSubmission: () => Promise.resolve(false)` into `IntakeSyncClient` (around line 459-461 in your build), permanently disabling the sync client's own duplicate-detection fast path (`IntakeSyncClient.processSubmission`, `src/platform/intake/IntakeSyncClient.ts:186-192`, unchanged and still correctly tested by `IntakeSyncClient.test.ts`). That fast path used to catch a submission that was already successfully routed and remembered (`rememberSubmission` only fires *after* successful routing — check the sequencing in `IntakeSyncClient.ts:194-198` yourself before changing anything), flag it `'duplicate'`, and ACK it — which is both correct and necessary, because the relay can legitimately redeliver a submission whose ack was lost to a network blip.

With the fast path disabled, every such redelivery now falls through to `routeIntakeSubmission`, hits your new `options.intake.knownSubmissionIds.includes(submission.submissionId)` check, and gets rejected as `'integrity_mismatch'` with **no ack**. Look at `IntakeSyncClient.syncOnce()` (`IntakeSyncClient.ts:130-159`): when a submission's result has no `ackedCursor`, the loop returns immediately — it does not just skip that one submission, it **stops processing the rest of that page**. So one ordinary redelivery permanently blocks every later submission for that intake, on every future sync, forever (the same un-acked submission is fetched again next cycle, fails the same way, stops the loop again).

**Fix:** restore `hasSubmission` in `syncOneIntake` to its original behavior — read `useIntakeStore.getState().intakesById[intake.intakeId]?.knownSubmissionIds.includes(submissionId) ?? false` (this is exactly what it was before your build; git blame/diff `lp/intake-w7...HEAD~1` on this file to see the original). Then **remove** the `options.intake.knownSubmissionIds.includes(submission.submissionId)` check you added inside `routeIntakeSubmission` — it's now redundant (the sync client's pre-check handles real duplicates before `routeIntakeSubmission` is ever called for them) and, as built, actively harmful. `routeIntakeSubmission` itself should go back to assuming it's only ever called for a submission that hasn't been successfully routed before; it doesn't need its own duplicate awareness.

Add a regression test that specifically proves this: a submission that's already in `knownSubmissionIds` gets flagged `'duplicate'` and ACKed via the real `IntakeSyncClient` wiring (not just at the `routeIntakeSubmission` unit level — go through `syncOneIntake` or an equivalent integration point so the actual `hasSubmission` wiring is exercised), and that a *second, unrelated* submission on the same page still gets processed (proving the loop doesn't stall).

## Finding 2 (P1, from codex-review — real, but read the scope note before touching code)

**Firm-team devices can no longer receive any shared-intake submissions.** `discoverGrantedIntakes` (`useIntakeInboxSync.ts:550-597`, a **pre-existing Wave 5/6 function you did not write**) seeds a local `IntakeRecord` on a teammate's device with `items: []` and no `requestItems` at all — it only ever had the private ECDH key to work with, not the sealed checklist. Your new `contractItemOrFail` (`useIntakeInboxSync.ts:232-244`) now requires `intake.requestItems` to route anything, so every submission on a team-shared intake permanently fails with `'integrity_mismatch'` — worse, that also invokes the Finding 1 stall.

**Scope note:** this is a real bug, but it's a gap in a Wave 5/6 feature that Wave 7 doesn't own the file territory for, and root-causing it properly means understanding whether a teammate device has access to anything that lets it recover the real checklist (check `src/platform/intake/intakeKeyShare.ts` — its own comment says key-sharing distributes only the private ECDH key, not the link secret/token; check whether that's enough to fetch and decrypt the checklist bundle via `IntakeRelayClient`, and whether `IntakeRelayClient` even has a method for that today — as of your original build it does not: `createIntake`, `extendIntake`, `revokeIntake`, `regenerateIntake`, `fetchInbox`, `ackSubmission` only).

**What to actually do:** spend real investigation time here — this may need a new relay-client method plus a checklist-unseal call reusing `intakeCrypto.ts` primitives, or it may turn out the private key alone isn't sufficient and this needs a design decision outside this fix round's scope. Two acceptable outcomes, pick whichever is true:

- **If you can safely and correctly wire it** (real decrypt, not a guess): do it — populate `requestItems` on the seeded record once the checklist can be recovered, before it's used for routing.
- **If it genuinely needs a design decision or new backend surface you can't safely build in this pass:** do NOT invent a workaround that silently guesses the checklist contents. Instead, make the failure mode honest and non-alarming instead of a security-flavored dead end: give this specific case (`!intake.requestItems` on an otherwise-legitimate, actively-synced intake) its own distinguishable flag/message — something like "This device needs setup to receive shared intake responses" — clearly different from `'integrity_mismatch'`, which should keep meaning "someone tried to submit something that doesn't match the sealed contract." Do not ack (we must not lose the submission), but do not conflate a legitimate teammate-device setup gap with a client integrity violation either. Report which outcome you chose and why in your final message — this is a real product decision, not just a code question, and the wave lead needs to know which one happened.

## Finding 3 (P2, from codex-review)

**An advisor-supplied `requestSlug` isn't validated at creation time.** `createIntake.ts` (around line 58-60 in your build) stores `options.requestSlug` when a caller supplies one, without running it through `assertRequestSlug`. A bad value (spaces, `../`, mixed case) creates a live, sendable link that will then fail every file upload later (since `intakeRequestFolder`/`fileIntakeDocument` calls `assertRequestSlug` downstream and throws). Fix: validate (`assertRequestSlug(options.requestSlug)`) before the slug is used to build the local record, so a bad caller-supplied slug fails loudly at send time instead of silently breaking every future file for that request. Add a test: a caller-supplied slug with a space or a `../` segment throws before any local record or relay call happens.

## Finding 4 (P2, from codex-review — accepted as out of scope for this fix round, confirm and note only)

codex-review flagged that removing the client-page "Skip for now" button (`intake-page/src/App.tsx`) leaves no recovery path for an *already-issued* live link whose sealed checklist contains `pdf_fill`/`signature`. This product has not shipped to outside users yet (no real client-facing links exist in production), and the only blueprint that ships today (`newHouseholdTemplate.ts`) never included these item types, so there's no realistic already-issued link this affects right now. **Do not build anything for this finding.** Just confirm in your final report that you checked no built-in blueprint can produce a `pdf_fill`/`signature` item today, so this stays a documented, accepted risk rather than a silent gap.

## Self-converge requirement

Fix all of Finding 1, 3, and (per your judgment call, documented) Finding 2, then run every test in your original brief's acceptance list again, plus the new regression tests above, until everything passes. Do not stop on a red test.

## Checks to run (report exact pass/fail; every test invocation wrapped in a timeout)

```
timeout 300 npx vitest run src/platform/intake/intakeStore.test.ts src/platform/intake/requestFiling.test.ts src/platform/intake/useIntakeInboxSync.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts src/platform/intake/IntakeSyncClient.test.ts src/platform/intake/createIntake.test.ts
timeout 300 npx vitest run src/platform/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
timeout 300 npm --prefix intake-page test
timeout 120 npm --prefix intake-page run typecheck
```

## Finish

Amend nothing — create a NEW commit on `lp/intake-w7-core` with a conventional message containing the phrase `W7-LANE1-FIXROUND`. Do NOT push. Do NOT merge. Report exact check results, which outcome you chose for Finding 2 and why, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
