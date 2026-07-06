# Worker brief — bench-1 driver: screenshot the UI-simplification branch for Jameson

You are **cc-lantern-uishots**, worktree **~/lp-uisimp** (the EXISTING worktree, branch lp/ui-simplification @b2bbc6ac — do not change code). You DRIVE `lantern-cloud-bench-1` (start just requested — poll it up, ~2-3 min; Tailscale; see coordination/azure-bench/SETUP-LOG.md + docs/qa/BENCH-SMOKE-HARNESS.md). You do NOT merge.

## Mission — pictures, not judgments
Build/deploy branch **lp/ui-simplification** (NOT the main tip) to bench-1 using the established flow, then screenshot the de-cluttered surfaces so Jameson can eyeball the new look BEFORE the post-demo merge:
1. Settings → AI & Privacy (the mode cards — the named example) — plus one shot HOVERING an "i" so the tooltip is visible.
2. Onboarding scenes (Choose Start / AI / Connect / API key) — one shot each.
3. Two representative connector cards (e.g. Outlook + Wealthbox).
4. The left client list: collapsed state, expanded state, and a client row (no repeated gray name).
5. One BEFORE/AFTER pair if cheap: the main tip build's AI & Privacy card vs the branch's (a prior screenshot from evidence archives is fine for BEFORE — check coordination/qa-campaign/evidence/).

Light theme. Save to `coordination/qa-campaign/evidence/uisimp-shots/` with a one-page INDEX.md (one line per shot: what Jameson should notice). Commit + push to branch **lp/ui-simplification** (`--no-verify`).

## Rules
- Poll the VM up in a FOREGROUND loop, hard timeout 15 min → report BLOCKED with attempts.
- Do NOT deallocate the VM (coordinator handles power). Do NOT run test suites.

## Done criteria (HARD)
Shots + INDEX.md pushed. THEN print exactly: `WORKER-DONE: uisimp-shots` + one line on anything that looked visually WRONG (overlap, misalignment, missing icon) — honest eyes, not a rubber stamp.
