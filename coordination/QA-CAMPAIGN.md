# Fresh-Eyes QA Campaign — control doc (Jameson-ordered 2026-07-04)

**Mission (Jameson's words):** "take a fresh view of this whole app as a real human would and go in and try everything and especially investigate and solve for edge cases." High quality, high efficiency, continuous.

## Operating rules
- Explorers TEST and REPORT; they do not fix product code. Every finding lands in the bug DB below with: repro steps, severity (P0 data-loss/crash · P1 broken feature · P2 wrong-but-workaroundable · P3 polish), evidence (screenshot/log), and an honest "is this real or my setup?" call. The coordinator triages → scoped fix lanes → merge → re-verify on a bench.
- Test seats: Legion (real hardware, one driver at a time) · Azure bench-1 + bench-2 (snapshot-resettable; bench-2 has VB-CABLE) · browser dev build on the server (fastest, for UI-only exploration).
- Personas drive sessions: (A) brand-new advisor, first 30 minutes — install/onboard/connect, does anything confuse or break; (B) daily-driver — a realistic week of work compressed (meetings, notes, asks, CRM pushes); (C) the klutz — mis-clicks, double-clicks, back-button abuse, cancels mid-flow, closes the laptop lid at the worst moment; (D) the edge-case hunter — systematic abuse (below).
- Edge-case catalog (D lanes work through this, extending as they go): huge files (500MB PDF), zero-byte files, filenames with emoji/unicode/reserved Windows names (CON, trailing dots), 500-client workspace, EMPTY workspace, disk nearly full, network loss mid-sync/mid-ask, OAuth token revoked mid-session, system sleep/resume during recording and during indexing, clock skew, DPI scaling/multi-monitor, non-English content and locales (de/es ship), rapid app restart, two instances launched, workspace on a USB drive/synced folder, antivirus-style file locks.
- **Real meeting-client recording verification (top priority, Legion):** an actual Teams call (host via the demo M365 account), then Zoom and Google Meet (need account setup — coordinator arranges). Record, verify both channels contain the real call audio, diarization runs, note lands.
- Bug DB: `coordination/qa-campaign/BUG-DB.md` (explorers append; coordinator owns status transitions). Evidence under `coordination/qa-campaign/evidence/<lane>-<date>/`, committed on `lantern-plus`.

## Session log
- 2026-07-04: campaign opened. Lane 1 = persona A on Azure bench-1 (app-data wipe first to simulate first-run). Real-call Teams test queued for the Legion after the cold-boot confirmation run frees it.
