# Lantern Intake — Wave 3 Lead Handoff (mid-wave, Lane 1 in flight)

**From:** the Wave 2 lead (Opus 4.8) session, 2026-07-10. **Reason:** context ceiling reached mid-Wave-3; Wave 3 is security-critical and a fresh session reviews it with fresh eyes.
**Read this + `W3-TRACKER.md` + `W3-EXEC-PLAN.md` (§0 = 12 questions resolved) + `W3-PREP.md` (the spec + matcher acceptance criteria) to continue.**

## 1. Where things stand
- **Wave 2 + coordinator final-pass fixes: DONE, merged, gate-green, pushed.** `lp/intake` reached `30f5f47a` clean; `WORKER-DONE: lp/intake` was printed (board + nudges + link-lifecycle + the live inbox sync that makes them real; every finding from 3 review passes fixed + tested). Wave 2 does not need more work.
- **Wave 3 branch state:** `lp/intake` @ `f651c51a` pushed (HEAD==origin) — this holds all Wave-3 PLANNING docs (W3-PREP, W3-EXEC-PLAN, W3-TRACKER, Lane-1 brief + fix brief). No Wave-3 CODE is merged to `lp/intake` yet.
- **Wave 3 Lane 1 (ingest+match — the ONLY Rust lane, the blocker): BUILT + reviewed, FIX ROUND IN FLIGHT.**
  - Build commit `354db44a` on branch `lp/intake-w3-1`, worktree `~/lp-w3-1`. 3944 insertions (mail-rail auth/attachment Rust + the deterministic TS matcher).
  - Lead verify PASS (vitest 90/90 src/platform/intake, tsc clean, eslint-gate clean). Lead read the security core closely — **sound + fail-closed** (see `W3-TRACKER.md` "Lane 1 review").
  - `codex-review` (mis-filing focus) found **2 real issues the lead missed** → fix round `briefs/w3-1-fix.md` is **BUILDING NOW** via Codex in `~/lp-w3-1`. Log: `/tmp/claude-1000/-home-jameson-lp-intake/73a13555-9703-4f92-85f1-e2c3fb0a7c6d/scratchpad/w3-1-fix.log`. Anchored sentinel watch: `tail -f LOG | grep --line-buffered -E "^DONE-EXIT:[0-9]+$" | sed -u '/^DONE-EXIT:[0-9]/q'`. Fix distinctive phrase: `W3-LANE1-FIX-SENDER-FAILCLOSED`.
  - The 2 findings being fixed: **[P1]** M365 Graph sync didn't fetch `internetMessageHeaders` → every Outlook reply stored `authResult: missing` → matcher quarantines ALL M365 replies (feature quarantine-only for the primary provider). **[P2]** sender parse trusted the first `<...>` and ignored trailing text → `Evil <sarah@x> <attacker@evil>` parsed as sarah (spoof-gate bypass) → must fail closed.

## 2. FIRST TASKS for the continuing session (in order)
1. **When the Lane-1 fix finishes** (`^DONE-EXIT:0$` in `w3-1-fix.log`): verify at `~/lp-w3-1` — confirm the phrase, then INDEPENDENTLY run `npx vitest run src/platform/intake` + `cargo test -p lantern --lib commands::mail -- --test-threads=1` (SERIAL — the `backfill_marker_set_is_idempotent_and_clearable` flake passes in isolation, NOT intake) + `npx tsc --noEmit` + `node scripts/eslint-gate.mjs`. Read the two fixed spots (graph.rs auth-header fetch; emailAddressMatch.ts extractAddress fail-closed) to confirm correctness. Optionally one more `codex-review --base lp/intake` if the fix is large.
2. **Merge Lane 1** into `lp/intake` (`git merge --no-ff lp/intake-w3-1`). NOTE: the lane branched off `8fac6c98` (before the tracker commits), so its diff shows W3-TRACKER as "removed" — that's a branch-point artifact; the 3-way merge KEEPS lp/intake's tracker (the lane didn't touch it). Verify the tracker is intact post-merge.
3. **Run `npm run gate`** (Lane 1 has Rust → cargo runs; SERIALIZE it, one compile box-wide). The only expected failure is the known mail flake (passes in isolation). Push (`git push origin lp/intake`; the pre-push hook runs typecheck + full vitest, ~2 min). `LANE-MERGED: ingest-match <sha>`. Update W3-TRACKER.
4. **Write `briefs/w3-2-proposal-cards.md` and `briefs/w3-3-quarantine.md`** (both scoped in `W3-EXEC-PLAN.md` §3) and fan out Lanes 2 (proposal cards + accept path) then 3 (quarantine), SAME RITUAL, off the merged Lane-1 tip. Merge 2 then 3.
5. **Gate-fix round** after Lane 3 (ESLint / token-guard / i18n-locale-parity / architecture-boundaries — scoped tests miss these). Then `WORKER-DONE: lp/intake`.

## 3. HARD-WON LESSONS (apply from day one)
- **The `codex-review` adversarial pass caught the deepest bug on EVERY lane across Waves 2 and 3** — contract breaks, unreachable features, mirror-gaps, the M365-quarantine break, the spoof-parse bypass — all things the lead diff-read + scoped tests MISSED. NEVER skip it; for Wave 3 point it at **mis-filing attacks** (spoofed sender, look-alike/plus-alias/display-name-only, missing-auth-must-quarantine, replies vs completed/revoked intakes, untrusted-body prompt-injection). Batch all findings into ONE fix round per lane ([[feedback-batch-findings-one-fix-round]]).
- **Monitor sentinel filters MUST be anchored** `^DONE-EXIT:[0-9]+$` — a loose `DONE-EXIT` false-fires on echoed brief prose ("...the DONE-EXIT sentinel") and `sed -q` kills the watcher mid-build. ([[project-monitor-anchor-done-sentinel]]) Stale monitors for finished jobs keep firing timeouts — ignore; act only on the active id.
- **Dispatch Codex prompt-FROM-FILE, never inline** (backticks/quotes corrupt it). ([[project-codex-prompt-from-file]]) Pattern: `nohup bash -c "codex exec --cd $WT --sandbox danger-full-access --skip-git-repo-check \"\$(cat $PF)\" < /dev/null >> $LOG 2>&1; echo DONE-EXIT:\$? >> $LOG" &`. `codex-review --base lp/intake` takes NO custom prompt (bare form); run it on a CLEAN committed worktree (it can reset during live-probing — you have no uncommitted edits so it's safe).
- **One cargo compile at a time, box-wide** (other efforts share the lock; a blocked job self-aborts exit 144). Serialize any cargo with the gate. Known baseline flake `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` (`Some("1")` vs `None` under parallel cargo; passes in isolation; NOT intake).
- **Fresh `lp-*` worktrees** need sidecar binaries (`cp -a ~/lp-ux-integrate/src-tauri/binaries/. <wt>/src-tauri/binaries/`) or the cargo build-script + pre-push hook fail; symlink `node_modules` (root + `intake-page`) into each lane worktree. Use `--no-verify` on push ONLY for docs-only commits.
- **The verification honesty rule bit twice:** Codex's "checks passed" claim was true, but the lead must STILL read the security core + run the gate — the adversarial pass found what green tests didn't. Evidence before assertions.

## 4. Non-negotiables (from W3-EXEC-PLAN §1)
Never silently filed (audit intent BEFORE effect, outcome after; intent-fail refuses the write). The MODEL never chooses client/request/item/path/recipient — CODE does. Email body is untrusted (sanitize before any prompt; never controls an identifier/path). Deterministic gate BEFORE AI; failed/missing auth or ambiguity → quarantine (no tier, no preselect, no one-click). Non-E2EE channel labeling everywhere email-reply data appears. Restricted values masked, SQLCipher-only, never in ordinary state or audit rows. Light theme, tokens, client/household copy, no em dashes, no time estimates, `matter`/`matter_id` never renamed.

## 5. Coordinator standing items
- **Legion BENCH is coordinator-gated** (demo indexing) — do NOT deploy to the Legion or run any bench until released. V10 (real-mailbox spoof / look-alike / reply-vs-completed attack round) is post-WORKER-DONE.
- "Keep the relay moving" — dispatch the next lane as soon as the prior merges; don't idle.
- You are a WORKER driven by an AI coordinator over tmux: NO interactive menus; surface decisions as plain text prefixed "COORDINATOR:"; DONE means committed + pushed + HEAD==origin. Communicate to Jameson in plain everyday language (he is a product designer, not an engineer).

## 6. Copy-paste bootstrap prompt for the fresh Wave 3 session
```
You are the LANTERN INTAKE WAVE 3 LEAD (Opus 4.8 · high), continuing a handed-off effort in worktree /home/jameson/lp-intake on branch lp/intake (@ origin, gate-green). Waves 1 and 2 (+ coordinator fixes) are DONE and merged. You are a WORKER driven by an AI COORDINATOR over tmux: NO interactive menus; surface decisions as plain text prefixed "COORDINATOR:"; DONE means committed + pushed + HEAD==origin. Communicate to Jameson in plain everyday language (product designer, not an engineer).

READ FIRST, in order:
1. docs/plans/lantern-plus/intake/W3-LEAD-HANDOFF.md   (this file — current state, in-flight Lane-1 fix, first tasks, lessons)
2. docs/plans/lantern-plus/intake/W3-TRACKER.md
3. docs/plans/lantern-plus/intake/W3-EXEC-PLAN.md      (§0 = 12 open questions RESOLVED; lanes; VERIFY; ritual; landmines)
4. docs/plans/lantern-plus/intake/W3-PREP.md            (spec + deterministic-matching acceptance criteria = the Lane-1 tests)
5. docs/plans/lantern-plus/intake/briefs/{w3-1-ingest-match.md, w3-1-fix.md}

IMMEDIATE: Wave-3 Lane 1 (ingest+match, the Rust blocker) is BUILT (commit 354db44a, branch lp/intake-w3-1, worktree ~/lp-w3-1) and its FIX ROUND (briefs/w3-1-fix.md: M365 auth-header fetch + sender fail-closed) is BUILDING via Codex — watch /tmp/claude-1000/-home-jameson-lp-intake/73a13555-9703-4f92-85f1-e2c3fb0a7c6d/scratchpad/w3-1-fix.log for `^DONE-EXIT:0$` (ANCHOR the filter). When done: verify (vitest src/platform/intake + cargo commands::mail SERIAL + tsc + eslint-gate; read the 2 fixed spots), merge --no-ff into lp/intake, run npm run gate (serialize cargo; the backfill_marker flake passes in isolation), push, LANE-MERGED. THEN write briefs/w3-2-proposal-cards.md + briefs/w3-3-quarantine.md (scoped in W3-EXEC-PLAN §3) and fan out Lanes 2 then 3 (SAME RITUAL: Codex build prompt-from-file → lead diff review → ONE codex-review --base lp/intake with MIS-FILING focus → batch findings → one fix round → merge --no-ff → gate → push). Gate-fix round after Lane 3, then WORKER-DONE: lp/intake.

STANDING: Legion BENCH is coordinator-gated — do NOT bench/deploy until released. Keep the relay moving. The adversarial codex-review pass is MANDATORY per lane (it caught the deepest bug on every lane so far). Anchor monitor sentinels. One cargo at a time. Fresh worktrees need sidecar binaries + node_modules symlinks.
```

## 7. What Wave 3 will deliver (one paragraph, plain)
A client can just REPLY to the advisor's normal email — attach the license photo, type the income number — and it flows into onboarding safely: the app checks the reply is genuinely from that client and passes email-authenticity checks (spoofs and look-alikes go to a quarantine holding area, never auto-filed), then shows the advisor a review card to accept, which files the document and records the fact with a clear "came in by email" label and a full audit trail. Nothing is ever filed without the advisor's explicit approval.
