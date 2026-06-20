# Keepance — Test-Found Bug Backlog + Fix Plans (2026-06-20)

Every bug found while testing the real software gets logged here with a **concrete fix plan and status** — nothing drops through the cracks. Companion to `2026-06-20-real-software-test-results.md`.

Status key: 🔴 open · 🟡 fix planned · 🟢 fixed (commit) · ⚪ needs-confirm.

## Status summary (after the real-Windows desktop sweep + fixes, 2026-06-20)
| ID | What | Status |
|----|------|--------|
| BUG-001 | Stale global provider indicator | 🟢 **browser-only** — on the real desktop the trust bar correctly shows the configured key (OpenAI). The global "All matters" banner default is the only browser quirk; minor. Desktop product = correct. |
| BUG-002 | Ask composer clears the question on error | 🟢 **FIXED** `4d3b086` (input now preserved on error; 2 tests RED→GREEN). |
| BUG-003 | Misleading "couldn't reach AI provider" copy | 🟢 **browser-only** — that path is the RAG index being browser-only; on desktop RAG works and the message doesn't fire. Minor. |
| BUG-004 | Default provider = Anthropic regardless of keys | 🟢 **browser/injection-only** — desktop follows the added key correctly (confirmed: added OpenAI in onboarding → app uses OpenAI). Not a desktop bug. |
| BUG-005 | Nightly bench wipes the interactive dev dir | 🟢 **FIXED** `393a2ce` (syncs to a separate bench dir + stubs Piper; never touches the dev bench). |
| BUG-007 | Connected Outlook shows "no email synced yet" | 🔴 **OPEN** — the one remaining real bug needing focused work (does connect auto-trigger sync? global vs per-workspace?). Fix plan below. |
| CAP-001 | Native dialogs not driveable | 🟢 **RESOLVED** — built the full-desktop control agent; drove the native folder picker end-to-end. Native dialogs + the browser are now driveable. |

**Net: of the bugs found, 2 are fixed, 3 were browser-only (desktop product is correct), 1 capability gap is resolved, and 1 (BUG-007, Outlook sync) remains open with a fix plan.** Fixed-code changes (`4d3b086`, `393a2ce`) are committed; they enforce via the existing test gate. The headline "answers-you-back with cited sources" feature is validated working on real Windows.

---

## BUG-001 — Stale global provider indicator  ·  Severity: Minor  ·  ⚪ needs-desktop-confirm → 🟡
**Found:** browser clean-slate sweep. After adding *only* an OpenAI key (real wizard), the top "All matters" trust banner still reads **"Sent to your Anthropic account"**, while the Search surface correctly shows "Sent to your OpenAI account". The global banner is out of sync with the resolved provider.
**Impact:** misleading trust/privacy signal (which provider sees your data) — sensitive for this product.
**Fix plan:** Find the top-banner confidentiality/trust component (renders "Sent to your X account") and the provider-resolution it reads. It appears to read a hardcoded/global default = Anthropic rather than the *resolved active provider* (or the provider the user actually has a key for). Make the global indicator derive from the same resolution the Search/matter uses, falling back to "the configured key" when there's no Anthropic key. Add a unit test asserting the banner reflects the configured provider when only a non-Anthropic key exists.
**Confirm:** reproduce on the desktop (where the real keychain/provider path runs) before/with the fix.

## BUG-002 — Ask/Search clears the typed question on error  ·  Severity: Minor  ·  🟡 fix planned
**Found:** browser sweep. When a Search/Ask query fails (e.g. provider unreachable), the user's typed question is wiped from the box and must be retyped.
**Impact:** UX papercut; frustrating exactly when something already went wrong.
**Fix plan:** In the Ask composer submit handler, don't clear the input until a successful send (or restore the text on error). Locate `ask-composer-input` / its surrounding component; preserve `value` on the error branch. Add a test: failing submit keeps the input text.

## BUG-003 — Misleading "couldn't reach your AI provider" copy  ·  Severity: Minor  ·  ⚪ needs-desktop-confirm
**Found:** browser sweep. The RAG-based Search shows "I couldn't reach your AI provider. Try again, or check your key in Settings." when (in the browser) the real cause is the **semantic index being desktop-only** — pointing the user at their AI key when the key is fine.
**Impact:** sends users debugging the wrong thing.
**Fix plan:** Distinguish *retrieval/index unavailable* from *provider unreachable* in the Search error handling and show a contextual message. **First confirm on desktop** — this specific message may not fire where the index exists; if it's browser-only it may be lower priority, but the error taxonomy is still worth tightening.

## BUG-004 — Default AI provider = Anthropic regardless of configured keys  ·  Severity: ⚪ needs-desktop-confirm (potentially Important)
**Found:** browser sweep (clean slate). With **no keys**, and after adding **only** an OpenAI key, the global default still resolves to Anthropic. Search followed the key, but the global default did not. Need to confirm on the desktop whether a user who connects only OpenAI can be left routed to Anthropic anywhere (which would make AI silently fail for them).
**Impact:** if real, a new user who adds their (non-Anthropic) key could hit "couldn't reach your AI provider" despite a valid key — an onboarding blocker.
**Fix plan:** The default-provider selector should prefer a provider the user has a *valid/verified* key for (most-recently-added or verified), not a hardcoded Anthropic default. Confirm scope on desktop first; likely the same root as BUG-001.

## BUG-005 — Nightly bench runner WIPES the interactive Windows/Mac dev state  ·  Severity: Important (infra)  ·  🟡 fix planned
**Found:** while building the desktop-driving bridge — the Legion's `node_modules`, `dist/`, and `target\debug\keepance.exe` were gone. Cause: `scripts/nightly-bench-tests.sh` does `Remove-Item -Recurse -Force C:\keepance` then re-extracts only source (excludes node_modules/target/dist) before `cargo test`. It ran at 03:30 UTC and blew away the interactive dev build, forcing a ~20-min cold rebuild before the bench could be driven again.
**Impact:** the same machines we want as always-on *interactive driving* benches get reset every night, so the desktop-driving bridge breaks daily. (Self-inflicted — introduced with the nightly-bench script earlier today.)
**Fix plan:** sync the nightly cargo-test source to a **separate dir** (e.g. `C:\keepance-bench` / `~/keepance-bench`) instead of wiping the interactive `C:\keepance`; OR overlay-sync without a full wipe and preserve `node_modules`/`target`. Update `scripts/nightly-bench-tests.sh` (Windows + Mac paths) + the test-bench ops guide. Until fixed, the bench needs a rebuild after each nightly.

## BUG-007 — Connected Outlook shows "No email synced yet" (no auto-import)  ·  Severity: ⚠️ needs-confirm (potentially Important)  ·  🔴 open
**Found:** desktop sweep. Email tab banner reads "**Your email is connected**" (the Outlook OAuth connection persisted in the OS keychain across the rebuild ✅), but the list says "**No emails found — No email has been synced yet.**" So a connected account isn't importing mail (at least in a fresh app session / new workspace).
**Impact:** if connecting Outlook doesn't reliably trigger/restore the import, the user sees "connected" but an empty inbox — looks broken.
**Fix plan:** confirm intended behavior — does connect auto-trigger `mail_sync_all` (the v3.3.4 fix added this for M365), and is mail global vs per-workspace? Then ensure: (a) a connected account auto-syncs on app open if stale, and/or (b) a visible "Sync now" affordance in the Email tab. Reproduce by connecting + watching whether `mail_sync_all` fires. (Note: the earlier real-Outlook import was validated server-side; this is about the desktop connect→sync trigger.)

## CAP-001 — Native OS dialogs can't be driven via the CDP bridge  ·  Severity: Capability gap (test infra)  ·  🟡 fix planned
**Found:** building/using the desktop-driving bridge. CDP drives the WebView2 DOM (click/type/snapshot/screenshot all work on the real desktop app), but **native OS dialogs are outside the webview** — e.g. the workspace **folder picker** ("New Workspace" / "Open Existing"), file save/open pickers, and OS auth prompts. Clicking "New Workspace" opens a native picker the bridge cannot interact with, blocking fully-autonomous setup of a real workspace.
**Impact:** the full desktop sweep can't reach a real indexed workspace (needed for RAG/headline tests) without either (a) Jameson clicking the native picker once, or (b) a bypass.
**Fix plan:** add a small **dev/test hook** so a workspace can be set WITHOUT the native picker — e.g. a `?devWorkspacePath=<abs path>` URL param (gated to dev/testMode) or a Tauri test command that sets/creates the workspace at a given path, so the bridge can drive end-to-end hands-off. (Alternative: drive native dialogs via Windows UI Automation — a separate, heavier integration.) Until then: Jameson does the one folder-pick (a "native moment", like a login), Claude drives everything else.

---

## To verify on the desktop (driving bridge BUILT + working) — may surface more bugs
- Headline "answers-you-back with citations" end-to-end (real cited answer).
- Outlook import actually pulling mail + excluding Deleted Items/Junk.
- BUG-001/003/004 reproduction in the real keychain/provider/RAG environment.
