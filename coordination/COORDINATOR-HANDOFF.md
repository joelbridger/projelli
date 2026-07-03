# LANTERN-PLUS COORDINATOR HANDOFF — read fully, then continue the mission

*Written 2026-07-02 by the founding coordinator (Fable, end of a full planning+launch day).
You are the Lantern-Plus coordinator: Fable 5 · high effort (xhigh only at merge/review
gates). You do NO product work yourself — spawn and manage workers (Sonnet 5 default,
Opus 4.8 `'claude-opus-4-8[1m]'` only for correctness-critical lanes with a stated reason,
NEVER Fable workers). You merge; workers never do.*

## Read order (before acting)
1. `~/keepance-coordination/coordinator/PLAYBOOK.md` — fleet technique (commandments, monitoring, merge ritual, model routing §7, self-respawn §6.1). It is written for the MAIN fleet; you inherit its technique but NOT its mission/board.
2. `~/lantern-plus/docs/plans/lantern-plus/PARALLEL-OPERATIONS.md` — BINDING coexistence rules with the main-line coordinator (scope walls, one-way merge valve, Legion reservation, cargo dirs).
3. `~/lantern-plus/coordination/STATUS.md` — the live board (update it as you go).
4. `~/lantern-plus/LANTERN-PLUS.md` + `docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md` — mission, waves, gates, cross-wave contracts.
5. `~/keepance-coordination/PARALLEL-EFFORTS.md` — the shared bulletin (append your session start; read for main-line news).
6. Memory: `~/.claude/projects/-home-jameson/memory/project_keepance_jump_feasibility.md` — the full program history in one file.

## Mission
Execute Waves 0→4 of the Jump feature-parity program per the wave plans in
`docs/plans/lantern-plus/` (~95 TDD tasks, twice Codex-reviewed, design-approved by
Jameson). ALL waves build BEFORE advisors see anything (his explicit override). UI work
is bound by `2026-07-02-UI-INTEGRATION-SPEC.md` + the approved prototypes in
`docs/design/lantern-plus-prototypes/` ("matches the prototype" = acceptance; screenshot
evidence + click-counts in merge notes; send UI screenshots to Jameson via notify-jameson
at each UI merge — his veto = P0 follow-up, not a merge block). Phase 2 =
`docs/plans/lantern-plus/phase-2/` briefs ONLY — never build from them (see its README).

## Current state (as of handoff)
- **Repo:** `~/lantern-plus`, branch `lantern-plus` @ `be3f5f28` (merge of keepance-3.0
  @7656f6c3), pushed. Gate GREEN on the merged tree: tsc ✅, vitest ✅ (exit 0), cargo
  check ✅ (7m cold, now warm) on `CARGO_TARGET_DIR=~/.cargo-target-lantern-plus`.
- **Fleet (both Sonnet 5, spawned from briefs in `coordination/briefs/`):**
  - `cc-lantern-w0` in worktree `~/lp-w0` (branch `lp/wave-0`): executing ALL 13 Wave 0
    tasks. Last seen: Task 1 in progress, waiting on its first cargo test build (using the
    shared effort target dir — correct). One stuck queued message was fixed by sending
    Enter; watch for that failure mode.
  - `cc-lantern-w1` in worktree `~/lp-w1` (branch `lp/wave-1`): scoped to Wave 1 Task 1
    (Google OAuth submission PACK doc — the filing itself is Jameson's) + Tasks 2–7 ONLY
    (Rust calendar module). Do NOT let it start TS/UI tasks 8+ yet.
- **Monitors — SEVEN, and ⚠️ THE LIST IS A CHECKLIST, NOT A MENU** (this session skipped
  two at startup; both misses cost real time: a 37-min undetected hang, and a startable
  Wave-2-UI lane that sat idle for hours until Jameson prompted). Re-arm ALL at YOUR start
  (the old session's monitors die with it), then do a BASELINE manual sweep immediately
  (watchers only see the future):
  (1) fleet watcher: `coordination/tools/lantern-finish-watch.sh` (DONE on fresh
  `WORKER-DONE:` in last 45 pane lines after WORKING→IDLE — tell workers to print the
  sentinel LAST; ACK_IDLE otherwise; STALL on frozen WORKING pane ~4min);
  (2) RAM watchdog + disk-pressure alarm <25G (after the 2026-07-02 disk-full emergency);
  (3) bulletin watcher: `tail -n 0 -F ~/keepance-coordination/PARALLEL-EFFORTS.md | grep -v
  <your-own-signature>` — main-fleet news (Legion release, tags, rebrand) pings you live — then VERIFY it end-to-end by appending a selftest line (non-your-signature) and waiting for the ping; a silently-dead watcher looks identical to a quiet bulletin (a rename heads-up was missed this way 2026-07-03);
  (4) STALE-IDLE backstop: any worker pane idle+unchanged >5min → one ping (caught the
  37-min hung test the transition watcher structurally cannot see);
  (5) BUILD-OVERTIME: cargo/rustc >35min or a test binary from our target dirs >15min →
  ping (match on comm= fields + /proc/pid/exe, NOT parsed args); workers also wrap every
  cargo test in `timeout 1200 …`;
  (6) PARALLEL-CHECK heartbeat: 15-min tick forcing the ritual "anything unblocked not
  running? did a lane just commit something another lane can build on?";
  (7) gate-cargo completion monitors are per-merge (grep the GATE-CARGO-EXIT line).
  Run long gate cargo in the `lp-gate-build` tmux session, NEVER via a backgrounded Bash
  call (the tool's 10-min ceiling kills it).
- ⚠️ COMMIT COORDINATION-DOC EDITS IMMEDIATELY. They live on the same tree as merges — a
  merge rollback (`git reset --hard <backup-tag>`) DISCARDS uncommitted handoff/STATUS
  edits silently (happened 2026-07-03: monitor notes + a landmine section were lost and
  had to be reconstructed). Edit → commit, every time.
- ⚠️ PHANTOM/STALE QUEUED TEXTS in worker input boxes (all night 2026-07-03): unsubmitted
  bubbles that read like coordinator go-aheads (often Jameson's own typing — see playbook
  queued-bubble rules). One falsely claimed a half-copied cargo cache was ready. Protocol:
  C-u (after Escape) before every send-keys; glance at input lines after events; gate
  irreversible go-aheads behind a token phrase in a DELIVERED message (RESUME-TOKEN-LP1
  pattern); long messages STICK as [Pasted text] and can silently vanish — write detail to
  a file in the worker's worktree and send a one-line pointer instead.
- **Merge queue:** empty. Merge order: Wave 0 first, then Wave 1 in batches. One merge in
  flight ever. Merge ritual per playbook §4 + master plan: backup tag → codex-review →
  merge --no-ff → npm run gate FOREGROUND (export the CARGO_TARGET_DIR!) → red = rollback
  → push --no-verify. Rust merges only when no worker cargo is running (cross-worktree
  incremental-cache corruption is real — playbook §7).

## Next steps, in priority order
1. Re-arm monitors + baseline sweep (above). Append session-start to the bulletin.
2. Ride w0 + w1 to WORKER-DONE: review (verify each Codex finding against HEAD), gate,
   merge Wave 0 → then release w1's remaining scope (tasks 8+) or spawn a fresh Wave 1 UI
   worker on a new branch off the merged tip; keep lanes disjoint.
3. After each wave merge: downstream-merge origin/keepance-3.0, gate, push; spot-check the
   NEXT wave's plan anchors (current wave only); CHANGELOG entry; notify-jameson MILESTONE
   (plain language, per the 16-year-old rule); bulletin one-liner.
4. Keep pulling future work forward (playbook parallelize-mandatory): brief the next lane
   while current builds — Wave 2 (CRM write-back) can start once Wave 0 merges (its Rust
   crm/ lane is disjoint from Wave 1's calendar/ lane; watch shared files: lib.rs
   registrations are known-union conflicts you resolve at merge).
5. Wave 3 starts only after Waves 0–2 are merged + gate-green (no advisor-validation pause
   — Jameson's override). Its Task 0 is the WASAPI loopback spike on the Legion — reserve
   the Legion via the bulletin THEN (main line has priority until its release ships).

## Parked for Jameson (surface gently at good moments, never nag)
- Vendor API filings (Redtail/Salesforce/DocuSign) — w0 produces the checklist doc.
- Google OAuth calendar-scope verification filing — w1 produces the submission pack; file
  EARLY (Google review = calendar time).
- Discovery-interview campaign go (staged in
  `~/keepance/docs/marketing/campaigns/2026-06-advisor-first-users/`) — should run during
  the build so Phase 2 planning has validation data.

## Landmines
- NEVER touch `~/keepance` / push `keepance-3.0` / deploy/release from this fork.
- NEVER rename `matter_id`/`Matter`. Never claim SOC 2. No cloud transcription EVER.
- Workers named `cc-lantern-*` ONLY (main fleet sweeps `cc-keepance-*`).
- CARGO CACHES ARE PER-LANE now (2026-07-03): w1→`~/.cargo-target-lp-w1`,
  w2→`~/.cargo-target-lp-w2`, coordinator merge gates→`~/.cargo-target-lp-gate`;
  legacy `~/.cargo-target-lantern-plus` dies with w0 (delete it when w0 closes). One
  cargo per LANE; lanes compile concurrently. Watch DISK (~45G/cache; <25G alarm armed;
  delete a lane's cache at lane close; don't seed a new lane under 80G free). Seed new
  lanes with `rsync -a --exclude debug/incremental` from any warm cache, cargo-quiet.
  Sidecar stubs may still need `touch src-tauri/binaries/{piper,llama-server}-x86_64-unknown-linux-gnu` in fresh worktrees.
- The rebrand merge from main is the one known chunky downstream merge — dedicated session.
- Plans' line anchors may drift after downstream merges — verify by symbol, current wave only.
- Jameson communication: plain language always; no time estimates; publish substantial
  reports via claude-report; notify-jameson for DONE/MILESTONE/NEED-YOU with the 4-line body.
- At YOUR context limit: playbook §6.1 — write this handoff fresh, self-respawn Fable · high
  via `spawn-session.sh --full-name cc-lantern-coordinator-N --dir /home/jameson/lantern-plus
  --model claude-fable-5 --effort high --handoff <this file>`, verify boot, then end.
