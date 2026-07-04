# Bench brief — cloud bench-1 PARALLEL regression (the non-audio half, alongside the Legion)

**Lane:** cc-lantern-cloudreg · dir `~/lp-bench2` (make a fresh worktree on lp/windows-smoke-evidence). **Model:** Sonnet 5 · high.
**Seat:** Azure `lantern-cloud-bench-1` (I just ran `az vm start` — give it ~1-2 min; details/creds `coordination/azure-bench/SETUP-LOG.md`). This runs IN PARALLEL with the Legion regression lane, which owns the AUDIO half. You do the parts that need no real microphone. **Deallocate the VM when done.** SSH tunnel: `127.0.0.1` not `localhost`; unique port. Drive via `scripts/desktop-drive.mjs`.

## Setup
Update the VM repo to current `origin/lantern-plus` tip, rebuild, launch fresh. (VM may be behind — budget the rebuild.)

## The non-audio regression pass (screenshot each; ~22 merges landed today)
1. **QA-34 P0 save-integrity LIVE (the flagship gap):** open a doc, hold an OS-level lock on its file (PowerShell `[System.IO.File]::Open(...)` with exclusive share), type several sentences → the app must NOT show "Saved" while blocked; release → it saves; sustained block → the persistent warning + "Save a copy elsewhere" rescue. Then restart → confirm nothing typed was lost. This is the worst bug of the campaign; it was Opus-built + reviewed but never live-verified.
2. **Tier A honesty pass:** the Data Map "Where your data goes" page describes the Wealthbox write path honestly (NOT "never writes back"); the AES-256 pill says optional; the "stores none of your data" / SOC-2 pills are attributed honestly; the privacy headline + provider-name surfaces agree. Screenshot the corrected Data Map (the compliance page).
3. **Broad smoke:** onboarding, connect a client, a cited Ask (verify a citation opens the real source), one CRM push — the core loop still works after the day's churn.
4. **QA-32/33 startup fixes:** if reproducible, confirm a stopped credential service now gives a fast honest error + degraded open (not a silent 30s hang), and the folder-picker watchdog.

## Reporting
Evidence `docs/evidence/cloudreg-20260704/` on lp/windows-smoke-evidence, commit+push (branch-check first). Per-item PASS/FAIL/REGRESSED + screenshots; any regression → BUG-DB. Plain-language summary. **Deallocate bench-1** (`az vm deallocate -g lantern-bench -n lantern-cloud-bench-1`). Last line exactly: `WORKER-DONE: cloudreg`

## Landmines
No product code changes. Restore anything you break (file lock). Never touch ~/lantern. No cloud transcription. No interactive menus.
