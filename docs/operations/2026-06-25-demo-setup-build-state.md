# Keepance Live-Demo Setup — Build State (2026-06-25)

Goal: a repeatable demo control panel on the Legion bench (`james@100.127.67.22`, Tailscale)
so Jameson can show people the product. Bench is a **dedicated testing bench** (do NOT use it
as a Parsec *client* — that steals its screen and crashes the GUI app). For actual presenting,
the plan is to install Keepance on Jameson's own desktop later (a UI/polish-stage task).

## Decisions (from interview with Jameson)
- Demo runs on the Legion bench; remote viewing already works (Parsec / Chrome Remote Desktop / TeamViewer installed).
- Build BOTH modes: **LOADED** (firm pre-loaded, instant, + one small client built live) and **BLANK** (true first-run, build live).
- Email: a **fake advisor Outlook inbox** (to be created) populated with realistic client emails, connected in-app.
- "Fully build out + make functional first, THEN do a UI pass" (lots of UI changes pending — hold them all for the UI pass).

## DONE
- **Import fix shipped** (commits `07d72fc1`, `a25fe973` on `keepance-3.0`, pushed): PDFs now index on workspace open. Verified live.
- **LOADED mode works**: 26 Northcrest clients seeded, full index built (~63 MB on disk), **Hollings Family client map pre-built** (~33 items, cited), and **Ask works** ("$50,200,000" cited).
- **Restarts are CHEAP**: index survives a restart; app usable in seconds (no 7.5-min re-index). A mid-demo crash recovers fast. (Confirmed: restart → dismiss tour → Ask works.)
- **Blank-reset script** written: `scripts/demo/legion-reset-blank.mjs` (clears localStorage, no seed → first-run wizard). Not yet wired into an orchestration .sh / tested end-to-end.
- **Staged live-build client** content written: `scripts/demo/staged-live-client/Brennan, Thomas & Karen/` (5 .txt files — Intake, Account Summary, Estate, Meeting Recap, Recommendations; portfolio $8.54M, Roth plan, estate attorney Catherine Pruett). Files are also staged on the bench at `C:\demo-staging\Brennan, Thomas & Karen\` and an empty client folder + `C:\demo\Add Brennan files.bat` trigger exist.
- **Email import confirmed REAL** (Outlook/M365 connector, ~10.8k lines Rust under `src-tauri/src/commands/mail/`; imported emails get RAG-indexed like docs; Ask has an Email scope). Demo-able with a real Outlook account in the desktop app. Gmail needs a build secret (shakier).

## Bench state right now
- App UP (CDP 9223, vite preview 5173). Index ~63 MB intact. 26 matters, correct mappings, **zero pollution**. Hollings map built.
- Tunnel from server: `bash scripts/.../fix-tunnel.sh` → `127.0.0.1:9444` → bench 9223. (MUST be 127.0.0.1, not localhost.)
- 5 Brennan .txt files currently sit in `Clients\Brennan, Thomas & Karen\` on disk (indexed as *unassigned* — the Brennan matter was removed during cleanup). A 27th folder with no client; harmless but redo Brennan cleanly.

## Key mechanics (verified)
- Indexing the full firm = ~7.5 min (≈300 scanned PDFs + OCR) → must stay PRE-loaded. Live-build uses a SMALL .txt/.docx client (~1 min; .txt/.docx skip OCR, PDFs don't).
- Matters never auto-created from folders. Create via the **New-Client dialog** (open it: `window.dispatchEvent(new CustomEvent('keepance:open-matter-manager'))`; fields `matter-new-name`/`matter-new-client`; `matter-create-button`). Map a folder via the chip `matter-folder-<matterId>-<folderPath>` — **⚠️ the dialog renders one such chip PER MATTER for the same folder; click ONLY the chip whose matterId is the target** (clicking the filtered set mapped the folder onto all 27 clients — the mistake that had to be undone).
- Client Map builds on ONE click `hub-panel-clientmap-open`, only when status==idle. **LANDMINE: click before files are indexed → sticky EMPTY map, no rebuild button.** Always: files indexed first, then one click.
- Navigation: `hub-back-btn` returns from a client hub to the "Clients" home; the matters list is VIRTUALIZED (off-screen rows aren't in the DOM); the feature tour modal (`feature-tour-center`, dismiss with Esc or `feature-tour-skip`) **reappears on restart and blocks all nav** — suppress it in the demo seed (`keepance:settings` → `featuresTourCompleted:true`).

## REMAINING (next session)
1. **Finish Brennan live-build**: map ONLY the Brennan matter's folder chip (recreate Brennan first — it was removed), get its 5 files indexed+tagged, confirm the map builds + a cited answer. Then design the on-stage trigger (recommended: pre-seed Brennan + folder mapped + EMPTY, files dropped live via `Add Brennan files.bat`, then 1 map click — OR the simplest "click Client Map and watch it build from already-staged files").
2. **Reset scripts**: a "reset to LOADED" (purge residue + remove any live-created client/map + suppress tour, NO full reindex) and the "BLANK" orchestration (.sh wrapping legion-reset-blank.mjs + restart). Bake the Hollings (and other deep) client maps into a seed snapshot so resets are instant.
3. **Pre-build more deep-client maps** (only Hollings is built). Drive UI per client (handle virtualization + use `hub-back-btn` between clients); capture `keepance:client-maps` into the loaded seed.
4. **Email inbox**: create a fake advisor Outlook account (Chrome + Android OTP), populate ~15-20 realistic client emails (IMAP append or sends), connect in Keepance, verify a cited-from-email Ask.
5. **BLANK mode**: a small fresh workspace + the first-run wizard flow + a small live-build client.
6. **Self-serve**: desktop shortcuts on the bench (Loaded / Blank / Reset / Add-client-files) so Jameson flips modes himself.
7. **THEN the UI pass** (Jameson has lots of UI changes/questions — gather + implement after functional).

## Gotchas
- PowerShell-over-SSH with quotes/`$_`/paths-with-spaces breaks constantly → **write a .ps1, scp it, run `powershell -File`.**
- The tunnel is flaky → re-run `fix-tunnel.sh` before each CDP op; it kills the old tunnel by PID (never `pkill -f`).
- The bench GUI app needs a free interactive screen. Don't run Parsec *on* the bench as a client. If the app dies: kill `keepance,msedgewebview2,node` then `Start-ScheduledTask KeepanceDev` (full-restart.ps1).
- The OpenAI key lives in the OS keychain and survives `localStorage.clear()`.
