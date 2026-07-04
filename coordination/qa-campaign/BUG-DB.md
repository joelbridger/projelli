# QA Campaign — Bug DB (coordinator owns status; explorers append findings)

| ID | Sev | Finding | Source | Status |
|----|-----|---------|--------|--------|
| QA-1 | P1 | Queued CRM write proposals are NOT persisted — app restart silently discards them (crmWriteQueueStore.ts) | codex code investigation off the bench's card-lifecycle repro | FIX LANE: lp/crm-card-visibility |
| QA-2 | P2 | The CRM review card renders only on the Client Map overview sub-tab — invisible from Documents/Email/Activity | same | FIX LANE: lp/crm-card-visibility |
| QA-3 | P3 | Toolbar confirmation copy misleads + auto-clears in 2.5s ("Added to the review card on this client's map") | same | FIX LANE: lp/crm-card-visibility |
| QA-4 | P2(harness) | wave2 bench check can PASS on the toolbar confirmation without proving the real review card | same | FIX LANE: lp/crm-card-visibility (item 4) |
| QA-5 | P1 | New clients created via "+ New client" have **zero folders linked by default** — new documents / imported files land in generic locations never scoped to the client, so the client's own Documents view falsely shows "No documents yet" even though the files are safely on disk. Breaks the client-isolation promise on a first-time user's very first action. | lane qa1, persona A first-run (Azure bench-1) | NEW |
| QA-6 | P1 | The Ask question input (`ask-composer-input`) collapses to 0px width and is non-interactable at the app's default-ish window size (~1028×749); confirmed working at 1424px. The whole 3-column Ask layout clips instead of stacking at 600px. Core "Ask" feature effectively unusable at a normal laptop window size. | lane qa1 | NEW |
| QA-7 | P1 (environment-dependent, needs re-verify) | Asking a question with local AI hangs on "Answering…" indefinitely (30s+, no error/timeout/messaging). Likely tied to a stalled local-model download on this specific Azure VM (app self-reported "The download looks stuck"), but the silent-forever-spinner UX gap is real regardless of root cause. | lane qa1 | FIXED @aca9bb81 (stall warning+timeout incl mid-answer; hang root-cause re-check on bench still open) |
| QA-8 | P2 | First-run onboarding splash: decorative icon graphics overlap and obscure card text ("builds Client Maps", "Ask anything, with sources" both illegible). Reproduced on 4 separate screenshots incl. a genuine cold first-run. | lane qa1 | FIXED @aca9bb81 (bench re-verify on next first-run pass) |
| QA-9 | P2 | Model-download progress banner overlaps the onboarding step header text ("2. Securely connect your data", "3. Setting up your firm" both garbled behind it) throughout the whole onboarding flow (9%/49%/93% progress all reproduce it). Does not occur once inside the main app. | lane qa1 | FIXED @aca9bb81 (bench re-verify on next first-run pass) |
| QA-10 | P1 (tentative, needs human-eyes confirm) | Onboarding splash's primary "Go!" CTA renders with opacity:1 in the DOM but is invisible in every screenshot (a transparent footer div sits on top per elementFromPoint); still clickable via test-id. Could be a real stacking bug or a CDP/WebView2 screenshot-capture quirk — flagging honestly, not confirmed either way. | lane qa1 | NEW |
| QA-11 | P3 | "Isolated client: outside connections are blocked..." status pill is visually truncated with no verified tooltip (full text present in DOM). | lane qa1 | NEW |
| QA-12 | P3 (possibly intentional) | 11-step product tour restarts from Step 1 on every fresh launch even after being skipped mid-tour previously. May be by design — flagging for a product call. | lane qa1 | PRODUCT CALL: Q8 in QUESTIONS-FOR-JAMESON (default: intentional) |
| QA-13 | P2 (browser-build-specific) | Client Map's "This client's memory needs to rebuild… try again in a moment" message is **permanent on the browser build**, not transient — source confirms the classifier explicitly buckets "no Tauri backend" (i.e. no RAG engine exists in-browser) into this same retry-suggesting message. Every client shows this forever; "try again" / "reopen this client" can never fix it here. Message should say the feature needs the desktop app instead of implying a retry will help. | lane qa3, persona D (browser dev build) | FIXED @4f26f151 (honest desktop-only message) |
| QA-14 | P1 | **Language switch (Settings → Deutsch/Español) does not translate the core app.** Setting persists correctly (`lantern:settings.language` survives reload) and the Settings panel itself IS fully translated, but the primary left nav ("Client Map"/"Ask"/"Workflows"), the per-client hub's own tabs, and row action buttons ("Ask") all stay hardcoded English. Root-caused to literal string labels (not `t()` calls) in `src/app/shell/layout/Spine.tsx:73-75`, `src/features/matters/MatterHub.tsx:87-89`, and `src/features/matters/MattersHome.tsx:272` — not a missing-translation-file problem (de.json has 1524 keys, more than en.json's 1058). Some other strings (e.g. the "Report a bug" aria-label) DO translate correctly, so this is a specific-components gap, not total breakage. Directly undercuts the "de/es ship" claim for the surfaces advisors actually live in daily. | lane qa3, persona D (browser dev build) | FIXED @31da41f6 (verified live in German w/ screenshots) |
| QA-15 | P1 (silent data loss) | **Two browser tabs open on the same workspace can silently destroy each other's data.** Deterministically reproduced: create a client in Tab B, then (without Tab B ever seeing Tab A's or vice versa — no cross-tab reactivity) create a different client in Tab A; reload Tab B and its own new client is simply gone from `localStorage`, silently overwritten by Tab A's last-write-wins full-state save. No error, no conflict warning, no merge. Mechanism is the browser build's `zustand/persist`-to-`localStorage` pattern with no `storage`-event/BroadcastChannel sync and no optimistic-concurrency check — flagging for a desktop re-check of the analogous two-windows-same-workspace scenario, since the failure mechanism is browser-specific but the general risk shape (two writers, last-write-wins) may not be. | lane qa3, persona D (browser dev build) | FIXED @4f26f151 (single-writer tab gate; 7 review rounds closed every race) |
| QA-16 | P3 (informational, held up well) | Client/file names containing `<img onerror>`/`<script>` HTML-injection payloads never execute anywhere in the UI (breadcrumb, sidebar, table, tab title, Ask composer) — confirmed via a `window.__xss` sentinel that stayed `false` through every surface. React's default escaping holds. Separately, the actual on-disk folder created for such a client has angle brackets stripped (`img src=x onerror=alert(1) Test script...`) while the UI continues to show the raw literal name — a minor, expected disk/display name mismatch for unsafe characters, not a bug. | lane qa3, persona D (browser dev build) | NEW |
| QA-17 | P3 (unexplored past 500, needs desktop recheck for OS-level names) | 500-client workspace: bulk-creating 500 clients directly via the store took 173ms; the Client Map table and sidebar render all ~500 rows into the DOM with no virtualization, but a live search-filter keystroke still resolved in 18ms and navigation felt immediate — no felt perf problem at this scale, though not tested materially larger. Separately, zero-byte files, a 500MB (allocated) file, reserved Windows device names (`CON`, `PRN`), trailing-dot/trailing-space names, emoji, CJK/accented unicode, and a 255-char filename all rendered correctly with no crash or layout break — but this used the permissive in-memory test-mode mock FS, so Windows reserved-name rejection specifically needs a real desktop/OS recheck (a real filesystem would enforce it; the mock cannot). | lane qa3, persona D (browser dev build) | NEW |
| QA-18 | P3 (informational) | The web build has zero URL/history integration — one static URL for the whole app, no `pushState`/hash routing, no `popstate` listener (grep-confirmed absent). Browser Back/Forward do nothing useful inside the app (can't step back through a tab switch), and if the browser tab has any prior page in its history, Back exits the entire app instantly with no warning. No deep-linking or bookmarking to a specific client/tab is possible. Likely a deliberate scope choice for now, flagging for product awareness. | lane qa3, persona D (browser dev build) | NEW |
| QA-19 | P1 | **Newly created/imported documents are not searchable by Ask until the app is restarted.** A doc created and typed into via the app's own UI, and files dropped straight into a linked folder, both come back "Nothing found in your files" from Ask — even though the content is real and correctly scoped. Only a full app restart triggers a real RAG reindex (`reused` count jumps, `reindexed` count stays 0 the whole time in between). Breaks the core "create → ask about it" workflow an advisor would do constantly in a single sitting. | lane qa2, persona B (Azure bench-1) | FIXED @70bc4cc6 (root cause: silent watcher-install failure; wiring isolated+retried) |
| QA-20 | P1/P2 | **Starting a meeting recording with no usable microphone fails completely silently.** Consent dialog closes, "Record a meeting" button reverts to its idle label, zero error/toast — an advisor has no way to tell whether recording started, failed, or why. Backend does get far enough to create an empty `Meetings/` folder on disk before failing, which is then never cleaned up. No crash, no wedged state (app stays fully navigable) — but the complete silence is itself a real gap, distinct from a "clean no-device message." | lane qa2 | CLOSED @d272c836 — orphan already fixed @e5f0207c, silent-half by @582a32fe; mic-specific regression tests added |
| QA-21 | P2 (environment-dependent) | Local-AI Ask answers intermittently end in a generic "The local AI couldn't answer, and your data stayed on your machine... try again or search by keyword" error after 60–90s of real processing (confirmed via CPU/process activity, not a hang) — happened on 2 of 3 attempts in this session, including once right after the model had already found and started citing the correct file mid-stream. Graceful degradation itself is good (no crash, clear message, keyword-search fallback suggested); the failure rate is the concern. This VM's CPU-only 4-vCPU inference is a plausible confound — recommend re-checking on the Legion/a GPU machine before treating the failure *rate* as a real product bug, but the error-message UX is worth keeping either way. | lane qa2 | NEW |
| QA-22 | P3 | "Send to Wealthbox" button's disabled-tooltip says "Connect Wealthbox in Settings → Connections" — but there is no "Connections" section anywhere under the Settings gear (confirmed via full settings nav, the settings search box, and the Ctrl+K command palette, all empty for "wealthbox"/"connections"). The real location is **Account (bottom-left "Your account") → Connections tab** — a completely different, non-obvious surface from what the tooltip tells you to look for. | lane qa2 | FIXED @d272c836 (tooltip points to Account → Connections; de/es backfilled) |
| QA-23 | P3 (inconclusive, needs live re-test) | Attempted to re-verify QA-1's persistence fix by directly seeding a well-formed `ProposedCrmWrite` into the `crm-write-queue-storage` localStorage key (matching the store's own persisted shape) and reloading. The item survived in localStorage across the reload (the underlying persistence QA-1 fixed does hold), but neither the Client-Map-overview review card nor the cross-tab "pending" banner ever rendered it — even though the card's own source only needs `items.length > 0` to mount. Could not tell whether this is a real regression or an artifact of hand-seeding the store outside its normal write path (no live Wealthbox token was available this session to test the real flow end-to-end). Flagging honestly as unresolved — the next lane with a real Wealthbox sandbox token should re-run QA-1's original repro rather than trust this synthetic test. | lane qa2 | NEW |
| QA-24 | P1 (client-isolation breach) | **Double/triple-clicking "Create client" creates multiple duplicate client records that collide on the same on-disk folder name, and files created inside one duplicate can become permanently invisible in that same duplicate's own Documents view.** Triple-clicking the Create button on a single "Klutz Test Client" submission created 3 separate matter records (distinct `matter_*` IDs), all auto-linked to the identical physical folder `QA Workspace/Klutz Test Client/` (confirmed via each duplicate's own "Creating in:" path in the New-Document dialog). A file created inside duplicate #1 was written to disk correctly but its own Documents tab kept showing "No documents yet" even after re-navigating away and back — while a control test creating a file in a normal, non-duplicated client (Garcia Family Trust) showed the new file immediately, proving the bug is specific to the name-collision state, not a general file-list-refresh issue. No debounce/disable-while-submitting guard exists on the Create button. | lane qa4, persona C "the klutz" (Azure bench-1) | FIXED @9dd18f06 (submit-guard + store uniqueness re-check) |
| QA-25 | P2 | **Submitting an Ask question and immediately switching to a different client silently discards the question** — no error, no partial/"Answering…" state, no history entry, nothing. Asked Emily Chen Household's Ask a real question, immediately clicked to Garcia Family Trust, then back to Emily (both immediately and again after an 8s wait): Emily's Ask thread was completely empty both times, as if the question had never been submitted — the composer still showed the typed text but the conversation area was blank. A real advisor doing this (ask a question, then get pulled into another client) would have no way to tell whether their question is still processing, was lost, or never went through. | lane qa4, persona C "the klutz" (Azure bench-1) | FIXED @9dd18f06 (honest cancel + persisted record + abort re-check) |
| QA-26 | P3 | **Two different "create a new document" affordances behave inconsistently.** The empty-state "+ New Word document" button (shown when a client has zero files) opens a "Create Word Document" naming dialog first. The toolbar's "New document" button (shown once a client has any files) instead creates a file immediately with a generic default name (`my-document.docx`) and no naming prompt at all. A klutz clicking the toolbar button expecting the same naming step as the empty-state button gets an unexpectedly-named file with zero confirmation. | lane qa4, persona C "the klutz" (Azure bench-1) | CLOSED @9dd18f06 (already consistent; regression test locks it) |
| QA-30 | P1 (trust-breaking) | **Recorded meetings vanish from the Meetings tab after an app restart** — files fully intact on disk (verified by direct filesystem check on the Legion), but the tab shows "No meetings yet" for ALL meetings incl. pre-existing ones. Looks exactly like data loss to an advisor. Found during the live Legion walkthrough (real Teams call recorded; consent + zero-egress PASSED). Evidence: docs/evidence/meetings-verify-20260704/ on lp/windows-smoke-evidence. (IDs QA-24..29 reserved for lane qa4.) | lane meetverify (Legion, real hardware) | FIXED @cb1181c9 (scan retry + honest error state; pending live Legion re-verify) |

---

## Lane qa1 detail — persona A, "brand-new advisor, first 30 minutes" (Azure bench-1, 2026-07-04)

**Seat/setup:** `lantern-cloud-bench-1`, app-data wiped (`%APPDATA%\lantern` backed up to
`C:\qa-backup-20260704` then deleted; no legacy `%APPDATA%\keepance` dir existed). No pre-existing
workspace folder was found anywhere on the VM's disk, so the wipe alone produced a true first run.
Driven live over CDP (`scripts/desktop-drive.mjs`) + a small ad hoc UI-Automation helper for the
two native Windows dialogs (folder picker, file picker) onboarding requires. Repo pinned at
`f6614b43` (12 commits behind `origin/lantern-plus` tip at exploration time — pathguard/audit-chain/
gap-tab fixes, none touching first-run/onboarding UI — kept as-is to save a rebuild cycle inside the
2h VM budget; none of the findings below look related to those 12 commits). Evidence under
`coordination/qa-campaign/evidence/qa1-20260704/`.

### Repro detail + evidence per finding

**QA-5** (client has no default folder): 1) Create a client via "+ New client" (name only — no
folder step in that dialog). 2) Click "New Word document" → save. 3) Go to Files list → "No
documents yet". 4) `Get-ChildItem` on the VM confirms the .docx really exists in `docs/`. 5) Same
result with "Add files" (files land in the *workspace root*, not even `docs/`). 6) Opening client
settings → "Folders in this client" shows every workspace folder with **none checked**. Manually
checking "docs" makes the file appear immediately. Evidence: `16-client-created.jpeg` →
`25-files-list.jpeg` (empty) → `28-doc-list-recheck2.jpeg` (still empty after full re-nav) →
`29/30` (imported files, same emptiness) → `31-client-folders.jpeg` (root cause: no folder checked)
→ `34-docs-after-linking.jpeg` (fixed once linked). **Real, high confidence** — reproduced 3
independent ways, and directly contradicts the client-creation dialog's own promise ("grouped under
one or more workspace folders... so other clients' data never appears").

**QA-6** (Ask input 0-width): Open Ask tab at the app's normal window size → no visible text box,
only scope pills + a disabled "Ask" button. DOM confirms `getBoundingClientRect().width === 0`;
Playwright's `.fill()` timed out (genuinely non-interactable, not just visually subtle). Resizing
the OS window to 1424px wide → input becomes 388px and fully usable. Resizing to 600px wide → whole
right/composer area clips off-screen instead of stacking. Evidence: `35-ask-tab.jpeg` (no input) vs
`36-ask-wide-window-works.jpeg` (works at 1424px) vs `45-ask-small-window.jpeg` (clipped at 600px).
**Real, high confidence** — this is the core "Ask" feature, unusable at a window size that isn't
unusually small for a laptop.

**QA-7** (Ask hangs on "Answering…"): picked "Try Local AI" during onboarding, asked "Which client
is doing a 1031 exchange?" shortly after — stuck 30+s with zero error/timeout/explanation. The AI &
Privacy settings page itself hedges "...Local AI **when it's ready**", and the download banner had
separately self-reported "The download looks stuck. Restarting Advisor Prep Hero resumes it where it
stopped." (~2.98GB downloaded of two models expected to total more.) Evidence: `37-ask-submitted.jpeg`,
`38-ask-answer.jpeg`, `39-ask-answer-wait2.jpeg` (all show "Answering…" unchanged). **Uncertain** —
likely this VM's network, not the app; recommend a re-check on the Legion before treating the hang
itself as confirmed, but the missing "still downloading" messaging is a real gap either way.

**QA-8** (splash icon/text overlap): reproduced on 4 independent screenshots including a genuine
cold first-run, persisting 3s+ apart (not mid-animation). Evidence: `00-preexisting-state.jpeg`,
`00b-preexisting-state-after-wait.jpeg`, `01-true-first-run.jpeg`, `03-recheck-go-button.jpeg`.

**QA-9** (download banner overlaps onboarding headers): reproduced at 9%, 49%, and 93% download
progress — i.e. throughout, not a one-frame glitch. Only happens during onboarding; the same banner
sits cleanly below the top bar once inside the main app. Evidence: `09-try-local-ai.jpeg`,
`10-download-overlap-recheck.jpeg`, `11-after-continue.jpeg`.

**QA-10** ("Go!" button invisible): DOM shows `opacity:1`, red background, `pointer-events:auto` at
a position that renders as blank background in every screenshot; `elementFromPoint` at that
coordinate returns an empty, fully-transparent footer div sitting on top. Despite this,
`page.click()` on its test-id succeeded and advanced the flow correctly. Evidence:
`01-true-first-run.jpeg`, `02-model-download-progress.jpeg`, `03-recheck-go-button.jpeg` (no button
visible) vs successful click outcome in `04-after-go-click.jpeg`. **Genuinely unclear** — could be a
real z-index bug or a WebView2/CDP-screenshot-specific rendering quirk (the Azure bench setup log
already documents past screenshot/DPI oddities on this same bridge); recommend a same-scenario check
on the Legion with a human screenshot before treating this as confirmed.

**QA-11** (status pill truncated): visible on `19-client-detail.jpeg` and most subsequent
client-view screenshots; full text confirmed present in the DOM via direct query, just not visually
complete without a wider window.

**QA-12** (tour restarts): skipped tour at step 4, killed + relaunched the app, tour reappeared at
Step 1 of 11. Evidence: `13-tour-step4.jpeg`, `46-after-crash-relaunch.jpeg`. Plausibly intentional
(keep offering until fully completed) — flagged as a product question, not a confirmed defect.

### What's GOOD (so a designer can feel the first-run, not just the bugs)

- **Crash resilience is solid.** Killed the app mid-session (after creating a client, a document, and
  linking a folder) and relaunched cold: workspace, client, linked folder, and the document all came
  back exactly as left. Zero data loss, zero corruption. (`46-after-crash-relaunch.jpeg`,
  `47-docs-survived-crash.jpeg`)
- **Single-instance handling is clean.** Launching a second copy of the app while one is already
  running silently no-ops — no crash, no duplicate window, no confusing state. (A friendly "already
  running" toast would be a nice-to-have, not a bug.)
- **Unicode/emoji/CJK names work correctly end-to-end.** Created a client named "Müller Family 🎉
  Household — 陈" and a folder with the same characters — both render perfectly in the app and
  persist correctly on disk. (The garbled `M?ller ?? ?` seen over a raw SSH terminal was confirmed to
  be a Windows console codepage display artifact, not a real bug — the app's own UI shows the name
  correctly.) (`48`–`52-unicode-*.jpeg`)
- **Privacy/trust messaging is genuinely good, not just marketing copy.** "Indexed on your machine.
  Nothing was uploaded." toast after importing files; the "On this computer only" vs "Cloud AI (your
  account)" tradeoff screen in Settings is clear and honest about what happens where; "Network
  lockdown" auto-enables with a plain-language reason shown inline; the "Isolated client" pill
  reinforces the same story contextually. This is the app's core differentiator and it actually shows
  up in the UI, not just the pitch deck.
- **The "How do you want to start?" (sample practice vs. connect your own data) and "Connect your AI"
  (BYOK vs. local, with an honest 2.5GB/~5min disclosure) onboarding screens are clean, well-written,
  and free of bugs.**
- **The New Client and New Document/New Folder dialogs are simple and clear**, and transparently show
  the real on-disk path being used ("Creating in: C:/Users/.../QA Workspace/docs/") — good
  trust-building detail.
- **The window holds up reasonably at a genuinely small size (600×500)** — no overlapping text,
  content just gets cramped and scrollable, aside from the Ask-screen clipping noted above.

### Notes for the coordinator (not product bugs)

- **Bench tooling landmine (not app-related):** on this VM, `ssh -L port:localhost:destport` silently
  fails (empty replies) because "localhost" resolves to IPv6 on the Windows sshd side while the app's
  CDP port only listens on IPv4. Using `127.0.0.1` explicitly in the `-L` spec fixes it. Worth a
  one-line fix in `scripts/desktop-drive.mjs`'s header comment / any bench docs referencing the
  `ssh -N -L 9444:localhost:9223` pattern, since it may bite the next session on this same VM.
- Voice input showed "Sidecar missing (voice features disabled in this build)" on this VM — plausibly
  a bench-setup gap (binary not copied to this VM), not a customer-facing defect; not filed as a bug
  pending confirmation the sidecar ships in real installers.

### Plain-language summary (for Jameson)

I set this cloud test computer back to exactly what a brand-new customer would see — wiped its saved
settings, confirmed there was no old workspace lying around — and then used the app myself from
scratch: installed screen, picked a folder, connected a free local AI, added a client, dropped in some
files, asked a question, poked every settings screen, and tried to break it (small windows, killing
the app mid-use, weird names with emoji, launching it twice).

**The one thing that most needs fixing:** when I made a brand-new client and added files to it, the
app told me "No documents yet" — as if my files had vanished. They hadn't; I found them safely on
disk. The real problem is that a new client isn't automatically given its own folder, so anything you
create for that client quietly lands somewhere else instead of "inside" the client, and the client's
own file list just looks empty. For a first-time user this reads exactly like "I just lost my work,"
which is about the worst first impression a private, trust-focused app like this can give.

**Second big one:** the box where you type your question to the AI ("Ask") was invisible and unusable
at the app's normal window size — it only worked once I made the window quite a bit wider. That's the
app's main feature, hidden, right out of the gate.

**Smaller stuff:** a couple of screens have graphics that overlap and cover up text (the welcome
screen and the "downloading your AI" progress banner); the local AI download seemed to stall on this
particular test computer and the app just spun forever with no explanation (might just be this cloud
machine's internet, not a real bug — worth a second look on the Legion laptop).

**What's genuinely good:** I could not make it lose data. I killed the app in the middle of working
and everything came back exactly as I left it. Weird names with emoji and Chinese characters worked
perfectly. The privacy messaging ("nothing was uploaded," "this client is isolated," the local-vs-cloud
AI choice) is clear and trustworthy, not just marketing talk. Running it twice at once was handled
gracefully. The onboarding screens themselves are well-written and pleasant once the visual overlap
bugs are fixed.

---

## Lane qa3 detail — persona D, "the edge-case hunter" (browser dev build, 2026-07-04)

**Seat/setup:** server's browser dev build only (`npm run dev` in `~/lp-qa3`, port 5177,
`--strictPort`), driven via the always-on Chrome over CDP. No VM, no Legion, no bench. Repo at branch
tip `d3b59aeb`. The app's real "New Workspace"/"Add files" flows call the native File System Access
API (`showDirectoryPicker`/`showOpenFilePicker`) which this session's tooling cannot drive directly
(native OS dialog, outside the page DOM) — testing instead used the app's own sanctioned test-mode
entry point (`?testMode=true`, the same one this repo's Playwright specs use: a real in-memory
`WorkspaceService` + real `matterStore`, not a UI mock). Full harness notes, raw eval output, and
source citations for every finding below are in `coordination/qa-campaign/evidence/qa3-20260704/evidence.md`;
screenshots in the same folder. Findings: QA-13 through QA-18 (see table above).

### What's GOOD (so a designer can feel the edge-case behavior, not just the bugs)

- **No XSS, anywhere tried.** Client and file names containing `<img src=x onerror=alert(1)>` and
  `<script>` payloads never executed — confirmed with a live `window.__xss` sentinel across every
  surface (breadcrumb, sidebar, table, tab title, Ask composer, workflow search). React's default
  escaping holds even under deliberately hostile input.
- **New clients still get a real linked folder automatically** — the earlier QA-5 fix (from the
  `lp/crm-card-visibility`-era work) is confirmed still in effect: a freshly created client showed
  "1 folder" immediately, no "No documents yet" false-empty trap.
- **State survives a full page reload.** 500+ clients and all settings were still present and correct
  after a hard reload of the page — the browser build's `localStorage` persistence is solid for the
  single-tab case.
- **Filenames are genuinely robust.** Zero-byte files, a 500MB file, emoji, Chinese/accented unicode,
  trailing dots/spaces, and a 255-character filename all rendered correctly in the Documents grid —
  no crash, no mis-encoding, no layout break, no truncation problems beyond sensible CSS ellipsis.
- **All the empty states are clean.** A brand-new workspace's Client Map, Ask, and Workflows tabs, and
  a brand-new client's Documents/Email/Meetings/Activity tabs, all show honest, on-brand "nothing here
  yet" messaging with no console errors — including a nice touch on Activity ("Stored in your browser,
  not encrypted. Use the desktop app for confidential work.") that's honest about this specific seat's
  limits.
- **500 clients performs fine.** No virtualization in the client list/table, but filtering 500 rows by
  search resolved in 18ms and the UI never felt sluggish at this scale.

### Plain-language summary (for Jameson)

I spent this session trying to break the web version of the app on purpose — empty workspaces, giant
lists of fake clients, ugly file names, and multiple browser tabs open at once.

**The most important thing I found:** if you have the app open in **two browser tabs at the same
time** and add a client in each one, one of those two new clients can just **silently vanish** — no
error message, nothing. The last tab to save "wins" and the other tab's work quietly disappears. This
only happens in the web/browser version (the desktop app doesn't work this way, though it's worth a
quick check there too for the same idea — two windows open on one workspace).

**Second big thing:** switching the app's language to German or Spanish in Settings does save your
choice, and the Settings screen itself really does show German — but the main screens you actually
work in every day (the left-hand menu, the tabs on a client's page, the "Ask" buttons) stay in English
regardless. So right now, choosing German or Spanish only changes one settings page, not the app you
actually use.

**Smaller things:** a client's overview page shows a permanent "still building, try again" message on
this web version specifically — it can never actually finish because the web build doesn't have the
piece that builds it (that's a desktop-only feature right now), so the message is misleading rather
than wrong. And the browser's own Back button doesn't do anything useful inside the app — it's a
different kind of app than a normal website, so there's nothing to step "back" through.

**What held up well:** I tried to break things with fake "hacker" text in names (the kind of thing
that can sometimes trick a website into running code) and none of it worked — the app safely showed
the ugly text as plain text every time, never ran it. Weird file names (emoji, foreign characters,
super long names, empty files, huge files) all displayed correctly. And even with 500 fake clients
loaded in, everything stayed fast. Nothing I did caused a crash.
> NOTE: this lane filed its findings as QA-13..17 before qa3's rows merged first; the table above renumbers them to QA-19..23 (evidence files keep the lane-internal numbers).

## Lane qa2 detail — persona B, "the daily driver, a week compressed" (Azure bench-1, 2026-07-04)

**Seat/setup:** `lantern-cloud-bench-1`. Repo was ~12 commits behind the Meetings-tab merge at
session start (`f6614b43`) — pulled to `origin/lantern-plus` tip (`a30d4d10`) and did a genuine
cold-ish rebuild (37 Rust files / ~10,650 lines changed since the VM's last pin — mostly the
diarization/Meetings feature — took ~14 min, not the "~3 min warm relink" the setup log assumed for
small diffs). App data was NOT wiped — the VM's existing state was a thin 2-client leftover from
lane qa1's own first-run testing (Emily Chen Household, Müller Family), both already correctly
folder-linked (QA-5's fix holding for pre-existing clients too, likely because qa1 manually linked
them during their own investigation). Kept those two and added Garcia Family Trust + Okafor
Retirement Planning via "+ New client" to reach 4 total, each seeded with realistic advisor notes
(Roth conversion, 529 plan, concentrated-stock diversification, Social Security claiming strategy)
so Ask/citation-isolation testing had real distinguishing content per client. Local AI was already
fully downloaded ("Installed and ready") from a prior session — QA-7's stalled-download state did
not reproduce this time. Evidence: `coordination/qa-campaign/evidence/qa2-20260704/`.

### Repro detail + evidence per finding

**QA-13** (Ask can't find new content until restart): created "Roth Conversion Plan - Emily
Chen.docx" via New Document + typed real content into it (autosave confirmed "Saved"), and
separately dropped a `concentrated-position-plan.txt` straight into Garcia Family Trust's linked
folder. Asked Garcia's own client-scoped Ask "What concentrated stock position does this client
hold?" → **"Nothing found in your files"** (`24-ask-fullanswer.jpeg`), despite the file existing on
disk and being correctly scoped. Checked the Rust log: `rag reconcile: DONE work=0 reused=3
reindexed=0 deleted=0` had run exactly once, at app boot, and never again — no reindex event fired
for either the app-created doc or the directly-dropped file for the rest of that session. Force-quit
and relaunched the app (a real, if forced, restart): the SAME question this time correctly surfaced
"[Garcia Family Trust — Advisor Working Notes paragraph 0]" mid-answer (`28-ask-final.jpeg` shows the
citation forming) — the restart is what triggered the real reindex (`reused` jumped 3→11, confirming
new content was finally picked up). **Real, high confidence**: reproduced identically for a
UI-created doc AND an externally-dropped file; the fix (restart) is not something a real advisor
would think to do mid-session, and the workflow this breaks (jot a note, immediately ask about it) is
exactly the "week compressed" persona's bread and butter.

**QA-14** (silent recording failure, no mic): `record-meeting-button` → consent checkbox → "Start
recording" on Emily Chen Household (Azure bench-1 has no real audio hardware, as expected/instructed).
Result: dialog just closes, button reverts to "Record a meeting" (not "Recording…"), Meetings tab
still says "No meetings yet" (`48-after-start-recording.jpeg`, `49-immediate-after.jpeg` — the second
one screenshotted immediately after the click to rule out a fast-fading toast; still nothing).
Reproduced twice identically. Checked disk: an empty `docs/Meetings/` folder had been created (Rust's
`capture_start` got far enough to set up a meeting directory before whatever failed), but the Rust
log shows zero lines matching `capture|audio|device|mic` around the event — the failure happens
somewhere that logs nothing. App itself stayed fully responsive after (navigated away cleanly, no
wedge) — this is NOT a crash, which per the brief counts as a real gap rather than a good outcome
(a clean, visible "no microphone found" message would have been the good outcome). Evidence:
`47-consent-dialog.jpeg` (the good part — clear, state-aware consent UX) through `49-immediate-after.jpeg`.

**QA-15** (local AI answer failures): confirmed via direct process monitoring that the local model
(`llama-server-x86_64-pc-windows-msvc.exe`) was genuinely computing (CPU time climbing steadily, not
stalled) during both long "Answering…" waits, ruling out a hang — but 2 of 3 completed Ask attempts
this session ended in the app's own "The local AI couldn't answer" error message after 60–90s,
including one case where the answer had already started forming with a correct citation
(`29-ask-final2.jpeg`) before failing. The one attempt that fully succeeded (`28-ask-final.jpeg`) took
a comparably long time. Flagging as environment-dependent (this VM is 4 vCPU / CPU-only inference,
no GPU) rather than asserting a universal reliability bug — but the failure *message* itself is good,
honest UX worth keeping regardless of root cause.

**QA-16** (Wealthbox tooltip points to the wrong Settings location): the disabled "Send to Wealthbox"
button's tooltip reads "Connect Wealthbox in Settings → Connections." Checked every Settings category
(Workspace/AI & Privacy/Voice/Advanced/Help), the Settings search box, and the Ctrl+K command palette
— none surface a "Connections" section for "wealthbox" or "connections." The real Wealthbox connector
(API-key paste field, `65-wealthbox-found.jpeg`) lives under the account-avatar menu (bottom-left
"Your account") → **Connections** tab, a completely different, much less discoverable surface than
what the tooltip describes.

**QA-17** (CRM review-card restart test, inconclusive): see bug-table entry above — a synthetic
localStorage seed of `crm-write-queue-storage` survived a reload (persistence layer itself works) but
never rendered a review card or cross-tab banner, and no live Wealthbox token was available this
session to run QA-1's original repro for real. Not confident enough to call this a regression;
flagging for a lane with real Wealthbox sandbox access to re-verify properly.

**Not filed as a bug — a testing lesson worth recording:** the "+ New client" quick-create form has
TWO name-like fields whose internal variable names are swapped from what a naive tester expects: the
visually-labeled "Client name" field is `matter-new-name` (bound to the actual name), while the
testid `matter-new-client` is actually the "Company / Organization (optional)" field. Typing a
client's name into `matter-new-client` by testid (an easy mistake for anyone driving this via
data-testid rather than visible labels) silently creates a client with an empty name and the typed
text sitting in Company instead — the UI happens to gracefully fall back to displaying the company
value as if it were the name, which is what makes the mistake easy to miss. Caught this on my own
Garcia/Okafor clients, verified via direct DOM inspection that it was my own driving error (not a
product bug — a real user typing into the correctly-labeled visible field never hits this), deleted
and recreated them correctly. Flagging only so a future explorer using testid-based automation
doesn't lose time on the same false lead.

### What's GOOD (so a designer can feel the week, not just the bugs)

- **Data survived everything I threw at it.** Across this session I force-killed the app mid-session
  more than half a dozen times (some intentional restart tests, several from my own bench-tooling
  troubleshooting) — every single time, all 4 clients, every document (including ones mid-autosave),
  and a 60-file bulk-import folder came back completely intact, `76-post-rapid-restart.jpeg` shows the
  Client Map fully recovered immediately after one such forced kill mid-view of the bulk-import
  folder. Never lost a byte, never saw a corrupted file.
- **The Word editor + autosave is solid.** Typed real multi-paragraph content into two different
  client documents; both autosaved cleanly ("Saved" indicator), and the app **automatically created a
  timestamped `.backup-*.docx` snapshot** of the pre-edit version before applying my typed content as
  a tracked change — a real safety net a financial advisor would want, working correctly without me
  asking for it.
- **The consent-to-record dialog is genuinely well done**, not just legally defensive: plain-language
  state-law framing, a suggested verbal script, and an honest "this is general guidance, not legal
  advice" disclaimer (`47-consent-dialog.jpeg`).
- **The new-client folder auto-linking fix (QA-5) holds** for freshly created clients — verified via
  direct DOM inspection that Garcia Family Trust and Okafor Retirement Planning's own folders were
  auto-checked the moment they were created, no manual linking needed.
- **The Ask composer responsive-layout fix (QA-6) holds** — the Ask input box was fully visible and
  usable at this session's ~1028×749 window the whole time, no 0-width collapse.
- **Bulk import handled 60 files without any strain** — dropped 60 plain-text files straight into a
  linked folder via the filesystem (simulating a large external import); the Documents grid rendered
  all of them instantly and scrolled smoothly, no lag, no pagination confusion, no missing files.
- **Client-scoped Ask never bled across clients** in any test I ran — when it did find content, it
  only ever cited the active client's own files, never another client's.

### Plain-language summary (for Jameson)

I spent the day pretending to be a busy financial advisor: I hopped between four made-up clients,
wrote real notes about their retirement plans and stock positions, tried recording a client meeting,
and asked the AI questions about what I'd just written — all on the cloud test computer.

**The biggest thing that needs fixing:** if you write a note or drop in a file and then *immediately*
ask the AI a question about it, the AI says "I found nothing" — even though the file is right there.
The only way to make it show up is to fully quit and reopen the app. For a real advisor jotting notes
during a busy day and asking follow-up questions right after, this would look exactly like the app
"forgetting" what you just told it, when really it's just a bookkeeping delay that a restart happens
to fix. This is the same "Ask" feature that was already flagged as needing fixes from the first-run
testing — it's core to the product's promise and needs to reliably see fresh work.

**Second thing:** I tried recording a fake client meeting on this test computer (which has no real
microphone, on purpose, since it's a cloud machine). The app didn't crash — good — but it also didn't
tell me anything went wrong. The "record" button just quietly went back to normal, like nothing had
happened. A real advisor with a genuinely broken microphone would have no idea why their meeting
never got recorded.

**Smaller stuff:** the button to connect the CRM system (Wealthbox) tells you to look in the wrong
settings menu for where to connect it; the AI sometimes takes a long time to answer and then gives up
with an honest "I couldn't answer" message instead of the answer (might just be this slow test
computer, worth checking on a real laptop).

**What's genuinely good, and worth feeling good about:** I could not break the data no matter how
hard I tried — I killed the app mid-work more than half a dozen times, once right in the middle of
viewing 60 freshly-imported files, and every single time everything came back exactly as I left it.
The Word editor auto-saves and even quietly keeps a backup copy before big edits. The meeting-consent
screen is genuinely thoughtful, not just a legal cover-your-back popup. And the fixes from the very
first testing round (new clients getting their own folder, the Ask box being visible on a normal-size
window) are both holding up correctly under real use.

---

## Lane qa4 detail — persona C, "the klutz" (Azure bench-1, 2026-07-04)

**Seat/setup:** `lantern-cloud-bench-1`, reused from qa2's session (repo was only ~2h stale). Pulled
to `origin/lantern-plus` tip (`de72ab1b`, includes the `aca9bb81` QA-fix-batch2 merge and the
`582a32fe` Meetings-tab UX gate) and rebuilt — no Rust changes in the diff, so the rebuild was a fast
8.97s relink, not a cold compile. Kept qa2's existing 4 clients (Emily Chen Household, Müller Family,
Garcia Family Trust, Okafor Retirement Planning) rather than wiping, per the coordinator's assignment.
Driven live over CDP (`scripts/desktop-drive.mjs`) via a dedicated SSH tunnel on local port 9451 (per
the coordinator's port-collision note). Evidence: `coordination/qa-campaign/evidence/qa4-20260704/`
(26 screenshots, numbered in chronological order).

**Operational note, not a product bug:** mid-session, killing `lantern.exe` to test crash resilience
left the dev harness (`npm run tauri:dev` via the `LanternDevBench` scheduled task) unable to cleanly
restart for about 15 minutes — `Start-ScheduledTask`/`schtasks /run` kept returning `LastTaskResult 1`
with the redirected log file silently un-writable, and manual `Start-Process`/`cmd /c` invocations over
SSH never actually launched a process (very likely a Windows session/window-station restriction on
processes started from a non-interactive SSH context, which is exactly why the original bench setup
used an interactive `AtLogOn` scheduled task in the first place). A full `az vm restart` resolved it
cleanly in ~3 minutes (the same auto-logon + `AtLogOn` task that worked right after the original
`az vm start` fired again correctly). Also chased a red herring here: repeatedly seeing a dozen
`msedgewebview2.exe` processes with fresh timestamps after each kill attempt looked at first like the
app orphaning its WebView2 children on force-kill, but turned out to be unrelated Windows 11 shell
components (Widgets/Search) that also use `msedgewebview2.exe` — confirmed by checking that
`lantern.exe` itself and port 9223 were both genuinely down the whole time. Flagging so a future bench
session doesn't lose the same ~15 minutes, and doesn't mistake OS shell noise for an app bug.

### Repro detail + evidence per finding

**QA-24** (duplicate clients collide on one folder, files go invisible): opened "+ New client",
typed "Klutz Test Client", then fired 3 rapid clicks at "Create client" — a well-meaning klutz's
classic "did that register?" re-click. Result: 3 separate matter records (`matter_59c12ad6…`,
`matter_48da243d…`, `matter_86e8ade9…`), each showing "1 folder" in the Client Map, and — critically —
each one's own "New Word Document" dialog showed the identical "Creating in:
C:/Users/lpbench/Documents/QA Workspace/Klutz Test Client/" path, proving all 3 point at the same
physical directory (confirmed on disk: only one `Klutz Test Client` folder exists at all).
Created `MARKER-FROM-DUPLICATE-1.docx` inside duplicate #1 — the file landed on disk correctly
(confirmed via `Get-ChildItem`) but duplicate #1's own Documents tab kept showing "No documents yet",
even after navigating away to Client Map and back twice. To rule out a general "file list doesn't
refresh" bug, ran the identical create-a-document flow on Garcia Family Trust (a normal,
non-duplicated client): the new file appeared in its Files grid immediately, no delay, no re-nav
needed — proving the invisibility is specific to the name-collision state the triple-click created,
not a general regression. Evidence: `03-new-client-doubleclick.jpeg` (dialog opens once despite
double-click) → `04-after-tripleclick-create.jpeg` (3 duplicate rows) → `05`/`08`/`09` (duplicate #1's
Documents tab stuck on "No documents yet") → `10`–`13` (Garcia control test: file appears instantly).
**Real, high confidence, reproduced with a clean control** — and a genuine breach of the client
isolation promise, since a real advisor mis-clicking Create would end up with confidential documents
silently split across indistinguishable "Klutz Test Client" rows in the sidebar, with some of that
content becoming permanently invisible from the UI (though safely still on disk). Left the 3 duplicate
clients + marker doc in place on the bench as live repro state for whoever picks up the fix.

**QA-25** (Ask silently discarded on immediate client-switch): on Emily Chen Household's Ask tab,
typed "What is this client doing about their Roth conversion?" and clicked Ask, then — the way an
impatient real user would — immediately clicked away to Garcia Family Trust before it could possibly
have answered. Switched back to Emily's Ask tab right away, and again 8 seconds later: both times the
conversation area was completely blank — no "Answering…" indicator, no error, no history entry, just
the composer still holding the typed text as if never submitted. Evidence: `23-ask-tab.jpeg` (question
typed, about to submit) → `25-emily-ask-state-after-switch.jpeg` and `26-emily-ask-recheck.jpeg` (both
show an empty conversation after switching away and back). Separately and not fully explained: Garcia's
own Ask tab showed an already-completed exchange with similar leftover composer text
(`24-switched-to-garcia-midask.jpeg`) — too fast to plausibly be a fresh local-AI computation
(this VM's local Ask answers take 60–90s per QA-21), so most likely a pre-existing conversation from
earlier in the session rather than genuine cross-client bleed of my question; flagging honestly as
unconfirmed rather than asserting cross-contamination. The clear, reproduced part of this finding is
that Emily's own question vanished with zero trace.

**QA-26** (inconsistent New Document affordances): the empty-state "+ New Word document" button (seen
when a client has zero files, e.g. `06-after-newdoc.jpeg` on a fresh Klutz Test Client) opens a naming
dialog ("Enter file name (without extension)"). The toolbar's "New document" button, present once a
client already has any files, instead creates `my-document.docx` immediately with zero prompt
(`18-emily-docs-state.jpeg` shows the file already existing right after the click, with no dialog ever
having appeared). Minor, but a real inconsistency between two entry points to the same feature that a
distracted user could easily trip over.

### Confirmed FIXED — re-verified live

**QA-20 (silent no-mic recording failure) is fixed.** Checked "I have the consent I need" and
double-clicked "Start recording" with no microphone present (this VM class has none, by design) — the
dialog now shows a clear inline error, **"Recording couldn't start: no microphone device"**, in red
text right in the dialog, which stays open so the user can Cancel or read the message (previously the
dialog just silently closed with zero feedback). The double-click didn't cause a duplicate error or
any glitch. Also checked disk afterward: **no orphan `Meetings/` folder was created this time**
(previously QA-20 also noted an empty leftover folder) — that part of the gap looks fixed too.
Evidence: `14-consent-dialog.jpeg` (before) → `16-after-start-recording-nomic.jpeg` (inline error) →
`17-after-cancel.jpeg` (clean Cancel back to empty state).

**Testing limitation, honestly flagged:** bench-1 has no virtual audio device (VB-CABLE lives only on
bench-2 per the campaign doc), so I could not get the app into an actual in-progress recording state —
meaning the brief's "sleep/resume mid-recording" and "start recording then switch clients" scenarios
could not be tested on this seat. A future klutz pass on bench-2 would be needed to cover those
specifically.

### What's GOOD (so a designer can feel the klutz-proofing, not just the bugs)

- **Rapid multi-click is safe almost everywhere except client creation.** Triple-clicking the
  onboarding tour's "Next" button advanced exactly 3 steps (1→4), no double-fire, no skipped/garbled
  state. Double-clicking "New client" to open the dialog only ever opened one dialog, never two
  stacked. Double-clicking "Start recording" during the no-mic failure didn't duplicate the error or
  glitch. The one place multi-click genuinely breaks something is the Create-client submit button
  itself (QA-24).
- **Escape and Cancel are reliable everywhere tried.** Escape correctly closed the onboarding tour,
  the New Client dialog (mid-typing, before any client was created — confirmed zero client and zero
  folder got created), and the recording consent dialog's Cancel button all left the app in a clean,
  unconfused state with no orphaned partial data, no stuck spinners, no leftover error banners.
- **Crash resilience held up again, even through a genuinely hard test.** Typed a full sentence into
  a document and force-killed `lantern.exe` within roughly a second — well inside the documented 2-
  second autosave window. After a full VM reboot and clean relaunch, the file itself was intact,
  opened correctly, and showed a clean "Saved" state (just the last, never-autosaved sentence was
  gone, which is the expected/correct behavior for a periodic-autosave design, not a bug) — no
  corruption, no crash dialog, no confusion.
- **The Ask composer responsive-layout fix (QA-6) still holds** at this session's window size, no
  0-width collapse.

### Plain-language summary (for Jameson)

I spent this session pretending to be a well-meaning but clumsy user: double- and triple-clicking
buttons, hitting Escape and Cancel on almost everything, killing the app at the worst possible moments,
and switching between clients mid-task.

**The biggest thing I found:** if you click "Create client" more than once in a row (the way anyone
does when they're not sure the first click registered), the app creates **multiple separate clients
with the same name that all secretly share one folder on disk.** Files you put into one of those
duplicate clients can end up **invisible in that same client's own file list** — the file is safely on
your hard drive, but the app itself can't find it anymore. Since this app's whole promise is "each
client's data stays cleanly separated," a simple double-click turning into three tangled, partly-broken
copies of the same client is a real problem, not just a cosmetic glitch.

**Second thing:** if you ask the AI a question and then get pulled away to a different client before it
answers (totally normal — a coworker interrupts you, a notification pops up), your question just
**disappears with no trace** — no error, no "still working on it," nothing. You'd have no way to know
if you need to ask again.

**Good news on an earlier bug:** the "starting a recording with no working microphone fails completely
silently" problem from an earlier testing round is now genuinely fixed — it shows a clear, honest error
message instead of just quietly giving up.

**What held up well:** I really tried to break things with rapid double- and triple-clicking, and
almost everywhere else it was rock solid — the onboarding tour, opening dialogs, hitting Cancel or the
Escape key, even killing the app while it was mid-save. The only real casualty of my clumsiness was the
"Create client" button.
