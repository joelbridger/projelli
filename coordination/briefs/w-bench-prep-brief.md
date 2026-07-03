ROLE: Bench-prep worker. One job: bring the Legion Windows bench fully current and verified-healthy NOW, so the imminent Wave-3/4 verification passes start warm instead of losing 30-60 min to setup. Prep only — you run NO feature tests.

WORKDIR: ~/lp-bench (git worktree, branch lp/windows-smoke-evidence — the evidence branch is checked out here permanently, so you never branch-switch ~/lantern-plus; that landmine is closed). Commit your prep log there. NOT self-merged.

READ FIRST: docs/evidence/windows-smoke-2/RUN-LOG.md (in your worktree — the Phase-1 setup procedures and bench conventions) + ~/.claude/projects/-home-jameson/memory/reference_keepance_desktop_control.md if present.

THE BENCH: Legion laptop, `ssh james@100.127.67.22` (Tailscale). Checkout at C:\lantern-plus, branch lantern-plus. App runs via the LanternPlusDev scheduled task (dev build). Workspace: C:\lantern-plus-smoke\Northcrest Wealth Partners. Test identity: Sarah Morgan — password+TOTP creds at ~/keepance-coordination/demo-creds/sarah-morgan-account.md (chmod 600; never echo/log/commit). Drive the app via scripts/desktop-drive.mjs (CDP port 9223) from the server; scripts/legion_agent.py for native dialogs.

STEPS:
1. Pull C:\lantern-plus to current origin/lantern-plus tip (b3bca9a0 or later — verify the SHA on the bench matches origin). npm install if the lockfile changed.
2. FULL REBUILD — never skip on a source-hash match (hard lesson: artifact freshness, not source freshness, is what a bench verifies). Record exit codes.
3. Boot the app; run a BUILD-FRESHNESS CANARY (verify some behavior/string only the new tip exhibits — e.g. a change from tonight's CRM merge visible in the bundle) before trusting anything.
4. Verify bench health: workspace binds + per-client files visible; search index fresh (re-index if stale); M365 (Sarah Morgan) calendar+mail connections alive (light-touch sign-in ONLY if needed — MS anti-automation triggers on rapid retries; if a passkey/human tap is genuinely required, STOP and report COORDINATOR: need Jameson); Wealthbox connection alive; console clean of errors.
5. FYI a real HEADSET is now plugged into the Legion (Jameson, tonight) — confirm Windows sees it (input + output device present) and note device names in your log; do NOT test capture (that's the Wave-3 lane's job).
6. Leave the bench QUIET: app stopped, no tunnels left running, everything ready to launch. Commit a short BENCH-READY.md prep log (SHA, build exit codes, canary result, health checklist, headset device names) on your branch and push.

NON-NEGOTIABLES: NEVER touch C:\bench-backups\ or C:\KeepanceWorkspaces\ (main line's). Never touch Jameson's personal account/Bitwarden. One bench driver at a time — you own the Legion until you report done; nothing else of ours drives it concurrently. No product-code edits.

RULES: COORDINATION MODE (no interactive menus; plain-text COORDINATOR: questions). Evidence handoff: bench SHA, build results, canary, health matrix, anything broken. THEN the last line: WORKER-DONE: bench-prep ready
