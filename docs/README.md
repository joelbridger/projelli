# Advisor Prep Hero Documentation Index

This is the docs index. The repo **root** holds only the highest-level files
(`README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `KEEPANCE_BUSINESS_PLAN.md`,
`BACKLOG.md`, `CHANGELOG.md`); everything else lives here under `docs/`, organized
by purpose.

## Start here (read these first)

| If you want to… | Read |
|---|---|
| **Find the current code** (which folder/branch is live) | [`operations/REPO-MAP-CURRENT.md`](operations/REPO-MAP-CURRENT.md) — the live branch is `keepance-3.0` |
| **Understand the code structure** | repo-root [`ARCHITECTURE.md`](../ARCHITECTURE.md) — the authoritative 5-layer feature-first map |
| **Know what Advisor Prep Hero is, who it's for, the plan** | repo-root [`KEEPANCE_BUSINESS_PLAN.md`](../KEEPANCE_BUSINESS_PLAN.md) (operating contract) |
| **See the big-picture business state** | the **board dashboard** at board.jameworld.com (data in [`board/board-data.json`](board/board-data.json)) |
| **Get the honest current snapshot** | the latest [`operations/2026-06-24-advisor-website-board-CURRENT-STATE.md`](operations/2026-06-24-advisor-website-board-CURRENT-STATE.md) |
| **Know the current positioning** | financial advisors first (see [`strategy/2026-06-29-board-decision-leading-advisor-ai.md`](strategy/2026-06-29-board-decision-leading-advisor-ai.md)); law/tax/consulting are secondary |
| **Follow the plain-language story of the product** | repo-root-linked [`PRODUCT-JOURNEY.md`](PRODUCT-JOURNEY.md) |

## Folder map

```
docs/
├── reference/      Architectural & product reference that doesn't change often (features, connectors, RAG, Rust, security)
├── operations/     Runbooks, current-state snapshots, the repo map, session handoffs — read these to DO things
├── strategy/       Strategy, positioning, competitive analysis, financial model, the advisor re-aim + board decisions
├── quality/        Testing, definition of done, the bug backlog, manual test checklists
├── qa/             The parallel-QA control board (QA_BOARD.md) + Windows test coverage
├── marketing/      ALL marketing work (playbook, channels, action-packs, campaigns) — see its own README
├── design/         UI/design-system docs, prototypes (onboarding, the 2026-06 UI reimagining)
├── research/       User-research and external deep-research reports (UX studies, testing assessments)
├── features/       Product RELEASE plans only (V1.5/V1.6/V2.0 release notes)
├── trust/          Trust & security posture (security overview, SOC 2 readiness/gap mapping)
├── legal/          Legal templates (e.g. DPA template)
├── partnerships/   Connector/partner programs (e.g. iManage)
├── board/          The board dashboard (data + deploy) — served privately at board.jameworld.com
├── superpowers/    Implementation plans, specs, and spikes (the build-session working docs)
├── personal-development/  Founder reading/learning library (getting customers, the advisor world, startup craft)
└── archive/        Historical documents superseded by current state — kept for reference
```

## Reference (the "what" and "why") — `reference/`

| File | What it covers |
|---|---|
| [FEATURES.md](reference/FEATURES.md) | Canonical "what can Advisor Prep Hero do" reference, code-grounded. Read first for current capabilities. |
| [CONNECTORS.md](reference/CONNECTORS.md) | Data connectors (email/CRM/OneDrive/Calendly/DocuSign): connect→sync→index, matter mapping, per-connector status. |
| [RAG_PIPELINE.md](reference/RAG_PIPELINE.md) | The local search engine end-to-end: ingest → chunk → embed → LanceDB → retrieve → cited answer. |
| [RUST_BACKEND.md](reference/RUST_BACKEND.md) | The Rust/Tauri backend: command layer + the `keepance-vault` / `keepance-docx` crates + encrypted stores. |
| [SECURITY.md](reference/SECURITY.md) | Security model, threat model, and constraints. |
| [VISION.md](reference/VISION.md) | Product vision (audience note: now advisor-first; see the banner at the top of the file). |
| [PROJECT_VISION_ORIGINAL.md](reference/PROJECT_VISION_ORIGINAL.md) | Original founding vision — preserved for context. |
| [COMPETITIVE_LANDSCAPE.md](reference/COMPETITIVE_LANDSCAPE.md) | How Advisor Prep Hero compares to other tools (audience note: now advisor-first; Jump is the key competitor). |
| [TRADEMARK_SEARCH.md](reference/TRADEMARK_SEARCH.md) | Name/trademark search notes. |
| [TAURI_COMMANDS.md](reference/TAURI_COMMANDS.md) | The Tauri command surface reference. |
| [DECISIONS.md](reference/DECISIONS.md) | The early architecture-decision log (ADRs). Historical-by-design; titled from the "Business OS" era. |

> **Architecture lives at the repo root, not here.** The authoritative `src/` map is
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md). The old `reference/ARCHITECTURE.md`,
> `reference/PRD.md`, and `reference/IMPLEMENTATION.md` were pre-v3 "Business OS"
> docs and have been archived (see `archive/pre-3.0-pivots/business-os-reference/`).

## Operations (the "how") — `operations/`

| File | What it covers |
|---|---|
| [REPO-MAP-CURRENT.md](operations/REPO-MAP-CURRENT.md) | **Where the current code is, how to start new work, the active-worktree list, the cleanup record. Read first if unsure which folder is current.** |
| [2026-06-24-advisor-website-board-CURRENT-STATE.md](operations/2026-06-24-advisor-website-board-CURRENT-STATE.md) | **The latest current-state snapshot** (supersedes the 2026-06-13/18/19 ones). |
| [DEVELOPER_ONBOARDING.md](operations/DEVELOPER_ONBOARDING.md) | New-developer runbook: clone → install → run dev → tests → the gate → PR/CI. |
| [DEVELOPMENT_WORKFLOW.md](operations/DEVELOPMENT_WORKFLOW.md) | Older day-to-day dev/release workflow (v1.0-era; superseded for the dev loop by DEVELOPER_ONBOARDING.md). |
| `BOARD_ACTION_ITEMS.md` | Engineering/financial/identity work that needs Jameson's hands (Azure signing, Apple Developer, LemonSqueezy, etc.). |
| `*-CURRENT-STATE.md`, `*-NEXT-SESSION-*.md` | Dated state snapshots and session handoffs — older ones are archived in `archive/session-handoffs/`; trust the 2026-06-24 snapshot above. |

## Quality & QA — `quality/` + `qa/`

**➡️ Start here: [quality/README.md](quality/README.md) — the testing index** (the test pyramid, every testing doc, the live trackers, how to run each layer).

| File | What it covers |
|---|---|
| [quality/README.md](quality/README.md) | The testing index — current state, the pyramid, how to run, what's left. |
| [qa/QA_BOARD.md](qa/QA_BOARD.md) | The control doc for accelerated, parallel QA (isolated worktree agents + Codex on scoped tickets). |
| [quality/2026-06-20-test-bug-backlog.md](quality/2026-06-20-test-bug-backlog.md) | The live bug database. |
| [quality/TROUBLESHOOTING_TESTS.md](quality/TROUBLESHOOTING_TESTS.md) | Debugging failing tests (Vitest / Playwright / Rust). |
| [quality/DEFINITION_OF_DONE.md](quality/DEFINITION_OF_DONE.md) | What "done" means before merging. |

## Marketing — `marketing/`

**➡️ Start here: [marketing/README.md](marketing/README.md)** — the canonical entry point for all marketing work (playbook, channels, action-packs, campaigns).

## Strategy — `strategy/`

**Read [`strategy/README.md`](strategy/README.md) first** — it lists the 4 current governing docs and the rest of the directory by recency. The older pre-June 23 strategy work is in `archive/`.

## Archive — `archive/`

Historical documents superseded by current state, kept for reference. Notable sub-areas:

| Location | Why it's archived |
|---|---|
| [archive/strategy-2026-06-17/](archive/strategy-2026-06-17/) | The 2026-06-17 "product is mature, stop building" strategy cluster + superseded May 2026 positioning/pricing/launch-readiness docs — all superseded by the 2026-06-23/29 advisor re-aim and 2026-06-29 board decision. |
| [archive/build-plans/](archive/build-plans/) | Apr–Jun 2026 build-session plans from `superpowers/plans/` that are completed and superseded. |
| [archive/session-handoffs/](archive/session-handoffs/) | SESSION_* handoffs and older *-CURRENT-STATE.md / *-NEXT-SESSION-*.md files — trust the newest `operations/2026-06-24-advisor-website-board-CURRENT-STATE.md` instead. |
| [archive/pre-3.0-pivots/business-os-reference/](archive/pre-3.0-pivots/business-os-reference/) | Pre-v3 "Business OS" reference docs (PRD, the old ARCHITECTURE, IMPLEMENTATION) — superseded by root `ARCHITECTURE.md` + `reference/FEATURES.md`. |
| [archive/pre-3.0-pivots/](archive/pre-3.0-pivots/) | Earlier market-pivot reports and rebrand guides. |
| `archive/decisions/`, `archive/quality/`, `archive/meta/` | Older ADRs, v1.0-era quality docs, and prior docs indexes. |
| `archive/OLD_BACKLOG_*.md`, `V1_LAUNCH_PLAN.md`, `WINDOWS_MIGRATION_*.md`, … | Done v1 plans and backlogs. |

## Repo root files

- `README.md` — public-facing project intro
- `ARCHITECTURE.md` — the authoritative code-structure map
- `CLAUDE.md` — instructions for Claude Code working in this repo
- `KEEPANCE_BUSINESS_PLAN.md` — the operating contract (read this first for strategy)
- `KEEPANCE_STRATEGIC_ADVISOR_ACTION_PLAN.md` — the advisor re-aim action plan
- `BACKLOG.md` — current week-by-week task list
- `CHANGELOG.md` — release-by-release history
