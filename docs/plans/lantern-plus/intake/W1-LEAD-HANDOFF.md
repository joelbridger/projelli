# Lantern Intake — Wave 1 Lead Handoff → Wave 2

**From:** the Wave 1 lead (Opus 4.8) session, 2026-07-10. **Reason:** Wave 1 DONE; context heavy; coordinator authorized a handoff before Wave 2.
**Read this + `W1-TRACKER.md` (the full record) + `W2-PREP.md` (the Wave 2 spec) to continue.**

## 1. Where things stand (Wave 1 = DONE, incl. the coordinator's hardening round)
- Branch **`lp/intake` @ `604dafdb`**, pushed, `HEAD == origin/lp/intake`, tree clean. (Was `fd9692cb`; the coordinator's independent Wave-1 pass then found 6 issues — 3 P1 incl. 2 wire-contract breaks — all fixed + the E2E test added + re-gated, merge `67962a45`.)
- **BIGGEST LESSON (Wave 2, apply from day one):** per-lane tests that MOCK the other side let two wire-contract breaks ship green (createIntake sent `token_b64` the relay didn't accept; the page called a `/chunks` route the relay never exposed). The fix was a TRUE end-to-end integration test (`backend/test/intake-e2e.test.ts`) that boots the real relay + real client crypto/submit + real advisor sync over real HTTP, no wire mocks. **For Wave 2, build the cross-lane E2E test EARLY (before merging the last lane), not after** — it's the only thing that proves the C↔B↔D contract actually connects. Also: the coordinator's independent adversarial pass is worth its weight — expect one and budget a hardening round after your own WORKER-DONE.
- All 5 Wave-1 lanes merged (A contracts+crypto `2942df73`, B relay `e828148e`, C client-page `f782a768`, D advisor-side `9a6990d5`, E hosting `b977b8cc`+`a639cd0e`), each lead-reviewed + one Codex adversarial pass; ~21 findings fixed + regression-tested; the C↔D page-seal + C↔E same-origin cross-lane bugs caught and reconciled.
- **Full `npm run gate` GREEN** (vitest 7208/0, cargo `--workspace`, typecheck, typecheck:tests, i18n completeness, eslint gate, token/handle guards). backend `bun test` 211/0 (incl. standing privacy-proof). intake-page Playwright+axe 13/13.
- Docs folded in: W2-PREP, W7-PREP, W1-BENCH-RUNBOOK, INTAKE-IT-PACK. Bench Hard Stops reviewed — compatible.
- **The complete lane-by-lane record, every finding, and all gotchas are in `W1-TRACKER.md`. Read it.**

## 2. Coordinator's two standing items (DO NOT FORGET)
1. **The coordinator's final independent Wave-1 pass runs in parallel.** Any findings arrive to you as a **fix round** (like Track 2's) — handle with the same batch-findings ritual: collect all, one combined Codex fix brief per area, verify, merge, re-gate.
2. **BENCH is BLOCKED:** the Legion phone-browser bench (per `W1-BENCH-RUNBOOK.md`) waits until the **demo practice indexing finishes**. **DO NOT deploy to the Legion / run the bench yet.** The coordinator will release it.

## 3. Wave 2 — what to build (from `W2-PREP.md` — READ IT FIRST)
Wave 2 = the Onboarding **board** + **nudge engine** + **link-lifecycle UI**, all riding Wave 1's rails (PRODUCT-DESIGN §4/§8, WAVE-PLAN Wave 2). Lanes are decomposed in `W2-PREP.md` with a nudge copy pack. Same ritual as Wave 1:
- Write the executable plan (`W2-EXEC-PLAN.md`) + per-lane Codex briefs (**prompt-from-file** — see §4).
- Dispatch Codex lanes (own worktree per lane off `lp/intake`), liveness-watched.
- Your diff review + one `codex-review --base lp/intake` adversarial pass per lane (different Codex call).
- Fix findings (batch), merge `--no-ff`, run the gate, push.
- Keep `W2-TRACKER.md` current (copy the W1-TRACKER shape — it worked well).

## 4. HARD-WON LESSONS (these will bite you if you don't apply them)
- **Dispatch Codex with prompt-FROM-FILE, never inline-expanded.** Briefs contain backticks/quotes/`$()` — an outer shell executes/breaks them silently. Pattern: write the full prompt to a file, then `nohup bash -c "codex exec --cd $WT --sandbox danger-full-access --skip-git-repo-check \"\$(cat $PF)\" < /dev/null >> $LOG 2>&1; echo DONE-EXIT:\$? >> $LOG" &`. Verify: `grep -c "<distinctive backtick phrase>" $LOG`. (See memory `project-codex-prompt-from-file`.)
- **`codex-review` can RESET the worktree during live-probing** (it ran servers/git in-worktree and wiped my uncommitted fix edits TWICE). So: do fixes on a CLEAN worktree with NO codex-review running in it, and **commit fixes immediately** before dispatching anything else there.
- **`codex-review --base <ref>` takes NO custom prompt** (scope+prompt are mutually exclusive in the wrapper). Use the bare `--base lp/intake` form; it reviews the branch diff adversarially by default.
- **The scoped per-lane tests MISS quality-gate checks.** Every lane passed its scoped vitest/cargo but the FULL gate later caught: ESLint regressions (`lantern-async/no-silent-failure`, `lantern-i18n/no-hardcoded-string`), token-guard (hard-coded hex → design tokens), **i18n locale parity** (new en.json keys MUST be added to de.json + es.json AND the `en-json-snapshot.test.ts` namespace-inventory + counts updated), and architecture-boundaries (declare new cross-feature edges in `tests/unit/architecture-boundaries.test.ts`, e.g. the `matters->intake` edge I added). **Budget a "gate-fix round" after the last lane merges — it's normal, not a surprise.**
- **Watchers via background Bash get reaped;** use the **Monitor tool** (survives) for completion/liveness. Poll logs directly if a monitor dies.
- **Resource flakes under the concurrent gate:** heavy tests that spawn real builds inside vitest hit `ERR_INSUFFICIENT_RESOURCES`; the fix pattern is pre-build the artifact serially in `gate.sh` + reuse it in the test (see the intake-hosting test fix). Backend `bun test` can flake right after the gate (211/0 in isolation).
- **Cross-lane seams are the lead's job** — the isolated adversarial reviews can't see them. For Wave 2 watch: board state shape vs `intakeStore` (Wave 1 contract), nudge sending through the advisor's own mailbox rails (`mail_save_draft`), and any new feature→feature import edge.

## 5. Environment landmines
- **One cargo compile at a time, box-wide.** Other efforts (Track 2: `lp-t2-*`) also build here — their Codex jobs share the cargo lock (a blocked one self-aborts exit 144). Serialize any cargo with the gate.
- **Fresh `lp-*` worktrees lack `src-tauri/binaries/*` (piper/espeak/ggml) AND may lack OCR wasm** → cargo build-script fails / pre-push hook ENOENT. Fix: `cp -a ~/lp-ux-integrate/src-tauri/binaries/. <wt>/src-tauri/binaries/` (and `public/ocr/*` if missing). Symlink `node_modules` from `~/lp-intake` (and `intake-page/node_modules`) into lane worktrees to skip installs.
- **Known baseline cargo flake:** `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` fails under parallel `cargo test --workspace`, passes in isolation. Not intake; re-run in isolation if it appears.
- Consumed Wave-1 lane worktrees still exist (`~/lp-w1-A..E`, `~/lp-w1-Efix`, `~/lp-w1-qfix`) — merged, prunable with `git worktree remove`.

## 6. Copy-paste bootstrap prompt for the fresh Wave 2 session
```
You are the LANTERN INTAKE WAVE 2 LEAD (Opus 4.8 · high), continuing a handed-off effort in worktree /home/jameson/lp-intake on branch lp/intake (@ origin, gate-green). Wave 1 (the honest E2EE onboarding slice) is DONE and merged.

READ FIRST, in order:
1. docs/plans/lantern-plus/intake/W1-LEAD-HANDOFF.md  (this handoff — lessons, landmines, coordinator's standing items)
2. docs/plans/lantern-plus/intake/W1-TRACKER.md  (full Wave-1 record + every gotcha)
3. docs/plans/lantern-plus/intake/W2-PREP.md  (the Wave 2 spec: board + nudge engine + link-lifecycle lanes + nudge copy pack)
4. docs/plans/lantern-plus/intake/{WAVE-PLAN.md (Wave 2 section), PRODUCT-DESIGN.md §4+§8, ARCHITECTURE.md, RISKS.md}

Then: write docs/plans/lantern-plus/intake/W2-EXEC-PLAN.md (per-lane TDD tasks, file structure, VERIFY register) + per-lane Codex briefs, and dispatch Wave 2 with the SAME ritual as Wave 1 (Codex builds via prompt-FROM-FILE + DONE-EXIT sentinel + Monitor-tool liveness watch; your diff review + one `codex-review --base lp/intake` adversarial pass per lane; batch findings into one fix round per lane; merge --no-ff; npm run gate; push; keep W2-TRACKER.md current). Budget a gate-fix round after the last lane (ESLint/token-guard/i18n-locale-parity/architecture-boundaries — the scoped tests miss these).

STANDING ITEMS FROM THE COORDINATOR:
- The coordinator's independent Wave-1 pass runs in parallel; its findings arrive to you as a fix round — handle like any fix round.
- The Legion BENCH is BLOCKED until demo practice indexing finishes — do NOT deploy to the Legion or run W1-BENCH-RUNBOOK yet; the coordinator releases it.
- You are a worker driven by the coordinator over tmux: NO interactive menus; surface decisions as plain text prefixed "COORDINATOR:"; DONE means pushed + HEAD==origin; print "LANE-MERGED: <slug> <sha>" per lane and "WORKER-DONE: lp/intake" only when Wave 2 is fully merged + gate-green + pushed.
Communicate in plain everyday language to Jameson (he is a product designer, not an engineer).
```

## 7. What Wave 1 delivered (one paragraph, plain)
An advisor presses New client, composes the locked checklist, and sends one link; the client fills it on their phone through a page that encrypts every answer and document in their own browser; the sealed data round-trips through a server that holds no key; the advisor's machine decrypts locally, files documents into the client's folder, writes secrets into an encrypted store, and shows progress on an Onboarding tab. Provably private, cited, real.
