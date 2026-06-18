# Keepance Full User-Test Playbook

A repeatable "drive it like a real user" test of the Keepance desktop app. It catches the class
of bugs unit tests miss: unreachable features, broken provider selection, modal sizing, silent
failures, copy issues. **Run it before any release candidate.** First run (2026-06-18) found a
critical bug (AI chat was 100% unreachable) plus several real gaps, none of which any unit test
caught.

> How to use this with Claude: open a session in `~/keepance` and say "run the full user-test
> playbook." A fresh session can follow this file end to end.

---

## Why a browser, and the browser-vs-desktop boundary

Keepance ships as a Tauri desktop app, but the React UI runs in the Vite dev server, where
Playwright can drive it like a user. About 80% of user journeys are testable this way. The other
20% are Tauri-native; they degrade gracefully in the browser and are validated separately.

| Works in the browser (dev server) | Tauri-native (NOT in browser) | Validate the native part via |
|---|---|---|
| App shell, nav, every surface, layout/polish | Email connect (OAuth loopback) | the live import harnesses (below) |
| Settings, API-key entry + management | Reading an email body (decrypt) | desktop only |
| **AI chat with real model replies** (Vite proxy) | Word/.docx editing (OOXML engine) | desktop only |
| File create + `.md`/`.txt` edit + autosave | RAG / semantic search index | desktop only |
| Email keyword search, filters, compose UI | OS-keychain key storage | browser uses a localStorage fallback |
| Workflows / Matters / Search / Privacy UIs | | |

In the browser, native-only actions show a graceful "only available in the desktop app" state
(e.g. opening a `.docx` or an email body). That is expected, not a bug.

---

## Setup (once per session)

1. **Dev server:** `cd ~/keepance && npm run dev` → `http://localhost:5173` (HTTP, not HTTPS).
2. **Test URL:** `http://localhost:5173/?testMode=true&mailFixture=1`
   - `testMode=true` bypasses the workspace-selector gate and seeds a mock workspace (a "Roberto
     Garcia" matter + `test1.md` / `test2.txt`). Read in `App.tsx`
     (`window.location.search.includes('testMode=true')`).
   - `mailFixture=1` populates the Email tab with 8 demo legal emails + demo accounts (DEV +
     non-Tauri only; see `mailFixtureEnabled()` in `mail-commands.ts`).
3. **Real API keys** are in `~/keepance/.env.test` (`CLAUDE_API_KEY`, `OPENAI_API_KEY`,
   `GEMINI_API_KEY`). Verify one before relying on it:
   `curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $KEY" -o /dev/null -w '%{http_code}'`
   (200 = good). **Heads up:** the Claude key has been expired (401); OpenAI + Gemini valid.
4. **Why AI chat works in a browser:** Vite proxies the provider APIs so there's no CORS wall:
   `/api/anthropic`, `/api/openai`, `/api/google` → the real endpoints (`vite.config.ts`
   `server.proxy`). Real key in, real model reply out.
5. **Enable cloud AI:** the active matter must not be local-only. Settings → AI & Privacy → "Where
   AI requests go" → **Cloud AI (your account)**. A local-only / isolated matter blocks cloud
   egress by design (and the chat will refuse).
6. **Inject keys without the UI (optional):** keys persist in localStorage as `apiKey_<provider>`
   (plaintext fallback), `bos_key_<provider>` (base64), and `bos_key_metadata` (a JSON array of
   `{provider, keyPrefix, addedAt, lastUsed}`). Set those + reload to skip the wizard.

Tooling: drive with the Playwright MCP browser (`browser_navigate`, `browser_snapshot`,
`browser_click`, `browser_type`, `browser_take_screenshot`, `browser_evaluate`,
`browser_press_key`, `browser_resize`). Resize to **1200×800** to match the app's default window —
some bugs (e.g. a too-tall modal) only show at the real size.

---

## The 6 journeys

For each journey: navigate, act, screenshot, **read the console log for errors**, and judge both
function and polish (light theme, layout, copy, plain language for a non-technical user).

1. **Onboarding / workspace** — the workspace selector ("Open Existing / New Workspace") and the
   onboarding flow (testMode skips the gate, so to test onboarding, load without `testMode`).
2. **API keys** — Settings → AI & Privacy → "Manage AI Account Keys". Add Claude/OpenAI/Gemini via
   the wizard. Check: clear save feedback, the key is actually **validated** (a bad key is
   flagged, not saved silently), the saved keys are **listed + removable**, and the wizard fits
   the window.
3. **AI chat** — open with **Ctrl+Shift+A** or the command palette (Ctrl+K → "Open AI Assistant").
   Pick a provider/model, send a message, get a real streamed reply. Check: a **model/provider
   picker** exists, model selection works, streaming + stop, error handling, save-to-workspace,
   the egress badge matches the provider **actually used** to send, cost tracking.
4. **Files** — the Files tab tree: New document (default `.docx`), New folder, edit a `.md`/`.txt`
   in CodeMirror, autosave ("Saved · Ns ago"), rename, Trash + restore. (`.docx` is read-only in
   the browser; Ctrl+N is eaten by the browser, use the button.)
5. **Email** — keyword search, AI search, filters (provider/date/attachments), compose
   (open / fill / **Escape to close** / Send), the connection panels (Account → Connections),
   matter mapping, privilege tagging.
6. **Surfaces sweep** — Workflows (try running one), Search (cited AI), Matters (create/switch),
   Privacy Center / Data Map, Activity Log. Look for broken states and console errors.

---

## Native-import validation (no signed build)

The OAuth connect and the real mail import can't run in the browser. Validate them with the live
harnesses (full detail in memory `reference_keepance_email_oauth.md`):

- `gmail_live_import` (`src-tauri/src/commands/mail/gmail/oauth.rs`) and `outlook_live_import`
  (`src-tauri/src/commands/mail/oauth.rs`) — ignored, two-phase. Phase 1 prints `AUTH_URL` +
  `VERIFIER`; drive the logged-in server Chrome through provider consent; read the redirect `code`
  from CDP `/json`; Phase 2 exchanges + imports the real mailbox into a temp encrypted store and
  prints folder counts + data-health. Outlook needs Jameson's one-time Microsoft login; Gmail's
  Google session in the server Chrome is usually still valid.

---

## Findings template + severity

Log each as: `[severity] surface — what's wrong — repro — recommendation`.

- 🔴 **Blocker** — a core feature is unusable (e.g. AI chat could not be opened at all).
- 🟠 **Significant** — a real gap many users hit (e.g. no model picker; new chats stuck on one provider).
- 🟡 **Minor** — cosmetic / edge (e.g. a modal that doesn't close on Escape, an em dash in UI copy).
- ✅ **Confirmed working.**

---

## Known gotchas (don't re-flag these as bugs)

- The Claude key in `.env.test` is expired, so a recurring `/api/anthropic/v1/models 401` in the
  console is just that, not an app bug.
- `testMode` uses a mock filesystem that re-seeds on every reload, so a text edit won't persist
  across a browser reload. Real disk persistence is desktop-only; the "Saved" indicator firing is
  the meaningful signal. Don't mistake the re-seed for a save bug.
- Ctrl+N opens a browser window (the page never sees it); use the "New document" button.
- Playwright MCP screenshots land in `~/` (the MCP server's cwd).
- Google's OAuth consent screen resists synthetic clicks; use real coordinate clicks and expect to
  click each "Continue" a few times.

---

## Run history

- **2026-06-18 (first run).** Found: 🔴 AI chat 100% unreachable (command-palette action pointed at
  a deleted sidebar surface; Ctrl+Shift+A compared lowercase `'a'` while Shift makes it `'A'` —
  also broke Ctrl+Shift+O / +P) → **fixed** (`c9ec30c`), AI chat then verified end-to-end (a live
  OpenAI "PONG"). 🟠 No chat model/provider picker; new chats hardcode Anthropic and ignore the
  saved default (two competing default mechanisms). 🟠 API-key entry saves a bad key silently;
  "Manage AI Account Keys" only adds (no list/remove). 🟡 Compose doesn't close on Escape; em
  dashes in UI copy; the key wizard modal is taller than the 800px window. All scheduled for the
  follow-up fix wave. ✅ Trust/egress badges (live + honest), cost tracking, Privacy Center,
  Workflows, Matters, Search, Email search/compose, file create/edit/autosave.
