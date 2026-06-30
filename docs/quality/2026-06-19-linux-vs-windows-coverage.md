# Linux test coverage vs. Windows risk — analysis + pre-Windows plan

_2026-06-19. Branch `keepance-3.0`._

## The question

Advisor Prep Hero is developed and tested on this Linux server, but ships signed for
Windows / macOS / Linux. Before doing a real Windows test pass, what else can we
verify on Linux, and how confident are we that Windows won't surprise us?

## What Linux covers well (high confidence)

The **logic and data layer** is platform-independent and heavily tested:

- **Unit / integration (Vitest + Rust):** 3,322 JS tests + the Rust crates
  (`keepance-docx` OOXML engine with round-trip integration tests, RAG/embed,
  mail). Covers matters, search, workflows, the AI answer/citation pipeline, the
  Word-document engine, and the **CRDT co-editing merge math**
  (`tests/unit/coedit/*` — diff, mutators, chaos, presence, session).
- **L1 browser (Playwright):** the React UI driven in the Vite dev server (~80%
  of journeys). Runs in **Chromium** — the same engine family as Windows'
  WebView2 — so it is a decent proxy for how the UI renders on Windows. Now
  green via `scripts/run-e2e-suite.sh`.
- **L2 real desktop app (tauri-driver + WebKitWebDriver + Xvfb):** the actual
  Tauri Rust app, headless on Linux. Board ~9 PASS (workspace shell, files,
  trash, vault, workflows, matters, settings/keychain, global shell, firm
  lifecycle single-instance) + 18-rag.

Deep logic bugs surfacing only on Windows are **unlikely** — the brains don't
change per OS.

## Where Linux ≠ Windows (the real risk surface)

The "last mile" where the app meets the OS is where surprises live:

1. **Webview engine.** Tauri uses the OS's native webview: **WebView2
   (Chromium) on Windows**, **WebKitGTK on Linux**, WKWebView on macOS. So the
   L2 Linux *desktop* tests render with a *different* engine than Windows will.
   Mitigant: the L1 browser tests run in Chromium (same family as WebView2), so
   UI rendering on Windows is reasonably—not perfectly—covered.
2. **File system.** Windows uses backslash paths + drive letters (`C:\`), has a
   `MAX_PATH` length limit, reserved names (`CON`, `NUL`, `PRN`, …),
   case-insensitive paths, and **locks files while open** (affects
   autosave/delete/move/rename). This is the most common "works on Linux, breaks
   on Windows" category for a file-based, local-first app.
3. **OS keychain.** API keys, vault keys, and mail/audit secrets use the OS
   secret store: **Windows Credential Manager** vs Linux gnome-keyring/Secret
   Service. The Rust crate abstracts both, but the Windows path only runs on
   Windows.
4. **Native dialogs.** The open/create-workspace **folder picker** is a native
   OS window WebDriver cannot drive.
5. **Build + sign + auto-update.** The Windows installer/signing/updater
   pipeline. There is a known history of the Windows build breaking on a
   Unix-only shell step the Linux dev rig can't catch.
6. **Microsoft Word interop.** Opening a co-edited `.docx` in *real* MS Word.

## Confidence (calibrated)

- **High** that logic / data / the AI pipeline / the doc engine won't surprise
  you on Windows.
- I would **not** bet on zero bugs. Expect a **short list of first-run,
  environment-flavored issues** — most likely in file paths, the keychain, the
  native folder picker, and possibly minor visual differences — plus the
  build/sign step is a known tripwire.
- Not deep-logic bugs; mostly environmental/cosmetic.

## Plan: do these on Linux first (priority order)

| # | Item | Why | Status |
|--:|------|-----|--------|
| 1 | **Two-instance firm co-editing + ethical walls, end-to-end** (2nd driver port in the L2 harness; two real app instances co-edit a shared matter over the relay; assert convergence + ethical-wall key denial) | Biggest untested *feature path* — CRDT logic is unit-tested but the real two-user desktop loop never has been | ✅ |
| 2 | **Windows-style path-handling tests on Linux** (feed PathValidator/WorkspaceService backslashes, `C:\`, long paths, reserved names) | Knocks out a real chunk of the #2 Windows risk **without** a Windows machine | ✅ |
| 3 | **Real Gmail/Outlook OAuth connect** (drive the logged-in Chrome through consent against a running build; the `*_live_smoke` path) | Email connecting is a headline feature; only the UI panels are tested, not a real round-trip | ✅ |
| 4 | **Re-run the full user-test playbook + es/de locales** | Catch UX/layout regressions from this week's changes across languages | ✅ |
| 5 | **Large-workspace stress** (index hundreds of files; watch speed + memory) | Local-first indexing on a real-sized practice; this box has OOM history | ✅ |

## Genuinely Windows-only (irreducible on Linux)

Native folder picker · Windows Credential Manager path · signed build +
auto-updater mechanism · real MS Word `.docx` interop · WebView2 rendering · the
Windows CI build itself. These need a real Windows spot-check.

---

## Results (2026-06-19, executed)

All five items done. Commits on `keepance-3.0`: `01b6b0e` (mail), `508b5d7`
(paths), `b0db3c0` (stress), plus the firm-collab + i18n verification below.

1. **Two-instance co-editing + ethical walls — ✅ already covered + verified green.**
   I was wrong that this "had never been run end-to-end": `firm-collaboration.spec.ts`
   already drives admin + member + walled user against the real local backend and
   passed **8/8** — bidirectional notes convergence over the real relay + the
   ethical-wall key-denial fail-close. (Also confirmed this week's archive-a-matter
   UI changes didn't break the firm flow.) Backed by the `coedit/*` unit tests +
   `20-firm` desktop. *Remaining sliver (low value):* the same flow across two real
   desktop windows on the OS keychain (browser uses localStorage); `20-firm` already
   proves the desktop keychain.

2. **Windows-style path handling — ✅ hardened, real bugs fixed.** New
   `PathValidator.windows` + `WorkspaceService.windows` tests. Fixed 3 real bugs
   (naive prefix boundary check → `<root>-evil` confusion; lowercase-drive rejection;
   reserved-name/dot/space). Traversal + symlink protection preserved. Full vitest
   3338 green.

3. **Real Gmail/Outlook OAuth — ✅ validated to Microsoft's auth gate; one stale
   test fixed.** The live smoke (`mail_e2e`) was bit-rotted (didn't compile) →
   rewritten to the production parse pipeline. Drove the logged-in Chrome through the
   real device-code flow: the Advisor Prep Hero side works end-to-end (real device code, app
   registered as "Advisor Prep Hero Desktop", personal accounts offered, account-select +
   device-confirm reached). The **final token grant is gated by Microsoft's own user
   auth** (a hardware passkey on the personal account; the work-account confirm
   doesn't complete under headless automation) — a real-device one-tap, not a
   Advisor Prep Hero bug. Gmail uses the auth-code+secret flow (not this device-code smoke).

4. **es/de locales — ✅ checked; found a real gap.** Key parity is solid
   (`tests/unit/i18n` 29/29) and the JSON is ~95% translated, BUT the running app
   only **partially localizes**: forcing German left the primary nav + much surface
   chrome in English because they're **hardcoded English, not `t()`** (`Spine.tsx`
   has no i18n import; only ~93/216 components use `useTranslation`). **Non-English
   support is incomplete — a product-priority decision** (large effort to localize
   ~half the UI; ICP is US firms). The full browser suite under es/de is not a clean
   signal (English-text selectors). The 6 user journeys were exercised live this
   session (archive flow + firm-collab driving chat/matters/notes/account/settings;
   en suite green) — no unreachable features.

5. **Large-workspace stress — ✅ memory is bounded.** New `rag_workspace_stress`
   indexed 300 files / 900 chunks with **peak RSS flat at ~1.1 GiB from first file to
   last** — memory does not grow with file count, no OOM cliff. Throughput ~8
   chunks/s on this CPU-only server (one-time background index; incremental +
   cancellable).

### Net effect on Windows confidence
Two of the named risk areas are now de-risked on Linux: **file-path handling** (#2,
real bugs fixed) and **large-workspace memory** (#5, bounded). The co-editing/relay
path (#1) and the OAuth pipeline (#3, to the provider's auth gate) are verified.
The remaining genuinely-Windows-only items are unchanged (native folder picker,
Windows Credential Manager, signed build + updater, WebView2 rendering, real Word
interop). Plus a non-Windows finding: **i18n is only partially wired** (#4).
