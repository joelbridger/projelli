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

## Harness reliability note (important for reading the board)

The L2 runner's per-spec cleanup is **incomplete**: it kills the `tauri-driver` process group but
leaks the **app process (spawned by WebKitWebDriver in a separate session) and its Xvfb display**.
On a clean start the full 12-spec board completes fine (first board: 5 PASS / 6 BLOCKED / 1 FAIL).
But if the run starts with pre-existing orphans (e.g. after ad-hoc single-spec runs or killed
agents), the leaked apps/Xvfb pile up and, from ~spec 14 on, a new app can't render within the
timeout — producing a wave of false `welcome-dialog-pitch not found` failures (NOT product bugs).
A second, dirty-start full board showed exactly this (1 PASS / 10 FAIL). **Authoritative signal =
small, clean-start batches.** Follow-up: harden cleanup to reap the app + its Xvfb per spec (track
the app PID / pkill by the per-spec temp HOME), or run in batches of <=6. Cleanup of leaked test
processes must match ONLY `1366x900x24` Xvfb (other services run 1280x1024 Xvfb — do not kill those).

## Fix status (2026-06-18, second half of session)

Closing the loop: 7 of the 8 confirmed bugs are fixed in code (merged to `keepance-3.0`),
typecheck clean, **full unit suite 3303 passing**. Fixes were authored by 5 parallel Codex
worktree agents and integrated on main.

| # | Fix | Status |
|--:|---|---|
| 1 | Trash restore-collision | **FIXED** (root cause: collision path built with a leading slash → WorkspaceService rejected it → restore bailed before cleanup). Merged + regression unit test. Desktop spec `11` needs a selector follow-up (Trash lives in the "View files or trash" segmented group) to also confirm end-to-end. |
| 2 | Desktop API keys → OS keychain | **FIXED + DESKTOP-VERIFIED** (`16-settings-keys` PASS on the real app: keys persist via the OS keychain across relaunch, not in localStorage). Added a Tauri keychain backend; browser keeps localStorage. ⚠️ Follow-up: no migration for keys existing desktop users already saved in localStorage. |
| 3 | Matter Manager Escape | **FIXED + DESKTOP-VERIFIED** (`14-matters` PASS). |
| 4 | Open `.workflow` record | **FIXED + DESKTOP-VERIFIED** (`13-workflows` PASS). |
| 5 | Root "New folder" | **FIXED** (merged + unit test). Desktop spec `10` selector follow-up. |
| 6 | Rename updates open tab | **FIXED** (merged + unit test). Desktop spec `10` selector follow-up. |
| 7 | Ctrl+Shift+A from Documents | **FIXED** (merged + unit test; DocumentsHome no longer filters out the AI-assistant tab). |
| — | Vault enable flow unreachable (built, never mounted) | **NOT yet fixed** — the wiring agent hung; deferred. Clear task: mount the existing `VaultEnableFlow` at a reachable entry point (the Data Map dialog already has the copy) + add testids so `12-vault` can drive it. |

**Desktop-verified now:** keychain (#2), matter-escape (#3), workflow-open (#4).
**Fixed + unit-verified, desktop spec selector follow-up:** trash (#1), new-folder (#5), rename-tab (#6), shortcut (#7).
**Remaining:** wire the vault enable UI; the spec-selector polish for `10`/`11`; and the coverage
enablers below (firm backend for `20`, embedding model + provider for `18-rag`, native folder
picker for `15`).

## Suggested fix order

1. **#1 Trash restore-collision** (🔴 data-integrity, well-scoped) — fix + let `11-trash` go green.
2. **#2 API-key OS-keychain** (🟠 trust/security) — wire the wizard/manager to the Tauri
   `keychain_*` commands on desktop; let `16-settings` persistence go green.
3. **#3 / #4** (🟠 navigation/UX) — Matter Manager Escape + workflow-record open.
4. **#5–#7** (🟡) — batch with the next files/editor pass.
5. Stand up the local **firm backend** + **embedding model** to un-block `20-firm` and `18-rag`.
