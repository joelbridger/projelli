# Bench brief — pre-warm the Legion to current tip (critical-path compression, not blocked)

**Lane:** cc-lantern-legionwarm · dir `~/lp-legionwarm` (fresh worktree on lp/windows-smoke-evidence sibling — see below). **Model:** Sonnet 5 · high. **You own the Legion** (free, at-rest).
**Why:** the Legion's next real job (Notice Card live-verify) is blocked on lp/notice-card merging, but the ~30-40min rebuild is NOT — do it now so the verify is instant later. This overlaps the Notice Card build time = net critical-path savings.

## Tasks (keep it light — this is prep, not a test pass)
1. Update the Legion's `C:\lantern-plus` checkout to current `origin/lantern-plus` tip.
2. Rebuild the app (`tauri build`/dev per the bench convention — a warm incremental build; watch progress, don't sit blind).
3. Health-check: launch the app, confirm it boots clean, Settings → Voice = "Voice ready", the AI key is healthy. Take ONE screenshot proving the app is up on the current tip.
4. Leave the Legion WARM and quiet: app closed but the build cached, scheduled tasks at their at-rest state, no stray processes, tunnels closed.
5. Report: the tip SHA it's warmed to, build result, health-check verdict. This makes the Notice Card verify (and Round 2's Legion persona) a fast pull-one-commit-and-run.

## Reporting
Short evidence note under `docs/evidence/legionwarm-20260704/` (SHA + health screenshot), commit+push on lp/windows-smoke-evidence's sibling branch (make `git worktree add -b lp/legionwarm-evidence`). Last line exactly: `WORKER-DONE: legionwarm`

## Landmines
No product code. Never touch ~/lantern (main line) on the Legion. Unique tunnel port. No interactive menus. If the rebuild fails, report the exact error honestly — don't force it.
