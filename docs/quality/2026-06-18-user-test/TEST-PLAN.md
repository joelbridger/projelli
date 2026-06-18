# Keepance — Layered Test Plan (break the build/fix loop)

**The problem.** Bugs in the desktop-only paths (firm login, .docx, mail import, vault,
multi-window) only showed up *after* a slow signed cross-platform build, so every fix meant
another build — a loop that takes forever and gets us stuck.

**The fix.** Test the **real software locally**, in layers, catching ~95% of bugs before any
build is needed. The key unlock: **the real Tauri desktop app (real Rust backend) now runs and
is drivable headless on this Linux server** — proven end-to-end this session (screenshot +
passing assertion in `harness-probe/evidence/`). A local Linux debug run is a fraction of the
cost of the signed all-platform release build and exercises the same real code paths.

This plan tests the ~540 stories in [USER-STORIES.md](./USER-STORIES.md). Run it before any
release candidate; the risk register is the priority order.

---

## The pyramid

```
        L4  windows-only manual  (~1%)   installer branding, console flash, auto-updater,
            └─ only at the signed build      code-sign/notarize, OS-keychain specifics
        L3  live-service        (~4%)    real Gmail/Outlook OAuth+import; disposable firm relay
            └─ existing harnesses + a test org
        L2  REAL desktop, local Linux, headless  (~25%)   ★ THE UNLOCK ★
            └─ keychain, encrypted mail store, RAG, .docx engine, multi-window,
               real persistence, firm create→login, two-instance co-editing
        L1  browser-dev (Playwright on Vite)     (~70%)
            └─ all platform-agnostic UI, AI chat via proxy, file/md create+edit
```

Each story in `inventory/` is tagged with its layer. Lower layers are cheaper and run first;
a story is tested at the *lowest* layer that can actually exercise it honestly.

---

## L1 — browser-dev (extend what we have)

- **Tool:** Playwright against `npm run dev` (`http://localhost:5173/?testMode=true&mailFixture=1`),
  real API keys via the Vite provider proxy. This is the existing
  [full-user-test playbook](../full-user-test-playbook.md).
- **Covers:** app shell, every nav surface, settings, key wizard/manager, AI chat with real
  model replies, file create + .md/.txt edit + autosave UI, email list/search/filter/compose UI
  (fixture), workflows launcher + interview forms, matters UI, privacy center, data map, command
  palette, keyboard shortcuts.
- **Action:** turn the playbook's 6 journeys into committed Playwright specs that walk the L1
  rows in each inventory file (don't just hand-drive). The global-sweep inventory flags shell/nav
  selectors that need L1 specs (number shortcuts, collapsed spine, trust-bar, account-window tabs).

## L2 — real desktop, local, headless  ★ the unlock ★

**Proven recipe** (see `harness-probe/README.md` + `evidence/`):

- `tauri-driver` v2.0.6 (installed via `cargo install tauri-driver --locked`) +
  `/usr/bin/WebKitWebDriver` + `xvfb-run`, driving `src-tauri/target/debug/keepance`.
- Env: `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `GDK_BACKEND=x11`.
- A W3C WebDriver session: launches the real binary, asserts `window.__TAURI__===true`, drives
  real UI by `data-testid`, reads/writes the real Tauri filesystem. Launch-to-shell ~2.2s.
- **Data isolation:** every run gets a fresh temp `HOME` + `XDG_*` + workspace under
  `/tmp/keepance-real-app.*`, so keychain-fallback, `~/.keepance`, and WebKit profile never touch
  the real home dir. Avoids the native folder picker by pre-seeding the recent-workspace entry.
- **Runner today:** `harness-probe/run-real-app.sh` (boots Vite if needed, runs `driver.mjs`).

**Covers (the desktop-only risk register):** firm create/claim → sign-in → seat → relaunch
hydration; ethical walls (key purge from keychain); shared-matter + .docx co-editing
(**two app instances** against a test relay); encrypted vault enable/migrate/recover/disable;
real mail store + the multi-window Email-tab refresh; RAG index build + cited Ask + citation
click-through; privilege/matter scoping with a real index; trash destructive ops; marketplace
install; OOXML .docx/.pptx export (open the produced Office files and re-parse).

**Action:** promote the probe into a small `tests/desktop/` suite (WebdriverIO config + one spec
per risk-register journey), each booting an isolated profile. Add a **two-instance** helper for
the firm co-editing/ethical-wall stories (two profiles, two users, one matter).

## L3 — live-service

- **Mail:** the existing ignored harnesses `gmail_live_import` / `outlook_live_import`
  (`src-tauri/.../mail/`) + driving the logged-in server Chrome through consent (see memory
  `reference_keepance_email_oauth.md`). Recommendation: a fixture IMAP server on every run, a real
  OAuth smoke on scheduled/manual runs.
- **Firm:** stand up a **disposable test org + relay** (local or staging — never production for
  destructive wall/seat/key tests). The firm stories in `firm-lifecycle.md` say exactly what each
  needs (and which require two concurrent instances).

## L4 — reserved windows-only manual (the only things that need the build)

A short checklist, run once at the eventual signed build — deliberately tiny and visual, never
logic:

- Installer + uninstaller show "Keepance" branding/icons (not "Projelli").
- No OS console window flashes on child-process spawns.
- Auto-updater serves + applies the new version; `latest.json` correct.
- Code-sign / notarize valid on Win + macOS.
- OS keychain (real Keychain/Credential Manager) stores + retrieves keys.
- LibreOffice detection + legacy `.doc`/`.ppt` conversion on each OS.

---

## Execution strategy

1. **Order of attack = the risk register** (USER-STORIES.md). Do L2/L3 on items 1–13 first;
   those are where the real bugs and the data-safety/firm exposure live.
2. **Then sweep L1** across all domains via the Playwright specs.
3. **Run L4 only when cutting the signed build**, against that build.
4. **"Done" for a release candidate** = risk register green at L2/L3 + L1 sweep green + L4
   checklist green on the signed build.
5. **CI:** L1 + the L2 headless suite can run in CI on Linux (xvfb is headless); L3 live + L4 stay
   manual/scheduled.

## First wave to build (concrete, in order)

1. Harden the probe into `tests/desktop/` (WebdriverIO config, isolated-profile boot helper,
   screenshot-on-failure). ← the enabler; everything else rides on it.
2. **Mail import → Email tab shows it → open body → attachment** (risk #7) — the exact class that
   bit us; pair the L2 UI assertion with the L3 live import.
3. **Firm create/claim → sign-in → seat → relaunch hydration** (risk #1) against a test org.
4. **Two-instance shared-matter + .docx co-editing** (risks #4–5) — build the two-profile helper.
5. **Vault enable → recover → disable** (risk #6) on a temp workspace with .docx/.pdf fixtures.
6. **RAG index → cited Ask → click-through** + **privilege/matter scoping** (risks #8–9) on a
   fixture corpus.
7. **Trash destructive ops** (risk #10) + **marketplace install** (risk #11).
8. Convert the L1 playbook journeys into committed Playwright specs.

## Why this breaks the loop

Today: change → signed all-platform build (slow) → find bug on Windows → repeat.
With this plan: change → L1 + L2 headless locally (minutes, real backend) → fix → repeat, all
**before** a build. The signed build becomes a final confirmation of the ~1% L4 visual/OS items,
not the place we *discover* logic bugs. The real-app harness is the difference.
