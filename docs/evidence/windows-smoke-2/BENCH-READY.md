# Legion Bench — Prep Log (bench-prep lane)

**Date:** 2026-07-03
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`)
**Checkout:** `C:\lantern-plus`
**Purpose:** bring the bench fully current and verified-healthy before the Wave-3/4 verification passes, per `coordination/briefs/w-bench-prep-brief.md`. No feature tests were run — prep only.

## Bench SHA

- Found at start: `fa172efa` (behind).
- Pulled clean fast-forward (no local changes, no lockfile diff) to: **`e4050327`** (`origin/lantern-plus` tip at pull time).
- The pull brought in the **CRM wire-fixes merge** (`b3bca9a0` and follow-ons through `e4050327`), which patches the two backend bugs (`background_information` wire-field mismatch, missing Wealthbox task `due_date` validation) the last Wave-2 re-test found and flagged unfixed.
- `npm install`: `up to date, audited 806 packages` — no lockfile change, no new deps needed.

## Build

- Full `npm run tauri:dev` launch via the `LanternPlusDev` scheduled task (found **Disabled** at session start — no dev/cargo/node processes were running; a handful of unrelated `msedgewebview2.exe` processes were present but belong to Windows' own Search feature, not the app — left untouched, no kill needed).
- Vite: **ready in 319ms**.
- Cargo (`lantern v3.3.5`): real recompile, **1064-1065/1066 objects rebuilt** (not a cache-hit skip) — confirms the Rust source changes (`crm/write.rs`, `crm/commands.rs`) actually got compiled, not skipped on a stale hash.
- **Finished `dev` profile [unoptimized + debuginfo] in 1m 35s.** One harmless pre-existing warning (`unused import: std::os::windows::process::CommandExt` in `util/proc.rs`) — not new, not a build failure.
- Exit/result: clean. App launched (`target\debug\lantern.exe`), one expected startup WARN log about a legacy `AppData\Roaming\keepance` folder coexisting with the migrated `lantern` folder (known, non-destructive, not touched).

## Build-freshness canary — PASS

Grepped the freshly-built `target\debug\lantern.exe` binary directly for two string literals that only exist in the new tip's `crm/write.rs`:
- `"Wealthbox tasks need a due date"` — **found**
- `"the CRM accepted this write but the field did not actually change — treated as failed, not sent"` — **found**

Binary `LastWriteTime` (4:26:22 PM) matches the build-completion timestamp. CDP (`127.0.0.1:9223/json/version`) responded correctly once the app was up. Confirms this is a real rebuild of the pulled tip, not a stale binary.

## Bench health checklist

| Check | Result |
|---|---|
| Workspace binds (Northcrest Wealth Partners loads, opens to last-session client) | **PASS** |
| Per-client folder mapping intact | **PASS** — Client Map whole-book view shows Caldwell, Jennifer and the other 25 originally-mapped clients as "1 folder"; the 14 additional Wealthbox-imported households correctly show "No folders" (expected — matches prior evidence run) |
| Documents tab shows real per-client files | **PASS** — Caldwell, Jennifer → Documents shows her real files (Agreements/DocuSign Certificate of Completion, etc.) |
| RAG search index | Was mid-rebuild at boot ("Indexing PDFs: 122/301") — **let it run to completion**, confirmed banner cleared (index fresh) |
| M365 (Sarah Morgan) — Mail connection | **Connected.** (Account → Connections panel) |
| M365 (Sarah Morgan) — Calendar connection | **Connected** ("Outlook calendar connected — Read-only · past 7 days +…") |
| Wealthbox connection | **Connected.** |
| Console errors during navigation (Client Map, Documents, Settings/Account) | **None** — one onboarding "feature tour" overlay (`feature-tour-skip`) was blocking clicks on first load (expected first-open behavior after a workspace reload picked up prior session state); dismissed cleanly, zero console errors or page errors afterward |

No sign-in prompts were needed for either connection (both connections were already live from the prior session and survived the app restart) — no MS anti-automation risk incurred, no Jameson hand-off needed.

## Headset check

A physical headset is now plugged into the Legion. Windows sees both directions correctly:
- **Output:** "Headphones (AB13X USB Audio)" — Status: OK
- **Input:** "Microphone (AB13X USB Audio)" — Status: OK

Capture was **not** tested (per brief, that's the Wave-3 lane's job).

## Bench state left behind

- App stopped (`Stop-ScheduledTask`), all `lantern`/`node`/`cargo` processes killed, CDP port 9223 confirmed no longer responding.
- `LanternPlusDev` scheduled task returned to **Disabled** — the exact state it was found in at session start.
- SSH tunnel (port 9444 → bench 9223) closed.
- No changes made to `C:\bench-backups\` or `C:\KeepanceWorkspaces\`.
- Jameson's personal account/Bitwarden untouched throughout.
- One bench driver the whole session — nothing else drove the Legion concurrently.

## Nothing broken

No new issues found. The bench is warm, current, and healthy — ready for the Wave-3/4 verification passes to start immediately without setup overhead.
