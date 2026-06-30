# Advisor Prep Hero — Real-Software Test Results (2026-06-20)

Driving the actual app to find real bugs, after the testing-infrastructure overhaul.
Tester: Claude (autonomous) + Jameson (live, where his hands/accounts are needed).
Branch: `keepance-3.0`.

## Method / environment
- **Windows desktop:** the Legion bench (`james@100.127.67.22`), unsigned debug build via `tauri:dev`, driven over Tailscale + screenshots; Jameson present at the keyboard for sign-ins.
- **Browser path:** the Vite dev server on the server, `http://localhost:5173/?testMode=true&mailFixture=1` (seeds a mock "Roberto Garcia" matter + demo files/emails). ~80% of journeys are testable here; the React UI is identical to the desktop's.
- Real API keys in `~/keepance/.env.test` (gitignored): **OpenAI ✅, Gemini ✅, Anthropic ✗ (key returns 401 — revoked/invalid)**.

## ⚠️ Integrity note — two false alarms caught BEFORE reporting
While sweeping the browser path, two things looked like real bugs. Verifying against a **clean slate** showed both were **test-environment artifacts, NOT product bugs**:
1. **"App loads in German."** Caused by leftover language state from earlier German-locale tests on the shared dev server. A genuinely fresh user gets **correct English** (`htmlLang=en`, breadcrumb = "Folder path", zero German). Not a bug.
2. **"Wrong AI provider (Anthropic with no key)."** Almost certainly an artifact of injecting keys via `localStorage` (bypassing the normal add-key flow). Not counted as a bug until reproduced through the real flow (being done in the live onboarding test below).

Lesson applied: test from a **clean slate through real flows**, not injected state on a dirty dev server.

## Results so far

### Windows desktop (Legion) — ✅ PASS
| Check | Result |
|---|---|
| Builds (incremental) | ✅ 1.35s, no errors (2 harmless dead-code/unused-import warnings) |
| Launches | ✅ `target\debug\keepance.exe` runs |
| Renders (WebView2) | ✅ Onboarding wizard renders cleanly; window title "Advisor Prep Hero" (correct branding, not "Projelli") |
| Tooling note | The auto-screenshot tool focuses imperfectly (Tauri window reports `MainWindowHandle 0`) and captures a viewport narrower than the (wide/maximized) window — a bench-tooling limit, not an app bug |

### Browser path — clean-slate sweep
| Area | Result |
|---|---|
| App shell / nav / light theme | ✅ Renders clean and polished |
| Language switcher (Settings → Language) | ✅ Works instantly (EN/ES/DE) |
| Default language (clean slate) | ✅ Correct English for an en-US user |
| Search / "answers-you-back" feature | ✅ Reachable (the **Search** surface); ✅ **graceful failure** on a bad key ("I couldn't reach your AI provider… check your key in Settings") — no crash, no silent fail |
| AI Account Keys management | ✅ Lists keys (masked), Add/Remove present; **"Check" verifies a key live** (OpenAI → "Working") |
| Add-key wizard (real 3-step flow) | ✅ Select provider → guided steps → paste → save; saved correctly (`apiKey_openai` + metadata) |
| Provider follows the added key | ✅ on the **Search surface** (switched to "Sent to your OpenAI account" after adding only an OpenAI key) |
| Email workspace (fixture mail) | ✅ Renders clean; all 8 seeded demo emails show with senders/subjects; "New email / Keyword / AI search / Filters" controls present |

### Confirmed real bugs
- **MINOR — query lost on error.** When a Search/Ask query fails, the typed question is cleared from the box; the user has to retype it. (UX papercut.)
- **MINOR — stale global provider indicator.** After adding *only* an OpenAI key, the **top "All matters" trust bar still reads "Sent to your Anthropic account"** even though the actual Search surface correctly uses OpenAI. So the global indicator is out of sync with the real provider — misleading. (The functional routing followed the key; the top banner is the stale part.)
- **MINOR (likely) — misleading error copy.** In the browser, the RAG-based Search shows "I couldn't reach your AI provider" when the real cause is that the semantic index is desktop-only (no index in the browser). The message points the user at their AI key when the issue is elsewhere. Needs desktop confirmation of the exact wording path.

### Browser limitations (NOT bugs — desktop-only features)
- **The headline "answers-you-back with citations" (Search) is RAG-based, and RAG is Tauri/desktop-only** (per `reference_keepance_email_oauth` / the user-test playbook). So it **cannot be fully verified in the browser** — it needs the real desktop app (where the index exists).
- Email connect, reading an email body, `.docx` editing, and OS-keychain storage are all desktop-only too.

### Still to verify — DESKTOP ONLY (needs the real app)
- **Headline feature end-to-end:** ask a question in the desktop app → real **cited** answer.
- **Outlook import:** does the connected Outlook actually pull mail into the Email tab (and exclude Deleted Items/Junk per the v3.3.x fixes)?
### ✅ Desktop-driving bridge — BUILT & WORKING (the vision: Claude drives the real Windows/Mac app)
`scripts/desktop-drive.mjs` connects Playwright to the desktop app's WebView2 over a Tailscale SSH tunnel and drives it by the app's own `data-testid`s. **Proven end-to-end on the Legion:** launched the app with `--remote-debugging-port=9223`, tunneled it (IPv4 `127.0.0.1` — `localhost` resolves to IPv6 and breaks), connected, and drove the real desktop app — full DOM snapshot, click/type, JS eval, and **clean full-window screenshots via CDP** (better than the old BenchShot partial captures). Commands: `pages | url | snapshot | click <id> | type <id> "<text>" [--submit] | eval "<js>" | screenshot <path> | waitfor "<text>"`.
**One boundary found → CAP-001:** native OS dialogs (the workspace **folder picker**, file save/open, OS auth) are outside the webview and can't be CDP-driven. So fully-autonomous setup of a *real* workspace needs the test hook in CAP-001, or one folder-pick from Jameson. Everything inside the app is fully drivable by Claude.
**Mac:** same approach with a WebKit bridge for WKWebView — next, after Windows is exercised.

## Full computer control — BUILT (CDP + desktop agent)
Beyond the in-app CDP bridge, native OS dialogs + the browser are now driven by a **desktop agent** on the Legion (`/tmp/legion_agent.py` → `C:\agent\legion_agent.py`): a tiny pyautogui HTTP service running in the logged-in session (started by the `LegionAgent` scheduled task), reached from the server via `ssh -L 8766:127.0.0.1:8765`. It does whole-screen screenshots + real mouse/keyboard anywhere. **Proven:** drove the native "Select Workspace Folder" picker (Ctrl+L → type path → Select Folder) to open a real workspace — closing the CAP-001 gap. Now: CDP for precise in-app clicks (by testid) + agent for native dialogs/browser. = control the whole machine like a user.

## Desktop sweep — RESULTS (driven autonomously via CDP + agent)
- ✅✅ **HEADLINE FEATURE WORKS.** Loaded `C:\Advisor Prep HeroTest` (3 sample matter files) → app auto-**indexed for RAG** → asked "answer deadline + contingency fee" in Search → got a **correct answer with VERIFIED citations** ("July 14, 2026"; "33.3% / 40%"; CITATION 1 ✓ Verified → `fee-agreement.md`). The product's core value prop confirmed end-to-end on real Windows.
- ✅ **AI provider follows the configured key** on desktop (trust bar = "Sent to your OpenAI account", the OS-keychain key from onboarding) — so **BUG-001/BUG-004 appear browser/injection-only**, NOT desktop product bugs. (Re-confirm + downgrade in backlog.)
- ✅ **Citation verification** works (claims marked "Verified" against the source file).
- ✅ Workspace load + RAG indexing + Search surface all functional on desktop.
- ✅ **Documents** — file tree shows the workspace files; Documents view works.
- ✅ **Matters** — created "Garcia v. Meridian Properties / Roberto Garcia" via the form; it auto-created folders (AI Chats, Audio Recordings, docs), mapped the Microsoft 365 account to the matter, and shows per-matter Network Lockdown + scoping. Solid.
- ✅ **Email connection** persists (Account → Connections: Microsoft 365 = "Connected." green) — but no mail synced + no Sync control → **BUG-007** (fix dispatched).
- ✅ **Privacy Center / Data Map** — renders clean + comprehensive ("Where your data is", Confidentiality Report, **Enable vault** (AES-256), plain-language data-map sections). **But** "Current mode" shows **Anthropic** while the trust bar shows **OpenAI** → **BUG-001 reproduces on desktop** (real, was wrongly dismissed as browser-only; fix to be dispatched).
- ✅ **Workflows, Activity Log** — load without errors.
- Not yet exercised: enabling the encrypted **vault** end-to-end (encrypt + recovery — disruptive, deferred); **`.docx`** Word-native editing (needs a .docx in the workspace); a full Outlook **import** (blocked by BUG-007 until the sync trigger lands or a re-connect).

**Sweep verdict:** the app is genuinely solid on real Windows. Real bugs found by the desktop sweep: **BUG-001** (provider indicators disagree) and **BUG-007** (connected mail never syncs / no Sync button) — both real, both now being fixed. Everything else worked.

### Live onboarding test (Legion, with Jameson) — IN PROGRESS
- [x] **Onboarding steps 1–6 walk-through** ✅ — all completed cleanly (green checks); no breakage reported.
- [x] **Step 6 "Connect AI"** ✅ — real key added through the proper flow; step marked complete.
- [x] **Step 7 — Outlook (Microsoft 365) connected on real Windows hardware** ✅ — **first time ever** (was blocked in all prior server-side tests because it requires Jameson's passkey). App reports connected.
- [x] **Gmail on the dev build — fails as expected (NOT a product bug).** Browser shows "Access blocked: Authorization Error"; the desktop app sits on "Waiting for Google sign-in…". Root cause: the dev/`tauri:dev` build does not have the Google client_id/secret baked in (injected only in the CI signed build per `reference_keepance_email_oauth`). The onboarding copy even warns "unverified app… while in testing." Gmail connect+import already validated server-side (811→966 rows). Optional follow-up: rebuild the Legion app with the Google creds to validate Gmail on real hardware too.
- [ ] **Verify the Outlook IMPORT** — does mail actually appear in the Email tab? (tests the v3.3.4/v3.3.5 fixes: Deleted Items/Junk excluded, per-provider progress, cross-window refresh) — pending.
- [ ] **Ask a real question → verify a real cited answer** (now that an AI key is connected) — pending.

_(Results appended as the live test proceeds.)_

## Rebuild + live-confirm of the fixes (Legion, autonomous via CDP) — 2026-06-20
Pushed the fixed frontend to the Legion, restarted the dev app fresh, reopened the workspace (via the Recent list — no native picker needed), and drove the real app to confirm the two sweep bugs are fixed.

- ✅ **BUG-001 CONFIRMED FIXED on real Windows.** In Privacy Center, every provider indicator now reads **"Sent to your OpenAI account"** — the trust bar and the Privacy Center "Current mode" agree (before the fix the Privacy Center wrongly said "Anthropic" while the trust bar said "OpenAI"). The remaining "Anthropic/OpenAI/Google" text on the page is generic explanatory copy, not the live indicator. The shared `useActiveEgressProvider` hook works.
- ✅ **BUG-007 fix CONFIRMED firing on real Windows.** Opening the Email tab now shows a **"Sync now"** button (was entirely absent before) and it **auto-switches to "Syncing…" on open** — i.e. the connected account auto-syncs on mount, exactly as the fix intends. (Before the fix: "No email synced yet" with no control anywhere.)
- 🐞 **NEW finding → BUG-008 (logged).** The auto-sync then sits on **"Syncing…" indefinitely (2.5+ min, 0 mail, no error, no timeout, no reconnect prompt)**. The most likely reason for *no mail* is a **stale/expired Microsoft 365 token** on this test account (the OAuth connect was done a while ago) — proving full import end-to-end needs Jameson to reconnect Outlook. But the **product gap is real and independent of the token**: a stuck sync gives the user zero feedback and looks broken forever. Logged in the backlog with a fix plan (add a sync timeout → surface an error → offer "reconnect"). The earlier headline result still stands: cited Ask was already proven working on Windows; this is purely the email-sync feedback path.

**Bottom line of the rebuild+confirm:** both bugs the sweep found are fixed and verified live; the email work surfaced one more honest gap (BUG-008), now tracked. See `2026-06-20-windows-desktop-test-plan.md` for the full Windows coverage tracker and what remains to drive.

## Word editor + AI redline (E3/E4/E6) — driven live on Windows, 2026-06-20
The flagship Word-native feature, never before driven on real Windows.

**First: solved typing into the custom Word page.** The earlier blocker was a driving-tooling gap — the desktop agent clicks in physical screen pixels while the app measures in its own scaled "web" pixels, so clicks landed in the wrong place and the page never took focus. Worked out the full mapping (`physical = (window_corner + web_position) × devicePixelRatio`; here window at web-(253,124), dpr 1.5, screen 2560×1600), clicked into the page, and confirmed via the app that a real text cursor landed inside it. Then pasted a paragraph — it rendered and autosaved. **E3 PASS.** (Mapping recorded in the `reference_keepance_desktop_control` memory.)

**Then: AI redline end-to-end.** Typed a paragraph with two deliberate errors ("it's" for "its"; "Payment are due"). Opened "Revise with AI" → **found BUG-009**: the composer showed "Add an account key" and a disabled button even though OpenAI is configured and works everywhere else. Root cause: the editor defaulted its provider to Anthropic because MainPanel never passed the real one. **Fixed** (resolve via `useActiveEgressProvider` + reactively from valid keys; new pure helper `resolveRedlineProvider` with 6 unit tests; Codex-reviewed, which caught two further edge cases now handled). Redeployed to the bench, restarted the app, re-drove:
- ✅ Typed an instruction, "Suggest changes" enabled, ran it → **real OpenAI call returned 2 correct tracked changes**: "it's → its" (possessive) and "Payment are → Payments are" (subject-verb), shown as proper Word redlines in the page AND in the Review pane (author "Advisor Prep Hero AI"). **E4 PASS.**
- ✅ **Accept/reject controls (E6):** accept-all cleared the prior change earlier, accept-one made "its" permanent (2→1), reject-one reverted "Payment are due" (1→0). All worked.

**Bottom line:** the Word AI-redline feature is proven working on real Windows — and fixing it removed a bug that would have made it unusable for the majority of BYOK users (anyone not on Anthropic). Full suite still green (3398 frontend tests); lint gate + CI restored to green (the BUG-008 connector changes had drifted the baseline; also removed an em dash from the connector warning copy).

## Run a workflow end-to-end (I2) — driven live on Windows, 2026-06-20
Drove the Workflows catalog (19 legal templates render cleanly) and ran **Case Timeline Builder** all the way through:
- ✅ Clicking "Run" opened the **Workflow Questions** interview form; its **required-field validation works** (Continue refused with "This field is required" until every required field had a value).
- ✅ On Continue it made a **real OpenAI call** and produced a proper, well-structured **`CASE_TIMELINE.docx`** in a new dedicated folder ("Case Timeline Builder - <timestamp>"), correctly using every input: title "Case Timeline: Garcia v. Meridian Properties LLC", case type, jurisdiction, trial date, a Parties Quick Reference table, and a Chronological Timeline grouping the events into phases with "Parties involved / Significance / Source" for each.
- ✅ The output opens in the same Word-native editor (Export / Revise with AI / Review pane), so it can be redlined further.
- ✅ The completed run appears in **Recent Runs** with a green check (I5).
- Notes (not user bugs): the InterviewForm inputs have no `data-testid`s (a testability gap — drove them by placeholder + React-aware fill); the shared "**Draft document** — Review and edit…" disclaimer baked into the workflow templates contains an em dash (minor copy style, lives in generated-document output rather than app UI; the no-em-dash rule de-scopes repo-wide hunts, so left as-is).

**Bottom line:** workflows work end-to-end on real Windows — interview → real AI → a correct, editable .docx artifact. **I2 PASS.**

## Encrypted vault — enable + recover (G3/G4) — driven live on Windows, 2026-06-20
The data-loss-sensitive flagship, tested on a **throwaway** workspace (`C:\kp-vault-test`, one file containing a fake "secret settlement figure"), never the real test data.
- ✅ Created the throwaway workspace via the **native folder picker driven end-to-end** (workspace switcher → Open Project → Open Existing → native dialog: Ctrl+L → path → Select Folder). Confirms B-series native-picker driving too.
- ✅ **Enable (G3):** Privacy Center → "Encrypt this workspace" → honest 2-step ceremony (clear warning that Advisor Prep Hero can't recover the phrase), a 24-word recovery phrase shown once, a confirm-3-specific-words gate, Activate → "Workspace encrypted." **Verified the encryption is real at the disk level (over SSH):** the file's bytes became ciphertext starting with the `KPV1` magic header, and the secret plaintext was gone. Folder names stayed readable, as the dialog promises.
- ✅ **Recover (G4):** via the app's own `vault_unlock_with_recovery` command — a **wrong** phrase was rejected ("failed BIP39 checksum validation"); the **correct** saved phrase unlocked; then reading the encrypted file decrypted it back to the exact original secret. So the 24-word phrase genuinely recovers the key and the data.
- ✅ **Off-ramp:** "Turn off vault and decrypt files" → confirm → the file was restored to plaintext on disk and `.keepance-vault.json` was removed (vault_status enabled=false).
- Cleaned up: switched back to the real test workspace and deleted the throwaway folder + the local copy of the phrase.
- Note: I tested the recovery *cryptography* directly rather than the locked-state UI prompt, because there is no in-app "lock" button and the OS keychain that holds the unlocked key isn't reachable from the SSH session to force the locked state. The substance — wrong-phrase rejection, correct-phrase recovery, real on-disk encryption, clean decrypt-and-disable — is fully proven.

**Bottom line:** the encrypted vault genuinely protects data at rest (real ciphertext) and the recovery phrase genuinely brings it back. **G3/G4 PASS.**

## Email end-to-end on Windows (H1/H4/H5) + BUG-010 + BUG-011 — 2026-06-20
The email connector was the hardest remaining surface, and driving it to completion exposed (and fixed) three real bugs. Final state: **the whole email feature is proven end-to-end on real Windows.**
- **Sign-in was fully broken on Windows (BUG-010), now fixed.** Clicking "Connect/Reconnect Microsoft 365" opened no browser and timed out. Two stacked causes: (1) the browser-opener `rundll32 url.dll,FileProtocolHandler` silently failed → replaced with Win32 `ShellExecuteW`; (2) the loopback listener bound `127.0.0.1` (IPv4) while the redirect used `localhost`, which Windows resolves to `::1` (IPv6) → "localhost refused to connect" + timeout → now binds the literal `localhost`. After the fix, Jameson clicked Connect → the real Microsoft sign-in opened in Chrome → passkey → the app's "Signed in, return to Advisor Prep Hero" page → connected. (Device-code flow also verified working as a fallback, though the loopback flow is the primary.)
- **Large import crashed the app (BUG-011), now fixed.** The first real import climbed to ~1,400 messages then the whole app aborted (allocation failure with 22 GB free). Root cause: `spawn_mail_rag_index` fire-and-forget `tokio::spawn`ed an embedding task per message with no cap → thousands of concurrent ONNX embeddings → thread/memory exhaustion. Fixed with a `Semaphore(4)` bounding concurrent indexing.
- **Verified end-to-end after both fixes:** re-ran the import → it sailed past the old ~1,400 crash point and **settled at 4,970 messages with the app alive** (the ~455 vs the ~5,425 mailbox total are the deliberately-excluded Deleted Items/Junk). Then **keyword search over the imported mail works** — "invoice" returned 21 real matches with correct subjects/senders.

**Bottom line:** Outlook on Windows now connects, imports a full real mailbox without crashing, and is searchable. **H1/H4 PASS; H5 keyword PASS.** Three customer-facing bugs (BUG-010 ×2 causes + BUG-011) found and fixed in the process.

## Lower-risk tail burn-down (continuation session) — 2026-06-20
Drove the next batch of surfaces on the real Legion. **Found + fixed one real, customer-facing bug (BUG-012) and proved several editing surfaces; recorded everything below.**

### 🐞→✅ BUG-012 — inline "Ask AI" edit on Markdown/text was dead for EVERY user (found + fixed live)
Driving **E7** (select text in a `.md` → "Ask AI" → edit), the edit silently did nothing — no change, no diff, no error. Root cause: `MainPanel` rendered `<MarkdownEditor>` with **no `getAiProvider`**, so `useInlineAiEdit`'s provider was always null and the submit handler took a silent early return (its own comment: *"We could show a toast here; for now just abort gracefully."*). Broader than BUG-009 (which only hit non-Anthropic users) — here the provider was null for everyone. **Fixed:** added a tested pure helper `resolveInlineEditProvider` that builds a real `Provider` from the SAME resolved provider as the redline/trust bar (`redlineProvider`) + the user's keys (local keyless; cloud only with a valid key; else null), and wired `getAiProvider` in `MainPanel`. 5 unit tests + typecheck. **Re-verified live:** select word → Ask AI → streaming diff overlay ("AI edit · 1 hunk", `- contingency` / `+ contingent-fee`) → accept hunk → applied. (Investigation confirmed `PlainTextEditor` also uses the hook but is **never rendered** — dead code, not a live bug.) **E7/E8 PASS.**

### ✅ E5 — document export (Word / clean / clean-final / PDF)
- **Word export** → real `.docx` on disk, valid OOXML zip (magic `50 4B 03 04`). **Clean-final** export → "changes accepted, comments and hidden metadata removed."
- **PDF export with no LibreOffice (the high-value Windows case):** instead of a silent fail, a clear plain-language notice — *"PDF export needs LibreOffice … a free program. Nothing leaves your machine."* + download link + Copy-link. Exactly the graceful behavior a real user needs.
- The actual PDF *conversion* couldn't be exercised: LibreOffice won't silent-install on this bench (MSI 1603/1402 — a Windows registry-permission quirk in the non-interactive SSH session; tried plain, ALLUSERS, and an elevated scheduled task; unrelated to Advisor Prep Hero), and the server has no `soffice`. The convert path is shared cross-platform code. **E5 PASS** (graceful-missing-converter — the real customer risk — proven; live conversion is a documented bench gap).

### ✅ E11 — trash (delete → restore)
Created a throwaway `trash-test.docx`, deleted it via the row kebab → "Delete" → a confirm dialog → file left Files and the **Trash badge showed "1"**. The Trash view listed it (size/date), with Empty-Trash + a 30-day retention setting. **Restore** put it back in Files and emptied the trash. **E11 PASS.** (Permanent-delete present, not separately exercised.)

### ✅ E12 — version history (text)
`fee-agreement.md` history panel listed **2 versions** with rich metadata (timestamp, a correct **"AI edit"** label for the inline edit, byte size, size-delta) and per-version Restore; Restore showed a confirm and applied cleanly. (Both snapshots had identical content so the revert wasn't separately visible — not a defect.) The **.docx binary** history UI exists but `redline-test.docx` reads "History (0)"; its on-disk `.backup-*` files are a separate redundancy mechanism. **E12 PASS** (text); binary-version restore not separately exercised.

### ✅ B3 — recent-workspaces reopen
After a dev-server restart, the workspace selector showed "Recent (2)"; expanding it and clicking the Advisor Prep HeroTest row reopened the workspace with no native picker. **B3 PASS.**

**Net this batch:** B3, E5, E7, E8, E11, E12 → PASS; **BUG-012 found + fixed + re-verified live** (inline AI edit was dead for everyone). Note: an independent Codex review/investigation was attempted twice but hung with no output on this box this session (killed per the watch rule); the fix was instead verified by 5 unit tests + typecheck + live end-to-end driving.

### ✅ H9 — email filters + pagination · ✅ H7 — file email to matter (single + bulk)
Over the 4,970 imported emails:
- **H9 filters:** the "Has attachment" filter took "Showing 50 of 4970" → "of 939"; a From-date filter (2026-06-19) narrowed the list to 5 rows; **load-more** paged 50 → 100 rows. **H9 PASS.** (Provider filter present in the panel; one provider connected, so not separately exercised.)
- **H7 single:** opened an email → clicked the Garcia-matter button → "Filed successfully." **H7 bulk:** hover-checkbox-selected 2 rows → "2 selected" bulk action bar → "File to matter" → picked Garcia → bar cleared + selection reset. Filing persists via `mailRetagMessageMatter`. **H7 PASS.**
- **🐞 BUG-013 (minor UX) logged:** reopening a filed email shows no persistent "filed to X" state (the success line is transient; matter buttons don't reflect the current association). Filing works; the gap is the missing filed-state display. Fix plan recorded in the backlog.

### ✅ K3 confidentiality mode · ✅ K5 memory/facts/OCR · ✅ K11 updates (settings depth)
- **K3:** "Where AI requests go" = "On this computer only" vs "Cloud AI (your account)". Switching to **Local-only flipped the trust bar to "On your machine. Nothing leaves…"** and back to "Sent to your OpenAI account" on Cloud — the egress indicator honors the mode. Privileged-matter + Network-lockdown toggles present. (Assured = firm-tier only.)
- **K5:** memory on; **added a fact → row appeared → deleted → empty**; OCR toggle present + ON ("local OCR … runs entirely on your machine").
- **K11:** channel "Stable", auto-update ON, "Check for updates now" clickable with no error/crash (dev build has no feed; real updater = signed build, N2).

All three PASS.

### ✅ M2 quick-open · ✅ M3 shortcuts overlay · ✅ M7 bug report (global overlays)
- **M2:** Ctrl+P → Quick Open; typing "fee" fuzzy-matched `fee-agreement.md`.
- **M3:** "?" → Keyboard-shortcuts overlay (FILE → Save File Ctrl+S, Close Tab, …) with search.
- **M7:** status-bar bug button → "Report a bug" dialog (required message + optional email + include-context). Renders correctly; not submitted (real endpoint).

All three PASS.

### ✅ N1 keychain (explicit) · 🐞 N4 OCR (not confirmed — found BUG-014 + BUG-015)
- **N1 PASS (explicit):** read the Windows Credential Manager from the *interactive* session — 6 real Advisor Prep Hero entries: OpenAI API key (`bos_key_openai`), M365 mail refresh token (`ms-refresh-token.keepance-mail-ms`), the vault key (`vmk-v1…vault`), + encryption master keys for mail/vectors/audit. All in the OS keychain, not a file. (`cmdkey` over SSH can't see them — session isolation; ran it via an interactive scheduled task.)
- **N4 NOT confirmed:** OCR engine fully present (tesseract-wasm + eng.traineddata + worker + WASM bundled on the bench), wired (`MemoryService.indexPdfFile`), toggle ON. But a real image-only scanned PDF ("ZEBRAFOX"/$73,250) placed in the workspace never became searchable — Ask returned "no information," and no runtime PDF-index/OCR call reached Rust. **Found BUG-014** ("Add files" opens New-Document instead of importing — no import path) and **BUG-015** (added PDF wasn't indexed; watcher missed the external copy; reopen didn't index; PDF-index errors silently swallowed). Also a trust observation **BUG-016** (a loose phrasing produced a confident "$8,760,000" cited-but-unverified answer for content not in the corpus; precise phrasing correctly declined — needs a verify-citation re-test).

**Net this batch:** N1 PASS (explicit). N4 not confirmed → 2 real bugs (BUG-014 Important — broken file import; BUG-015 — OCR-to-search/indexing gap) + 1 trust observation (BUG-016, needs-confirm).

## Fix wave: BUG-014 (file import) + BUG-015 (OCR-to-search) — 2026-06-20
After the burn-down, Jameson said "keep going, everything must be functional and fixed." Fixed the two real gaps and confirmed OCR works:

### ✅ BUG-014 FIXED — "Add files" now imports (was: opened New-Document)
Implemented a real import: native multi-file picker → copy into the current folder (dedup) → **explicitly index each** (deterministic, not watcher-dependent) → refresh tree + open. New tested helper `importPickedFiles` (5 unit tests); threaded `onImportFiles` App→Router→DocumentsHome; falls back to create-doc only when no native picker (browser/test). **Confirmed live:** "Add files" opened a native picker titled "Add files to your workspace", selected the scanned PDF, it imported + opened in the viewer. Committed `6ed894a`, re-deployed to the bench.

### ✅ BUG-015 ROOT-CAUSED + FIXED — and ✅ N4 OCR CONFIRMED WORKING
Root cause of "scanned PDF not searchable": **"Include PDFs in workspace index" defaults OFF** (while "Read scanned PDFs with OCR" defaults ON — misleading), so the PDF-index path returned early (`pdf-indexing-disabled`), silently. **Proved OCR works:** with PDF indexing ON, the image-only scanned PDF ("ZEBRAFOX"/$73,250, no text layer) was OCR'd and Ask returned the correct cited answer — "seventy-three thousand two hundred fifty dollars ($73,250) … November 3, 2026" citing the PDF pages. `tesseract-wasm` + the bundled model genuinely read the scan (using the single-threaded fallback core, since the dev server isn't cross-origin isolated). **Fix:** importing a PDF while indexing is off now shows a toast — "Added — but PDF search is off…" — with a one-tap **"Turn on PDF search"** that flips the setting (auto-reindex). **Verified live:** turned indexing off → imported a PDF → toast appeared → tapped "Turn on PDF search" → setting flipped ON. (Generalized `UndoToast` with an optional action label.) **Product note:** PDF indexing OFF-by-default is a perf/product call, left as-is and flagged to Jameson — flip the default if you want scanned-filing search on out of the box.

**Net:** both functional gaps fixed + verified live; OCR (a flagship desktop-only feature) is now proven end-to-end. BUG-016 (phrasing-dependent confident-wrong cited answer) remains a needs-confirm trust observation for a future verify-citation re-test.
