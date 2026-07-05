# Explorer brief — QA campaign lane 2: "the daily driver, a week compressed" (persona B)

**Lane:** cc-lantern-qa2 · dir `~/lp-qa2` (your OWN worktree, branch `lp/qa-persona-b`). **Model:** Sonnet 5 · high.
**Read first:** `coordination/QA-CAMPAIGN.md` (rules, severity scale, bug-DB format) + the qa1 lane detail in `coordination/qa-campaign/BUG-DB.md` (so you don't re-file QA-5..QA-12 — they're known). You are an EXPLORER: find and report, never fix product code.

## Seat
Azure `lantern-cloud-bench-1` (details + landmines: `coordination/azure-bench/SETUP-LOG.md`, incl. the 2026-07-04 section). `az vm start` it; **deallocate when done**; ≤3h VM budget. **The VM's repo is ~12+ commits behind and predates the Meetings tab — update it to the current `origin/lantern-plus` tip and rebuild the app first** (warm target on the VM; budget the rebuild inside your window). SSH tunnel landmine: use `127.0.0.1` (not `localhost`) in any `-L` port-forward spec. Drive over CDP via `scripts/desktop-drive.mjs`.

App state: you are NOT first-run. Restore the app-data backup at `C:\qa-backup-20260704` if intact, or build a plausible working practice fresh (workspace + 3-4 clients + files linked per client). You're an advisor who has used this app for a while.

## Mission
Compress a realistic work-week as a busy advisor who is past onboarding: hop between clients; create + edit Word documents; import files; run Asks against real content across clients (check citations point at the right client's docs — cross-client bleed = P0); use the **new Meetings tab** (between Email and Activity) — explore its whole surface: record pill, consent dialog, transcript viewer, notes, needs-review queue, dictation filing. ⚠️ This cloud VM has NO real audio hardware — judge the meetings UI/flows and how gracefully recording behaves with no usable mic (a crash or wedged state = real finding; a clean "no device" path = good), don't judge transcription quality here. Queue CRM pushes (Wealthbox demo account) and watch the review-card lifecycle across an app restart (QA-1's fix is merged — verify it held). Work fast and impatiently like a real user: switch tabs mid-operation, edit two docs in quick succession, ask a question then immediately navigate away, resize the window through the day.
Probe 3 edge-catalog items along the way: a ~200-file bulk import; network loss mid-ask (disable the VM NIC briefly or block the endpoint); rapid app restart while an index/download is in flight.

## Reporting
Append findings to `coordination/qa-campaign/BUG-DB.md` continuing the ID sequence (QA-13+), severity + repro + evidence path (`coordination/qa-campaign/evidence/qa2-20260704/`). Record what's GOOD too — the report should let a designer feel a working week. Plain-language summary at the end (Jameson reads it). Commit on YOUR branch in YOUR worktree (`git branch --show-current` first — must say `lp/qa-persona-b`), push, deallocate the VM, then the last line exactly: `WORKER-DONE: qa2`

## Landmines
Never fix product code. Never touch the Legion (bench-1 is your only seat). No cloud transcription paths ever. If you hit a blocking decision: plain text prefixed `COORDINATOR:`, no interactive menus.
