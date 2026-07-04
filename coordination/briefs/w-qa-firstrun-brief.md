# Explorer brief — QA campaign lane 1: "brand-new advisor, first 30 minutes" (persona A)

**Lane:** cc-lantern-qa1 · dir `~/lantern-plus`. **Model:** Sonnet 5 · high.
**Read first:** `coordination/QA-CAMPAIGN.md` (rules, severity scale, bug-DB format) — you are an EXPLORER: find and report, never fix product code.

## Seat
Azure `lantern-cloud-bench-1` (details + landmines: `coordination/azure-bench/SETUP-LOG.md`). `az vm start` it; deallocate when done (≤2h VM budget). The app + workspace are pre-baked — to simulate a BRAND-NEW user: stop the app, back up then delete the app-data dir (`%APPDATA%\lantern`, plus any `%APPDATA%\keepance` legacy dir — note what you find) and rename the existing workspace folder away. Then launch and experience true first-run.

## Mission
Live the first 30 minutes exactly as a skeptical advisor who just installed it, over CDP (drive it like a human: read every screen, click what a human would click). Judge everything: Is the onboarding clear? What's confusing, broken, mislabeled, or jargon-y? Does the empty state make sense? Create a workspace from scratch, add a client, drop in a few files (make simple ones), try Ask before anything is indexed (what happens?), open Settings, poke every visible surface. Try the honest paths AND the impatient ones (skip buttons, close dialogs mid-flow, resize the window small).
Also probe 3 items from the edge catalog while you're there: launch two instances; kill the app during initial indexing then relaunch; a client folder with a unicode/emoji name.

## Reporting
Append every finding to `coordination/qa-campaign/BUG-DB.md` (create it, table per the campaign doc) with severity + repro + screenshot path (`coordination/qa-campaign/evidence/qa1-20260704/`). Also record what was GOOD — the report should let a designer feel the first-run. Plain-language summary at the end (Jameson reads this). Commit on `lantern-plus` (`git branch --show-current` first), push, deallocate the VM, then the last line exactly: `WORKER-DONE: qa1`
