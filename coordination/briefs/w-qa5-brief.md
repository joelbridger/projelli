# Explorer brief — QA campaign lane 5: "edge-case hunter, desktop round" (persona D on bench-2)

**Lane:** cc-lantern-qa5 · dir `~/lp-qa5` (own worktree, branch `lp/qa-persona-d2`). **Model:** Sonnet 5 · high.
**Read first:** `coordination/QA-CAMPAIGN.md` + ALL of `coordination/qa-campaign/BUG-DB.md` (QA-1..31 known — do NOT re-file; qa3 already did the browser-build edge sweep, you do what a browser CANNOT test). You are an EXPLORER: find and report, never fix product code.

## Seat
Azure `lantern-cloud-bench-2` (the VB-CABLE virtual-audio clone — see coordination/azure-bench/SETUP-LOG.md + LANES history for details; snapshot-resettable). `az vm start`; **deallocate when done**; ≤3h budget. Update the repo to current `origin/lantern-plus` tip + rebuild. SSH tunnel: `127.0.0.1` not `localhost`; pick a unique local port (not 9444/9448/9451). Drive via `scripts/desktop-drive.mjs`.

## Mission — the desktop-only edge catalog (what qa3's browser seat couldn't reach)
Work these systematically, extending as you discover: **reserved Windows filenames on the REAL filesystem** (CON, PRN, NUL, trailing dots/spaces — qa3's mock FS couldn't enforce rejection; what does the app do when Windows refuses?); **disk nearly full** (fill the VM disk to a few hundred MB free, then create docs/import/record — honest errors or corruption?); **system sleep/resume mid-index and mid-recording** (VB-CABLE gives you a real audio device for the record path); **workspace on a path with unusual shapes** (deep nesting near MAX_PATH, spaces+unicode dirs); **antivirus-style file locks** (hold a file handle open on a doc the app wants to write — PowerShell can do this); **DPI scaling changes** (bump Windows scaling 100→150% mid-session); **two app instances via the real single-instance path**; **OAuth token revoked mid-session** (disconnect a connector server-side if a demo connector is wired, else skip honestly); **clock skew** (jump the VM clock ±1 day; watch meeting timestamps/consent ledger). Also: **QA-21 re-check** — local-AI Ask reliability on a fresh VM (qa2 saw 2-of-3 generic failures; is it reproducible here or was it that VM?).

## Reporting
Append findings to BUG-DB continuing IDs from **QA-32**, severity + repro + evidence (`coordination/qa-campaign/evidence/qa5-20260704/`). What-held-up-well section + plain-language summary (Jameson reads it). Commit on YOUR branch in YOUR worktree (`git branch --show-current` first — must say `lp/qa-persona-d2`), push, **deallocate the VM**, then exactly: `WORKER-DONE: qa5`

## Landmines
Never fix product code. Never touch the Legion (meetverify3 will own it). Restore anything you break on the VM (disk fill, clock) or snapshot-reset and say so. No interactive menus — `COORDINATOR:` plain text for blockers.
