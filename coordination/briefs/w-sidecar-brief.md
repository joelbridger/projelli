# Bench-infra brief — build + stage the speech-to-text sidecar on the Legion (unblocks the Meetings re-verify)

**Lane:** cc-lantern-sidecar · dir `~/lp-bench` (evidence worktree, branch `lp/windows-smoke-evidence` — never switch it). **Model:** Sonnet 5 · high.
**Context:** today's live walkthrough hit "Sidecar missing (voice features disabled in this build)" on the Legion — only `parakeet.rs` source exists there, no compiled binary. The upcoming re-verify pass (record → transcript → notes) needs it. bench-1 has the same gap (note it; staging bench-1 is OPTIONAL/time-permitting, Legion is the priority).

## Task
On the Legion (`james@100.127.67.22`; one driver — you own it now, confirm nothing else is driving): update the repo checkout to current `origin/lantern-plus` tip, find how the sidecar is built/staged for dev (check how release.yml stages it — lp/diarize-release-staging landed the release wiring; also scripts/ and src-tauri/binaries conventions; the binary naming pattern is `<name>-x86_64-pc-windows-msvc.exe` in src-tauri/binaries/), build it on the Legion (its own cargo — fine, one cargo on that machine; wrap in a sane timeout and watch progress, don't sit blind), stage it where the app expects, then VERIFY: launch the app, Settings → Voice must no longer say "Sidecar missing". If models are also required (the release staging bundled models), stage those too and say what you staged. Screenshot the healthy Voice settings as evidence.

## Reporting
Append a short section to `docs/evidence/meetings-verify-20260704/RUN-LOG.md` (SIDECAR STAGING addendum) with what you built/staged/verified + screenshot; commit on `lp/windows-smoke-evidence` (`git branch --show-current` first), push. Leave the app CLOSED and the Legion quiet. If the build fails, report the exact error honestly — do not force it. Last line exactly: `WORKER-DONE: sidecar`

## Landmines
No product-code changes (a build/staging script fix is allowed if genuinely broken — state it clearly). Never touch `~/lantern` (main line) on the Legion. Unique local tunnel port if you tunnel (not 9444). No interactive menus — `COORDINATOR:` plain text for blockers.
