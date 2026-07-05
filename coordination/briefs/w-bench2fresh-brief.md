# Explorer brief — bench-2 FRESH first-run + new-features audio pass (distinct from the two scripted regressions)

**Lane:** cc-lantern-bench2fresh · dir `~/lp-bench3wt` (fresh worktree on lp/windows-smoke-evidence). **Model:** Sonnet 5 · high.
**Seat:** Azure `lantern-cloud-bench-2` (VB-CABLE virtual audio — this is the audio-capable cloud bench; just `az vm start`ed, give it ~1-2 min). **Deallocate when done.** SSH `127.0.0.1` not localhost; unique tunnel port; `scripts/desktop-drive.mjs`.
**Why distinct:** the Legion runs scripted audio regression, cloud bench-1 runs scripted non-audio regression. YOU are the fresh-eyes explorer: a brand-new skeptical advisor meeting the day's ~23 merges for the first time, WITH working audio. You catch what scripts don't.

## Setup — a TRUE first run
Update the VM repo to current `origin/lantern-plus` tip, rebuild. Then simulate a brand-new user: stop the app, back up + delete the app-data dir (`%APPDATA%\lantern`) and rename any existing workspace away, so onboarding runs from scratch. Launch fresh.

## The pass (fresh-user lens; screenshot freely; VB-CABLE gives you real audio for recording)
1. **Onboarding from zero** — does the day's honesty pass (Tier A) read right to a new user? Screenshot the connect-your-data / AI-choice screens; confirm no overclaiming headline, the "Most private/Most capable" framing on the AI cards, the SOC-2/AES pills honest.
2. **Full Meetings flow with real audio** — connect a client, record a real ~90s meeting (speak via VB-CABLE), watch transcript → notes land; confirm the **Notice Kit** consent dialog shows the "say this out loud" script at record time, and the notice-verified/needs-review state appears after. Restart → everything persists.
3. **The Data Map as a new skeptic** — open "Where your data goes"; confirm the Wealthbox row is honest about the write path. This is the compliance page — screenshot it.
4. **Cited Ask** — ask a question, open a citation, confirm it points at the real source.
5. **Break-it-a-little as a fresh klutz** — anything that surprises, confuses, or reads as overclaiming to a first-timer. This is judgment, not a checklist.

## Reporting
Evidence `docs/evidence/bench2fresh-20260704/` on lp/windows-smoke-evidence, commit+push (branch-check first). What's good + what a fresh user distrusts/misreads; any regression → BUG-DB. Plain-language summary. **Deallocate bench-2.** Last line exactly: `WORKER-DONE: bench2fresh`

## Landmines
No product code. Restore/backup before wiping app-data. Never touch ~/lantern. No cloud transcription. No interactive menus.
