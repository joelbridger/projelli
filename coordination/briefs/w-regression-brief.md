# Bench brief — consolidated Windows regression smoke of the day's 22 merges + 2 honest gaps

**Lane:** cc-lantern-regression · dir `~/lp-bench` (evidence worktree, lp/windows-smoke-evidence — never switch). **Model:** Sonnet 5 · high. **You own the Legion** (it's free, at-rest, everything staged incl. voice).
**Why:** ~22 merges landed today (Meetings end-to-end, the P0 save fix, the trust honesty pass, voice, web-locks, i18n, and more), plus fixes that were unit/Rust-proven but not live-checked. Server tests are green; this is the "does it all still work together on real hardware" pass. Independent of every code lane — pure evidence.

## Update + baseline
Update the Legion to current `origin/lantern-plus` tip, rebuild, launch fresh. Confirm Settings → Voice = "Voice ready" and the AI key is healthy before starting.

## The regression pass (drive it like an advisor; screenshot each)
1. **Meetings end-to-end (the declared-done feature) — reconfirm on the newest tip:** record a short real call → transcript → notes land → restart-safe. This guards against the day's later merges regressing what meetverify5 proved.
2. **The P0 save fix (QA-34) LIVE:** the honest one — open a doc, hold an OS lock on its file (PowerShell), type; the app must NOT say "Saved" while the write is blocked; release the lock → it saves; sustained block → the warning + "Save a copy elsewhere". This was Opus-built + reviewed but never live-verified. High value.
3. **QA-35 disk-full recording LIVE (the gap qa35fix honestly skipped):** fill the disk during a recording → honest "disk is full" error + clean stop + the partial recording preserved (not eternal-pending). Restore disk after.
4. **The trust honesty pass (Tier A) spot-check:** the Data Map "Where your data goes" page now describes the Wealthbox write path honestly (not "never writes back"); the privacy headline and provider-name surfaces agree. Screenshot the corrected Data Map — it's the compliance-officer page.
5. **The Recording Notice Kit:** consent dialog shows the "say this out loud" script at record-time (the bug the trust review caught — confirm it renders now if noticecard has merged by your run; if not merged yet, note it); after a recording, the notice-verified state / needs-review appears.
6. **Broad smoke:** onboarding, connect a client, cited Ask, one CRM push — confirm nothing from the day's churn broke the core loop.

## Optional if time (deallocate-budget aware)
7. **Zoom live call-recording test:** the Zoom demo account is ready (`~/keepance-coordination/demo-creds/zoom-account.md`) — host + join from a 2nd context, record in-app, verify both channels + transcript. (Teams already confirmed; this adds Zoom.)

## Reporting
Evidence `docs/evidence/regression-20260704/` on lp/windows-smoke-evidence, commit+push (branch-check first). Per-item PASS/FAIL/REGRESSED with screenshots. Any regression is a real finding → BUG-DB with repro. Plain-language summary for Jameson. Leave the Legion quiet. Last line exactly: `WORKER-DONE: regression`

## Landmines
No product code changes — findings route to the coordinator. Restore anything you break (disk, file lock). Unique tunnel port. No cloud transcription. Never touch ~/lantern. No interactive menus.
