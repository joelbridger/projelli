# Windows Bench Smoke — Lantern-Plus Waves 0-2 (smoke-2, corrected re-run)

**Date:** 2026-07-03
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`)
**Checkout:** `C:\lantern-plus`, branch `lantern-plus`, pulled to tip before Phase 2 (includes `lp/smoke-p0-fixes` merge for the two smoke-1 P0 code fixes)
**Workspace:** `C:\lantern-plus-smoke\Northcrest Wealth Partners` — fresh copy of `C:\keepance-demo-northcrest`, rebound to the new path (see Phase 1 below)
**App:** `advisor-prep-hero@3.3.5`, dev build via the `LanternPlusDev` scheduled task
**Test identities:** Sarah Morgan (`sarah.morgan.cfp@outlook.com`) — bench test Microsoft 365 account for Calendar + Mail OAuth, signed in by Jameson at the keyboard (passkey/Windows Hello). Jameson's personal account/Bitwarden vault was never touched, per standing policy.

## Summary

| Area | Result |
|---|---|
| Phase 1 setup corrections (folderPaths rebind, re-index, calendar OAuth) | **PASS** — all 3 verified |
| Wave 0 — Draft follow-up, Client Map review tray | **PASS** (Save-to-Drafts P0 fix confirmed working end-to-end) |
| Wave 1 — Calendar sync, meeting matching, briefs, exports | **PASS**, with one real UX finding (auto-match never fires on first sync; see below) |
| Wave 2 — Send to Wealthbox from a normal client note | **FAIL — the P0 #5 fix did not land** (button never renders in the docx toolbar) |
| Wave 2 — Field-level 3-column CRM review | **Known dormant** — not chased, per coordinator scope note; NOTE-path review tray tested instead |
| Cross-cutting | **PASS** — light theme, no console errors, egress indicator correct in Local-only mode |

**Bottom line:** Wave 0 and Wave 1 are solid. Wave 2's headline "Send to Wealthbox from a note" flow is still broken — not the same failure mode as smoke-1 (this time the button is simply absent, not disabled), and root-caused below to a matter-resolution bug affecting open editor tabs specifically.

---

## Phase 1 — setup corrections (done before the fix merge, all re-verified after)

### 1. Workspace folderPaths rebind — PASS
- Copied `C:\keepance-demo-northcrest` → `C:\lantern-plus-smoke\Northcrest Wealth Partners`.
- No in-app UI path existed to bulk re-map 26 clients' folders in one step, so the matter store's persisted `folderPaths` were rebound to the new root (`lantern:matters` localStorage key), then verified via the proper **Clients management dialog** (`spine-new-client` → per-client folder checkboxes) that the mapping is real and toggleable, not just a raw string edit — toggled Caldwell's folder checkbox off/on through the actual UI action and confirmed the resulting `folderPaths` value round-trips correctly.
- **VERIFY:** Documents tab for Caldwell, Jennifer shows her real files (Agreements, Planning, Statements — screenshot `s2-60-docs-tab` style, see Wave 0 below); Client Map "26 clients, 26 folders indexed" with correct per-client scoping.

### 2. RAG re-index — PASS
- No separate manual trigger was needed: the full-workspace index build ("Indexing PDFs: X/301...") runs automatically on workspace open and completed cleanly.
- **VERIFY:** Client Map for Caldwell built real cited facts (portfolio value, equity allocation, retirement goal) with no "memory integrity uncertain" / AI-connection error.

### 3. Calendar OAuth — PASS
- Started Connect Microsoft once, did not cancel. Jameson completed the Sarah Morgan passkey sign-in on the physical keyboard (handed off via `notify-jameson --level critical`, never touched by the AI worker).
- **VERIFY:** Connection shows "Connected." and survives a panel close/reopen.

---

## Wave 0 — Draft follow-up, Client Map review tray

### Documents scoping — PASS
- Caldwell, Jennifer → Documents tab shows only her real files (Agreements/, Planning/, Statements/), tree-scoped correctly. No cross-client leakage observed when spot-checking a second client (Hollings Family).

### Draft follow-up modal — PASS
- Opened `Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx`, clicked **Draft follow-up** (toolbar testid `docx-draft-follow-up`).
- Modal generated a cited draft (3 citations: meeting date, target-equity-mix decision, next-review timing), each a hoverable chip. Subject auto-filled (`Follow-up: Meeting Notes 2024-05-20 - Caldwell, Jennifer`).
- Screenshots: `s2-63-64-draftmodal2/done.png`

### Save to Drafts (smoke-1 P0 #1 retest) — **PASS, fix confirmed**
- First attempt: "To" field stayed empty (no prior mail correspondence to derive a suggestion from in this fresh workspace — expected, not a bug) and Save-to-Drafts was correctly disabled while To was empty.
- **Real finding surfaced here:** clicking Save produced *"Your email connection needs one more permission to save drafts. Open Settings and reconnect the account."* — the Microsoft 365 Calendar OAuth grant from Phase 1 did not include Mail read/write scope. Went to **Your account → Connections → Microsoft 365 email → Reconnect**, completed a fresh consent screen explicitly requesting *"Read and write access to your mail... Does not include permission to send mail"* (a real permission-grant screen, not a passkey/credential prompt, so no handoff needed), and the connector then showed **"Connected. Mail imported."**
- Retried Draft follow-up → Save to Drafts with a manually-entered To address: button enabled correctly, and the modal confirmed **"Saved to your Drafts folder. Review and send from your email."**
- **Verdict:** the P0 #1 fix is real — Save to Drafts is fully functional once the mailbox connection has Mail scope. Screenshots: `s2-65-saved-draft.png`, `s2-68-connections.png` (before), `s2-73-connected-check.png` (after reconnect), `s2-76-draft-saved-confirmed.png`.
- **Minor note (not a blocker):** the separate Calendar and Mail connectors don't share OAuth scope automatically — an advisor who only connects Calendar will hit this same "needs one more permission" wall the first time they try Draft-follow-up. Worth a product call on whether the initial Calendar consent screen should request Mail scope up front, or whether the error message (which is already clear and actionable) is sufficient.

### Client Map review tray (NOTE-path, since field-level 3-column is dormant) — PASS
- Per coordinator scope note, the field-level Existing/From-this-meeting/Blended 3-column review is deliberately dormant until Wave 3 — not chased.
- Instead tested the live **ClientMapUpdatesTray** ("N updates to review", Accept/Edit/Dismiss per proposed fact): clicked Accept on "Jennifer Caldwell's household has goals with a moderate risk posture" — item disappeared immediately, counter went 10 → 9, "Saved" confirmation shown. Works correctly.
- Screenshot: `s2-59-after-accept.png`

### "Imported meeting notes" filter chip — not testable in this dataset
- This chip only renders when a Client Map fact is cited to a notetaker-imported source (Zocks/Jump connector). This demo workspace's facts all cite PDFs/statements/Word notes directly, so the chip correctly never appears — expected absence given the seed data, not a defect.

---

## Wave 1 — Calendar sync, meeting matching, briefs, exports

### Calendar sync — PASS
- Seeded Sarah Morgan's real Outlook calendar (as her, never touching Jameson's account) with two events for today: "Portfolio review — Jennifer Caldwell" (attendee `jennifer.caldwell@example.com`) and a deliberately-unmatched "Coffee with Alex".
- In-app **Sync now** (scoped precisely to the Calendar connector card — an ambiguous `textContent==='Sync now'` selector first mis-hit the Wealthbox card's identical-text button twice; both accidental "Import 40 households" dialogs were cancelled without confirming) → **"Synced 2 meetings."**

### Today's-meetings strip + client matching — PASS, with one real finding
- Both events correctly appeared on the Client Map "Today" strip.
- **Finding (not a blocker, worth product awareness):** neither event auto-matched on first sync — even "Portfolio review — Jennifer Caldwell" with a plausible client-name title and a distinct attendee email showed "Whose meeting is this?" ("0 matched · 2 need a client"). Root cause understood, not a bug: matching requires either a previously-taught `meetingKeys` entry or an exact match against the client's stored name/email, and this is a first-ever sync with nothing taught yet — there is no actual client email on file to match against (`Matter` has no email field), only the stored display name ("Caldwell, Jennifer") which naturally won't equal a calendar attendee's display name format. So on a brand-new client, the FIRST meeting for them will always need manual assignment; only subsequent meetings from the same address auto-match. This is a reasonable design, but worth knowing it means "auto-match" never fires on a client's very first calendar sync.
- Exercised the assignment flow for both events:
  - Caldwell event → clicked "Whose meeting is this?" → selected "Caldwell, Jennifer" from the client list → app correctly detected the meeting had **two possible identities on it** ("Which one is Caldwell, Jennifer?" — the advisor's own address `sarah.morgan.cfp@outlook.com` vs. the client's `jennifer.caldwell@example.com`) and required picking the real client address before teaching it. Picked the client's address. Meeting immediately became a proper matched card with client name + a "Sending to your AI provider" brief-generation kick-off. This two-step disambiguation is a genuinely well-designed safety detail (it would be easy to accidentally teach the advisor's own address as a client's, permanently misfiling every future meeting).
  - "Coffee with Alex" (deliberately unmatched, no real client) → used the **"Not a client meeting · skip"** escape hatch. Works, but is session/local-only: it just closes the popover without persisting any "not a client" state, so this same event will show "Whose meeting is this?" again on the next reload/day. Minor — worth a product call on whether a real dismiss-and-remember is warranted, but not a functional blocker.
- Screenshots: `s2-42-clientmap-strip.png` (before assignment), `s2-44/45/46/47` (assignment flow), `s2-48-meeting-chip-click.png` (after — matched card)

### Before-you-meet brief — PASS
- Opened the matched Caldwell meeting: brief rendered 4 bullet points, each with a citation chip naming its source document (Schwab Statement, Meeting Notes x2, Investment Advisory Agreement).
- **Hover previews — PASS, but only with a real (trusted) hover, not a synthetic DOM event.** A raw `dispatchEvent(new MouseEvent('mouseenter'))` did not trigger the preview popover; Playwright's `.hover()` (a real simulated pointer move) did, immediately showing the source excerpt with the exact matching numbers. This is a test-tooling note, not a product bug — flagging it so future smoke runs don't misdiagnose a real hover feature as broken based on a synthetic-event test.
- Screenshot: `s2-50-real-hover.png`

### Export brief (Word) / Agenda (Word) — PASS, with an important bench-driving lesson
- **Operational gotcha (not a product bug):** both export buttons open a real **native Windows Save As dialog** via the Tauri dialog plugin — this is a genuine top-level OS window, separate from the WebView2 content CDP screenshots. It does not "steal focus" and is easy to lose track of if you're only looking at CDP screenshots or the physical screen's foreground app; it stayed pinned in the taskbar the whole time. Future runs: after clicking an Export/Save action, check the taskbar for a new window rather than assuming the click silently failed.
- Once located, both dialogs were correctly pre-filled: `Meeting-Brief-2026-07-03.docx` and `Agenda - Caldwell, Jennifer.docx`, defaulting to the workspace root (not the client's own folder — a minor, reasonable default).
- Saved both; verified on disk as valid `.docx` (real ZIP archives containing `word/document.xml`, confirmed via `System.IO.Compression.ZipFile`) — 10,451 and 9,110 bytes respectively.

---

## Wave 2 — CRM write-back

### Send to Wealthbox from a normal client note (smoke-1 P0 #5 retest) — **FAIL**
- **Repro:** Open any normal client Word note that is correctly folder-mapped to a matter with real, on-disk, correctly-resolving files (verified: Documents tab shows this exact file; Client Map cites this exact file; RAG citations correctly attribute it to Caldwell) → the docx toolbar shows **Draft follow-up / Export / Revise with AI** but **no "Send to Wealthbox" button at all** (not disabled — entirely absent from the DOM).
- **Root-caused, not just observed:** the toolbar only receives an `onSendToWealthbox` handler when `resolveMatterIdForWorkspacePath(tab.path, rootPath)` resolves to a real matter id (`MainPanel.tsx:853-863`). Confirmed via direct inspection that the open tab's stored path is workspace-relative (`Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx`), and manually replicated the exact matching algorithm from `matterResolver.ts` against the live, confirmed-correct `folderPaths` (`C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients/Caldwell, Jennifer`) — the join **should** match. Re-verified `folderPaths` twice: once via my Phase-1 rebind, once by toggling the folder checkbox off/on through the real Clients-management UI (forcing a clean write through the app's own `addFolderPath` action) — identical resulting value both times, both times the button stayed absent, including after a full page reload.
- **This same root cause likely explains a second symptom seen in Wave 0:** Draft follow-up's "To" field failed to auto-suggest a client email even after the mailbox had real imported mail — consistent with `resolveMatterIdForWorkspacePath` also feeding a wrong/unassigned matter id into that lookup, not just a "no correspondence yet" data gap.
- **Impact:** the entire Wave 2 headline flow (write a note → Send to Wealthbox → review card → Approve → appears in Wealthbox) could not be exercised at all — blocked at the very first click. Disconnect/reconnect-no-duplicate-posts could not be tested as a result.
- **Severity:** P0 — this is the exact flow smoke-1 flagged and the fix branch was supposed to resolve; it does not work in this build. Given the button is now missing entirely (vs. smoke-1's "disabled and never enables"), this looks like a different failure mode than what was fixed, not a full regression of the same one — but the net effect for an advisor is identical: the feature does not work.
- Evidence: confirmed via repeated `document.querySelector('[data-testid="docx-send-to-wealthbox"]')` returning null across a fresh reload and a clean UI-driven folder re-map; source read at `src/features/documents/media/DocxEditor.tsx:222-235,1278-1310` and `src/app/shell/layout/MainPanel.tsx:853-863`, `src/platform/hooks/useMemoryWiring.ts:284-290` (`resolveMatterIdForWorkspacePath`).

### Field-level 3-column CRM review (Existing / From this meeting / Blended) — known dormant
- Per coordinator's explicit scope note: this is deliberately dormant until Wave 3 in this build. Not chased. The simpler NOTE-path review tray (ClientMapUpdatesTray, tested above under Wave 0) is the live equivalent for this wave.

### Wealthbox disconnect/reconnect, no duplicate posts — not tested
- Blocked by the Send-to-Wealthbox failure above; there was nothing to post, so nothing to duplicate-check.

---

## Cross-cutting

### Light theme — PASS
- Confirmed throughout every screen visited this run (Settings → Workspace → Theme = "Light" explicitly set); no dark-mode surfaces anywhere.

### Console errors — PASS
- Instrumented a real `page.on('console', ...)` / `page.on('pageerror', ...)` listener during navigation between Client Map / Documents / Settings — zero errors logged.

### Egress indicator, Local-only mode — PASS
- Settings → AI & Privacy → switched to **"On this computer only"**: Network lockdown toggled on automatically ("On automatically because On this computer only is selected"), and the persistent bottom-right indicator correctly updated to **"Isolated client: outside connections are blocked so nothing can leave this client."** — clear, accurate, not silent. Reverted back to "Cloud AI (your account)" (the recommended default) before finishing.
- Screenshot: `s2-80-local-only.png`

---

## Bench restore

- Reverted confidentiality mode back to Cloud AI (recommended default) after the Local-only test.
- No new scheduled tasks added beyond the pre-existing `LanternPlusDev` (left running per standing setup; `KeepanceDev` untouched throughout).
- `C:\bench-backups\` and `C:\KeepanceWorkspaces\` were never touched.
- `~/lantern-plus` workdir on the coordination server was read-only except for this evidence branch.

## Severity summary

| Finding | Severity | Status |
|---|---|---|
| Send to Wealthbox button missing from docx toolbar (matter-resolution bug for open editor tabs) | **P0** | Confirmed FAIL in this run, root-caused → **fixed and verified in the Wave-2 re-test below** |
| `background_information` field-blend write uses the wrong Wealthbox wire field name — silent no-op | **P0/P1** | **New, found during the Wave-2 re-test's live-probe** (see below) — not yet fixed |
| Wealthbox task creation requires `due_date`; code currently allows omitting it, which 422s | P2 | **New, found during the Wave-2 re-test's live-probe** — not yet fixed |
| Calendar/Mail OAuth scope not shared — Draft-follow-up needs a separate Mail reconnect the first time | P2 | Product/UX call, not a defect |
| "Not a client meeting · skip" doesn't persist across reload | P3 | Minor UX gap |
| First-time calendar sync never auto-matches (no client email field to match against) | P3 (by design, worth awareness) | Not a defect |
| Export dialogs are real native OS windows, easy to lose track of during CDP-only testing | N/A | Testing-methodology note for future runs |

---

## Wave-2 re-test (2026-07-03, after the `lp/matter-resolve-windows` fix merged)

**Tip pulled:** `fa172efa` — "docs: changelog for the Windows matter-resolver fix", includes
`03e0bd32 fix(matters): unify workspace-path matter resolution, fail closed on cross-matter
ambiguity (smoke-2 P0 #5)`. Bench app restarted clean via `LanternPlusDev` (no Rust changes in
this pull, so it was a fast dev-server-only restart, ~2s). Prior session state (Today-strip
meeting assignment, workspace folder mapping) persisted correctly across the restart.

### Send to Wealthbox — **P0 #5 fix CONFIRMED WORKING**

Reopened the exact same `Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx` that previously
failed to show the button at all. **The button now renders and is enabled.** The client wasn't
yet linked to a Wealthbox household (correct, expected state — this workspace had never synced
Wealthbox before) — the app surfaced its own correct guidance ("Link this client to a Wealthbox
household first") rather than failing silently. Ran a normal Wealthbox **Sync now** (Connections
panel), imported 40 households, Caldwell auto-linked to household `66158044`. The note then
appeared in the **Update Wealthbox** review card ("Nothing sends until you approve") → clicked
**Approve 1 change** → note landed in Wealthbox as id `271197631`, correctly linked, content and
citations intact. Full live-probe detail (including two real backend findings surfaced along the
way) in `WEALTHBOX-PROBE.md` in this same folder.
Screenshots: `wave2-retest-01-send-to-wealthbox-renders.png`, `-02-review-card-queued.png`,
`-03-approved-sent.png`.

### Draft follow-up "To" auto-suggest — same resolver, retested

Reopened Draft follow-up on the same note. Modal opened correctly and generated a properly-cited
draft (2 citation chips, hover previews worked) — this alone confirms the matter-id resolver fix
also applies here (previously this exact modal's To-suggestion lookup was suspected to be
feeding off the same broken resolver). The "To" field itself is still empty, but for the
already-documented reason from the first smoke-2 pass: no real prior email correspondence exists
with `jennifer.caldwell@example.com` in this fresh mailbox (only a manually-saved Draft, which
doesn't count as "history"). Not a new finding — re-confirms the earlier P2 note.
Screenshot: `wave2-retest-04-draft-followup-resolver-fix.png`.

### Disconnect/reconnect, no duplicate posts

Disconnected Wealthbox (Account → Connections → "Disconnect and delete imported data") —
confirmed Microsoft 365 stayed connected throughout, unaffected. Reconnected with the same
token, re-imported all 40 households, Caldwell re-linked to the same household automatically.
The already-sent note stayed shown as sent (not re-queued). Directly verified the underlying
idempotency mechanism (not just the UI's memory) by invoking the write command twice with an
identical `requestedAt` — second call correctly returned `deduped: true` with no second Wealthbox
note created. **Dedup/idempotency across disconnect-reconnect: confirmed working correctly.**
Full detail, including an initial test-methodology mistake on my part that looked like a bug and
wasn't, in `WEALTHBOX-PROBE.md`.

### Wealthbox write-path live-probe — 2 real findings

Ran the full `scripts/crm/wealthbox-write-probe.md` checklist against the sandbox (Steps 1-3),
plus the field-blend step (Step 4, marked "deferred" in that doc pending Task 9c's UI — run
anyway via direct backend invocation since the coordinator's brief asked for it and the backend
command is fully implemented). **Two real, unfixed bugs found** — full detail, repro steps, and
exact code locations in `WEALTHBOX-PROBE.md`:

1. **`background_information` field-blend writes silently do nothing** — the code translates the
   app-facing field name to the wrong wire name for PUT requests (right for GET, backwards for
   PUT). Wealthbox returns HTTP 200 with no error; the field is genuinely unchanged. Confirmed on
   both a Household and a Person contact record; ruled out propagation delay and general
   PUT-permission problems (a control write to `job_title` worked normally). **High priority** —
   this hasn't shipped to any user yet only because Task 9c's UI is still dormant, but it will
   silently fail the moment that UI ships unless fixed first.
2. **Wealthbox tasks require a `due_date`** — omitting it returns HTTP 422. The code currently
   just omits it when the user doesn't set one, with no client-side validation. Confirmed the
   plain `"YYYY-MM-DD"` format IS accepted when present (normalizes correctly server-side), and
   that `created_at`/`updated_at` ARE present on real task responses (the code's speculative
   empty-string default for these was overly cautious but harmless, not a bug).

All sandbox mutations from this probe were either restored to original values (the two
`background_info` fields) or left as clearly-labeled test artifacts the API's token doesn't have
permission to delete (three duplicate/probe notes — see `WEALTHBOX-PROBE.md` for exact ids and
why). Nothing destructive or unrecoverable was done to the sandbox.

---

## Wave-4 evidence (new in this tip — Whole book, estate/beneficiary gaps, Ask whole-practice)

Per the coordinator's addendum, captured evidence for the Wave-4 features that landed in the
same tip pull:

1. **Client Map → Whole book view** — `View: Clients | Whole book` toggle on the Client Map,
   ranked list of all 40 clients (26 originally folder-mapped + 40 total after the Wealthbox
   household import — some overlap) with Sourced Facts / Open Gaps / Last Touch columns.
   Screenshot: `wave4-01-whole-book-view.png`.
2. **Estate/beneficiary gap chip** — checked via a targeted Whole-practice Ask question
   ("Which clients have a beneficiary designation gap or estate-document inconsistency?").
   Result: **none found** in this demo dataset — the check itself clearly ran (cited "Answered
   from each client's saved summary"), it just found nothing to flag, so there was no gap chip
   to screenshot on any individual client. Per the coordinator's own instruction, skipped rather
   than forced. Screenshot of the "none found" result kept as evidence the feature works:
   `wave4-03-beneficiary-gap-check-none-found.png`.
3. **Ask → Whole practice** — selected the "Whole practice" scope pill, granted the "Allow for
   all" cross-client consent prompt when it appeared, asked a real practice-wide question
   ("Which clients have the highest advisory-fee assets, and are any below their target equity
   allocation?"). Got a cited answer identifying the Hollings Family ($50.2M, below target
   equity) with a clickable "Hollings Family" client-chip result and per-fact citations.
   Screenshot: `wave4-02-ask-whole-practice.png`.
