# L2 real-app test run — findings (2026-06-18)

First run of the Layer-2 desktop suite (`tests/desktop/`) against the **real Tauri app** headless
on Linux. The suite did its job: it surfaced real bugs in the high-risk areas, and it cleanly
separated genuine product issues from "needs a test backend" blocks. None of these would have
shown up in the browser (L1) or in unit tests; most would only have surfaced after a signed build
or in a user's hands.

## Official board (12 specs, real app, sequential)

**5 PASS · 6 BLOCKED · 1 FAIL**

- **PASS:** `00-workspace-shell.smoke`, `10-files-editor`, `13-workflows`, `14-matters`, `19-global-shell`
- **BLOCKED (honest, each names its enabler):** `11-trash-destructive` (real bug #1), `12-vault`
  (vault enable-flow not reachably mounted), `15-onboarding` (native folder picker), `16-settings-keys`
  (keychain wiring, finding #2), `17-email-connections` (live OAuth, L3), `20-firm-lifecycle` (local firm backend)
- **FAIL:** `18-rag-cited-ask` — spec-flow/selector issue opening the chat UI (NOT a missed product
  bug; keychain + RAG index now work on this box). Being finished by a follow-up Codex pass.

Severity: 🔴 data-integrity/security · 🟠 broken-feature/trust · 🟡 minor/UX.
Confidence: **confirmed** (a spec blocks/asserts on it, or verified in source) vs **observed**
(seen by a Codex agent mid-iteration, not yet pinned by a dedicated assertion).

## Product bugs found

| # | Sev | Confidence | Finding | Evidence | Where |
|--:|:--:|---|---|---|---|
| 1 | 🔴 | confirmed | **Trash restore-collision is broken.** Restoring a file whose name already exists does NOT create the `collision_restored_*` copy; the trashed payload stays and the trash metadata still lists the entry, so the restore silently does nothing. Data-integrity. (Confirms the inventory's TR-04 high-risk-untested story.) | `11-trash-destructive.mjs` blocks honestly on this exact step | TrashService restore path |
| 2 | 🟠 | confirmed | **Desktop API keys are stored in localStorage as base64, not the OS keychain.** The frontend `KeychainService` only has `localStorage`/`memory`/`env` backends and does `btoa(key)` into `localStorage` (`apiKey_<provider>`), with no Tauri OS-keychain path — even though CLAUDE.md says "API Key Storage: OS Keychain primary" and the product's trust story implies it. (The Rust OS keychain *is* used for vault/mail/audit secrets — just not the BYOK API keys from the wizard.) base64 ≠ encryption: anyone with disk access reads the keys. | verified in source | `src/platform/providers/KeychainService.ts:48` |
| 3 | 🟠 | observed | **Escape on the Matter Manager dumps you back to the workspace selector** instead of leaving the shell in place. Feels like losing your place/work. | seen during `14`/`19` iteration | Matter Manager dialog Escape handler |
| 4 | 🟠 | observed | **Opening a saved `.workflow` record from the Documents grid doesn't mount the workflow execution view** — the app appears to fall back to the workspace selector. | seen during `13` iteration | workflow record open path |
| 5 | 🟡 | observed | **Root-level "New folder" fails** when no folder context is active (works inside an existing folder). | seen during `10` iteration | Documents toolbar New folder |
| 6 | 🟡 | observed | **Renaming a file via the tree menu doesn't update an already-open tab's label.** | seen during `10` iteration | tab label / rename sync |
| 7 | 🟡 | observed | **Ctrl+Shift+A from the Documents browser** creates/focuses an AI Assistant tab in state but doesn't mount the AI UI until an editor surface is active. | seen during `14` iteration | AI assistant shortcut |

## Retracted

- ~~Linux keychain "locked collection" = product bug (no encrypted-file fallback).~~ **Not a bug.**
  Codex investigated and proved it was **test-harness contamination**: earlier manual runs left
  orphaned `tauri-driver`/`WebKitWebDriver` processes on ports 4514/4515, and the old cleanup only
  killed the `xvfb-run` wrapper, so later runs attached to the stale driver with no dbus session.
  Fixed in `run.sh` (port preflight + `setsid` process-group cleanup). The keychain works through
  the real app.

## Honest BLOCKs (not bugs — need a local test enabler)

These specs drive the real journey as far as it goes, then stop at a dependency we haven't stood
up locally. Each is a clear next investment to widen coverage.

| Spec | Needs |
|---|---|
| `12-vault` | Vault enable/unlock UI selectors finalized (its enable-flow may not be mounted in the running surface — verify reachability); keychain itself now works. |
| `15-onboarding` | A headless way past the **native Tauri folder picker** after onboarding (or accept this as desktop-only-manual). |
| `16-settings-keys` | OS-keychain relaunch persistence — tied to finding #2; UI parts (invalid-key flagged, manager list/check/remove) already pass. |
| `17-email-connections` | Live provider OAuth (L3) — covered by the `gmail_live_import` / `outlook_live_import` harnesses. UI panels + compose pass. |
| `18-rag-cited-ask` | The `intfloat/multilingual-e5-small` embedding model (via `model_ensure`) + an AI answer provider (a seeded key or local Ollama chat model). |
| `20-firm-lifecycle` | A local firm backend: `./scripts/run-firm-backend-local.sh` so `/org/claim`, `/auth/login`, `/org/activate`, `/seat/validate` etc. are reachable. Two-instance co-editing/ethical-wall coverage also needs a second driver port in the harness. |

## Harness reliability note — FIXED (2026-06-18)

**The per-spec cleanup leak is fixed in `run.sh`; full clean boards now run honestly without
batching.** A re-verified full 12-spec board on `keepance-3.0` came back **6 PASS · 2 FAIL ·
4 BLOCKED**, every spec (including the later 16–20 that used to cascade) booting the real app
cleanly, and a post-run scan showed zero leaked harness processes. The two FAILs are honest,
non-product issues — `10-files-editor` (row-menu spec selector) and `18-rag-cited-ask` (needs the
e5-small embedding model + an answer provider) — not the old false `welcome-dialog-pitch` wave.

What was wrong and what changed:

- **The leak:** the old cleanup killed the `tauri-driver` process group but left two escapees
  behind — the **app binary** (WebKitWebDriver launches it in its OWN session, so the group kill
  misses it) and its **Xvfb display** (`xvfb-run` double-forks Xvfb and, when SIGKILLed, never runs
  its own teardown). On a dirty start these piled up and, from ~spec 14 on, a new app couldn't
  render within the timeout, producing a wave of false `welcome-dialog-pitch not found` failures
  (a dirty-start board once showed 1 PASS / 10 FAIL).
- **The fix (`run.sh`):** (1) each spec now records the Xvfb display it lands on and cleanup kills
  *that exact* X server; (2) cleanup also reaps any process whose environment still carries the
  spec's unique `/tmp/keepance-l2.*` temp root (catches the escaped app); (3) a startup
  `sweep_stale_l2` reaps leftovers from a previously-killed run before a board begins. All matching
  is scoped so it can never touch other services — the app/driver match is on the unique per-run
  temp path, and the only Xvfb ever killed is this harness's `1366x900x24` server (other services
  on the box run `1280x1024` and are left alone; verified intact after every run).

Independent of the leak, a **stale long-running Vite dev server** can produce the *same*
`welcome-dialog-pitch not found` symptom: if Vite was ever started inside a now-deleted worktree
(e.g. a Codex `.worktrees/<x>` agent), its in-memory module graph keeps a dead path and throws a
full-screen HMR overlay (`ENOENT … /.worktrees/<x>/public/favicon.svg`) that hides the app. The
HTTP response still returns 200 with the right `<title>`, so `run.sh` "reuses" it. **If every spec
fails at the welcome screen on a clean start, restart Vite from the repo root before debugging the
app** (`kill` the `:5173` process, then `npm run dev`).

## Fix status (2026-06-18, second half of session)

Closing the loop: 7 of the 8 confirmed bugs are fixed in code (merged to `keepance-3.0`),
typecheck clean, **full unit suite 3303 passing**. Fixes were authored by 5 parallel Codex
worktree agents and integrated on main.

| # | Fix | Status |
|--:|---|---|
| 1 | Trash restore-collision | **FIXED + DESKTOP-VERIFIED** (`11-trash-destructive` PASS on the real app). Root cause: collision path built with a leading slash → WorkspaceService rejected it → restore bailed before cleanup. Merged + regression unit test. |
| 2 | Desktop API keys → OS keychain | **FIXED + DESKTOP-VERIFIED** (`16-settings-keys` PASS on the real app: keys persist via the OS keychain across relaunch, not in localStorage). Added a Tauri keychain backend; browser keeps localStorage. ⚠️ Follow-up: no migration for keys existing desktop users already saved in localStorage. |
| 3 | Matter Manager Escape | **FIXED + DESKTOP-VERIFIED** (`14-matters` PASS). |
| 4 | Open `.workflow` record | **FIXED + DESKTOP-VERIFIED** (`13-workflows` PASS). |
| 5 | Root "New folder" | **FIXED + DESKTOP-VERIFIED** (`10-files-editor` PASS, 3/3 stable). Merged + unit test. |
| 6 | Rename updates open tab | **FIXED + DESKTOP-VERIFIED** (`10-files-editor` PASS, 3/3 stable). Merged + unit test. |
| 7 | Ctrl+Shift+A from Documents | **FIXED** (merged + unit test; DocumentsHome no longer filters out the AI-assistant tab). |
| — | Vault enable flow unreachable (built, never mounted) | **FIXED + DESKTOP-VERIFIED** (`12-vault` PASS, 3/3 stable). Mounted the orphaned `VaultEnableFlow` via a new `VaultControlCard` in the Privacy Center: "Enable vault" (→ flow dialog) when off, "Turn off vault and decrypt files" (→ `VaultEscapeHatchDialog`) when unlocked; added open/enable/ceremony/progress/done testids. UI-only, no crypto changes. |

**Desktop-verified now:** trash (#1), keychain (#2), matter-escape (#3), workflow-open (#4),
new-folder (#5), rename-tab (#6) — specs `10`/`11` selectors fixed, both green end-to-end.
**Fixed + unit-verified (no dedicated desktop assertion):** shortcut (#7).
**Vault enable flow:** mounted + desktop-verified (`12-vault` PASS).
**Remaining:** the coverage enablers below (firm backend for `20`, embedding model + provider for
`18-rag`, native folder picker for `15`).

Also fixed a latent harness flake while doing the above: the feature tour is gated by the Zustand
settings store (`featuresTourCompleted`, persisted under `keepance:settings`), not the legacy
`keepance_feature_tour_*` keys `seedReadyState` was setting — so it could mount after the shell
loaded and intercept the first nav click. `seedReadyState` now seeds the real store flag.

## Suggested fix order

1. **#1 Trash restore-collision** (🔴 data-integrity, well-scoped) — fix + let `11-trash` go green.
2. **#2 API-key OS-keychain** (🟠 trust/security) — wire the wizard/manager to the Tauri
   `keychain_*` commands on desktop; let `16-settings` persistence go green.
3. **#3 / #4** (🟠 navigation/UX) — Matter Manager Escape + workflow-record open.
4. **#5–#7** (🟡) — batch with the next files/editor pass.
5. Stand up the local **firm backend** + **embedding model** to un-block `20-firm` and `18-rag`.

## Round 3 — Codex-reviewed hardening + coverage (2026-06-18, later)

After mounting the vault UI, an independent Codex review of the session diff surfaced a real
**data-loss bug** (now fixed) and the API-key migration follow-up was implemented and merged.

- **🔴 Vault re-create data-loss (FIXED).** `vault_create` wrote new metadata + a fresh master key
  *unconditionally*, so enabling a vault on an already-vaulted workspace would overwrite the key and
  permanently orphan files encrypted under the old one. `VaultControlCard` could briefly reach it
  (the first render offered "Enable vault" before `vaultStatus` resolved). Fix: the card never offers
  "Enable vault" until status is known and the workspace is confirmed unvaulted (drops stale async
  responses); `vault_create` now refuses with `AlreadyEnabled` when metadata exists (defense-in-depth,
  +cargo test); `12-vault` asserts an enabled vault never shows the enable trigger.
- **#2 follow-up — legacy API-key migration (DONE, merged).** A one-time, desktop-only migration moves
  pre-existing `apiKey_<provider>` localStorage keys into the OS keychain (write → read-back verify →
  remove; sentinel set only on a fully clean run so failures retry). Codex-implemented in a worktree,
  reviewed + merged; 3 unit tests.
- **Full unit suite reconciled:** running the *whole* vitest suite (not just typecheck + L2) caught 7
  failures the narrower checks missed — the i18n key-count/inventory lock (the 4 new `vault.control`
  keys), the `privacy->firm` architecture edge (now allowlisted), and `first-run-mount`'s
  `KeychainService` mock (needed the new migration export). All fixed. **Suite: 3306 passed / 3 skipped
  / 0 failed.**

### Final L2 board: 8 PASS · 1 FAIL · 3 BLOCKED

Against a debug binary rebuilt to current source (the honest artifact). Every high-risk journey this
campaign targeted is green; the remaining 1 FAIL + 3 BLOCKED are infra gaps, not product bugs.

- **PASS (8):** `00`, `10`, `11`, `12-vault`, `13-workflows`, `14`, `16`, `19`. Zero process leak after
  the run; the three other-service 1280x1024 Xvfb stayed up.
- **`11-trash` — FIXED (now 4/4 stable).** Was flaky with *varying* errors ("Trash button not found",
  "stale element reference") — spec races, not a product bug. Hardened like `10`: the row-menu and
  trash-action helpers now retry (were single-shot `execute`s); `activateFilesView`/`activateTrashView`
  use a settle-window + new `docs-files-toggle`/`docs-trash-toggle` testids to beat the editor-takeover
  race and stale-element clicks; and the restore assertions wait for the metadata.json update (a
  separate write from the payload move) instead of checking it immediately.
- **`13-workflows` — FIXED.** It blocked on "no AI provider configured" with Ollama up. Root cause was
  a regression introduced THIS session: the tour-suppression seed made `seedReadyState` *overwrite*
  `keepance:settings`, wiping the `templateModelOverrides` (Ollama pin) the spec seeds just before.
  `seedReadyState` now MERGES, preserving spec-seeded settings. Now PASS (runs the real Ollama
  llama3.2:3b workflow, ~48s). The "stale binary" theory was a red herring.
- **BLOCKED (honest infra):** `15` (native folder picker — desktop-only-manual, can't be driven by
  WebDriver), `17` (live OAuth — needs real creds + the L3 `*_live_import` harnesses).
- **`20-firm` — backend path PROVEN, spec needs a flow rewrite (no 2nd port after all).** Starting
  `./scripts/run-firm-backend-local.sh` (:5290) un-blocks it: the Vite `/api/firm` proxy forwards to the
  backend by default (verified), and the **org-claim UI succeeds** — the app signs in as firm admin and
  shows the onboarding firm console. The spec times out only because its post-claim assertions
  (`firm-email-display`, then the seat-activation selectors) target the *Account-window* FirmSignIn
  component, but the post-claim surface here is the **onboarding "Your firm" console** (firm-name field
  + Matters/Seats/SSO), a different layout. The run() is single-instance (claim → seat → onboarding →
  reopen → hydrate), so the earlier "needs a 2nd driver port" note was wrong.
  **Follow-up — the exact rewrite map** (verified by partial-rewriting + running it through each step;
  reverted to keep the spec clean):
  1. **Claim success indicator** = `firm-admin-content` testid (the onboarding "You are signed in as a
     firm admin" console), NOT `firm-email-display`. Wait for `firm-admin-content || firm-claim-error`.
  2. **Org-name check**: the claimed org name appears as a *placeholder* in the `firm-branding-name`
     input, not as page text — don't assert it via `waitForBodyText`. `firm-admin-content` is enough.
  3. **Re-open after onboarding**: `openSeededRecentWorkspace` looks for the workspace by the seeded
     `WORKSPACE_NAME` (`firm-lifecycle-<id>`), but after onboarding the recent entry shows under the
     real temp-dir name **`workspace`** (the `KP_WORKSPACE` basename) — match that (or click the only
     recent row) instead.
  4. **Seat activation is a different screen**: `firm-license-key`/`firm-machine-label`/
     `firm-activate-submit`/`firm-seat-status`/`firm-seat-id` live in the **Account-window Firm tab**
     (`FirmSignIn.tsx`), not onboarding. So reorder run() to: claim → `finishOnboardingAndOpenWorkspace`
     → `openAccountFirmTab` → `activateSeatThroughUi` → `assertFirmHydrated`.
  5. Not yet reached/verified beyond step 3: the Account-tab seat-activation + hydration steps may need
     their own selector touch-ups. Start `run-firm-backend-local.sh` first; the feature itself works.
- **`18-rag` FAIL** is the one deep item: its `model_ensure` downloads the 470MB e5-small model into
  each isolated profile's app-data (a host prefetch into `resources/embeddings/` doesn't satisfy the
  per-profile path), and the cited-ask chat-viewer flow needs the model ready first. A real harness
  investment (cache the model per profile + verify the ask flow), not a product bug. **Follow-up.**
