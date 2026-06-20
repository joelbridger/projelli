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
- The desktop app cannot be remote-driven by Claude without a WebView2 debugging bridge (not yet set up); these need that bridge or Jameson's hands.

### Live onboarding test (Legion, with Jameson) — IN PROGRESS
- [x] **Onboarding steps 1–6 walk-through** ✅ — all completed cleanly (green checks); no breakage reported.
- [x] **Step 6 "Connect AI"** ✅ — real key added through the proper flow; step marked complete.
- [x] **Step 7 — Outlook (Microsoft 365) connected on real Windows hardware** ✅ — **first time ever** (was blocked in all prior server-side tests because it requires Jameson's passkey). App reports connected.
- [x] **Gmail on the dev build — fails as expected (NOT a product bug).** Browser shows "Access blocked: Authorization Error"; the desktop app sits on "Waiting for Google sign-in…". Root cause: the dev/`tauri:dev` build does not have the Google client_id/secret baked in (injected only in the CI signed build per `reference_keepance_email_oauth`). The onboarding copy even warns "unverified app… while in testing." Gmail connect+import already validated server-side (811→966 rows). Optional follow-up: rebuild the Legion app with the Google creds to validate Gmail on real hardware too.
- [ ] **Verify the Outlook IMPORT** — does mail actually appear in the Email tab? (tests the v3.3.4/v3.3.5 fixes: Deleted Items/Junk excluded, per-provider progress, cross-window refresh) — pending.
- [ ] **Ask a real question → verify a real cited answer** (now that an AI key is connected) — pending.

_(Results appended as the live test proceeds.)_
