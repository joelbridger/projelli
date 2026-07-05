# Hunt4 (bench-1, cloud) — Document / save-integrity / connector hunt

**Lane:** cc-lantern-hunt4 · **Date:** 2026-07-05 · **Bench:** Azure `lantern-cloud-bench-1` (cloud VM, Tailscale `100.75.247.98`, user `lpbench`, repo `C:\lantern-plus`). **Tip tested:** `73e3b151` (updated from the VM's stale `371702eb`, fast-forwarded, rebuilt — real cargo recompile since the diff touched `src-tauri`). **AI mode:** cloud (OpenAI GPT via a real `.env.test` key — local Ollama isn't installed on this bench, confirmed via an honest "Ollama isn't running" error, not a hang).

## Setup landmines hit (for the next session)

1. **QA-60 case-collision still blocks boot on this tip** (`MeetingNoteOutboundGate.tsx` / `meetingNoteOutboundGate.ts`, not yet merged to `lantern-plus` mainline as of `73e3b151`). Applied the standard local-only workaround: renamed the lowercase file to `meetingNoteOutboundGateCore.ts`, fixed its one importer, cleared `node_modules/.vite`, full process restart. **Not committed** — bench-local only, per the recurring instruction.
2. **A hard `Stop-Process -Force` on `lantern.exe` left a stale handle on `C:\tauri-dev.log`**, which then silently broke every subsequent relaunch attempt (`cmd.exe` opens the batch file, tries to redirect `>` into the locked log, fails instantly, exits — zero new process, zero log growth, scheduled-task result code 1 with no useful detail). Neither `Stop-ScheduledTask` + kill + `Start-ScheduledTask` nor a direct `Start-Process`/`schtasks /run` could clear it from an SSH session. **Fix: a full `az vm restart`** cleared the lock and the `AtLogOn` auto-logon scheduled task (`LanternDevBench`) came up clean on its own — this is the reliable recovery path, not manual SSH-triggered relaunches, when a hard-kill leaves a locked log file behind.
3. Tailscale logs itself out on every VM start/restart (known, documented landmine) — reconnected each time via `az vm run-command invoke` with the saved reusable authkey (`~/lp-azure/creds/tailscale_authkey.txt`), which works even before Tailscale itself is reachable since it goes over the Azure control plane.
4. A real Wealthbox API token was already available at `~/.config/wealthbox-seed/curl.cfg` from an earlier session — reused it for live connector testing rather than a synthetic/mocked flow.

## Mission scope (per brief): Word/.docx engine + save integrity + connectors — NOT meetings/audio (hunt3) or RAG cross-workspace (ragleak)

### 1. Save/reopen integrity — mostly holds; QA-34/QA-43 fix confirmed live

- Imported a real, freshly-generated multi-paragraph `.docx` (python-docx fixture, `IPS-Hunt4-SaveTest.docx`) into a dedicated test client via a direct external file-copy (proves the FileSystemWatcher auto-detects external drops — it did, instantly, at this point in the session).
- Ran 4 manual-edit → save → close/reopen cycles (via navigate-away-and-back, not just tab-hide) — all 4 markers survived every cycle intact, `CHANGES` count tracked correctly, `Accept all` correctly finalized each one.
- Ran a real cloud-AI "Revise with AI" redline — proposed a tracked change correctly, `Accept all` applied it cleanly.
- **Aggressive re-repro of QA-34/QA-43 (file-lock during autosave):** held an exclusive OS-level lock (`FileShare.None`) on the `.docx` from a separate process, typed new content while locked. The edit correctly stayed as a **pending, honestly-represented tracked change** (not silently marked "Saved" as base content) — released the lock, accepted the change, and confirmed via direct `python-docx` disk read that it flushed to disk correctly. **No silent permanent data loss reproduced** — the QA-34/QA-43 fix (commit `1231f395`, already merged to `lantern-plus` mainline) holds under a fresh repro on this tip.
- **Kill-mid-typing test:** typed a marker, hard-killed `lantern.exe` within ~1s (before any autosave debounce could fire). Result: only that last, genuinely-unsaved keystroke was lost (expected/acceptable for any autosave-based editor) — **no corruption**, all prior content intact, confirmed via direct disk read both immediately after the kill and again after a full VM reboot. App/workspace recovered cleanly on relaunch with the full "QA Workspace" (9+ clients) intact.
- **New finding, QA-76 (P2):** manual typed edits are NOT tracked as reviewable/rejectable changes until the FIRST AI action runs on that document, even with "Reviewing" toggled on. See below.
- **Positive:** QA-5 (new clients get zero default folders) appears fixed — a freshly-created client in this session immediately showed "1 folder" and documents landed correctly.

### 2. Word engine edge cases — two real rendering gaps found, both verified as display-only (not data loss)

Built a 50+ page synthetic fixture (`BigDoc-WordEngineTest.docx`) with a large table (41×5), an embedded PNG, superscript reference markers, and heavy paragraph padding.

- **QA-77 (P2):** tables and images render as opaque "[preserved content...]" / "⋯" placeholders — zero visual representation. Verified via `python-docx` + raw zip inspection that the actual table data and image file survive a save round-trip byte-correct — a rendering gap in the custom OOXML engine, not data loss, but a real functional gap for a document-heavy financial-advisor product.
- **QA-78 (P3):** superscript formatting displays as plain baseline text; the underlying `<w:vertAlign w:val="superscript"/>` XML is confirmed intact after save.
- Tracked-changes Accept/Reject both work correctly once a change is properly tracked (see QA-76 for the case where it isn't).

### 3. Connectors — Wealthbox connects but silently imports nothing (QA-74, P1)

Used a real, live Wealthbox API key (already available on this server from an earlier session) to connect for real, not a mock:

- Connection itself succeeded cleanly: "Connected to Northcrest (basic)."
- The "Import 40 Wealthbox households" flow completed with no error and no stuck spinner.
- **But the Client Map stayed at exactly 9 clients, 9 folders indexed — before and after, across TWO separate attempts** (the initial import confirm, and a manual "Sync now" retry). Zero of the 40 households ever appeared anywhere. No console/network error surfaced either time. This is a complete silent failure of the connector's core promise.
- Email (Microsoft 365 / IMAP) and other connector cards (OneDrive, DocuSign, ShareFile, Box, Addepar) were visually inspected but not live-tested against real accounts — no credentials available for those in this session; flagging as untested rather than claiming a pass.

### 4. Cross-cutting edge cases

- **New client creation**: confirmed fixed (see above, QA-5).
- **Unicode/emoji filenames**: files named with accented Latin (Éé), Japanese (日本語), and emoji (🎉📊) all rendered PERFECTLY once the file tree actually refreshed — **unicode itself is not a bug**.
- **QA-75 (P1/P2, matches the QA-19 class):** the live file tree stops picking up new externally-added files partway through a session. The FIRST external file drop (early in the session) was picked up instantly by the FileSystemWatcher. Four LATER external drops (after a VM reboot + app relaunch mid-session) — including one with a plain ASCII name — never appeared in the file tree despite folder collapse/expand and full navigate-away-and-back. Confirmed NOT unicode-specific: a full app restart made all 4 appear correctly and instantly (including full emoji rendering). Root cause is most likely the FileSystemWatcher not being correctly re-established across the app-relaunch-after-reboot path, with zero user-visible indication anything is stale.
- Two-docs-open-at-once and disk-near-full were not exhaustively re-tested given time budget — disk-near-full during save is already covered by QA-35 (prior lane); no cross-contamination was observed between documents in the course of normal multi-file testing in this session.

## Findings filed (BUG-DB.md, source tag `hunt4/bench-1`)

| ID | Severity | One-line summary |
|---|---|---|
| QA-74 | P1 | Wealthbox connector claims success, zero client data ever lands in Client Map |
| QA-75 | P1/P2 | File tree stops picking up new externally-added files mid-session (matches QA-19 class); NOT unicode-related |
| QA-76 | P2 | Manual edits untracked/unrejectable until first AI action runs on a document |
| QA-77 | P2 | Tables/images not rendered (verified NOT data loss — round-trips correctly) |
| QA-78 | P3 | Superscript formatting not rendered (verified NOT data loss) |

## Positive confirmations (not new bugs)

- QA-34/QA-43 save-integrity fix holds under a fresh file-lock-during-autosave repro on `73e3b151`, including surviving a full VM reboot.
- Local-AI unavailability shows an honest, clear error ("Ollama isn't running") — no hang, nothing sent.
- Hard-killing the app mid-typing loses only the last unsaved sub-second keystroke, no corruption; app/workspace recover cleanly.
- QA-5 (new clients had zero default folders) appears fixed.
- QA-60 case-collision boot bug is still present on `lantern-plus` mainline as of `73e3b151` (not yet merged from either fix candidate) — required the standard local workaround to boot at all.

## Screenshots

All 60 screenshots in `screenshots/`, numbered in narrative order (00–59). Key ones: `00` boot confirmation, `11`/`15`/`16`/`28`/`30` save-integrity cycle evidence, `32`/`34` file-lock repro, `37`–`41` Word-engine rendering gaps, `44` retroactive tracked-change reveal, `51`–`54` Wealthbox silent-failure, `55`–`59` file-watcher staleness repro + restart fix.
