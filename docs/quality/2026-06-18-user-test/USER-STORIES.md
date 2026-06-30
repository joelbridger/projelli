# Advisor Prep Hero — User Stories & Actions Catalog

**Purpose.** A complete, exhaustive inventory of *everything a user can do* in Advisor Prep Hero, so we
can test it in the real software instead of discovering bugs only after a slow signed build.
This is the index; the per-domain detail lives in `inventory/` (one file per domain, every row
in the shared [SCHEMA](./SCHEMA.md): story, steps, surface + `data-testid`, precondition,
expected result, **test layer**, risk, and existing coverage).

Built 2026-06-18 by fanning out parallel agents over the whole codebase: 4 Claude inventory
agents + **5 concurrent Codex (gpt-5.5) sessions** (an independent IPC boundary map, the firm
lifecycle deep-dive, and three domain inventories) + a headless real-app harness prover.

## Totals

**~540 user stories across 9 domains**, plus an **82-command IPC boundary map**.

| Domain | Stories | File | Notes |
|---|--:|---|---|
| Onboarding + workspace selection | ~74 | [onboarding-workspace.md](./inventory/onboarding-workspace.md) | First-run, "how do you practice?", AI setup, tour, setup checklist |
| Files + document editor + trash/versions | ~83 | [files-editor.md](./inventory/files-editor.md) | .docx OOXML, .md/.txt, tabs, autosave, version history, trash |
| AI chat (Ask) + search + palette + shortcuts | ~56 | [chat-search.md](./inventory/chat-search.md) | Provider/model picker, streaming, citations, 4 retrieval scopes, RAG |
| Email | ~78 | [email.md](./inventory/email.md) | Connect/import, list/search/filters, compose, matter mapping, privilege |
| Workflows + matters | ~40 | [workflows-matters.md](./inventory/workflows-matters.md) | Templates, interview forms, run/export .docx/.pptx, matter create/switch |
| Firm / multi-user | 16 | [firm-lifecycle.md](./inventory/firm-lifecycle.md) | Org claim, seat, SSO, invite/join, shared matters, co-edit, ethical walls, vault |
| Privacy + settings + keys + account | ~104 | [privacy-settings-keys.md](./inventory/privacy-settings-keys.md) | Confidentiality spectrum, egress, data map, audit, key wizard/manager, Ollama |
| Global app-shell sweep | ~91 | [global-sweep.md](./inventory/global-sweep.md) | Shell, nav, status/trust bar, dictation/TTS, media, toasts, multi-window |
| IPC boundary map (reference) | 82 cmds | [ipc-boundary-map.md](./inventory/ipc-boundary-map.md) | Every `#[tauri::command]`, browser-OK vs desktop-only, top-10 risk journeys |

## Personas

- **Solo** — a lawyer running Advisor Prep Hero on one machine, BYOK. Most stories.
- **Firm-admin** — creates/claims the org, manages seats, invites, ethical walls, SSO config.
- **Firm-member** — joins via invite/SSO, works in shared matters, co-edits.
- **any** — applies regardless of tier (shell, settings, files).

## Test-layer distribution (where each story can be exercised)

| Layer | What it means | Share |
|---|---|---|
| **L1 browser-dev** | Runs in the Vite dev server (Playwright). Most UI, AI chat via proxy, file/md create+edit. | ~70% |
| **L2 real-desktop (local Linux)** | Needs the real Rust backend: keychain, encrypted mail store, RAG, .docx engine, multi-window, real persistence, firm. **Now runnable headless here** (see the test plan). | ~25% |
| **L3 live-service** | Real provider OAuth + import (Gmail/Outlook) and a disposable firm relay/backend. | ~4% |
| **L4 windows-only-manual** | Only a signed platform build shows it: installer/uninstaller branding, OS console flash, auto-updater, code-sign/notarize, OS-keychain specifics. | ~1% |

The headline: **~95% of all stories can be tested locally without a signed build** (L1 + L2 +
the existing L3 live harnesses). Only a tiny reserved L4 set truly needs the build — and those
are exactly the cheap visual/OS checks, not logic.

## Cross-cutting risk register — the highest-risk, desktop-only, currently-untested journeys

These are the ones that have bitten us (or would), cluster in the firm/data-safety areas you
named, and have **no automated integrated coverage** today. Ranked. (Full detail + the proposed
real-app test for each is in the linked inventory files and the boundary map's top-10.)

| # | Journey | Risk | Layer | Why it matters |
|--:|---|---|---|---|
| 1 | Create/claim a firm → sign in → activate a seat → quit/reopen → session hydrates from keychain | H | L2/L3 | Auth + paid-tier access + token persistence; the "create a firm then log into it" you called out |
| 2 | Firm SSO (OIDC) login through the system browser/loopback | H | L2/L3 | Brittle, platform-specific; blocks enterprise login |
| 3 | Ethical wall: admin walls a member; stale matter key purged from keychain; UI fails closed | H | L2/L3 | The most severe legal/privacy failure if wrong |
| 4 | Shared matter notes co-editing across **two real app instances** | H | L2/L3 | Core firm promise: relay + E2EE + presence + convergence |
| 5 | Live **.docx** co-editing (tracked changes + comments) across two instances | H | L2/L3 | Highest data-loss/fidelity risk: OOXML + CRDT + relay + autosave |
| 6 | Encrypted vault: enable → migrate files → quit/reopen locked/unlocked → recover with phrase → disable | H | L2 | Data-loss/recoverability; touches every file read/write |
| 7 | Real mail connect → sync → **Email tab shows imported mail** → open body → attachment → send/reply | H | L2/L3 | OAuth + SQLCipher store + the multi-window refresh bug that already bit us |
| 8 | Semantic RAG: first-run model download → index workspace → cited Ask answer → citation click-through opens source | H | L2 | Core product promise; silent empty/wrong answers if the index breaks |
| 9 | Privilege + matter scoping in real retrieval (privileged excluded by default; no cross-matter leak) | H | L2 | Confidentiality + legal-ethics boundary |
| 10 | Trash destructive ops: empty trash, restore-collision rename, permanent delete | H | L2 | Irreversible deletion, zero integrated coverage |
| 11 | Marketplace install of a template package (checksum + tar extract + audit) | M | L2 | Supply-chain/install path safety |
| 12 | Onboarding email OAuth + "create a firm during onboarding" | H | L2/L3 | First-run paths a new user hits immediately |
| 13 | Multi-window refresh (connectors/account windows back to the main window) | M | L2 | Source of the "imported but not showing" class of bug |

## How to use this catalog

- **To test a feature:** open its domain file, find the story, follow `Steps`, assert `Expected`,
  run it at its `Layer`. The `data-testid`s are real and current.
- **Before any release candidate:** walk the risk register top-to-bottom at L2/L3, then sweep L1.
- **The execution strategy** (how to actually run L2 against the real app headless, in what order,
  and how it breaks the build/fix loop) is in [TEST-PLAN.md](./TEST-PLAN.md).
