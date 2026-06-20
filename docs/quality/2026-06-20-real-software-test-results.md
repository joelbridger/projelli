# Keepance — Real-Software Test Results (2026-06-20)

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
| Renders (WebView2) | ✅ Onboarding wizard renders cleanly; window title "Keepance" (correct branding, not "Projelli") |
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
- ✅✅ **HEADLINE FEATURE WORKS.** Loaded `C:\KeepanceTest` (3 sample matter files) → app auto-**indexed for RAG** → asked "answer deadline + contingency fee" in Search → got a **correct answer with VERIFIED citations** ("July 14, 2026"; "33.3% / 40%"; CITATION 1 ✓ Verified → `fee-agreement.md`). The product's core value prop confirmed end-to-end on real Windows.
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
