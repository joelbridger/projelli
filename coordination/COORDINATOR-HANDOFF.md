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

## Current state (as of 2026-07-03 midday, coordinator-2 → handing off) — SOFTWARE MERGED, BUT REAL-WINDOWS SMOKE FOUND IT DOESN'T RUN END-TO-END YET

**Tip: `lantern-plus @46cc3697` (pushed). Gates green: 5529 vitest + 1100 cargo lib, zero fail.**
MERGED so far: Waves 0/1/2 + polish lane + trust-fixes (cross-wave prompt-security + egress-audit
hardening from a whole-program review). All unit-green.

### 🔴 THE HEADLINE — read the smoke result FIRST, it reframes everything
The interim real-Windows smoke of Waves 0-2 (bench worker, evidence branch `lp/windows-smoke-evidence`,
saved durably at **`coordination/smoke-1/RUN-LOG.md`** + **`coordination/smoke-1/P0-TRIAGE.txt`**) found the
assembled app does NOT work end-to-end despite green unit tests. A read-only Codex triage classified all 5 P0s:

- **REAL BUGS, OURS TO FIX (2, both UI-wiring):**
  1. **Save-to-Drafts button stuck disabled.** `DraftFollowUpModal.tsx:196,554` disables Save when the
     selected mail account is IMAP; the backend account list (`mail/connect.rs:263`) can return IMAP-only
     when M365 isn't connected. Tests only covered M365 (`draft-follow-up-modal.test.tsx:10`) so missed it.
     FIX: default to the first draft-capable account; disable+explain only for genuine IMAP; add IMAP-first/only tests.
  5. **No discoverable "Send to Wealthbox."** The only enqueue button lives in `MatterNotesEditor.tsx:247,307`,
     which opens ONLY for shared matters via `matter-notes:/…` (`openMatterNotes.ts:28` refuses non-shared);
     ordinary Word notes (`DocxEditor.tsx:1219`) have only Draft-follow-up/Export. The review card IS mounted
     (`MatterHub.tsx:455`) but nothing queues from normal notes. FIX: add "Send to Wealthbox" to the normal
     note/DOCX toolbar surface, enqueue into `crmWriteQueueStore` for the current matter.
- **NOT OUR BUGS — bench-setup / smoke-procedure artifacts (3), the code is likely fine but UNVERIFIED:**
  2. Per-client Files empty + new docs to root `docs/` → the demo workspace was COPIED to `C:/lantern-plus-smoke`
     without rebinding matter `folderPaths` (`AppSurfaceRouter.tsx:377`, `scopeFileTree.ts:193`). ENV.
  3. Client Map "check your AI connection" → same copied-workspace root: RAG threw "memory integrity uncertain;
     re-index" (`rag/query.rs:101`), and the UI masks any retrieval error as an AI-connection error
     (`useClientMap.ts:118` — a nice-to-fix UI clarity item, not the root cause). ENV (needs re-index after copy).
  4. Calendar OAuth "never connected" → the bench worker CANCELLED the in-app OAuth before Jameson's passkey;
     our fail-closed rollback (`calendar/commands.rs:117`) then correctly discarded the token. SMOKE PROCEDURE.
- **What genuinely PASSED on real Windows (the differentiated core):** AI drafting + citations + hover previews,
  cancel-on-close, CalendarConnect card render, Wealthbox connect/sync, light theme, console cleanliness, and —
  critically — Local-only mode (correctly refused to call cloud, generated on-device). The trust story works.

### ⭐ YOUR #1 JOB (Jameson's explicit instruction: he paused me here to hand off BEFORE any corrections)
1. **Fix the 2 real bugs** (#1 Save-to-Drafts IMAP default, #5 Send-to-Wealthbox entry point) — spawn a
   worker per the triage's file:line fix directions; TDD; these are small, well-localized TS wiring fixes.
2. **Set up a CORRECTED bench smoke** and re-run it to actually VERIFY Waves 0-2 end-to-end:
   (a) after copying/opening the demo workspace on the bench, REBIND matter `folderPaths` for the new path
   and RE-INDEX the RAG memory (fixes findings #2/#3 as test-setup); (b) for the calendar, do NOT cancel the
   in-app OAuth — leave it pending while Jameson taps the passkey (fix #4 procedure). Corrected-smoke brief
   should extend `coordination/briefs/w-bench-smoke-brief.md`. Legion is OURS (reserved on the bulletin).
3. **Recalibrated done-gate (honest-reporting lesson, tell Jameson plainly):** "merged + unit-green" is NOT
   "done." A wave is only really done when it's VERIFIED WORKING in the real app on the bench. Report that way.

### In-flight / fleet (as of handoff)
- `cc-lantern-w6` in `~/lp-w6` (branch `lp/wave-4-bc`, TS-only, no cargo cache): **Wave 4 Tracks B+C** —
  Book view (Tasks 1,2) + estate/beneficiary mismatch (2b, Jameson-requested) + whole-practice Ask
  (Tasks 3,4,5 incl. the SACRED no-raw-RAG matter-isolation guard). ALL tasks done; in final verification;
  will print `WORKER-DONE: lp/wave-4-bc`. Started BEFORE the smoke result — it's plan-authorized early Wave 4
  work with no Wave 3 dependency, independent of the P0 fixes. Review (xhigh on Task 4's isolation guard) + merge it.
- `cc-lantern-bench` (Legion driver): smoke DONE, evidence pushed (`lp/windows-smoke-evidence`), bench restored
  to quiet (its `LanternPlusDev` scheduled task removed; main line's `KeepanceDev` untouched). KEEP it for the
  corrected re-test. Bench gotcha it found: a fresh checkout needs `src-tauri/binaries/*` Windows sidecars
  copied from an existing checkout (e.g. `C:\keepance\src-tauri\binaries\`) before the first build.
- `lp-gate-build` tmux session = the long-job runner (gate cargo + codex reviews). Keep. Its cwd must be a
  real dir (`/home/jameson/lantern-plus`) — never leave it parked in a temp worktree you later remove.
- `~/.cargo-target-lp-gate` (merge-gate cache) + `~/.cargo-target-lp-w4` (seeded warm for Wave 3) exist. KEEP.

### Then (after the 2 fixes + corrected smoke is green)
- Wave 3 (meeting capture) — brief `coordination/briefs/w-wave3-brief.md` (anchor-corrected for the .lantern
  data-dir seam); starts with the Legion WASAPI spike; cache `~/.cargo-target-lp-w4` already seeded. **GATED
  behind waves 0-2 actually working on the bench** (don't build capture on an unverified foundation).
- Wave 4 remainder (Tracks A diarization + D retention) after B+C merges.
- Rename window: main line's ~/keepance→~/lantern FOLDER rename expected 2026-07-04+ — FREEZE downstream merges
  between the bulletin's EXECUTING and DONE lines (Phase-1 data-dir migration already absorbed & clean).
- Release the Legion on the bulletin when done (main line asked; Jameson's personal test is postponed behind ours).

### Parked for Jameson
Google OAuth calendar filing (pack ready, weeks of Google review); interview campaign go; Wealthbox live-probe
token (needed to confirm CRM write formats — VERIFY-LIVE tags in the CRM code). Product questions: should
background-AI features share the chat consent gate?; a second bullet-vs-quote verification pass on briefs?

## Stale detail below (pre-completion snapshot, kept for context)
### (superseded) Current state as of 03:45
- **Repo:** `~/lantern-plus`, branch `lantern-plus` @ `5bcb3a3a`+ (pull first), pushed.
  MERGED: Wave 0 (all 13 tasks) + Wave 1 backend (lp/wave-1b, tasks 1-11) + three
  downstream merges (last @566d9849). Gates green at each step (5281 vitest; cargo clean;
  the consent-gate contract test is a KNOWN load-flake — verify in isolation, don't chase).
  Milestone report published + notify-jameson sent (with UI screenshots, docs/evidence/wave-0/).
- **Fleet (all Sonnet 5, briefs in `coordination/briefs/`):**
  - `cc-lantern-w0`: CLOSED (merged; worktree removed).
  - `cc-lantern-w1` in `~/lp-w1` (branch `lp/wave-1c`, stacked on merged tip): Wave 1
    finale — tasks 12/14/15/16/18 + google-cancel done; building 13 + 17/17b. Task 17
    ships the SIMPLER spec'd version (per-bullet citation chips = P0 follow-up, Jameson
    aware). Cache: `~/.cargo-target-lp-w1`.
  - `cc-lantern-w2` in `~/lp-w2` (branch `lp/crm-writeback`): CRM Rust tasks 1-7 done, on
    final verification (fixed a Drop-impl deadlock after a 37-min hang). Cache: the legacy
    `~/.cargo-target-lantern-plus` (w2-exclusive; DELETE when w2 closes — ~85G).
  - `cc-lantern-w3` in `~/lp-w3` (branch `lp/crm-ui`, stacked on lp/crm-writeback): Wave 2
    UI tasks 8+9 ONLY (pure TS, no cargo). First action was merging origin/lantern-plus in.
  - `lp-gate-build` tmux session: the coordinator's long-cargo runner (not a worker).
- **Rename freeze:** main line executes the ~/keepance→~/lantern folder rename (symlink-
  bridged) earliest 2026-07-04 06:00 — bulletin posts EXECUTING/DONE. FREEZE downstream
  merges between those lines; our ACK + two invariants (repo/branch names unchanged,
  keepance-coordination un-renamed) are on the bulletin.
- **P0 follow-up queue (post-wave):** Wave-0 modal citation-chip hover popovers; Task-17
  per-bullet brief citations; Outlook attendee self-filter parity.
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
0. **Re-arm ALL monitors** (the checklist above — fleet watcher, RAM+disk, bulletin+selftest, stale-idle,
   build-overtime, parallel-check) + baseline sweep + bulletin session-start line. The old session's monitors
   die with it.
0b. **Ride `cc-lantern-w6` to WORKER-DONE**, review (xhigh on the no-raw-RAG isolation guard) + merge lp/wave-4-bc.
0c. **Do Jameson's #1 job (above): the 2 real P0 fixes + a corrected bench smoke.** This is THE priority — he
    paused execution specifically to hand this off cleanly. Wave 3 waits until the corrected smoke is green.
--- (original recurring steps below still apply) ---
1. Re-arm ALL SEVEN monitors + baseline sweep (above). Append session-start to bulletin.
2. Ride w1 (Wave 1 finale) / w2 (CRM Rust) / w3 (CRM UI) to WORKER-DONE. Each handoff:
   independent codex-review in a detached temp worktree at the branch HEAD → verify each
   finding against the code → route confirmed ones back (findings file + one-line pointer)
   → merge ritual (backup tag → merge --no-ff → typecheck+vitest foreground, cargo via
   lp-gate-build tmux → red=rollback → push --no-verify). Merge order: wave-1c, then
   crm-writeback, then crm-ui (rebase-merge origin/lantern-plus into each first).
3. After each merge: downstream-merge check (FROZEN during the rename window!), CHANGELOG,
   notify-jameson MILESTONE with UI screenshots where applicable, bulletin line, STATUS.
4. After Waves 0-2 all merged + green: Wave 2 remaining tasks (9b/9c/10/11) to a worker;
   AND (Jameson, 2026-07-03) an INTERIM REAL-WINDOWS SMOKE of the merged Waves 0-2 features
   as soon as the Legion frees (reserve via bulletin): bring the bench to the lantern-plus
   tip, drive the new features like an advisor (calendar connect UI, draft-follow-up from a
   note into real drafts, CRM approve card, meetings strips), fix what breaks BEFORE Wave 3
   starts. The AI drives the bench (desktop-drive.mjs + legion_agent.py), never Jameson.
   Then Wave 3 — Task 0 is the WASAPI loopback spike on the Legion (reserve via bulletin;
   main line has priority until their release ships). Wave 4 after. P0 follow-up queue
   bundles into one polish lane once wave-1c + crm-ui are merged.
5. Parked for Jameson (surface gently): Google OAuth filing (pack ready), interview
   campaign go, vendor API filings, Wealthbox live-probe token (VERIFY-LIVE register).

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
