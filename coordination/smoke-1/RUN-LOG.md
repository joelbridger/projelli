# Windows Bench Smoke — Lantern-Plus Waves 0-2

**Date:** 2026-07-03
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`)
**Checkout:** fresh git clone at `C:\lantern-plus`, branch `lantern-plus`, tip commit `463a83fa` ("coordination: bench smoke brief (+ handover conditions); Legion reserved")
**App:** `advisor-prep-hero@3.3.5`, dev build (`npm run tauri:dev`) via a dedicated `LanternPlusDev` scheduled task (interactive session)
**Workspace used:** `C:\lantern-plus-smoke\Northcrest Wealth Partners` — a copy of the shared demo dataset `C:\keepance-demo-northcrest`, made specifically to avoid writing into shared/protected paths (`C:\bench-backups`, `C:\KeepanceWorkspaces` were never touched; confirmed via `Test-NetConnection`/process checks that the bench was quiet before starting)
**Sidecar note:** the fresh checkout's first build failed on a missing `piper-x86_64-pc-windows-msvc.exe` sidecar binary (known bench gotcha — cold checkouts need `src-tauri/binaries/*` copied from an existing checkout). Copied read-only from `C:\keepance\src-tauri\binaries\*`, then the rebuild succeeded (`Finished dev profile ... in 4m 18s`).
**Manual-step note:** the Wave 1 Outlook/Microsoft calendar sign-in was completed manually by Jameson at the keyboard (a passkey/biometric prompt tied to his personal Bitwarden vault appeared mid-OAuth on this bench's Chrome profile — the AI worker cannot and should not automate a passkey tap). This is expected, not a defect; noted inline below.

## Summary

| Wave | Result |
|---|---|
| 0 — Draft follow-up + Client Map | **PARTIAL** — draft generation, citations, hover previews, and cancel-on-close all work; **Save to Drafts is stuck disabled**, the **client Files view can't see real files**, and the **per-client Client Map errors out** |
| 1 — Calendar connect + briefs | **FAIL** — CalendarConnect card renders and the OAuth flow itself works, but the connection does not persist / register as connected, so no meeting-matching, briefs, or agenda export could be exercised |
| 2 — Wealthbox CRM write-back | **FAIL** — Wealthbox connects and syncs cleanly, but there is no discoverable "Send to Wealthbox" action anywhere in the UI |
| Cross-cutting | **PASS** — light theme throughout, no console error flooding, egress indicator/Local-only mode behaves correctly (local generation succeeds, no silent cloud call) |

---

## Wave 0 — Draft follow-up, Client Map

### Step 1: Bench prep — PASS
- Confirmed bench quiet (no `cargo`/`node`/`keepance` processes, CDP port 9223 not listening) before touching anything.
- Cloned `lantern-plus` branch fresh to `C:\lantern-plus`, `npm install` clean (794 packages), copied Piper sidecar binaries, launched via new `LanternPlusDev` scheduled task.
- Version/branch confirmed via `git log` on the bench checkout (branch `lantern-plus`, commit `463a83fa`) and the in-app title `Advisor Prep Hero` / `advisor-prep-hero@3.3.5`.
- Screenshot: `screenshots/w0-01-app-launch-workspace.png`

### Step 2a: Draft follow-up modal populates — PASS
- Opened a real meeting note (`Meeting Notes 2025-05-15 - Caldwell, Jennifer.docx`) via Ctrl+P quick-open, clicked **Draft follow-up**.
- Modal populated with a subject line, a cited draft body (4 citation chips), and a plain-text message mirror.
- Screenshot: `screenshots/w0-02-draft-followup-cited.png`

### Step 2b: Citation hover previews — PASS
- Hovering a citation chip (`May 15, 2025`) shows a tooltip with the source filename and the exact quoted line ("MEETING NOTES 2025-05-15 - CALDWELL, JENNIFER.DOCX" / `"Caldwell, Jennifer · May 15, 2025"`).
- Screenshot: `screenshots/w0-03-citation-hover-preview.jpg`

### Step 2c: Close cancels generation — PASS
- Re-triggered Draft follow-up and clicked the close (X) immediately, mid-generation. Modal dismissed cleanly; no lingering "Sending to your AI provider" indicator on the next screenshot, no leaked draft state on reopen.

### Step 2d: Save to Drafts — **FAIL (P0)**
- **Repro:** Open any client note → Draft follow-up → wait for generation to finish → fill TO with a valid email → click "Save to my Drafts".
- **Observed:** The button never becomes clickable. A raw Playwright `page.click()` against `[data-testid="followup-save-drafts"]` timed out after 30s with the browser reporting `element is not enabled` on every retry — this is a real disabled state, not a UI-only render glitch. A brief window right after setting the TO field via a synthetic React input event showed `disabled: false`, but by the time an actual click landed the button was disabled again, and it never became clickable afterward no matter how long we waited or how the field was filled (agent paste vs. programmatic `input`/`change` events).
- **Impact:** Blocks the entire "save to Drafts" acceptance item for Wave 0 — an advisor cannot ever save a drafted follow-up to their mailbox in this build.
- **Severity:** P0 — blocks a core, headline Wave 0 flow.
- Screenshot: `screenshots/w0-07-save-to-drafts-disabled.png`

### Step 2e: Client Map — source chips / "Imported meeting notes" filter — **FAIL (P0), and a related file-visibility bug**

Two related, serious findings surfaced while checking this item:

**(i) Per-client Files/Documents view cannot see real files that exist on disk.**
- **Repro:** Open any client (e.g. Caldwell, Jennifer) → Documents tab → both Grid and Tree view.
- **Observed:** "No documents yet" / "No files yet", even though the client's own folder (`Clients/Caldwell, Jennifer/Planning/Meeting Notes ....docx` etc.) genuinely has files on disk (confirmed via `Get-ChildItem` on the bench). Creating a **brand-new** document from inside this view (`New document` → named it, clicked OK) also silently "succeeded" in the UI but the file was written to the **workspace-root `docs/` folder** (`C:/lantern-plus-smoke/Northcrest Wealth Partners/docs/Watch Test Doc.docx`), not into `Clients/Caldwell, Jennifer/` — confirmed via captured console logs (`[DocCreate] docx destDir: .../docs`). So the per-client Files view is pointed at the wrong base folder for both listing and creation.
- **Workaround found:** Ctrl+P quick-open correctly indexes and finds real per-client files (e.g. searching "Meeting Notes" returns `Clients/Caldwell, Jennifer/Planning/Meeting Notes 2025-05-15 - Caldwell, Jennifer.docx` etc.), so the underlying file index has the right data — only the per-client Files/Documents tab is broken.
- **Severity:** P0 — this is how an advisor is meant to browse a client's own documents; it's empty for every client we checked.
- Screenshots: `screenshots/w0-04-files-tree-empty-bug.png`, `screenshots/w0-05-quickopen-finds-real-files.png`

**(ii) Per-client "Client Map" tab errors out.**
- **Repro:** Open any client → click the "Client Map" tab (top of the client detail header, not the sidebar nav item of the same name).
- **Observed:** "Could not build client map. Check your AI connection and try again." — even though AI connectivity plainly worked in the same session seconds earlier (Draft follow-up successfully called the cloud AI provider). Retried by re-entering the client; same error every time.
- **Impact:** This is (per the brief) where source chips naming the notetaker and the "Imported meeting notes" filter should live — with the view erroring out, neither could be verified at all. We also searched the whole app (top-level Client Map list, sidebar, Activity tab) for any "chip"/"notetaker"/"imported"/"filter" UI and found nothing outside this broken view.
- **Severity:** P0 — blocks this entire Wave 0 acceptance item.
- Screenshot: `screenshots/w0-06-clientmap-ai-connection-error.png`

**(iii) Minor — unfilled template placeholder text.** The generated meeting note content includes a literal `[preserved content - table, section, or other element kept as-is]` placeholder string visible in the document body — looks like an unfilled template artifact rather than real content. P2, cosmetic.

---

## Wave 1 — Calendar connect + briefs

### CalendarConnect card renders — PASS
- Account → Connections → Calendar card renders correctly: "Connect Microsoft" / "Connect Google" buttons, a "paste .ics link" fallback, and accurate read-only copy.
- Screenshot: `screenshots/w1-01-calendarconnect-card.png`

### Connect + sync — **FAIL (P0)**, with a manual-step note
- Clicking "Connect Microsoft" opens a real Microsoft OAuth flow. On this bench, selecting the pre-authenticated test account (`sarah.morgan.cfp@outlook.com`) triggered a Windows "Face, fingerprint, PIN or security key" prompt tied to a personal Bitwarden vault installed in that Chrome profile — a passkey/biometric gate the AI worker correctly refused to automate per policy (backed out cleanly without touching the vault, cancelled the connect attempt in-app, cleaned up the stray browser processes it left behind). **Jameson then completed this sign-in himself at the keyboard** and reported the calendar as connected. This hand-off is expected bench behavior, not a product defect.
- **However**, after that manual sign-in, a fresh read of the app state (Connections panel, reopened cleanly) still shows the Calendar card in its **disconnected** state ("Connect Microsoft" / "Connect Google" buttons, no "Connected." confirmation), and the Client Map shows **no "Today's meetings" strip** at all. Retrying "Connect Microsoft" from this state opened a fresh OAuth window rather than completing silently against an existing session, i.e. the app does not appear to have durably recorded the prior sign-in.
- **Impact:** Because the calendar never registers as connected in the app's own state, the rest of Wave 1 (today's-meetings matching, before-you-meet brief generation with citations, agenda .docx export) could not be exercised at all — there's nothing to test against.
- **Severity:** P0 — blocks the entire Wave 1 feature end-to-end.
- Screenshot: `screenshots/w1-02-calendar-still-disconnected.png`

### Before-you-meet brief / agenda export — **UNTESTABLE**
- Blocked entirely by the calendar-connection issue above; no meetings ever appeared to generate a brief or export an agenda from.

---

## Wave 2 — Wealthbox CRM write-back

### Wealthbox connects and syncs — PASS
- Account → Connections → Wealthbox card shows "Connected." out of the box in this workspace, and clicking "Sync now" completes with no visible error.
- Screenshot: `screenshots/w2-01-wealthbox-connected-card.png`

### "Send to Wealthbox" from a client note — **FAIL (P0)**
- **Repro:** Open a real client note (Caldwell, Jennifer's meeting note) and look for a way to push it to Wealthbox.
- **Observed:** No such action exists anywhere we could find:
  - Not in the document toolbar (only Draft follow-up / Export / Revise with AI / Reviewing toggle).
  - Not in the toolbar's "..." overflow menu (Download / History / Split horizontally / Split vertically / Toggle outline only).
  - Not on the Client Map list or per-client row actions (Ask / Documents / Email / Archive only).
  - Not on the client's Activity tab.
- **Impact:** Blocks the entire Wave 2 CRM write-back verification — the review card, 2-click approve, the 3-column field-level blend, and the disconnect/reconnect dedup check all require this entry point to exist first.
- **Severity:** P0 — the headline Wave 2 feature has no discoverable UI trigger in this build.

### Secondary observation — client Activity log
- The Caldwell, Jennifer client's own Activity tab reports "No activity logged yet" even after an AI request (the successful Draft follow-up) was made for that exact client earlier in the same session. Not central to Wave 2, but worth a look — audit logging may not be wired to the same matter scope the UI uses. Severity: P2/uncertain, noted for awareness.
- Screenshot: `screenshots/w2-02-activity-log-empty.png`

---

## Cross-cutting checks

### Light theme — PASS
Confirmed light theme throughout every screen visited (Settings → Theme = Light by default; no dark-mode surfaces encountered anywhere in Waves 0-2).

### No console error flooding — PASS
Sampled the live browser console for a 4-second window mid-session: 0 `console.error`/`pageerror` events. Normal operation logs only informational `PathValidator`/`TauriFSBackend` traces.

### Egress indicator / Local-only mode — PASS
- Switched Settings → AI & Privacy → "Where AI requests go" from "Cloud AI (your account)" to "On this computer only". App correctly auto-enabled Network lockdown, showed a green confirmation banner, and the header badge changed from "Using cloud AI" to "Using local AI"; the status bar showed a persistent "Isolated client: outside connections are blocked" indicator.
- Re-ran Draft follow-up in this mode: it did **not** silently call the cloud — it generated locally (took ~20-25s vs. a few seconds for cloud, consistent with on-device inference) and produced a correctly cited draft. This is the desired "refuse/queue, not silently call cloud" behavior.
- Screenshots: `screenshots/xc-01-local-only-mode-enabled.png`, `screenshots/xc-02-local-ai-generation-success.png`
- Reverted the setting back to "Cloud AI (your account)" (the app's original default) before finishing, to leave the workspace in the state it was found.

---

## Findings summary (severity-ranked)

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | Wave 0 | "Save to my Drafts" on the Draft follow-up modal is permanently disabled — confirmed via Playwright, never becomes clickable regardless of valid TO/complete draft | **P0** |
| 2 | Wave 0 | Per-client Files/Documents view (Grid and Tree) shows no files for any client, even ones with real content on disk; new-document creation from inside a client's Documents tab writes to the workspace-root `docs/` folder instead of that client's own folder | **P0** |
| 3 | Wave 0 | Per-client "Client Map" tab always errors with "Could not build client map. Check your AI connection and try again." despite AI clearly working elsewhere in the same session — blocks source-chip/notetaker-name and "Imported meeting notes" filter verification entirely | **P0** |
| 4 | Wave 1 | Calendar connection does not persist / register as connected in the app even after a completed Microsoft OAuth sign-in — no "Today's meetings" strip ever appears, blocking the rest of Wave 1 | **P0** |
| 5 | Wave 2 | No "Send to Wealthbox" action discoverable anywhere in the UI (document toolbar, overflow menu, Client Map, Activity tab), despite Wealthbox showing "Connected." and syncing cleanly | **P0** |
| 6 | Wave 2 | Client-scoped Activity/audit log shows "No activity logged yet" even after an AI request was made for that client in-session | P2 / needs follow-up |
| 7 | Wave 0 | Generated document content contains a literal unfilled template placeholder string `[preserved content - table, section, or other element kept as-is]` | P2, cosmetic |

**What passed cleanly:** Draft follow-up generation + citations + hover previews + cancel-on-close (Wave 0); CalendarConnect card rendering and the OAuth flow mechanics themselves (Wave 1); Wealthbox connect/sync (Wave 2); light theme, console cleanliness, and — notably — the Local-only/egress-indicator behavior, which did exactly what it should (no silent cloud calls, clear indicator, working local fallback).

## Bench state notes
- Never touched `C:\bench-backups` or `C:\KeepanceWorkspaces`. All smoke work happened in a separate copy at `C:\lantern-plus-smoke`, on a separate checkout at `C:\lantern-plus` (git clone, distinct from main-line's plain-copy `C:\keepance`).
- Stopped the `LanternPlusDev` scheduled task and the app's processes at the end of this session; the bench is quiet again.
- Left `C:\lantern-plus` and `C:\lantern-plus-smoke` on disk as this run's residue (consistent with the many other `keepance-*` demo/test directories already on this bench) — not cleaned up, in case they're useful for a follow-up session; flag if they should be removed.
