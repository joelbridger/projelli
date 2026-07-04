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

---

## Full scripted bench pass (2026-07-04) — Waves 0-4, `scripts/bench-smoke.mjs`

**Mission:** run the complete scripted smoke of Waves 0-4 on the Legion at the current merged tip
and bring it to a clean pass or a precise FAIL report per check, per
`coordination/briefs/w-bench-full-brief.md`. Full evidence: `docs/evidence/bench-smoke/legion-20260704-033315/`
(the final, trustworthy run — three earlier runs same session are superseded, see "Harness fixes" below).

### Bench bring-up

- Legion was on stale tip `e4050327` (from the prior bench-prep pass) — **144 commits behind**
  the actual merged tip. Re-pulled `C:\lantern-plus` to **`1eb10dba`** (`git fetch` + `git pull
  --ff-only`), which is `origin/lantern-plus` HEAD at run time (one coordination-doc commit ahead
  of `fc82c2a2`, no code diff). Pull brought in Wave 3 capture, symlink hardening/pathguard, the
  CDP env-var fix (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` forwarded through wry — changes how the
  main window is created, see `src-tauri/src/lib.rs` `.setup()`), and harness round-2
  (`scripts/bench-smoke.mjs` + `scripts/bench-smoke/`). `npm install`: no lockfile change, no-op.
- **Full rebuild, not skipped:** `cargo` did a real recompile (new deps this pull: `cpal`,
  `keepawake`, `hound` for Wave 3/4 capture+diarization) — `Finished 'dev' profile
  [unoptimized + debuginfo] target(s) in 1m 39s`. App booted clean, CDP responded.
- **Freshness canary — PASS.** Grepped `target\debug\lantern.exe` for two string literals that
  only exist in this pull's new code: `"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"` (the CDP env-var
  fix, `lib.rs:362`) and `"a previous recording is still finalizing"` (Wave 3 capture engine,
  `commands/capture/engine.rs`) — both found. Binary `LastWriteTime` matched the build-completion
  timestamp.
- **Bench-infra fix:** the harness's target registry (`scripts/bench-smoke/targets.mjs`) hardcodes
  the Legion's app log at `C:\tauri-dev.log`, but the actual dev-launcher batch
  (`C:\run-dev-lantern.bat`, bench-local, not in git) was redirecting to `C:\lantern-plus-dev.log`
  — a stale, silently-wrong log path mismatch that would have made any FAIL's captured
  `*-tauri-dev-tail.txt` forensics show garbage from a week-old run instead of the real one. Fixed
  the `.bat` to redirect to `C:\tauri-dev.log` (matching the other registered target's convention)
  and restarted the app once to pick it up.

### Harness fixes (in `scripts/bench-smoke/`, unit-tested, committed on this branch)

Three real, root-caused bugs in the smoke harness itself were found and fixed live this pass —
each one was previously masking real product signal behind a false `SETUP-BLOCKED`:

1. **`checks/setup.mjs` (`per-client-files-visible`)** — was asserting file rows via
   `findByText(snapshot(), /\.docx|\.pdf/i)`, but `snapshot()` only captures *interactive*
   elements ([data-testid]/button/a/role=button/input/textarea); file rows in the Documents Tree
   view are plain text spans, so this always false-negatived even when real files were plainly
   visible on screen. Switched to `textPresent()` (real page-text search via Playwright's
   `getByText`), matching the pattern `index-health` already used for the same reason.
2. **`click-by-text.mjs` (`clickByTextScript`)** — the "controls" tier matched any
   `[data-testid]`-bearing element whose full `textContent` merely *contained* the needle. Since
   `textContent` cascades up through every ancestor, the outermost `app-container` div (the first
   `[data-testid]` element in document order) trivially "contains" almost any needle that appears
   anywhere on the page — so `.find()` returned it and issued a no-op single click on the giant
   wrapper, silently breaking `clickByText`/`doubleClickByText` for nearly any real needle. Fixed
   by excluding candidates that have their own nested `[data-testid]` descendants (structural
   wrappers have many; a real button/card/leaf has none). Added a regression test
   (`click-by-text.test.mjs`) that fails against the pre-fix version.
3. **`checks/wave0.mjs` / `checks/wave2.mjs`** — both wrapped `openSmokeClientDocuments` +
   `openSmokeClientNote` in a *single* try/catch, so whenever a prior check (e.g. `index-health`)
   had already left a client hub open on a different sub-tab, the first click's expected failure
   (`matter-launch-documents-<id>` only exists in the table view) aborted the whole block and
   `openSmokeClientNote` never even ran — the exact "single try/catch" ordering bug `setup.mjs`'s
   `primeClientView` had already been fixed for, just not applied here. Split into independent
   try/catches (matching `primeClientView`'s pattern) in both files. Also fixed
   `openSmokeClientNote` itself (`checks/_util.mjs`) to switch to "Tree" view and wait for the
   filename before searching — Grid view only shows the current folder, so a smoke note living in
   a subfolder was invisible to a whole-page text search if a prior session had left Grid active.

All three were verified against the live bench (not just unit tests) before being trusted — see
"Debugging notes" below. Full suite: **124/124 unit tests pass** (was 122 before this pass;
+1 new regression test for the container-match bug, +1 for the Tree-view-switch fallback).

### Debugging notes (things that looked like product bugs and weren't)

- **A stray native "Open" file dialog** (Windows file picker, filtered to image files, rooted at
  Jameson's real personal `C:\Users\...\Jameson Daines` folder) was found sitting open and
  focused on top of the app window mid-run — almost certainly triggered by an earlier manual
  click on the Account/Connections modal's "Upload photo" button during interactive debugging.
  While it sat open, CDP-based DOM queries returned stale/incomplete results (the docx editor was
  actually open and fully rendered underneath it) — closing the dialog (`Escape` via
  `scripts/legion_agent.py`, no files touched/selected) immediately restored correct CDP
  visibility. Verified via a real full-desktop screenshot (`legion_agent.py` `/shot`, not CDP) —
  worth remembering for future runs: if CDP-driven checks report "nothing happened" right after
  a manual desktop interaction, screenshot the real desktop before trusting the DOM query.
- **A "stuck" smoke-test file** — after ~10 repeated manual open/close cycles on the exact same
  note (`Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx`) during interactive debugging, that
  *specific* file stopped opening on click/double-click (row highlighted/selected, no editor tab
  appeared) while a *different*, never-before-touched file in the same folder opened instantly on
  the first click. Root-caused as test-session contamination from the debugging itself, not a
  product bug — confirmed by a full app restart (which clears in-memory editor/session state)
  making the original file open normally again on the very next click.

### Results — FAIL (2 real product findings)

| Check | Status | Finding |
|---|---|---|
| `wave1-calendar-brief-export` | **FAIL** | Calendar connector shows `scope_upgrade_required` under Account → Connections (raw error code surfaced as user-facing text, not a friendly message) and "Sync now" never completes (`Synced ...` confirmation never appears, 20s timeout). Clicking Sync now while in this state appears to trigger an OAuth re-auth redirect: a genuine Microsoft "Enter your password" sign-in tab opened in a **separate system browser window** (not the app's own WebView) and was still sitting open, untouched, at the end of this run. **Per playbook policy, this was NOT interacted with** (MS anti-automation risk + credential-handling rule) — COORDINATOR: this needs a human (Jameson) to either complete or dismiss that sign-in tab on the Legion, and the Calendar connector re-authorized, before Wave 1 can be re-verified. |
| `wave4-estate-beneficiary-gap` | **FAIL** | The Whole-book Client Map view flags an estate/beneficiary gap chip on `book-row-matter_nc_caldwell_jennifer`, but navigating into Caldwell's own Client Map sub-tab shows no corresponding resolvable gap row (no `clientmap-ask-flag` control) — the book-level gap chip and the per-client detail view are out of sync. Screenshots: `08-failure-wave4-estate-beneficiary-gap.jpeg` (Caldwell's Client Map, no gap control), `07-wave4-estate-beneficiary-gap-chip.jpeg` (the book-view chip). This is a real, reproducible Wave-4 bug — COORDINATOR: needs a fix lane. |

### Results — PASS (9)

`workspace-binding`, `per-client-files-visible`, `wave0-draft-followup` (Draft follow-up modal +
cited draft), `wave2-wealthbox-queue-review` (Send to Wealthbox button renders, review card
queues — stopped there by read-only design, no Approve/send), `wave4-whole-book-view` (40 ranked
clients, row click opens hub), `wave4-whole-practice-ask` (scope pill + consent gate),
`cross-cutting-light-theme`, `cross-cutting-console-errors` (zero errors the whole run),
`cross-cutting-egress-indicator` (Local-only mode flips correctly, reverts to Cloud AI).

### Results — SETUP-BLOCKED (3, not product verdicts)

- `index-health` — Client Map rendered with no error, but the specific word "cited" wasn't found
  within the check's timeout window on this run. Not chased further this pass; likely a
  timing-margin issue in the check itself (Client Map fact-citation rendering can take a moment)
  rather than a real index problem — Caldwell's Client Map was directly observed showing real
  cited facts (screenshot `08-failure-wave4-estate-beneficiary-gap.jpeg`'s "Before you meet"
  section) moments after this check ran.
- `wave2-wealthbox-approve-live` — the review card queued by `wave2-wealthbox-queue-review`
  (immediately prior in the same run) was gone by the time this check ran a few seconds later; no
  `Approve` control to click. Not chased further — flagging as a harness sequencing gap worth a
  look in a future harness round, not a product regression (queue-review itself PASSed cleanly).
- `wave4-estate-beneficiary-gap-dismiss-live` — downstream of the real `wave4-estate-beneficiary-gap`
  FAIL above; there was no resolvable gap control to dismiss.

### Not exercised (STUB checks, expected)

`wave3-capture-start-stop`, `wave3-capture-crash-recovery`, `wave3-capture-session-manifest`,
`wave4-diarization`, `wave4-retention-attestation` — all report `TODO`, not wired to bench-drivable
UI yet per the harness's own checklist (see `docs/qa/BENCH-SMOKE-HARNESS.md`). Not a gap in this
pass; these are intentionally out of scope until their respective UI lands.

### Bench state left behind

- App stopped, `LanternPlusDev` scheduled task returned to **Disabled** (its found state), SSH
  tunnel closed. `C:\bench-backups\` and `C:\KeepanceWorkspaces\` untouched.
- **NOT resolved, left for a human:** the Microsoft "Enter your password" browser tab from the
  Calendar OAuth re-auth attempt (see FAIL above) is still open on the Legion's desktop, untouched.
- Wealthbox sandbox: one review card was queued (Caldwell's smoke note) but never approved
  (`wave2-wealthbox-queue-review` stopped there by design) — no live CRM write occurred this pass.

---

## Coordinator-directed follow-up (2026-07-04, same day) — both bench FAILs resolved and verified

Per the coordinator's verdict on the run above: the 3 harness fixes were reviewed and merged
(tip `00558e1d`); authorized to complete the Calendar re-auth using the de-passkeyed Sarah Morgan
demo account (`demo-creds/sarah-morgan-account.md`); and later, the Wave-4 gap-sync fix landed
(tip `85c4a633`, TS-only) mid-session. Full evidence: `docs/evidence/bench-smoke/legion-20260704-043146/`
and `legion-20260704-wave1-final-verify/`.

### Calendar OAuth re-auth — done, verified twice (including surviving a restart)

- Completed sign-in on the pending Microsoft tab using the password from the demo-creds file
  (pasted via clipboard, never typed/logged) — landed on a **stale, unrelated** tab (Microsoft
  account security settings, `wreply=account.live.com/proofs/manage/additional`, most likely a
  leftover from the 2026-07-03 de-passkey session), not an actual calendar-scope consent screen.
  **Declined the passkey-setup prompt Microsoft showed after sign-in** (passkeys are never
  automated) and **declined saving the password to the browser** (this turned out to be
  Jameson's own personal Chrome profile — his own Bitwarden vault and saved logins were visible
  in unrelated save-password/passkey prompts during this flow; none were touched or read).
- The real fix: in-app, Account → Connections → Calendar had no "Reconnect" affordance (unlike
  Mail) — only Sync now/Disconnect. **Disconnected and reconnected** via "Connect Microsoft",
  which opened the actual OAuth authorize screen for the app's real Azure client id
  (`845ddba0-70ab-4f90-88ba-e3522157e37a`, matching the demo-creds file). Sarah's session was
  already authenticated, so selecting her account tile completed the flow with no further
  prompts. Result: "Outlook calendar connected", **Sync now succeeded** ("Synced 2 meetings"),
  confirmed twice more after a clean app restart ("No new meetings came in" — expected, no new
  events since the first sync).
- **A red herring that cost significant time:** the Calendar repeatedly *appeared* to spontaneously
  disconnect after later actions. Root cause, confirmed twice: a stray native Windows "Open" file
  dialog (filtered to image files, rooted at Jameson's real home folder) kept reappearing on top
  of the app window, and while it sat open, CDP-driven DOM queries returned stale/incomplete
  results — reading the app as "disconnected" when it was not. Traced to
  `scripts/bench-smoke/overlay-dismiss.mjs`'s generic overlay-dismiss helper: its fallback
  ("click a dialog's first button" — added for the Draft-follow-up modal, whose first button is
  its close X) was blindly applied to the Account modal too, whose *first* button is "Upload
  photo" — a real native-file-picker trigger. Fixed in `lp/bench-harness-followup-fixes` (pushed
  for review) to prefer a button with `aria-label="Close"`, falling back to the old behavior only
  when no such button exists. Verified live: the Account modal now closes via its real Close
  button with no native-dialog side effect, and the Calendar has shown zero further false
  "disconnects" since.
- Also fixed in the same branch: `checks/wave1.mjs` was asserting the "Today" meetings strip
  while still inside the (still-open) Account modal — structurally could never find it. Now
  closes the modal and returns to Client Map before asserting the strip. **wave1-calendar-brief-export
  now PASSes cleanly**: "Calendar sync confirmed and Today strip populated."

### Wave-4 gap-sync fix — confirmed working, live-verified twice

Pulled the Legion to tip `59235fa4` (fast-forward past the fix commit `85c4a633`; diff-verified
frontend-only — only `src/features/matters/ClientMapPanel.tsx` plus harness/docs, no
`src-tauri` changes). Restarted the app; cargo confirmed a no-op relink ("Finished ... in 1.25s",
not a real recompile), consistent with "no Rust changed". Canary: the fix's own described
behavior (unresolved gap wins the Client Map's initial tab) is what the check verifies, so the
check passing **is** the canary.

- `wave4-estate-beneficiary-gap`: **PASS** — book-view gap chip and the flagged client's Client
  Map sub-tab are now in sync (a resolvable `clientmap-ask-flag` row is present). Reproduced on
  two different runs, two different clients (Caldwell, Jennifer once; Hollings Family once) —
  not client-specific.
- `wave4-estate-beneficiary-gap-dismiss-live`: **PASS** (`--live`) — dismissing the gap via the
  Client Map resolve control actually cleared it (resolvable-row count dropped by exactly one
  each time, 5→4 and 6→5).

### Updated scorecard (final run this session, `legion-20260704-043146`)

| Check | Status | Note |
|---|---|---|
| workspace-binding | PASS | |
| per-client-files-visible | SETUP-BLOCKED | Pre-existing table-vs-book sub-view state gap (see below), not a regression |
| index-health | SETUP-BLOCKED | Same class as smoke-2/first pass — check-timing precondition, not chased |
| wave0-draft-followup | SETUP-BLOCKED | Downstream of the same sub-view state gap |
| **wave1-calendar-brief-export** | **PASS** | **Fixed this session — was FAIL** |
| wave2-wealthbox-queue-review | SETUP-BLOCKED | Downstream of the same sub-view state gap |
| wave2-wealthbox-approve-live | SETUP-BLOCKED | Downstream of queue-review |
| wave4-whole-book-view | PASS | |
| **wave4-estate-beneficiary-gap** | **PASS** | **Fixed this session — was FAIL** |
| **wave4-estate-beneficiary-gap-dismiss-live** | **PASS** | **Fixed this session — was SETUP-BLOCKED** |
| wave4-whole-practice-ask | PASS | |
| cross-cutting-light-theme | PASS | |
| cross-cutting-console-errors | PASS | |
| cross-cutting-egress-indicator | not reached | Full-suite run hit a 300s wall-clock cap set for this pass; app was confirmed left in the correct default state (Cloud AI, not stuck in Local-only) |

Both real FAILs from the round-1 verdict are now fixed and independently verified live. The
remaining SETUP-BLOCKED cluster (per-client-files-visible, index-health, wave0, wave2 ×2) all
trace to one known, pre-existing harness gap: `openSmokeClientDocuments` needs the Client Map's
**"Clients" table** sub-view (for its `matter-launch-documents-<id>` button), but a prior check
in the same run can leave the app on the **"Whole book"** sub-view instead, and `spine-nav-matters`
alone doesn't reset that choice. Not touched this pass — out of scope for what was asked, and
lower-value than the two real product bugs that were the actual point of this follow-up.

### Harness fixes this session (branch `lp/bench-harness-followup-fixes`, pushed for review)

1. `overlay-dismiss.mjs`: prefer `aria-label="Close"` over blindly clicking a dialog's first
   button (root cause of the false Calendar-disconnect readings above).
2. `checks/wave1.mjs`: close the Account modal and return to Client Map before asserting the
   "Today" meetings strip.

128/128 → confirmed 126/126 unit tests pass (2 new regression tests added for the aria-label
preference and its fallback).

### Bench state left behind (this follow-up)

- App stopped, `LanternPlusDev` returned to **Disabled**, SSH tunnel closed.
- Calendar connector confirmed **connected and healthy** at end of session (real, working state —
  not a stale reading).
- The stray native "Open" dialog was closed each time it appeared; no files were selected or
  opened through it. Jameson's personal saved logins (visible in incidental
  save-password/passkey/passkey-manager prompts during the OAuth flow) were never read, selected,
  or interacted with.
- The original stale Microsoft security-settings tab from the round-1 pass is still open,
  untouched, exactly as before — still a human cleanup item, not urgent (no pending action on it).

---

## Second coordinator-directed follow-up (2026-07-04, same day) — the Clients-table navigation gap

Per the coordinator: fix the known navigation gap (a prior check leaving the Client Map on
"Whole book" instead of "Clients" silently broke every table-dependent check after it), pull +
rebuild first for maximum honesty on `index-health` since Rust changed (an unrelated audit-chain
fix merged in the interim), then re-run the 4 still-blocked checks. Full evidence:
`docs/evidence/bench-smoke/legion-20260704-052952/` (the definitive final run).

### Bench bring-up

Pulled `C:\lantern-plus` from `59235fa4` to `64df925e` (the two merged harness-follow-up fixes)
then on to the tip carrying the audit-chain fix (`src-tauri/src/commands/audit/{mod,store}.rs`,
`retention/mod.rs`, `lib.rs` — genuine Rust changes). **Full rebuild, not skipped:** real
recompile confirmed (`Compiling lantern...`, 1086 objects). **Freshness canary — PASS:** grepped
the built exe for a string literal only present in the new audit fix
(`"chain head seal is corrupt"`) — found; binary timestamp matched the build-completion time.

### The navigation-gap fix — root-caused, fixed, verified

`openSmokeClientDocuments` (used by `setup.mjs`, `wave0.mjs`, `wave2.mjs`) needs the Client Map's
**"Clients" TABLE** sub-view for its `matter-launch-documents-<id>` button — that testid only
exists there, never on "Whole book". The Clients/Whole-book toggle choice persists across
navigation, so any check that left it on "Whole book" (any of the wave4 book-view checks)
silently broke every table-dependent check that ran after it in the same suite.

Added `ensureClientsTableTab` (`checks/_util.mjs`) — same pattern as the existing Tree-view
normalization in `openSmokeClientNote`: click `spine-nav-matters` (with the existing "still in
hub" defensive re-click), then switch the toggle to "Clients" via `clickByText`. Confirmed live
that `clickByText('Clients')` is unambiguous: of several plain-text elements on the page whose
text is exactly "clients" (page title, sidebar section header, etc.), only the toggle's own
button is a real interactive control, so click-by-text.mjs's controls-tier selector never
matches the others. `openSmokeClientDocuments` now calls this first (best-effort).

**A second bug this fix surfaced:** once `wave0` and `wave2` could both actually reach their
note-opening step in the same run for the first time, they collided on the identical smoke note
file — reopening a file very soon after a prior check already opened-and-navigated-away-from it
can silently fail to render (row selects, no editor tab appears; confirmed reproducible on the
same file, NOT reproducible on a different file opened immediately after — a real, narrow
product quirk, not fixed here, out of scope for this harness lane). Added
`SMOKE_NOTE_FILENAME_SECONDARY` and pointed `wave2.mjs` at it.

**A third bug, found while verifying the above in the full default suite order:** the just-merged
`wave1.mjs` fix (round-1 follow-up) closed the Account modal with a plain Escape dispatch,
specifically avoiding `driver.dismissBlockingOverlay()` because that helper used to risk clicking
the Account modal's "Upload photo" button. But a leftover Draft-follow-up modal (left open by a
prior `wave0-draft-followup` in the same suite) does **not** close on Escape at all — confirmed
live, this left it open and silently blocked `wave2`'s navigation right after. Now that
`overlay-dismiss.mjs` itself prefers an `aria-label="Close"` button (also already merged), it's
safe to use `dismissBlockingOverlay()` again — reverted `wave1.mjs` to it.

Pushed as `lp/bench-harness-clients-tab-fix` (3 commits) for coordinator review. 131/131 unit
tests pass (+5 new regression tests).

### Updated scorecard (definitive final run, `legion-20260704-052952`, full default order)

| Check | Status | Note |
|---|---|---|
| workspace-binding | PASS | |
| per-client-files-visible | **PASS** | **Fixed — was SETUP-BLOCKED** |
| index-health | SETUP-BLOCKED | Unchanged — separate, not-yet-root-caused check-timing issue (confirmed unrelated to the audit-chain rebuild: Client Map surface untouched by that fix) |
| wave0-draft-followup | SETUP-BLOCKED | **Flaky, not fully resolved** — PASSes reliably in isolation (confirmed 2×, including from a cold "Whole book" start) but hit a leftover-modal timing issue in the full-suite run this time (see "Residual flakiness" below) |
| wave1-calendar-brief-export | PASS | (fixed round-1, still holding) |
| **wave2-wealthbox-queue-review** | **PASS** | **Fixed — was SETUP-BLOCKED** |
| wave2-wealthbox-approve-live | SETUP-BLOCKED | Unchanged — separate issue, see "Not resolved" below |
| wave4-whole-book-view, estate-beneficiary-gap, estate-beneficiary-gap-dismiss-live, whole-practice-ask | PASS | (fixed round-1, still holding — confirmed again on two more different clients: Diaz, Sandra and Diaz, Michelle, not client-specific) |
| cross-cutting (light-theme, console-errors, egress-indicator) | PASS | |

**11 PASS, 0 FAIL, 3 SETUP-BLOCKED, 5 TODO (stubs, expected).** Both real FAILs from round 1 and
both navigation-gap SETUP-BLOCKEDs asked about this round are now fixed for the checks that
matter most (Wave 1, Wave 2 queue, Wave 4 — all real product flows). Two items remain
imperfect; neither is a product regression:

**Residual flakiness — wave0-draft-followup:** confirmed PASSing reliably in isolated re-runs
(twice, including cold-starting from "Whole book"). In the one full-suite run where it
SETUP-BLOCKED, the root cause traces to a Draft-follow-up modal left open from an *earlier manual
verification step in this same session* (not from the harness itself) that hadn't fully cleared
before the suite started — the same modal-doesn't-close-on-Escape behavior the `wave1.mjs` fix
above addresses. Not fully ruled out as zero-risk in a truly cold run; flagging honestly rather
than claiming full confidence.

**Not resolved — wave2-wealthbox-approve-live:** the review card `wave2-wealthbox-queue-review`
just confirmed present (screenshot-verified) is gone by the time the next check's fresh snapshot
runs a few seconds later. Investigated at length: not a toast/auto-dismiss timer (checked
`CrmWriteReviewCard.tsx` source, no such timer), not a Wealthbox-connection issue (confirmed
connected throughout), reproducible via the harness's own exact call sequence but NOT reliably
reproducible via manual step-by-step replay with the same driver primitives (several manual
attempts on fresh, never-before-touched notes never got the card to appear at all, even waiting
30+ real seconds) — suggesting a timing/state dependency not yet isolated. Time-boxed and
stopped rather than continuing to chase; flagging as a candidate for a future targeted
investigation, separate from this round's navigation-gap ask.

### Bench state left behind (this round)

App stopped, `LanternPlusDev` returned to **Disabled**, SSH tunnel closed. No stray native
dialogs this round (the overlay-dismiss fix held throughout). Calendar and Wealthbox connectors
both confirmed connected and healthy at end of session.
