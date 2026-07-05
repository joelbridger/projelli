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
| QA-30 | P1 (trust-breaking) | **Recorded meetings vanish from the Meetings tab after an app restart** — files fully intact on disk (verified by direct filesystem check on the Legion), but the tab shows "No meetings yet" for ALL meetings incl. pre-existing ones. Looks exactly like data loss to an advisor. Found during the live Legion walkthrough (real Teams call recorded; consent + zero-egress PASSED). Evidence: docs/evidence/meetings-verify-20260704/ on lp/windows-smoke-evidence. (IDs QA-24..29 reserved for lane qa4.) | lane meetverify (Legion, real hardware) | VERIFIED FIXED @cb1181c9 (live Legion re-verify: survives clean restart AND hard kill) |
| QA-31 | P1 | **Meeting AI notes never finish** — after transcription completes (which now works end-to-end), the meeting sits at "Notes are being written…" forever. Reproduced on BOTH real Teams and real Zoom calls on the Legion; a direct provider call with the same Anthropic key succeeded, ruling out setup. Transcript itself is fine and usable. Evidence: docs/evidence/meetings-verify2-20260704/ (14-BUG-zoom-notes-also-stuck.jpeg + RUN-LOG). | lane meetverify2 (Legion, real hardware) | FIXED @b3e2efc8 (120s watchdog + honest classified errors + retry; pending scoped Legion re-check) |
| QA-40 | P1 (blocks Meetings DONE) | **Transcript generation hangs on real recordings post-rebuild (Legion)** — mic channel completes, sys channel never starts; reproduced 2/2 on fresh short recordings; app restart does not resume. Strong suspect: contract mismatch — the voicefix merge @aa0ab3eb switched the app to real whisper.cpp CLI (temp-file, -f/-m), but the Legion still has the morning's translator SHIM staged (expects the OLD --stdin contract → blocks reading stdin forever). May ALSO reveal a product gap if an engine subprocess can hang without tripping a timeout. (IDs QA-32..39 reserved for lane qa5.) | lane meetverify3 (Legion) | FIXED @b9dc02ca (swallowed-error hole + Windows temp-WAV handle; 3 real recordings live-proven) |
| QA-32 | P1 (real severity uncertain — see notes) | **The native folder-picker dialog (Tauri's `plugin:dialog|open`, which backs "Open Existing", "New Workspace", "Add files", and onboarding's "Connect my own data"/"Start with a sample practice") never opens and never resolves.** Confirmed at the raw IPC level: calling `window.__TAURI_INTERNALS__.invoke('plugin:dialog|open', ...)` directly neither resolves nor rejects, ever (30+ min observed) — no native picker window appears at all (confirmed via repeated top-level-window enumeration over several seconds after the click, zero dialog window found). Ruled out "native dialogs are broken on this VM in general": a plain .NET `System.Windows.Forms.FolderBrowserDialog` opened immediately in the same interactive session. Reproduced identically on a completely fresh app relaunch (rules out my own session/state corruption). Confirmed independent of QA-33 below: restarting the stopped `VaultSvc` (which fixed QA-33) did NOT fix this. **This blocks every UI path to opening or creating a workspace** — a brand-new user cannot get past the welcome screen at all without a workspace already pre-seeded some other way. | lane qa5, persona D (bench-2) | FIXED @b9e3dda3 (dialog watchdog + manual-path fallback; VM trigger documented) |
| QA-33 | P1 | **Windows Credential Manager service (`VaultSvc`) was found STOPPED on this fresh VM, and its absence silently breaks opening any existing/recent workspace.** With `VaultSvc` stopped, every API-key keychain read (Anthropic/OpenAI/Google) times out at 10s each (`[useApiKeys] could not read the anthropic key from the keychain: TimeoutError... timed out after 10s`); this cascades into the "open recent workspace" code path (`handleOpenRecentProject`) hitting its own 30-second overall timeout and failing (`TimeoutError: Opening the workspace timed out after 30s`) — **with zero user-visible error**: the buttons just silently re-enable after 30 seconds, no toast, no banner, no message of any kind, leaving the user to guess what happened. Manually starting `VaultSvc` fixed workspace-opening immediately and reliably on a fresh app relaunch. Whether a stopped `VaultSvc` reflects a real-world Windows state (disabled by IT/group policy, a first-boot race, antivirus interference) or is specific to this VM's history (it had VB-CABLE installed in an earlier session per `coordination/azure-bench/VIRTUAL-AUDIO-SPIKE.md`) is unconfirmed — but regardless of root cause, a completely silent 30-second failure with no error surfaced anywhere (not even the dev console before this) is a real product gap. | lane qa5, persona D (bench-2) | FIXED @b9e3dda3 (fast classified error incl vault_status path + degraded open) |
| QA-34 | P0/P1 (silent data loss) | **Once a document's autosave write fails one time (e.g. another process briefly holds an exclusive OS-level lock on the file, simulating antivirus/backup-software scanning), the app permanently stops persisting that document for the rest of the session — while continuing to display "Saved" the entire time, including after the lock is released and the user keeps typing new content.** Repro: opened a real `.docx`, held an exclusive lock (`FileShare.None`) on its file from another process, typed a sentence into the open document — toolbar showed "Saved," but the on-disk file's timestamp/size never changed (confirmed via direct filesystem check). Released the lock ~90s later, typed MORE new content — still showed "Saved," still zero write to disk, and the console showed **no error whatsoever**, not even a caught-and-logged one. Restarted the app: the document opened **completely empty** — every sentence typed across the whole test was gone forever, no crash-recovery/backup snapshot rescued it. This is the exact "the app said Saved, then I lost everything" failure the product's whole design (autosave, tracked-changes, `.backup-*.docx` snapshots noted by earlier lanes) is supposed to prevent. | lane qa5, persona D (bench-2) | FIXED @9e87a8c2 (docx saves join save-integrity guards; truthful state + retry + rescue) |
| QA-35 | P1/P2 (causation not fully isolated — see notes) | With disk space driven down to true zero free bytes during an active meeting recording, the recording kept showing a live-incrementing "Recording… M:SS" timer with no error for as long as observed (3+ minutes), and clicking "Stop" did not visibly stop the recording for at least ~10 seconds of repeated attempts (both via the UI and a direct element click) — it only succeeded once external disk space was freed up. **Flagging honestly, not fully isolated as disk-specific**: a control test finalizing a Stop on healthy disk also took ~13 seconds, so some of the apparent "stuck" behavior may just be normal (if slow) finalization latency rather than a true disk-full deadlock — I did not have time to test patience-only recovery at true zero-free without also freeing space. What IS confirmed either way: zero user-facing indication that disk space (or anything) is the problem while this is happening — a real advisor would just see a stuck recording button. | lane qa5, persona D (bench-2) | NEW |
| QA-36 | P2 | The app allows creating a document literally named after a Windows-reserved device name (e.g. `CON.docx`) via the "New Word Document" naming dialog — no client-side validation blocks it, and the file **is actually created for real** on the NTFS filesystem (the app evidently uses extended-length `\\?\`-style paths internally, which bypass Windows' normal device-name reservation). The app itself reads/displays/edits this file fine. But standard Windows tools that don't use extended-length paths cannot: `Get-ChildItem`/`cmd dir` lists it, yet PowerShell's `Rename-Item` and `Remove-Item` **both fail** ("cannot rename/remove because item does not exist") against that exact same file. A real advisor who created such a file (a client literally named "CON," a typo, a copy-pasted company name) would be unable to rename or delete it from File Explorer, and it would likely also break for backup tools, antivirus scanners, cloud-sync clients, or opening it directly in Microsoft Word outside the app. | lane qa5, persona D (bench-2) | FIXED @9e87a8c2 (reserved names rejected at create, both layers) |
| QA-41 | P1 (blocks Meetings DONE) | **Meeting notes never generate — CONFIRMED on a fully clean session** (rules out session-state noise): stuck on "Notes are being written" forever, no error, no retry, survives navigation + app restart. Network inspection: ZERO requests ever reach the AI provider. Code-traced lead: tryGenerateNotes() (meetingStore.ts) silently swallows a failed transcript.json READ and treats it as "still queued" — the QA-31 watchdog only guards the AI-call step, never this earlier read, so the honest-failure net never engages. Transcript itself is perfect (word-for-word) and persists. Evidence: docs/evidence/meetings-verify4-20260704/ (19 shots) @674846ae. | lane meetverify4 (Legion, fresh session) | VERIFIED FIXED @e4b0f30d (clean end-to-end run: record→transcript 2s→notes 15s→restart-safe) |
| QA-42 | P3 (test-infra) | CrmWriteReviewCard.test.tsx has a pre-existing race between a resolved mock and the resulting DOM update (unrelated to the chunk-load flake) — occasionally fails under stress. Flagged by flakefix; predates that branch. Batch into a future test-infra cleanup. | lane flakefix (side note) | NEW |
| QA-43 | P0/P1 (silent data loss, REGRESSION) | **QA-34 save fix handles the FIRST file-lock/recovery cycle correctly but a SECOND lock cycle on the same document silently loses data again** — after one honest-warn+recover cycle, further typed content stops persisting with the UI showing a calm "Saved • Xm ago", restart-verified permanent loss. The save-retry/dirty-state machine does not re-arm after a first recovery. Found by cloud bench-1 parallel regression (cloudreg @3d545f43, evidence docs/evidence/cloudreg-20260704/). | lane cloudreg (Azure bench-1) | FIX LANE: lp/cleanup-batch4 (save-resilience owner) |
| QA-44 | P0 (privilege/isolation) | **RAG retag failures swallowed after client/privilege change** (useMemoryWiring.ts:1489/1524/1549): if a folder/email is re-assigned to a client or a source marked privileged and the retag call fails, the .catch(()=>{}) drops it — UI says the new rule is active but search still uses old tags → privileged content can stay available in normal Ask, or content stays attached to the WRONG client. Fix: durable retry + visible 'scope update failed' + FAIL CLOSED on privilege (exclude until retag succeeds). | Codex swallow-sweep (static) | FIX LANE: lp/swallow-p0 |
| QA-45 | P1 | **Shared client notes stuck on 'Loading' forever** (MatterNotesEditorWrapper.tsx:52): ensureMatterSync rejects (key fetch/sync/crypto fail), .then has no .catch → loading stays true, permanent spinner instead of the locked/no-access panel. | Codex swallow-sweep (static) | CONFIRMED REAL + FIXED @5f0f01c9 (rejection now falls back to the fail-closed no-access panel; red-first test) |
| QA-46 | P1 | **Live co-edit sync never re-arms after socket drop** (MatterSyncClient.ts:288/338): on ws close / failed push it sets offline but no reconnect loop + unsent Yjs updates not queued → teammates silently stop receiving changes until an outside restart. | Codex swallow-sweep (static) | CONFIRMED REAL + FIXED @5f0f01c9 (reconnect-with-backoff 1s→30s cap while started + unsent-update queue/flush; codex-review found + fixed 2 more gaps: stuck retry after a persistent push failure, duplicate/orphaned sockets on reconnect — both now covered by regression tests) |
| QA-47 | P1 | **Meeting notes exist but screen says 'notes pending' after DocxEditor chunk-load fail** (MeetingEntry.tsx:115/378): dynamic import fails → DocxEditorComp null → falls through to false 'pending'. Same class as the merged flake. Fix: track load error + retry. | Codex swallow-sweep (static) | CONFIRMED REAL + FIXED @5f0f01c9 (routed through LazyBoundary, same pattern as MainPanel's .docx tabs — real retry state instead of false pending; the earlier "merged flake" fix was test-infra-only and never touched this product code) |
| QA-48 | P1 | **Calendar failure treated as 'no meetings today' → auto-prep silently dies** (TodaysMeetingsStrip.tsx:98/147, useMeetingAutoprep.ts:97): calendarListEvents fails → events=[] → no Today strip, no prep briefs, no error. Fix: calendar error state + retry, don't equate fail with empty. | Codex swallow-sweep (static) | CONFIRMED REAL + FIXED @5f0f01c9 (visible calendarError state: retryable warning when no events, stale-data warning when prior matched meetings still shown; useAutoprepRescan reports failures via the same channel) |
| QA-49 | P2 | **'Refresh brief' silently no-ops on calendar failure** (BeforeYouMeetStrip.tsx:128): fetch fail → events=[] → no job queued, stale brief stays stale, no error. | Codex swallow-sweep (static) | ROUND 2 / swallow-batch |
| QA-50 | P2 | **Meeting folder read failures masquerade as 'pending'** (ClientMeetingsTab.tsx:114/117/194): a folder that can't be listed / meeting.json unreadable renders a row with missing data as 'pending' instead of 'couldn't read this meeting'; notice-ledger failure also clears notice states. | Codex swallow-sweep (static) | ROUND 2 / swallow-batch |
| QA-51 | P2 | **Fact-extraction failure marked as handled → never retries** (AIChatViewer.tsx:558): one failure advances the checkpoint so the same answer never re-extracts; auto-accept save failures also swallowed. Fix: separate error/retry-eligible from 'checked'. | Codex swallow-sweep (static) | ROUND 2 / swallow-batch |
| QA-52 | P0 (cross-workspace) | **Workspace A load can land the app on the WRONG workspace** (WorkspaceSelector.tsx:247/308/320-328): open A then quickly B; if A finishes last it still setRootPath/setFileTree/onWorkspaceSelected → wrong workspace active. Fix: openRequestId, drop stale. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-53 | P0 (cross-client) | **Email A filing/draft can update email B** (EmailViewer.tsx:241/261): file A to a client or 'Draft with AI', open B before async returns → setMessage(prev) marks B filed to A's client / A's draft in B's reply box. Fix: capture sourceId at start, re-check before setMessage/setReplyDraft. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-54 | P0 (cross-client BIOMETRIC) | **Voiceprints for client A can appear on client B** (VoiceprintsCard.tsx:17/21): voiceprintList(A) resolves after switching to B → setItems shows A's biometric profiles under B; stale confirm → delete with mismatched matterId. Fix: request token + clear items/confirming on matterId change + bind matterId into pending delete. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-55 | P0/P1 (cross-client) | **Ask shows old client's answer after switching during email-citation labeling** (useAsk.ts:1120/1191): abort checked before, but not re-checked after awaiting resolveEmailCitationLabels → addMessage/setTurns/setStatus write to the NEW client. Fix: abort re-check after label resolution. COORDINATE — useAsk is Tier B/C P1 territory; folded into Tier C P1 scope. | Codex race-sweep (static) | FIX LANE: Tier C P1 (useAsk overlap) |
| QA-56 | P1 | **Citation verify verdict paints onto the WRONG citation card** (SourcePanel.tsx:130): verify A, card rerenders for B before ragVerifyCitation returns → A's verdict becomes B's green/red. Fix: capture id/matterId, setVerdict only if same citation. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-57 | P1 | **Privilege explainer reports proof for the wrong current question/client** (PrivilegeExclusionExplainer.tsx:72): demo retrieval for query A, user changes question/scope, late result shows as new context. Fix: token per run / compare current query+scope before setDemo. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-58 | P1/P2 | **Memory facts settings show stale workspace facts** (MemoryFactsSettings.tsx:55): listFacts(A) returns after switching to B → setFacts shows A's memory in B's settings. Fix: workspace generation token, drop stale. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-59 | P2 | **Run-on-all contradiction analysis attaches to a later comparison** (RunOnAllButton.tsx:123/167): slow analysis from comparison 1 sets analysis during comparison 2. Fix: request id around setResults + setAnalysis. | Codex race-sweep (static) | FIX LANE: lp/race-p0 |
| QA-60 | P0 (boot-blocking) | **Two files in `src/features/meetings/` differ only by letter case** — `MeetingNoteOutboundGate.tsx` (component) and `meetingNoteOutboundGate.ts` (the gate function it wraps) — and on a real Windows box (bench-2, NTFS, default case-insensitive per `fsutil queryCaseSensitiveInfo`) Vite's dev-server module resolution collided on the two names and served the WRONG file's exports for the `.tsx` import in `MainPanel.tsx:22`, so `MeetingNoteOutboundGate` was `undefined` and the **entire React app failed to mount** (permanent blank white screen, zero console errors beyond the one module error). Live-verified: renaming the lowercase file to a genuinely distinct name (`meetingNoteOutboundGateCore.ts`) + fixing its one importer + clearing `node_modules/.vite` fixed the boot immediately. Fix: rename one of the two files to a non-case-colliding name in the real repo (the local rename on bench-2 was NOT committed — test-environment-only workaround). | hunt2 (bench-2), live-verified | NEW |
| QA-61 | P1/P2 | **An overlong (300+ char) client name silently and permanently breaks that client's ability to create any document.** Client creation itself succeeds and registers a `folderPaths` entry in `lantern:matters`, but the corresponding folder is never actually created on disk (confirmed with a `\\?\`-prefixed long-path-aware check). The client shows completely normal ("Your workspace is ready" / "No documents yet") in the UI. Clicking "New Word document" → name → OK silently no-ops — dialog closes, still "No documents yet," **zero user-visible error**. The real cause reaches the console but never the user: `TauriFSBackend.mkdir()` fails with Windows error 123 ("The filename, directory name, or volume label syntax is incorrect" — actually NTFS's per-path-component 255-char limit), then `useDocumentCreation.ts:105` swallows it into a console-only `FileOperationError`. Fix: (a) cap client-name length before it becomes a folder name, (b) surface `FileOperationError` from `useDocumentCreation.ts` to a visible toast. | hunt2 (bench-2), live-verified | NEW |
| QA-54 (re-check) | — | **Live-verification result for QA-54 above: attempted repro via every real UI navigation path (sidebar switch, racing matter-row clicks, zero-delay scripted clicks) — could NOT reproduce.** Traced to `MattersHome.tsx:732-734`, which renders `<MatterHub key={hubMatterId} .../>` — an explicit `key` keyed to the active client, which forces React to fully unmount+remount the whole hub (incl. `VoiceprintsCard`, the only place it's rendered anywhere in `src/`) on every client switch, by deliberate design (see the comment already at that call site). A stale `voiceprintList(A)` promise resolving late can only call `setState` on an already-discarded instance — a no-op, not a leak — so the exact race the static sweep flagged cannot occur via any current UI path. Backend storage (`voiceprint/store.rs`) is independently confirmed correctly per-`matter_id`-scoped too. Recommend downgrading QA-54's status to reflect this unless a different, non-`MattersHome` render path for `MatterHub`/`VoiceprintsCard` is found (none exists as of this tip). | hunt2 (bench-2), live-verified | (informational — coordinator to update QA-54's Status) |
| QA-60 (corroboration) | — | **Independently reproduced QA-60 (the `MeetingNoteOutboundGate.tsx`/`meetingNoteOutboundGate.ts` case-collision boot-crash) on a SECOND, separate machine (Azure `lantern-cloud-bench-1`, not bench-2) at the same tip (`371702eb`).** Same exact failure signature: blank white screen, zero DOM children under `#root`, one `pageerror` — `The requested module '/src/features/meetings/meetingNoteOutboundGate.ts' does not provide an export named 'MeetingNoteOutboundGate'`. Confirmed via `fsutil file queryCaseSensitiveInfo` that bench-1's `src/features/meetings/` directory is also plain case-insensitive NTFS (not a bench-2-specific quirk). This is NOT a one-off VM anomaly — it will hit **every** Windows and macOS user (both default to case-insensitive filesystems), 100% of the time, on this tip; only Linux CI/dev machines are blind to it. Applied the identical local-only workaround independently (renamed the lowercase file to `meetingNoteOutboundGateCore.ts`, fixed its one importer in `useMeetingNoteOutboundGate.ts`, force-restarted the whole `tauri:dev` process — a `location.reload()` alone was NOT enough, Vite's dev-server module-resolution cache kept re-resolving to the deleted path and threw a second error until the node/cargo processes were fully killed and relaunched). Not pushed anywhere; bench-only. **Recommends bumping this from "found once" to "confirmed systemic — blocks EVERY Windows/Mac install of this tip" when triaging fix priority.** | hunt1 (bench-1), live-verified independently | (informational — corroborates QA-60, no new ID) |
| QA-62 | P0 (cross-workspace isolation) | **The entire Client Map is a global, workspace-unscoped store — switching to a completely different (and empty) workspace still shows every client from the PREVIOUS workspace, with their real absolute folder paths.** Root cause: `useMatterStore`'s Zustand `persist` writes to a single fixed `localStorage` key (`lantern:matters`, `MATTERS_KEY = SK_MATTERS` in `src/platform/matter/matterStore.ts:461,1176`) with no per-workspace namespacing at all — unlike `workspace_tabs_<path>` / `workspace_expanded_<path>`, which correctly key off the open workspace's absolute path. No filter anywhere in the matters getters (`archived`-only filter at line 1508/1514) excludes matters whose `folderPaths` don't fall under the currently-open workspace root. **Live repro:** created a brand-new, empty second workspace folder (`QA Workspace B`, only a marker file) and switched to it via the app's own "Recent Projects" list (the same code path `WorkspaceSelector.tsx` / `openWorkspacePath` uses for QA-52) — console logs confirm `WorkspaceService`/`TauriFSBackend` correctly re-rooted to `.../QA Workspace B`, but the Client Map still rendered all 8 clients from the old `QA Workspace` ("8 clients, 8 folders indexed"), each still carrying `folderPaths` like `C:/Users/lpbench/Documents/QA Workspace/docs` (the OLD root). Clicking "New Word document" against the stale "Emily Chen Household" matter attempted `[DocCreate] docx destDir: C:/Users/lpbench/Documents/QA Workspace/docs` (the old, wrong root) and was correctly rejected by `PathValidator` (`PAGEERROR Absolute path outside workspace not allowed: ...`) — **no cross-workspace file content was actually written**, so this stops short of a full data-bleed, but (a) the failure is an UNCAUGHT client-side exception with zero user-visible feedback (same "swallowed failure" class as the QA-44..51 sweep — the user just sees the dialog do nothing) and (b) showing an entirely wrong client roster under a nominally different, isolated workspace is itself a serious trust/isolation defect for a product whose core pitch is per-workspace client confidentiality. **Open question, NOT yet tested (ran out of time this session):** whether `Ask`/RAG answers for one of these stale matters can pull real content from the OLD workspace's vector index — `CLAUDE.md` documents the semantic-RAG LanceDB store as living under a global `~/.keepance`, i.e. NOT obviously workspace-scoped either, which would bypass `PathValidator`'s filesystem-level protection entirely and could be a much worse leak than the blocked file-write. Attempted to test this directly (asked "What does the Roth Conversion Plan document say?" scoped to the stale Emily Chen Household matter) but the bench's local CPU-only LLM (`llama-server`) never finished inferring within the session's time budget — worth a dedicated, GPU-backed or cloud-AI-mode follow-up test. Fix direction: namespace the `lantern:matters` persist key (and its UI-snapshot/glance sibling keys) by the open workspace root, the same way tab/expanded state already is, and reset/reload the matter store on every workspace switch. | hunt1 (bench-1), live-verified | NEW |
| QA-63 | — (positive confirmation, not a bug) | **Live-verified the Tier B "outbound gate" for meeting notes (`meetingNoteOutboundGate.ts` / `MeetingNoteOutboundGate.tsx` / `DocxEditor.tsx`) works correctly and cannot be trivially bypassed.** No microphone on this cloud bench, so built a minimal on-disk fixture matching the real write shape (`<matterFolder>/Meetings/<id>/meeting.json` with no `reviewedAt` + a real `.docx`) for a fresh "Smoke Test Family" client, then opened `notes.docx` as a normal file tab. Confirmed live: both `docx-draft-follow-up` and `docx-send-to-wealthbox` render as genuinely `disabled` (Playwright itself refuses to click them — "element is not enabled" — not just a CSS/opacity fake) with the honest tooltip/inline text "Review this note first. It hasn't been checked yet." Clicking the Meetings-tab "Mark reviewed" action correctly persisted `reviewedAt` into `meeting.json` on disk. (Could not re-confirm the buttons flip to enabled afterward within this session — re-opening the same file tab via scripted click/dblclick stopped registering for an unrelated CDP/harness reason after the reviewed-state change, not an app bug; the positive-path logic itself was already read and is a simple, deterministic one-line check (`if (!input.reviewedAt) return 'needs-review'; return null;`) so high confidence it flips correctly.) No Wealthbox connector was configured in this workspace, so `Send to Wealthbox`'s `!wealthboxConnected` disablement couldn't be isolated from the review-gate's own `outboundBlocked` disablement in the same test — worth a follow-up with a connected Wealthbox sandbox to confirm the two disablement reasons are both correctly wired end-to-end. | hunt1 (bench-1), live-verified | NEW (positive finding) |
| QA-65 | P1 (Rust crash) | **Unicode byte-slice panic in retention cleanup** (capture/retention meeting_started_ms, `&name[..10]`): a finalized meeting folder with no transcript meta + a name whose byte 10 lands inside a multibyte char (e.g. an accented letter) panics → retention cleanup crashes, old audio/transcripts not removed. Fix: `name.get(..10)` instead of `&name[..10]`. | Codex panic-sweep (static Rust) | FIX LANE: lp/rust-harden |
| QA-66 | P1 (Rust poison cascade) | **Shared stores use Mutex::lock().unwrap() everywhere** (capture/engine.rs:328/354, calendar/store.rs:137, mail/store.rs:592, audit/store.rs:568, crm/store.rs:262): a panic while a lock is held POISONS it → every future .lock().unwrap() then panics → one crash breaks all those commands until app restart. StoppingGuard::drop() also unwraps → double-panic risk. Fix: an unpoison() helper (into_inner on poison) for shared-state locks, or clean Err on genuinely-corrupt state. | Codex panic-sweep (static Rust) | FIX LANE: lp/rust-harden |
| QA-67 | P2 (Rust) | **Diarization duration underflow** (diarize/mod.rs:396): bad sidecar output can underflow duration math (debug: panic; release: huge bogus duration). Fix: saturating_sub / validate. | Codex panic-sweep (static Rust) | FIX LANE: lp/rust-harden |
| QA-68 | P0? (UNTESTED — investigate URGENTLY) | **Possible RAG/Ask cross-workspace CONTENT leak** — hunt1 flagged but couldn't test (bench CPU model too slow): the semantic-RAG LanceDB store lives under a GLOBAL ~/.keepance (per CLAUDE.md), NOT obviously workspace-scoped. Combined with QA-62 (matter store shows old workspace's clients), an Ask scoped to a stale matter might pull REAL content from a DIFFERENT workspace's vector index — bypassing PathValidator's filesystem protection entirely. This would be a far worse leak than the blocked file-write. NEEDS a GPU/cloud-AI-mode bench test (ask a question scoped to a stale cross-workspace matter, see if it returns the other workspace's content). | hunt1 (flagged, untested) | INVESTIGATE (next hunt, cloud-AI mode) |
| QA-60 (hunt3 corroboration + FIX) | — | **Independently hit QA-60 (the `MeetingNoteOutboundGate.tsx`/`meetingNoteOutboundGate.ts` case-collision boot-crash) on a THIRD, separate machine — the Legion, real Windows hardware, not a cloud VM — at the same tip (`371702eb`).** Same exact failure: blank white screen, 87-byte `#root`, one `pageerror` naming the same wrong file. **Unlike the two prior sightings, this one is FIXED and pushed, not just a local workaround:** renamed the logic file to `meetingNoteOutboundGateRules.ts` (a name that can't case-collide with the component) and updated its two importers. `tsc --noEmit` clean; full `npm run test` green (6214 passed); pushed to `lp/meetingnotegate-case-fix` (commit `2c0bd2f7`, based on `371702eb`). **Live-verified on the Legion**: applied the fix, restarted the dev app, confirmed via CDP the body went from 87 bytes to 165KB and the full UI (persisted 26-client workspace) rendered correctly. ⚠️ **Coordinator note:** a separate fix brief (`w-qa60-brief.md`, commit `917a40f1`) dispatched a `cc-lantern-qa60` lane on `lp/qa60-case-fix` ~36 min *after* this fix was already pushed; that branch doesn't exist on origin yet, so nothing has actually collided, but pick ONE fix (this one already satisfies that brief's own "needs a Windows boot re-verify" requirement) rather than merging both. Full narrative: `docs/evidence/hunt3-20260705/RUN-LOG.md`. | hunt3 (Legion, real hardware), live-verified + FIXED | FIX PUSHED: lp/meetingnotegate-case-fix @2c0bd2f7 — needs coordinator pick vs lp/qa60-case-fix |
| QA-69 | P1 (Windows power-management leak) | **The app never releases its sleep-prevention lock after a recording finishes.** `powercfg /requests` on the Legion showed `lantern.exe` holding both a `SYSTEM` and an `AWAYMODE` request while recording (expected — prevents lid-close/idle-sleep from corrupting an active capture, confirmed by design: `AWAYMODE` is the specific Windows API for exactly this). But 15+ seconds after Stop, with transcript+notes fully generated and the app fully idle, `powercfg /requests` STILL shows both requests held by `lantern.exe`, unchanged. Real impact: once an advisor records one meeting, their laptop can never auto-sleep again for the rest of that app session — a real battery-life regression. Code review of `CpalSource::stop()` (`src-tauri/src/commands/capture/sources.rs`) shows the app's own Rust correctly signals-and-joins the capture thread (which does `drop(stream)`) before returning, so the app-level lifecycle looks correct; the leak is very likely in the `cpal` crate's WASAPI backend not clearing `SetThreadExecutionState` on stream `Drop` (that Win32 API is process-wide and needs an explicit `SetThreadExecutionState(ES_CONTINUOUS)` call to clear, not just dropping the object that set it). Fix direction: after `AudioSource::stop()` succeeds, explicitly call `SetThreadExecutionState(ES_CONTINUOUS)` on Windows (via the already-a-dependency `windows-sys` crate, needs its `Win32_System_Power` feature added) to counteract whatever cpal left set. | hunt3 (Legion, real hardware), live-verified via powercfg /requests | NEW |
| QA-70 | P1 (blocks Meetings DONE — same class as QA-40/41) | **Killing the app mid-transcription leaves the meeting permanently stuck in "Transcription is queued" forever, with no automatic retry and no user-facing error.** Recorded ~25s for a fresh client, clicked Stop, then `Stop-Process -Force`'d `lantern.exe` before transcription finished (confirmed via `.transcribe-progress.json`: only the mic channel's first chunk done, sys channel never started). Restarted the app cleanly — audio.wav/meeting.json/consent-ledger all survived intact (no data loss), but 35+ seconds later, and again after navigating away and back into the meeting, the progress file is byte-for-byte unchanged — no retry was ever attempted. **Root cause:** the existing QA-40 "Retry" button (`retryMeetingTranscript` in `meetingStore.ts`) only renders once `transcriptError` is set on `meeting.json`, and that field is only ever written from a `catch` block around the transcription call — which never runs if the whole process dies mid-flight (confirmed: no `transcriptError` field exists on this meeting's `meeting.json` after the kill). There is no app-startup reconciliation pass that scans for meetings with audio but no transcript/error and resumes or offers to retry them, even though the Rust side already supports resuming from `.transcribe-progress.json` (that's what the QA-40 fix's manual Retry uses) — the JS side just never calls it again after an ungraceful process death. Fix direction: on workspace load, scan each client's Meetings folders for an `audio.wav` with neither a `transcript.json` nor a `transcriptError`, and either auto-resume transcription or synthesize enough state for the existing Retry UI to appear. | hunt3 (Legion, real hardware), live-verified (stuck meeting left in place as evidence) | NEW |
| QA-71 | P1/P2 (compounds QA-70) | **"Delete audio · keep transcript" has misleading, dangerous copy when no transcript exists yet.** The button's confirmation dialog reads *"The audio file is deleted from this computer. The transcript and notes stay."* — but for a meeting stuck at "queued forever" (QA-70) there is no transcript and no notes at all. Clicking it would silently and permanently destroy the ONLY copy of that meeting's content, with the dialog actively implying something will be preserved that won't be. Verified by opening the confirmation dialog on the QA-70 stuck meeting and reading its exact copy, then clicking Cancel (not Delete) to avoid actually destroying the evidence. Fix direction: gate this button's copy (or its enablement) on whether a transcript actually exists yet; if not, warn that deleting the audio now means losing everything. | hunt3 (Legion, real hardware), live-verified (dialog opened, NOT executed — evidence preserved) | NEW |
| QA-72 | — (positive confirmation, not a bug) | **Live-verified meetings have NO cross-client bleed, including the async-race-prone "switch clients right after Stop" window (the meetings-specific analog of the QA-52/53 stale-async class).** Recorded a real ~15s meeting for client A (Foster, Ronald & Linda) via real TTS through the Legion's speakers/mic, clicked Stop, then IMMEDIATELY (before A's transcript/notes had finished generating) switched to a different client B (Jennings, Carol) and recorded a second real meeting there with distinctly different content. Checked both clients' full transcript+notes content (not just the list): A's meeting contains only A's content (including a numeral marker "123" easy to miss on a naive text search), B's contains only B's content (a different marker, "456") — zero contamination in either direction, in-flight processing included. Bonus/incidental: the cloud AI provider correctly refused to draft a note for the synthetic TTS recording, explicitly identifying it as test content rather than a real client conversation — a real (if unplanned) safety behavior, not a bug. | hunt3 (Legion, real hardware), live-verified | NEW (positive finding) |

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

---

## Lane qa5 detail — persona D, "the edge-case hunter, desktop round" (Azure bench-2, VB-CABLE, 2026-07-04)

**Seat/setup:** `lantern-cloud-bench-2` (the VB-CABLE virtual-audio clone). Repo pulled to
`origin/lantern-plus` tip (started at `521a29ed`, tip moved to `eae6d622` and beyond mid-session as
other lanes merged — rebased clean at write-up time). ~54 changed `src-tauri` files vs. the VM's old
pin meant a genuine ~10-minute cold-ish rebuild, not a quick relink. Driven live over CDP
(`scripts/desktop-drive.mjs`, tunnel on local port 9455 — 9444/9448/9451 were noted as taken) plus
direct raw-IPC `eval` calls (`window.__TAURI_INTERNALS__.invoke(...)`) and a small ad hoc
UI-Automation PowerShell helper (run via an interactive `AtLogOn`-style scheduled task, same pattern
as the `LanternDevBench` task) for native-window enumeration where CDP can't see native Win32 dialogs.
Evidence: `coordination/qa-campaign/evidence/qa5-20260704/` (52 screenshots, numbered chronologically).

**Big landmine hit early, worth flagging for future sessions on this exact VM:** after a fresh
`az vm start`, Tailscale came back up but showed **"Logged out"** — the VM's Tailscale needs
`tailscale up --authkey=... --reset` re-run after every reboot (matches the known quirk documented in
`SETUP-LOG.md`), which cost real time before I found it via `az vm run-command invoke` (works even
when the Tailscale-dependent SSH path is down, since it runs through the Azure VM agent instead).

### Repro detail + evidence per finding

**QA-32** (native folder-dialog hang, blocks ALL workspace creation): first hit trying "Connect my
own data" during onboarding — the button went into a permanent "Opening…" spinner state with the
whole onboarding screen disabled, forever. Root-caused down to the raw Tauri IPC layer, bypassing all
app JS: `window.__TAURI_INTERNALS__.invoke('plugin:dialog|open', {options:{directory:true,...}})`
called directly neither resolves nor rejects, checked over 30+ seconds. Confirmed this isn't "native
dialogs are broken on this VM" in general: a plain `System.Windows.Forms.FolderBrowserDialog` (older
legacy Windows dialog API) opened immediately and correctly in the same interactive session
(evidence: window enumeration showing a real `Browse For Folder` / class `#32770` window). Confirmed
this isn't state corruption from my own repeated testing: killed and cleanly relaunched the whole app
(`Stop-Process` + scheduled-task restart, no code change), retried "Connect my own data" fresh — same
hang, same zero-native-window result across 5 separate window-enumeration checks spanning ~9 seconds.
Also confirmed the plain Workspace Selector's "Open Existing" button (a different, older, non-onboarding
code path) hits the exact same raw dialog-invoke hang. Also confirmed independence from QA-33: retried
the same raw invoke AFTER starting the stopped `VaultSvc` (which fixed QA-33) — still hangs identically,
so these are two separate bugs, not one root cause. **I could not get past this at all through the UI**;
the only way I found a workspace to test the rest of my mission was to manually seed
`localStorage['lantern_recent_workspaces']` with a real on-disk folder path (the same shape the app's
own `addRecentWorkspace` would have written) and use the resulting "Recent" list entry instead — a
workaround for my own testing, not something a real user could discover. Evidence:
`00`–`04` (onboarding "Opening…" stuck) through the direct-IPC test screenshots; window-enumeration
output captured in-session (not screenshots, raw PowerShell output).

**QA-33** (VaultSvc stopped → silent 30s workspace-open failure): found while investigating why my
localStorage-seeded "Recent" workspace entry ALSO wouldn't open — it sat in the same "busy/disabled"
state for 30+ seconds before silently giving up with buttons just re-enabling, no error shown anywhere
in the UI. Captured the real browser console via a Playwright CDP listener attached before the click
(not via the CLI driver, which doesn't surface console output): showed
`[useApiKeys] could not read the anthropic key from the keychain: TimeoutError: Reading the anthropic
key timed out after 10s` (×2 more for openai/google) followed 25s later by
`[App] Failed to open recent project: TimeoutError: Opening the workspace timed out after 30s`.
Checked the OS service directly: `Get-Service VaultSvc` (Windows' Credential Manager service) showed
**Stopped**. `Start-Service VaultSvc` fixed it — a clean app restart afterward opened the same recent
workspace correctly and landed in the real Client Map. Evidence: `05`–`14` (stuck busy state across
multiple wait/retry cycles) → `console-capture3.log` (the actual error chain, quoted above) →
`12`–`14` (successful open post-fix).

**QA-34** (antivirus-style file lock → permanent silent data loss): opened a real `.docx`
(`my-document.docx`) in the editor. From a second OS process, opened the same file with
`FileShare.None` (an exclusive lock, the same access pattern many antivirus/backup scanners take
briefly). Typed a sentence into the open document in the app — toolbar showed "Saved" — but
`Get-Item` on the real file showed its `LastWriteTime`/`Length` completely unchanged from before the
edit. Captured the live browser console for this whole window (attached before typing): **zero console
output, not even an error** — the write failure isn't just hidden from the user, it isn't logged
anywhere a developer would see it either. Released the lock (~90s later), typed MORE new content —
still showed "Saved," disk file still completely unchanged. Force-killed and relaunched the app,
reopened the same document: it was **completely empty**, as if none of the session's typing had ever
happened. No `.backup-*.docx` snapshot or any other recovery path saved it. Evidence: `45` (doc open,
clean) → `46` (typed, shows "Saved," lock held) → `47` (typed more post-unlock, still "Saved," disk
still stale — `Get-Item` output confirms) → `48`–`50` (post-restart: document empty).

**QA-35** (disk-full during recording, Stop unresponsive): filled the VM's disk down via `fsutil file
createnew` to leave first ~300MB, then ~95MB, then true zero free bytes (`(Get-PSDrive C).Free` == 0),
while an active meeting recording (VB-CABLE virtual mic) was running. The recording's timer kept
counting past 3 minutes with the disk fully exhausted and no error/toast ever appeared. Clicking
"Stop" (both via the CLI driver's click and a direct `element.click()` eval) did not stop the
recording across ~10 seconds and two separate attempts. Freed disk space back to ~90MB — the very next
"Stop" attempt succeeded within ~3 seconds, and a "Meeting … notes pending" entry appeared with a real
audio file on disk. Honestly flagged as not fully isolated: a separate control test finalizing a Stop
on a healthy disk also took ~13 seconds end-to-end, so I can't rule out that "more patience" alone
(without freeing space) would have eventually worked too — I did not test that specific combination
due to time. Evidence: `32`–`38` (consent → recording starts → disk driven to zero → still
"Recording…" at true-zero → Stop appears to do nothing → space freed → Stop succeeds, meeting
appears).

**QA-36** (reserved Windows device name creatable, then "cursed" outside the app): created
"CON.docx" via the New Word Document dialog inside a real client folder — no validation blocked it,
editor opened normally, toolbar showed "Saved." Confirmed on disk via `cmd /c dir /b`: `CON.docx` is
listed as a real file. Then, from the same folder over a plain (non-extended-path) session:
`Rename-Item 'CON.docx' 'CON-renamed.docx'` → **"Cannot rename because item at 'CON.docx' does not
exist"**; `Remove-Item 'CON.docx'` → **"Cannot find path ... because it does not exist"** — both against
a file `dir` shows sitting right there. This is the classic Windows reserved-device-name behavior
(`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9` are intercepted by the Win32 API unless a path uses the
`\\?\` extended-length prefix), meaning the app's own extended-path-aware file I/O can create/open it
fine, but the moment a real advisor's other tools (Explorer, antivirus, backup/sync software, or Word
itself opened directly) touch that same file using ordinary paths, it becomes untouchable. Evidence:
`23`–`24` (naming dialog previews `CON.docx`, no warning; file created, editor opens normally) plus
the PowerShell rename/remove-failure transcripts (not screenshots — terminal output).

### What's GOOD (so a designer can feel the resilience, not just the bugs)

- **Deep, unusually-nested file paths are handled correctly** once they exist. Windows' own default
  tooling (`New-Item`/`Set-Content` without long-path opt-in) silently stopped extending a chain of
  identically-named nested folders at ~227 characters (an OS/PowerShell fact, not an app bug) — but a
  real file placed at that natural ~241-character depth showed up correctly in the app's Tree view,
  with every intermediate folder expanded properly, and opened with its real content intact.
- **Clock skew (system clock jumped forward exactly 1 day) caused zero corruption.** A meeting recorded
  entirely under the skewed clock got a correctly-dated, correctly-sorted entry ("Jul 5, 2026," sorted
  above the pre-skew "Jul 4" meeting) — no crash, no date-math weirdness, no consent-ledger oddity
  observed.
- **Single-instance handling still holds on the real compiled desktop exe**, re-verified past qa1's
  original dev-harness-only observation: launching a second real `lantern.exe` process alongside a
  running one resulted in exactly one window the whole time, and the second process exited cleanly on
  its own within a couple seconds — no crash, no duplicate window, no confusing state.
- **The app survived every deliberate abuse thrown at it structurally** — repeated forced app kills
  mid-test, a fully-exhausted disk, a locked file, a day-skewed clock — without a single crash or wedge
  of the whole application; only specific, narrow features (recording-stop responsiveness, one
  document's autosave) degraded, never the app as a whole.

### Not tested this session (honest, time-boxed out)

- **DPI scaling change mid-session**: attempted (registry `LogPixels` 96→144 +
  `UpdatePerUserSystemParameters` broadcast), but this VM's virtual "Basic Display Adapter" doesn't
  propagate a live DPI change to an already-running process without a full user logoff/logon — the app
  never visibly responded, and I couldn't tell if that's a real gap or just this VM's virtual-display
  limitation. Reverted the registry change; genuinely inconclusive, not filed as a finding.
- **Sleep/resume mid-index and mid-recording**: `powercfg /a` shows this Azure VM's firmware supports
  **no sleep states at all** (S1/S2/S3/hibernate/S0-low-power/hybrid-sleep all unavailable) — there is
  no way to test real OS sleep/resume on this seat at all, cloud VM or otherwise, without different
  underlying hardware (the Legion would be the place to test this for real).
- **OAuth token revoked mid-session (Wealthbox)**: had a real Wealthbox token available
  (`~/.config/wealthbox-seed/curl.cfg`) but did not attempt this — standing up the full connect flow
  and then revoking server-side would have cost more time than the campaign's remaining budget allowed
  once the P0/P1s above were found; flagging as a good next-lane target with the token already in hand.
- **QA-21 re-check (local-AI Ask reliability)**: this fresh VM only had the `e5-small` embedding model
  already downloaded (from a prior session), no local LLM — a 2.5GB+ fresh download would have consumed
  most of the remaining VM budget for an uncertain payoff; deferred rather than rushed.

### Plain-language summary (for Jameson)

I spent this session on the second cloud test computer (the one with a fake microphone plugged in, so
it can actually test recording) trying to break things a normal person wouldn't think to try — full
hard drives, a security-software-style file lock, a wrong clock, files with names Windows treats
specially, and so on.

**The single biggest thing I found, and it's a serious one:** if something else on your computer
briefly holds a file open right when the app tries to save — the most common real-world cause is
antivirus software scanning the file, which happens all the time and normally nobody notices — the app
can get stuck in a state where it says "Saved" forever, but is actually not saving anything at all,
even minutes later, even after whatever was holding the file lets go. I typed several sentences into a
document under this condition; the app said "Saved" the whole time; when I closed and reopened the
app, the document was completely empty. Nothing warned me. This is exactly the kind of silent data
loss the app is supposed to protect against, and I could reliably make it happen.

**The second biggest thing:** on this fresh test computer, I could not get past the very first screen
of the app at all through its own "pick a folder" button — clicking it just spins forever with no
folder-picker window ever appearing, and no error message. I had to use a workaround only someone
digging into the app's internals would know about, just to get inside the app to test anything else.
A real brand-new customer hitting this would be stuck on step one, forever, with the app spinning a
"loading" icon and never telling them anything is wrong.

**A related, smaller version of the same "silence" problem:** on this same test computer, one of
Windows' own background services that stores saved passwords/keys (called the Credential Manager) had
somehow stopped running. When that happens, opening an already-set-up copy of the app takes exactly 30
seconds and then just... does nothing, no error, nothing — as if the button did nothing at all. Once I
turned that Windows service back on, everything opened normally right away. I can't tell you why that
Windows service was off to begin with on this particular test machine, but the app's total silence
about a 30-second failure is worth fixing regardless of why it happens in the wild.

**Smaller, real things:** if you fill up someone's hard drive completely while they're in the middle of
recording a meeting, the "Stop" button can look like it's doing nothing for a while — no crash, but no
explanation either. And the app will happily let you name a document "CON" (a special reserved word to
Windows, left over from the MS-DOS era) — the app itself handles it fine, but that file then becomes
impossible to rename or delete using Windows' own File Explorer or PowerShell, which would very
confusingly trap a real user's file.

**What genuinely held up well:** I could not get the whole app to crash or corrupt data no matter what
I threw at it — full disk, locked files, a day-skewed clock, launching it twice, deeply nested folders.
Every one of those either worked correctly or failed in a narrow, contained way (one stuck feature),
never bringing down the whole app or corrupting other data. The meeting timestamps stayed sane even
with the clock a day off, and running the app twice at once is still handled cleanly.
| QA-73 | P2 (stale error banner — same swallow class) | **Calendar-error banner in TodaysMeetingsStrip can stay stuck ON after a transient rescan failure recovers.** A single `calendarListEvents` failure in the 5-min background `useAutoprepRescan` sets `calendarError=true` (TodaysMeetingsStrip.tsx:136-138), but the flag is only cleared inside `refresh()` — the periodic rescan has no success path back to the component. So after one transient failure, the strip shows the error/stale warning until the user manually clicks Retry or a separate calendar-sync event fires, even though access recovered. Fix: clear calendarError on a successful rescan (route rescan through the same refresh path, or surface rescan success to the component). Found by codex-review of the swallow-batch (QA-45..48) patch; NON-BLOCKING — filed as follow-up, fold into meetings-recovery or a calendar lane. | codex-review (swallow-batch) | NEW (follow-up, not blocking swallow-batch merge) |
| QA-74 | P1 (silent connector failure) | **Wealthbox connector claims success but zero client data ever lands in the Client Map.** Connected a REAL Wealthbox account (live API key) — "Connected to Northcrest (basic)." shown, no error. The "Import 40 Wealthbox households" confirmation completed with no error and no stuck spinner (the "Syncing…" label cleared cleanly). But the Client Map stayed at exactly **9 clients, 9 folders indexed** — identical count before and after — with none of the 40 households ever appearing. Reproduced twice: once via the initial "Import 40 Wealthbox households" confirm, once via a separate manual "Sync now" click. No console/network error surfaced either time (checked live via CDP). This is a complete silent failure of the connector's core promise ("bring client household data into your Client Map") — an advisor would reasonably believe the import worked (green "Connected" text, clean completion) while getting literally zero data. | hunt4 (bench-1), live-verified w/ real Wealthbox key | NEW |
| QA-75 | P1/P2 (matches QA-19 class) | **The live file tree stops picking up new externally-added files partway through a session — only a full app restart reveals them.** The FIRST external file drop of the session (copying a .docx directly into a client's folder early on) was picked up correctly and instantly by the FileSystemWatcher ("External file changes detected, refreshing file tree..."), confirming the watcher mechanism works in general. Later in the SAME session (after a VM reboot + app relaunch), 4 more files copied into the same client folder — including a plain-ASCII-named file (`Unicode-no-emoji-test.docx`) and 3 unicode/emoji-named files — never appeared in the file tree, even after collapsing/expanding the folder and a full navigate-away-and-back (which re-triggers `list()`). Confirmed NOT a unicode/emoji bug: once the app was fully restarted (not just navigated), ALL 4 files appeared correctly and instantly, including full emoji rendering (🎉📊) and Japanese/accented characters — proving the filenames themselves were never the problem. This is the same failure class as QA-19 (newly added content invisible until restart) but for the raw file-browser listing itself, not just RAG search indexing — the underlying watcher/list-refresh mechanism can silently stop working mid-session (most likely tied to the app-relaunch-after-reboot path) and there is no user-visible indication anything is stale. | hunt4 (bench-1), live-verified (repro'd across 4 files, confirmed fixed only by full restart) | NEW |
| QA-76 | P2 (trust/UX gap, not data loss) | **Manual edits are not tracked as reviewable/rejectable changes until the FIRST AI action runs on a document — even with "Reviewing" toggled ON the whole time.** Typed two markers directly into a fresh document with Reviewing already ON; both stayed completely untracked for 90+ seconds (CHANGES stayed at 0, text rendered as plain unhighlighted content, not as a tracked insert) — clicking "Reject all" correctly reported nothing to reject and (correctly, given the true state) left the text in place. The moment "Revise with AI" was invoked on the same document, BOTH earlier manual edits retroactively appeared as tracked INSERT changes attributed to "You", timestamped to that moment rather than when they were actually typed. Real risk: an advisor who trusts the "Reviewing: ON" toggle to mean their own typed edits are protected/revertible until reviewed would have those edits silently become permanent, un-reviewable content with no record, unless they happen to also invoke an AI action first. No data is lost — this is a false sense of protection, not corruption. | hunt4 (bench-1), live-verified (repro'd twice: CLEAN-REJECT-MARKER-XYZ, DELAYED-TYPE-MARKER-ABC) | NEW |
| QA-77 | P2 (rendering gap, verified NOT data loss) | **Tables and images embedded in an imported .docx are not rendered in the editor at all** — shown only as a generic "[preserved content - table, section, or other element kept as-is]" block or a "⋯" placeholder (`title="Preserved content"`, `contenteditable="false"`), with zero visual representation of the actual table cells or image. Verified via a 40-row/5-col table and a real embedded PNG in a 50+ page test fixture — `document.querySelectorAll('table')` and `querySelectorAll('img')` both return **zero** elements anywhere in the rendered document. Critically, the underlying data is NOT lost: re-saved the document after an unrelated edit and confirmed via `python-docx` + raw zip inspection that the table (41×5, correct header row "Holding/Ticker/Shares/Price/Value" and all data) and the embedded image (`word/media/image1.png`) both round-tripped byte-correct. So this is a pure rendering/UX gap in the custom OOXML engine, not data loss — but a serious functional gap for a financial-advisor product whose core documents (asset-allocation tables, holdings tables, charts) are exactly this content type; an advisor opening their own client's plan would see large chunks of it as inert grey placeholder boxes. | hunt4 (bench-1), live-verified | NEW |
| QA-78 | P3 (display-only, verified NOT data loss) | **Superscript character formatting is not visually rendered** — text with `<w:vertAlign w:val="superscript"/>` (e.g. footnote-reference-style markers "value¹...fluctuation²") displays as plain inline baseline text at normal size, not raised/smaller as real superscript. Confirmed the underlying OOXML is NOT affected: inspecting the saved `word/document.xml` directly shows `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` correctly preserved around the "1"/"2" runs after a save round-trip — display-only gap in the editor's rendering layer. | hunt4 (bench-1), live-verified | NEW |
| QA-79 | P2 (swallow-class debt) | **~11 pre-existing async silent-failure sites grandfathered when the new `lantern-async/no-silent-failure` ESLint rule landed** (guardrails merge, 465c74bc): `void` promises with no `.catch` / empty catch blocks in `src/features/meetings/noticeCard/supervisor.ts` (+3), `noticeCard/tauriDriver.ts` (+2), `useMeetingNoteOutboundGate.ts` (+3), `settings/RecordingNoticeSettings.tsx` (+1), `platform/firm/MatterSyncClient.ts` (+2), `platform/fs/docxSaveSession.ts` (+2). Rule now blocks all NEW swallow sites; these existing ones are baselined. Review each for a real silent-failure vs genuine best-effort — **prioritize `docxSaveSession.ts` (save path) and `MatterSyncClient.ts` (firm sync) first** as they're on data-integrity paths. Fix (add `.catch`/error-state) or annotate with an explicit disable+reason. | coordinator-8 (guardrails baseline) | NEW (follow-up) |
| QA-80 | P0 (silent data loss, NO adversarial condition needed) | **A newly-created Word document's typed content is only actually written to disk when the user navigates away from it (tab switch / close) — NOT on the documented periodic autosave — and an abrupt app termination (crash, forced Windows restart, power loss, Task Manager "End task") while the content sits in that un-flushed state loses it permanently, with the toolbar showing "Saved" (idle state) the entire time and zero rescue backup created.** Repro on current merged tip (b1794baf), Azure bench-1: created a fresh client + fresh "New Word Document," typed real keyboard input (Playwright `keyboard.type`, not synthetic DOM events) via `[data-testid="docx-editor"]`, confirmed the text rendered in the live DOM. Waited 30+ seconds with the document untouched — `auto-save-indicator` stayed `data-state="idle"` / label "Saved" the whole time, and the on-disk `.docx` never changed size or content (verified via `python-docx`/zip inspection of `word/document.xml`: still the empty-paragraph skeleton). Repeated on a second fresh document and force-killed `lantern.exe` (`Stop-Process -Force`, simulating a crash — no graceful shutdown) ~5s after typing, well past the 1200ms `SAVE_DEBOUNCE_MS` constant in `DocxEditor.tsx`: on relaunch, the document opened **completely empty**, confirmed both via the UI (screenshot) and by pulling the raw `.docx` off disk (still the pristine empty skeleton, `LastWriteTime` unchanged since creation). Critically, **no `.backup-*.docx` rescue snapshot exists for this file** (compare: two sibling documents where I *did* navigate away before restarting had both a correctly-updated `.docx` AND a `.backup-<timestamp>.docx` snapshot — the rescue mechanism only engages once a real save has happened at least once). This reproduces the exact "said Saved, lost everything" failure class from QA-34/QA-43, but via an ordinary, non-adversarial trigger (any crash/forced-restart/power-loss during normal typing) rather than a simulated antivirus file lock — meaning it is a broader and more likely real-world trigger than the scenario QA-34/43 fixed. Root-cause lead (not confirmed, needs a fix-lane's deeper look): `DocxSaveSession.scheduleSave()`/`SAVE_DEBOUNCE_MS` (`src/platform/fs/docxSaveSession.ts`, `src/features/documents/media/DocxEditor.tsx:116`) is the periodic debounced-save path; a separate `flush()` path documented as "the registry-facing flush (close-tab / quit / workspace-switch guards)" is what actually persisted content in my navigate-away tests — the periodic path appears to not fire (or not be wired) reliably, at least for freshly-created documents, leaving the close/switch flush as the only thing standing between an active edit and total loss on any abrupt termination. **Not yet tested**: whether a previously-existing (not brand-new) document exhibits the same periodic-autosave gap, or whether this is specific to the "New Word Document" creation path — flag for the fix lane to check both. Evidence: `docs/evidence/bench-smoke/benchverify-20260705/` screenshots 05 (typed), 08/09 (idle "Saved" after 30s+ with unchanged disk file), 11 (post-force-kill relaunch showing the document empty). | cc-lantern-benchverify (Azure bench-1) | NEW — highest priority, contradicts TRUST-BREAKER-LOCKDOWN.md's "SAVE bucket largely done" |

---

## ✅ MERGED to lantern-plus (2026-07-05, coordinator-8) — trust-breaker lockdown wave

These fix-lane rows above are now MERGED (see `coordination/TRUST-BREAKER-LOCKDOWN.md` for the live finish-line status):
- **race-p0** (8f5947fd): cross-client isolation stale-async guards — QA-52/53/56/57/58/59/62.
- **qa60** (5128f2ea): Windows boot crash (case-collision) + permanent gate — QA-60. Boot-verified live on Legion.
- **cleanup4** (b0275bb8): docx save regression + 2 save-integrity edge cases — QA-43, QA-42.
- **swallow-batch** (775327d0): meeting/calendar swallow fixes — QA-45/46/47/48.
- **guardrails** (465c74bc): async-swallow ESLint rule + i18n completeness gate.
- **QA-68** (RAG cross-workspace leak): **DOWNGRADED — no leak** (vector store is per-workspace; verified UI+backend, ragleak lane).

**In flight:** swallow-p0 (durable mail exclusion, round 3), QA-74 wealthbox, QA-75 filewatcher.
