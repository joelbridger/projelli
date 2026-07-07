# Relay: coordinator-10 → coordinator-11 (written 2026-07-07, at session wrap)

You are **cc-lantern-coordinator-10's successor (coordinator-11)** for the lantern-plus fork. NO product code from you except small gate repairs — Codex builds EVERYTHING (Jameson's standing token-economy directive; Claude tokens are scarce, Codex is free). You are the SOLE merge gate. Comms with Jameson: explain like he's 10 (his 3rd correction) — short sentences, everyday words, never a codename/path/command as the subject of a sentence.

## ⚡ IMMEDIATE first actions (an in-flight handoff — do these in order)
1. **A Codex hygiene job (`lp-hygiene` tmux session) is running IN ~/lantern-plus itself** (log: `$SCRATCHPAD/hygiene.log` of the OLD session — instead just `tmux capture-pane -t lp-hygiene` and check `~/lantern-plus` git state). It is making the gate green after 3 locally-merged feedback rounds (scroll-sweep, send-defaults, settings-infohelp; plus earlier-merged docs-tabs, map-autopopulate, cited-pill, clientmap-header — those 4 are already PUSHED). When it finishes: verify `npm run gate` is GREEN yourself (run it in a tmux session, NEVER as a harness background task — those get killed; NEVER pipe the verdict into a push command — read verdict first, push in its OWN command, then `git ls-remote` verify).
2. Push `lantern-plus` (contains: scroll-sweep + send-defaults + settings-infohelp merges + hygiene commit + this relay).
3. **Sync the Legion** to the pushed tip: `bash scripts/legion-sync-launch.sh` in a tmux runner writing to a log; its 10-min poll usually times out during Rust rebuilds — that's NOT failure; watch CDP 9223 with a patient 50-min loop (`Invoke-WebRequest http://127.0.0.1:9223/json/version` over ssh james@100.127.67.22). App log on Legion: `C:\tauri-dev2.log` (NOT tauri-dev.log — that one is locked by a dead zombie handle; if launches die instantly with LastTaskResult=1, a process holds the log — point run-dev.bat at a fresh log name). ALWAYS freshness-probe before declaring ready (fetch a new-code module via the vite port and confirm 200 / probe a new symbol over CDP).
4. **notify-jameson** (email+telegram) that his laptop has the complete feedback batch. He is ACTIVELY live-testing and sending feedback batches — that's the main loop now.
5. Re-arm the fleet finish-watch monitor if you spawn cc-lantern-* workers (`coordination/tools/lantern-finish-watch.sh`). The idle-capacity heartbeat is deliberately OFF (token economy).

## 🎯 Where the mission stands
- **Demo: POSTPONED by Jameson** until the UI meets his bar. The old "Legion pinned at abcedeb0" freeze is LIFTED; the Legion is the live test bench Jameson drives personally. Demo re-certification happens later on whatever tip it ends at.
- **Everything shipped so far (all strict-gate green, remote-verified):** the 15-branch merge window (swallow-p0 data-safety fix live-proven on real Windows; dark-theme kill; etc.) → keepance→lantern rename (code + server folders; app is 'lantern' inside; dev data reset done) → UI Iteration System (handles/token/tier/robot foundation) → ALL 8 UI overhaul rounds (R1-R8 from his 2026-07-06 feedback markdown, 100% verified line-by-line incl. the recovered items) → all 3 meeting features (MF0 calendar-link, MF1 per-artifact recipients, MF2 reviewed send, MF3 opt-in calendar auto-join first slice) → 7 live-testing feedback fixes (docs-in-tabs+single header row, map auto-populate replacing the yellow tray, clickable cited pill, scroll-everywhere sweep + robot guard, send-to-everyone defaults + exclude UI + groups, client-header icons (download/sync/history) + Activity tab retired into history panel, settings instant-hover info icons everywhere).
- **The working rhythm (proven, keep it):** Jameson tests on the Legion → sends a feedback batch → you turn each item into a precise Codex round (fresh branch, worktree, TDD, ui-system guards) → adversarial Codex review → ONE combined fix round (batching doctrine, WORKER-DISCIPLINE 🧺) → you gate (npm run gate in tmux) → merge → push → batch Legion update → ping him.

## 🔧 Operating mode (hard rules from this shift's incidents)
- **Codex-task invocations:** ALWAYS write the prompt to a file in your scratchpad and `codex-task "$(cat file)"` — inline quoting breaks; stdin closed `< /dev/null`; output to a log ending `echo DONE-EXIT:$? >> log`; run in a DEDICATED tmux session named lp-<job>; Monitor greps the sentinel. NEVER let a Codex job run `git checkout -b` or branch-switch in ~/lantern-plus (it hijacked the coordinator checkout once — worktrees only: `git -C ~/lantern-plus worktree add -b <branch> ~/lp-<name> origin/lantern-plus`, and tell the job it works in that worktree). Exception that works: gate-hygiene jobs that commit ON the current branch in ~/lantern-plus with explicit do-not-rebase/pull/push instructions.
- **Push discipline (violated 3x by me — don't repeat):** read the gate verdict in one command; push in a SEPARATE later command; `git ls-remote` verify after every push. Never chain `&& git push` after a gate/grep.
- **Gates:** `npm run gate` is the bar (typecheck incl. tests + i18n + full vitest + eslint-gate + handle/token guards + cargo). Run it inside tmux (harness background tasks get killed mid-gate). Recurring hygiene reds after UI rounds: i18n leaf-key count + namespace snapshot (set TRUE count, honest comment, `vitest -u` that file only), handle-guard baseline folds, kebab-case keys, test-file typing — batch them to one Codex hygiene round. No em dashes in i18n strings (house rule, tested).
- **One cargo compile at a time** box-wide (blocked Codex self-aborts exit 144). Rust jobs share the warm CARGO_TARGET_DIR.
- **tmux to workers:** long pastes need an extra C-m ("paste again to expand"); always capture-pane to confirm submission.
- **Batching doctrine (Jameson-approved):** collect ALL findings on a branch → ONE combined fix round; re-review once after; further rounds only for NEW bugs the fix introduced.

## 🗺️ Key paths
- Plans: `coordination/UI-OVERHAUL-ROUNDS-PLAN.md`, `coordination/MEETING-FEATURES-PLAN.md`, `coordination/FOLDER-CLEANUP-RENAME-PLAN.md` (done).
- Reports (all prep/investigations live here): `coordination/reports/` — esp. `meetings-features-brainstorm.md` (MF designs incl. the deferred TRUE unattended auto-send toggle + MF3 later slices), `meetings-r7-investigation.md`, `final-seam-hunt.md`, `stalebundle-investigation.md`, `ask-scope-semantics.md`.
- His feedback source: `docs/APP FEEDBACK 07-06-2026 503 PM MST.md` (fully implemented). Later feedback came via chat (all implemented through the FB rounds above).
- Doctrine: `coordination/WORKER-DISCIPLINE.md`. Status history: `coordination/STATUS.md` (add your entries). Product journey: `docs/PRODUCT-JOURNEY.md` (major decisions only).
- Gallery artifact (same URL every redeploy, he knows the tab): https://claude.ai/code/artifact/310a5655-ea3a-408c-9ae8-facece4dd139 — robot-capture screenshots (codex job: npm run dev + scripts/robot verbs → PNGs → rebuild tip-gallery.html w/ base64 → Artifact tool, favicon 🖼️).
- Full backup (pre-UI-overhaul rollback point): `~/archive/lantern-plus-backup-20260706-uiapproved` + `/mnt/backup/lantern-plus-archive/` + tags on GitHub. Backup tags `backup/pre-*` at every merge.

## 🖥️ Benches
- **Legion** (james@100.127.67.22): Jameson's live test machine. Drive via scripts/desktop-drive.mjs / legion-drive.sh; CDP 9223, vite 5173 (IPv6 [::1] often the one that answers). Don't restart it under him while he's testing.
- **Cloud bench-1** (lantern-cloud-bench-1, rg lantern-bench): WORKING again — tailscale rejoined; smoke on the tip was 3 PASS / 0 FAIL / 9 setup-blocked (unstaged accounts). Deallocated. bench-2: still tailscale-logged-out (same browser-key flow revives it: Jameson's Tailscale login persists in the server Chrome — chrome-cdp to login.tailscale.com/admin/settings/keys → key → az vm run-command tailscale up → revoke key after).
- Azure: az CLI authed; auto-shutdown 02:00 PT; deallocate when done; never buy anything.

## 🔒 Locked constraints
Never rename matter/Matter/matter_id (wire facade; user-facing copy says client). Light theme only. Local-first/per-client isolation sacred — client-scoped saves land in the client's workspace. AI docx author = "Advisor Prep Hero AI". MF2 send stays REVIEW-GATED until Jameson explicitly OKs unattended auto-send. MF3 auto-join: fail-closed (fresh calendar sync before join; never join unseen/disabled/cancelled). No cloud transcription. Never release/deploy. Real-money = Jameson only.

## 📋 Open items
- (in-flight) hygiene → push → Legion sync → notify (steps 1-4 above).
- Task #19: a full Legion whole-tip robot smoke (bench-smoke.mjs --target legion) when Jameson isn't using the laptop.
- NEED-JAMESON, non-blocking: Outlook security code on the Legion (deferred to post-demo by agreement).
- Deferred by design: MF2 unattended auto-send toggle; MF3 later slices (see brainstorm report); demo re-certification after UI work settles; the 5 setup-blocked bench smoke checks want staged accounts someday.
- Codex usage limits exist (hit once, ~4h reset; Jameson sees more budget than the error claims — just retry once before parking).

## Fleet/monitor state at handoff
tmux: lp-hygiene (running — YOUR first responsibility), various dead lp-* runner sessions (kill freely). No cc-lantern-* workers. All monitors die with my session — the hygiene job must be picked up by pane-watching or a fresh Monitor.
