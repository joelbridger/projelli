# QA Campaign — Bug DB (coordinator owns status; explorers append findings)

| ID | Sev | Finding | Source | Status |
|----|-----|---------|--------|--------|
| QA-1 | P1 | Queued CRM write proposals are NOT persisted — app restart silently discards them (crmWriteQueueStore.ts) | codex code investigation off the bench's card-lifecycle repro | FIX LANE: lp/crm-card-visibility |
| QA-2 | P2 | The CRM review card renders only on the Client Map overview sub-tab — invisible from Documents/Email/Activity | same | FIX LANE: lp/crm-card-visibility |
| QA-3 | P3 | Toolbar confirmation copy misleads + auto-clears in 2.5s ("Added to the review card on this client's map") | same | FIX LANE: lp/crm-card-visibility |
| QA-4 | P2(harness) | wave2 bench check can PASS on the toolbar confirmation without proving the real review card | same | FIX LANE: lp/crm-card-visibility (item 4) |
| QA-5 | P1 | New clients created via "+ New client" have **zero folders linked by default** — new documents / imported files land in generic locations never scoped to the client, so the client's own Documents view falsely shows "No documents yet" even though the files are safely on disk. Breaks the client-isolation promise on a first-time user's very first action. | lane qa1, persona A first-run (Azure bench-1) | NEW |
| QA-6 | P1 | The Ask question input (`ask-composer-input`) collapses to 0px width and is non-interactable at the app's default-ish window size (~1028×749); confirmed working at 1424px. The whole 3-column Ask layout clips instead of stacking at 600px. Core "Ask" feature effectively unusable at a normal laptop window size. | lane qa1 | NEW |
| QA-7 | P1 (environment-dependent, needs re-verify) | Asking a question with local AI hangs on "Answering…" indefinitely (30s+, no error/timeout/messaging). Likely tied to a stalled local-model download on this specific Azure VM (app self-reported "The download looks stuck"), but the silent-forever-spinner UX gap is real regardless of root cause. | lane qa1 | NEW |
| QA-8 | P2 | First-run onboarding splash: decorative icon graphics overlap and obscure card text ("builds Client Maps", "Ask anything, with sources" both illegible). Reproduced on 4 separate screenshots incl. a genuine cold first-run. | lane qa1 | NEW |
| QA-9 | P2 | Model-download progress banner overlaps the onboarding step header text ("2. Securely connect your data", "3. Setting up your firm" both garbled behind it) throughout the whole onboarding flow (9%/49%/93% progress all reproduce it). Does not occur once inside the main app. | lane qa1 | NEW |
| QA-10 | P1 (tentative, needs human-eyes confirm) | Onboarding splash's primary "Go!" CTA renders with opacity:1 in the DOM but is invisible in every screenshot (a transparent footer div sits on top per elementFromPoint); still clickable via test-id. Could be a real stacking bug or a CDP/WebView2 screenshot-capture quirk — flagging honestly, not confirmed either way. | lane qa1 | NEW |
| QA-11 | P3 | "Isolated client: outside connections are blocked..." status pill is visually truncated with no verified tooltip (full text present in DOM). | lane qa1 | NEW |
| QA-12 | P3 (possibly intentional) | 11-step product tour restarts from Step 1 on every fresh launch even after being skipped mid-tour previously. May be by design — flagging for a product call. | lane qa1 | NEW |
| QA-13 | P2 (browser-build-specific) | Client Map's "This client's memory needs to rebuild… try again in a moment" message is **permanent on the browser build**, not transient — source confirms the classifier explicitly buckets "no Tauri backend" (i.e. no RAG engine exists in-browser) into this same retry-suggesting message. Every client shows this forever; "try again" / "reopen this client" can never fix it here. Message should say the feature needs the desktop app instead of implying a retry will help. | lane qa3, persona D (browser dev build) | NEW |
| QA-14 | P1 | **Language switch (Settings → Deutsch/Español) does not translate the core app.** Setting persists correctly (`lantern:settings.language` survives reload) and the Settings panel itself IS fully translated, but the primary left nav ("Client Map"/"Ask"/"Workflows"), the per-client hub's own tabs, and row action buttons ("Ask") all stay hardcoded English. Root-caused to literal string labels (not `t()` calls) in `src/app/shell/layout/Spine.tsx:73-75`, `src/features/matters/MatterHub.tsx:87-89`, and `src/features/matters/MattersHome.tsx:272` — not a missing-translation-file problem (de.json has 1524 keys, more than en.json's 1058). Some other strings (e.g. the "Report a bug" aria-label) DO translate correctly, so this is a specific-components gap, not total breakage. Directly undercuts the "de/es ship" claim for the surfaces advisors actually live in daily. | lane qa3, persona D (browser dev build) | NEW |
| QA-15 | P1 (silent data loss) | **Two browser tabs open on the same workspace can silently destroy each other's data.** Deterministically reproduced: create a client in Tab B, then (without Tab B ever seeing Tab A's or vice versa — no cross-tab reactivity) create a different client in Tab A; reload Tab B and its own new client is simply gone from `localStorage`, silently overwritten by Tab A's last-write-wins full-state save. No error, no conflict warning, no merge. Mechanism is the browser build's `zustand/persist`-to-`localStorage` pattern with no `storage`-event/BroadcastChannel sync and no optimistic-concurrency check — flagging for a desktop re-check of the analogous two-windows-same-workspace scenario, since the failure mechanism is browser-specific but the general risk shape (two writers, last-write-wins) may not be. | lane qa3, persona D (browser dev build) | NEW |
| QA-16 | P3 (informational, held up well) | Client/file names containing `<img onerror>`/`<script>` HTML-injection payloads never execute anywhere in the UI (breadcrumb, sidebar, table, tab title, Ask composer) — confirmed via a `window.__xss` sentinel that stayed `false` through every surface. React's default escaping holds. Separately, the actual on-disk folder created for such a client has angle brackets stripped (`img src=x onerror=alert(1) Test script...`) while the UI continues to show the raw literal name — a minor, expected disk/display name mismatch for unsafe characters, not a bug. | lane qa3, persona D (browser dev build) | NEW |
| QA-17 | P3 (unexplored past 500, needs desktop recheck for OS-level names) | 500-client workspace: bulk-creating 500 clients directly via the store took 173ms; the Client Map table and sidebar render all ~500 rows into the DOM with no virtualization, but a live search-filter keystroke still resolved in 18ms and navigation felt immediate — no felt perf problem at this scale, though not tested materially larger. Separately, zero-byte files, a 500MB (allocated) file, reserved Windows device names (`CON`, `PRN`), trailing-dot/trailing-space names, emoji, CJK/accented unicode, and a 255-char filename all rendered correctly with no crash or layout break — but this used the permissive in-memory test-mode mock FS, so Windows reserved-name rejection specifically needs a real desktop/OS recheck (a real filesystem would enforce it; the mock cannot). | lane qa3, persona D (browser dev build) | NEW |
| QA-18 | P3 (informational) | The web build has zero URL/history integration — one static URL for the whole app, no `pushState`/hash routing, no `popstate` listener (grep-confirmed absent). Browser Back/Forward do nothing useful inside the app (can't step back through a tab switch), and if the browser tab has any prior page in its history, Back exits the entire app instantly with no warning. No deep-linking or bookmarking to a specific client/tab is possible. Likely a deliberate scope choice for now, flagging for product awareness. | lane qa3, persona D (browser dev build) | NEW |

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
