# Folder Reorg Phase A Log

Date: 2026-07-06

Spec read first: `coordination/FOLDER-CLEANUP-RENAME-PLAN.md`.

Scope: tidy loose files and active support folders in `/home/jameson`. This did not rename `~/lantern`, `~/lantern-plus`, any `~/lp-*` worktree, or any `~/kp-*` worktree.

## Summary

- Archived 41 loose Keepance/KP screenshot, CSV, and audit-note files to `~/archive/keepance-screenshots-2026/`.
- Renamed these active support folders and left compatibility symlinks at the old paths:
  - `~/keepance-backups` -> `~/lantern-backups`
  - `~/keepance-demo-data` -> `~/lantern-demo-data`
  - `~/keepance-web-demo` -> `~/lantern-web-demo`
  - `~/keepance-founder-guide` -> `~/lantern-founder-guide`
  - `~/keepance-coordination` -> `~/lantern-coordination`
- Left `~/keepance` alone because it was already a symlink to `~/lantern`.
- Left `~/kp-coord` alone because it is a Git worktree: its `.git` file points at `/home/jameson/keepance/.git/worktrees/kp-coord`.
- Updated the cron pointer for the coordinator heartbeat to `/home/jameson/lantern-coordination/...`.
- Updated `~/.claude/CLAUDE.md`; `~/.codex/AGENTS.md` follows it by symlink.

## Archived Loose Files

Destination: `/home/jameson/archive/keepance-screenshots-2026/`

- `/home/jameson/keepance-bench-buildtimes.csv`
- `/home/jameson/keepance-homepage-reposition.jpeg`
- `/home/jameson/keepance-homepage-v2.jpeg`
- `/home/jameson/keepance-r2a-01-onboarding-welcome.png`
- `/home/jameson/keepance-r2a-01-welcome.png`
- `/home/jameson/keepance-r2a-02-profession.png`
- `/home/jameson/keepance-r2a-05-day2-search-landing.png`
- `/home/jameson/keepance-r2a-06-matters-home.png`
- `/home/jameson/keepance-r2a-06-matters-view.png`
- `/home/jameson/keepance-r2a-07-search-ask.png`
- `/home/jameson/keepance-r2a-08-matter-manager.png`
- `/home/jameson/keepance-r2a-09-ask-empty-sample.png`
- `/home/jameson/keepance-r2a-10-ask-empty-fresh.png`
- `/home/jameson/keepance-r2a-11-nondemo-question.png`
- `/home/jameson/keepance-r2a-12-after-nondemo.png`
- `/home/jameson/kp-audit-final.png`
- `/home/jameson/kp-audit.png`
- `/home/jameson/kp-audit2.png`
- `/home/jameson/kp-docs-files.png`
- `/home/jameson/kp-docs-final.png`
- `/home/jameson/kp-docs-grid2.png`
- `/home/jameson/kp-docs-tree.png`
- `/home/jameson/kp-docs-tree2.png`
- `/home/jameson/kp-email-final.png`
- `/home/jameson/kp-email.png`
- `/home/jameson/kp-email2.png`
- `/home/jameson/kp-email3.png`
- `/home/jameson/kp-matterhub.png`
- `/home/jameson/kp-matters.png`
- `/home/jameson/kp-matters2.png`
- `/home/jameson/kp-matters3.png`
- `/home/jameson/kp-matters4.png`
- `/home/jameson/kp-memory-restore.png`
- `/home/jameson/kp-search-final.png`
- `/home/jameson/kp-settings-split.png`
- `/home/jameson/kp-settings.png`
- `/home/jameson/kp-settings2.png`
- `/home/jameson/kp-workflow-final.png`
- `/home/jameson/kp-workflow-fixed.png`
- `/home/jameson/kp-workflow.png`
- `/home/jameson/keepance-testing-codex-findings-2026-06-19.md`

## Folder Moves

- Renamed `/home/jameson/keepance-backups` to `/home/jameson/lantern-backups`; created symlink `/home/jameson/keepance-backups -> /home/jameson/lantern-backups`.
- Renamed `/home/jameson/keepance-demo-data` to `/home/jameson/lantern-demo-data`; created symlink `/home/jameson/keepance-demo-data -> /home/jameson/lantern-demo-data`.
- Renamed `/home/jameson/keepance-web-demo` to `/home/jameson/lantern-web-demo`; created symlink `/home/jameson/keepance-web-demo -> /home/jameson/lantern-web-demo`.
- Renamed `/home/jameson/keepance-founder-guide` to `/home/jameson/lantern-founder-guide`; created symlink `/home/jameson/keepance-founder-guide -> /home/jameson/lantern-founder-guide`.
- Renamed `/home/jameson/keepance-coordination` to `/home/jameson/lantern-coordination`; created symlink `/home/jameson/keepance-coordination -> /home/jameson/lantern-coordination`.

Skipped:

- `/home/jameson/keepance`: already symlinked to `/home/jameson/lantern`.
- `/home/jameson/kp-coord`: Git worktree; left untouched.

## First Reference Pass

- `keepance-backups` -> `lantern-backups`: 1 matching line across 1 file.
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_codebase_cleanup.md`
- `keepance-demo-data` -> `lantern-demo-data`: 5 matching lines across 4 files.
  - `/home/jameson/.claude.json`
  - `/home/jameson/.claude/projects/-home-jameson/memory/MEMORY.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_demo_fileset.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_wealthbox_demo_seed.md`
- `keepance-web-demo` -> `lantern-web-demo`: no pre-move matches in the first pass.
- `keepance-founder-guide` -> `lantern-founder-guide`: no pre-move matches in the first pass.
- `keepance-coordination` -> `lantern-coordination`: 26 matching lines across 17 files.
  - `/home/jameson/.claude.json`
  - `/home/jameson/.claude/CLAUDE.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/MEMORY.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/feedback_coordinator_autonomous_until_done.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/feedback_coordinator_durable_backlog.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/feedback_spawned_sessions_no_interactive_menus.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/feedback_thorough_coordinator_handoff.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_brand_vs_lantern_split.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_clientmap_ui_redesign.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_codebase_cleanup.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_jump_feasibility.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_wealthbox_connector.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_server_oom_hang_2026_06_09.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/project_wealthbox_demo_seed.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/reference_coordinator_playbook.md`
  - `/home/jameson/.claude/projects/-home-jameson/memory/reference_memory_governance.md`
  - `/home/jameson/services/projelli-demo-proxy/set-demo-key.sh`

## Second Reference Pass

After the folders moved, I searched the renamed active folders plus the Lantern-Plus coordination folder and updated folder-internal references. This pass edited 166 files:

- `/home/jameson/lantern-backups/cleanup-2026-06-29/canonical-untracked/docs/design/onboarding-prototype-v2-concise/CRITIQUE.md`
- `/home/jameson/lantern-coordination/BACKLOG.md`
- `/home/jameson/lantern-coordination/BOARD.md`
- `/home/jameson/lantern-coordination/HANDOFF-2026-06-28.md`
- `/home/jameson/lantern-coordination/HARDENING-TRACKER.md`
- `/home/jameson/lantern-coordination/INITIATIVES/cleanup-plan.md`
- `/home/jameson/lantern-coordination/INITIATIVES/lantern-rename-plan-2026-07-02.md`
- `/home/jameson/lantern-coordination/INITIATIVES/post-rebrand-codebase-cleanup.md`
- `/home/jameson/lantern-coordination/INITIATIVES/wave5c-settings-plan-codex.md`
- `/home/jameson/lantern-coordination/PARALLEL-EFFORTS.md`
- `/home/jameson/lantern-coordination/PLAYBOOK-PROJECT-BRIEF.md`
- `/home/jameson/lantern-coordination/SESSION-LEDGER.md`
- `/home/jameson/lantern-coordination/STATUS.md`
- `/home/jameson/lantern-coordination/briefs/ADVISOR-REPOSITIONING.md`
- `/home/jameson/lantern-coordination/briefs/IA-MIGRATION.md`
- `/home/jameson/lantern-coordination/briefs/WEB-DEMO-redeploy.md`
- `/home/jameson/lantern-coordination/briefs/WS-DOCS.md`
- `/home/jameson/lantern-coordination/briefs/WS-SHIP.md`
- `/home/jameson/lantern-coordination/briefs/WS0-backup.md`
- `/home/jameson/lantern-coordination/briefs/advisor-demo-questions-brief.md`
- `/home/jameson/lantern-coordination/briefs/ai-popup-feasibility-brief.md`
- `/home/jameson/lantern-coordination/briefs/aph-rebrand-look-preview.md`
- `/home/jameson/lantern-coordination/briefs/ask-internet-evaluation-brief.md`
- `/home/jameson/lantern-coordination/briefs/ask-smart-agent-brief.md`
- `/home/jameson/lantern-coordination/briefs/ask-ui.md`
- `/home/jameson/lantern-coordination/briefs/board-update.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave1-docs.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave2-cruft.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave4-efficiency.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave5a-structural.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave5b-app.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave5b-ask.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave5b-email.md`
- `/home/jameson/lantern-coordination/briefs/cleanup-wave5c-connectors.md`
- `/home/jameson/lantern-coordination/briefs/clientmap-ui.md`
- `/home/jameson/lantern-coordination/briefs/connector-access-research.md`
- `/home/jameson/lantern-coordination/briefs/connector-integration.md`
- `/home/jameson/lantern-coordination/briefs/connectors-bonus-brief.md`
- `/home/jameson/lantern-coordination/briefs/coordinator-tooling-sprint.md`
- `/home/jameson/lantern-coordination/briefs/demo-live-ai-brief.md`
- `/home/jameson/lantern-coordination/briefs/demo-recut-v2concise.md`
- `/home/jameson/lantern-coordination/briefs/demo-recut-v3.md`
- `/home/jameson/lantern-coordination/briefs/demo-video-recut.md`
- `/home/jameson/lantern-coordination/briefs/demo-video.md`
- `/home/jameson/lantern-coordination/briefs/finish-onboarding-v2.md`
- `/home/jameson/lantern-coordination/briefs/fix-timeout-hangs.md`
- `/home/jameson/lantern-coordination/briefs/fix-windows-path-isolation.md`
- `/home/jameson/lantern-coordination/briefs/hf-ask-isolation-citations.md`
- `/home/jameson/lantern-coordination/briefs/hf-clientmap.md`
- `/home/jameson/lantern-coordination/briefs/hf-docx-dataloss.md`
- `/home/jameson/lantern-coordination/briefs/hf-email-workflows.md`
- `/home/jameson/lantern-coordination/briefs/impl-ask-smart-agent.md`
- `/home/jameson/lantern-coordination/briefs/impl-connector-access.md`
- `/home/jameson/lantern-coordination/briefs/impl-demo-recs.md`
- `/home/jameson/lantern-coordination/briefs/jump-competitive-analysis.md`
- `/home/jameson/lantern-coordination/briefs/onboarding-render.md`
- `/home/jameson/lantern-coordination/briefs/phase-c-reverify.md`
- `/home/jameson/lantern-coordination/briefs/product-journey.md`
- `/home/jameson/lantern-coordination/briefs/rename-execution.md`
- `/home/jameson/lantern-coordination/briefs/rightcapital-feasibility.md`
- `/home/jameson/lantern-coordination/briefs/strategy-advisor-memo.md`
- `/home/jameson/lantern-coordination/briefs/surface-cleanup.md`
- `/home/jameson/lantern-coordination/briefs/update-memory-rules.md`
- `/home/jameson/lantern-coordination/briefs/web-demo-redeploy.md`
- `/home/jameson/lantern-coordination/connector-lead-PARK.md`
- `/home/jameson/lantern-coordination/connector-research/CONNECTOR-CANDIDATES.md`
- `/home/jameson/lantern-coordination/connector-research/SESSION-HANDOFF.md`
- `/home/jameson/lantern-coordination/connector-research/logs/monitor.sh`
- `/home/jameson/lantern-coordination/coordinator/PLAYBOOK.md`
- `/home/jameson/lantern-coordination/coordinator/templates/bench-handoff.md`
- `/home/jameson/lantern-coordination/coordinator/templates/session-handoff.md`
- `/home/jameson/lantern-coordination/coordinator/templates/startup-checklist.md`
- `/home/jameson/lantern-coordination/coordinator/tools/codex-review-safe.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/finish-watch.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/finish-watch.sh.orig-bak-20260701`
- `/home/jameson/lantern-coordination/coordinator/tools/finish-watch.v2.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/fleet-heartbeat.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/merge-ledger.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/parallel-check.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/session-monitor.sh`
- `/home/jameson/lantern-coordination/coordinator/tools/wrap-and-respawn.sh`
- `/home/jameson/lantern-coordination/handoffs/BENCH-HANDOFF.md`
- `/home/jameson/lantern-coordination/handoffs/CLIENTMAP-UI-HANDOFF.md`
- `/home/jameson/lantern-coordination/handoffs/CREDS-HANDOFF.md`
- `/home/jameson/lantern-coordination/handoffs/DEMO-VIDEO-HANDOFF.md`
- `/home/jameson/lantern-coordination/handoffs/DESIGN-SESSION-HANDOFF.md`
- `/home/jameson/lantern-coordination/handoffs/PRODUCT-JOURNEY-HANDOFF.md`
- `/home/jameson/lantern-coordination/handoffs/WEB-REDEPLOY-HANDOFF.md`
- `/home/jameson/lantern-coordination/onedrive-demo/PLAN.md`
- `/home/jameson/lantern-coordination/scratchpad/2tb-drive-setup-handoff.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-comprehensive-retest-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-final-recheck-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-final-verify-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-installer-verify-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-migverify-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-pass2-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-pass3-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-r17-deeptest-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-r17-retest-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/bench-report-req.txt`
- `/home/jameson/lantern-coordination/scratchpad/bench-reverify3-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/branch-audit.md`
- `/home/jameson/lantern-coordination/scratchpad/check-state-after-esc.mjs`
- `/home/jameson/lantern-coordination/scratchpad/conng-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/dashboard-scoreboard-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/datadir-migration-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/eval-arch.md`
- `/home/jameson/lantern-coordination/scratchpad/eval-rust.md`
- `/home/jameson/lantern-coordination/scratchpad/eval-security.md`
- `/home/jameson/lantern-coordination/scratchpad/eval-testing.md`
- `/home/jameson/lantern-coordination/scratchpad/f13-ci-dered-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/f39-scout-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/fix-doctab-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/fix-localai-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/fix-onedrive-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/fix-reconnect-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/fleet-dashboard-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/fleet-dashboard-handoff.md`
- `/home/jameson/lantern-coordination/scratchpad/fleet-dashboard-v2-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/odsilence-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/onedrive-screenshot.mjs`
- `/home/jameson/lantern-coordination/scratchpad/p11-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/p12-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/p13-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/p21-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/p23-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/perf-ask.md`
- `/home/jameson/lantern-coordination/scratchpad/perf-boot.md`
- `/home/jameson/lantern-coordination/scratchpad/perf-front.md`
- `/home/jameson/lantern-coordination/scratchpad/perf-rust.md`
- `/home/jameson/lantern-coordination/scratchpad/refix-aitable-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/refix-docs-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/refix-onboarding-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/reimagine-waveA-brief.md`
- `/home/jameson/lantern-coordination/scratchpad/rename-path-inventory.md`
- `/home/jameson/lantern-coordination/scratchpad/ux-screens-brief.md`
- `/home/jameson/lantern-coordination/testing-findings-2026-06-25.md`
- `/home/jameson/lantern-coordination/ux-audit/mockups/MOCKUP_NOTES.md`
- `/home/jameson/lantern-coordination/wealthbox-seed-PLAN.md`
- `/home/jameson/lantern-coordination/wealthbox-seed-scripts/wb_run.py`
- `/home/jameson/lantern-coordination/wealthbox-seed-scripts/wb_seed.py`
- `/home/jameson/lantern-coordination/wealthbox-seed-summary.md`
- `/home/jameson/lantern-demo-data/build/generators/_GENERATOR_GUIDE.md`
- `/home/jameson/lantern-demo-data/build/generators/_brief_firm.md`
- `/home/jameson/lantern-demo-data/build/generators/_brief_plan.md`
- `/home/jameson/lantern-demo-data/build/generators/_brief_taxreturn.md`
- `/home/jameson/lantern-demo-data/docs/superpowers/specs/2026-06-24-advisor-demo-fileset-design.md`
- `/home/jameson/lantern-demo-data/roster/authors/_TASK_CONTEXT.md`
- `/home/jameson/lantern-demo-data/roster/authors/_brief_hollings.md`
- `/home/jameson/lantern-demo-data/roster/authors/_brief_nakamura.md`
- `/home/jameson/lantern-plus/coordination/COORDINATOR-HANDOFF.md`
- `/home/jameson/lantern-plus/coordination/LANES.md`
- `/home/jameson/lantern-plus/coordination/QUESTIONS-FOR-JAMESON.md`
- `/home/jameson/lantern-plus/coordination/STATUS.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-bench-prep-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-meetverify-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-meetverify2-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-regression-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-renameref-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-trustreview-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-winvm-brief.md`
- `/home/jameson/lantern-plus/coordination/briefs/w-zoomacct-brief.md`
- `/home/jameson/lantern-plus/coordination/reports/w-renameref-report.md`
- `/home/jameson/lantern-plus/coordination/tools/post-reboot-resume.sh`
- `/home/jameson/lantern-web-demo/Caddyfile`
- `/home/jameson/lantern-web-demo/Caddyfile.bak.pre-redeploy.1782693744`

Final cleanup for the last three leftovers:

- `/home/jameson/lantern-coordination/briefs/WS0-backup.md`
- `/home/jameson/lantern-coordination/coordinator/tools/session-monitor.sh`
- `/home/jameson/lantern-coordination/scratchpad/rename-path-inventory.md`

## Lantern-Plus Files Updated

These were changed in this repo because they pointed at renamed support folders:

- `coordination/COORDINATOR-HANDOFF.md`
- `coordination/LANES.md`
- `coordination/QUESTIONS-FOR-JAMESON.md`
- `coordination/STATUS.md`
- `coordination/briefs/w-bench-prep-brief.md`
- `coordination/briefs/w-meetverify-brief.md`
- `coordination/briefs/w-meetverify2-brief.md`
- `coordination/briefs/w-regression-brief.md`
- `coordination/briefs/w-renameref-brief.md`
- `coordination/briefs/w-trustreview-brief.md`
- `coordination/briefs/w-winvm-brief.md`
- `coordination/briefs/w-zoomacct-brief.md`
- `coordination/reports/w-renameref-report.md`
- `coordination/tools/post-reboot-resume.sh`

## Verification

- Confirmed `~/keepance-*` old names are symlinks to `~/lantern-*` new names.
- Confirmed `~/keepance` is still a symlink to `~/lantern`.
- Confirmed `~/kp-coord` remains a real Git worktree and was not renamed.
- Confirmed the cron entry now uses `/home/jameson/lantern-coordination/coordinator/tools/fleet-heartbeat.sh`.
- Confirmed `coordination/tools/post-reboot-resume.sh` now calls `/home/jameson/lantern-coordination/coordinator/tools/spawn-session.sh`.
- Ran `bash -n /home/jameson/lantern-plus/coordination/tools/post-reboot-resume.sh`.
- Ran `bash -n` across `/home/jameson/lantern-coordination/coordinator/tools/*.sh` and `/home/jameson/lantern-coordination/connector-research/logs/monitor.sh`.
- Ran a final focused search for `keepance-backups`, `keepance-demo-data`, `keepance-web-demo`, `keepance-founder-guide`, and `keepance-coordination` across the renamed active folders, `~/.claude/CLAUDE.md`, project memory, services, and Lantern-Plus coordination. The intentional remaining occurrences are the original cleanup plan and this report, because both document the old-to-new mapping.

## Notes

- I did not rewrite old chat/session logs or old shell history.
- The separate `~/lantern-coordination` Git repo had unrelated dirty files before this task started. I did not commit that repo because it would mix this path cleanup with prior work.

## Leftovers Pass

Date: 2026-07-07

Scope: finish the remaining real, non-symlink `~/keepance-*` folders found by
`ls -la ~/ | grep keepance`, while leaving the intentional compatibility
symlinks and active worktrees alone.

### Folder Checks

Checked these leftover folders for Git worktree risk before moving anything:

- `/home/jameson/keepance-archive-staging`: no `.git` file and no `.git/worktrees`.
- `/home/jameson/keepance-jump-feasibility`: no `.git` file and no `.git/worktrees`.
- `/home/jameson/keepance-lawyer-interviews`: no `.git` file and no `.git/worktrees`.

Found these additional real `keepance-*` folders and left them untouched because
their `.git` files point into `/home/jameson/keepance/.git/worktrees/`:

- `/home/jameson/keepance-wt-dialin`
- `/home/jameson/keepance-wt-onboarding`
- `/home/jameson/keepance-wt-website`

Also noticed `/home/jameson/.keepance-coord`, but left it untouched because it
is a hidden helper folder referenced by `/home/jameson/.local/bin/keepance-coord`,
not a visible `keepance-*` project folder.

### Folder Moves

These folders were still referenced by current notes, so they were renamed to
`lantern-*` names and old-path symlinks were left behind:

- `/home/jameson/keepance-archive-staging` -> `/home/jameson/lantern-archive-staging`
- `/home/jameson/keepance-jump-feasibility` -> `/home/jameson/lantern-jump-feasibility`
- `/home/jameson/keepance-lawyer-interviews` -> `/home/jameson/lantern-lawyer-interviews`

Created `/home/jameson/archive/keepance-history-2026/` for this pass. No folders
were moved into it because the remaining dormant folders had live references and
therefore used the rename-plus-symlink path.

### References Updated

Updated current references from the old names to the new names in:

- `/home/jameson/.codex/config.toml`
- `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_lawyer_outreach.md`
- `/home/jameson/.claude/projects/-home-jameson/memory/project_keepance_jump_feasibility.md`
- `/home/jameson/.claude/projects/-home-jameson/memory/reference_quo_phone.md`
- `/home/jameson/lantern-coordination/briefs/WS0-backup.md`
- `/home/jameson/lantern-coordination/briefs/WS-CLEAN.md`
- `/home/jameson/lantern-plus/LANTERN-PLUS.md`
- `/home/jameson/lantern-plus/coordination/briefs/trust-fixes-findings.txt`
- `/home/jameson/lantern-plus/coordination/qa-campaign/static-race-sweep.md`
- `/home/jameson/lantern-plus/coordination/reports/w-renameref-report.md`
- `/home/jameson/lantern-plus/coordination/smoke-1/P0-TRIAGE.txt`
- `/home/jameson/lantern-plus/docs/board/cold-call-guide.html`
- `/home/jameson/lantern-plus/docs/marketing/campaigns/2026-06-advisor-first-users/DISCOVERY-INTERVIEW.md`
- `/home/jameson/lantern-plus/docs/marketing/campaigns/2026-06-advisor-first-users/README.md`
- `/home/jameson/lantern-plus/feasibility/codex-codebase-readiness.md`
- `/home/jameson/lantern-plus/feasibility/research/codex-review-of-assessment.md`
- `/home/jameson/lantern-jump-feasibility/codex-codebase-readiness.md`
- `/home/jameson/lantern-jump-feasibility/research/codex-review-of-assessment.md`
- `/home/jameson/lantern-lawyer-interviews/PLAN.md`
- `/home/jameson/lantern-lawyer-interviews/queue-wave1.sh`
- `/home/jameson/lantern-lawyer-interviews/quo-label-lawyers.ts`
- `/home/jameson/lantern-lawyer-interviews/send-wave1.sh`

Did not rewrite historical chat logs, Claude file-history snapshots, paste
caches, security logs, or the old rename inventory scratchpad. Those are records
of what happened at the time, not live instructions.

### Verification

- Pulled `lantern-plus` first: already up to date.
- Confirmed the three renamed leftovers are now symlinks at their old paths.
- Confirmed the three `keepance-wt-*` folders are active Git worktrees and were
  not moved.
- Confirmed `crontab -l` has no references to these leftover paths.
- Ran a focused search across current memory, `~/lantern-coordination`,
  `~/lantern-plus`, and `~/.codex/config.toml`; no current references to
  `keepance-archive-staging`, `keepance-jump-feasibility`, or
  `keepance-lawyer-interviews` remain outside intentionally historical files.
