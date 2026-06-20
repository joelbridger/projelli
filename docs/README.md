# Keepance Documentation Index

This is the docs index. The repo root has only the highest-level files; everything else lives here, organized by purpose.

**Start here if you're new to the project:** read `~/keepance/KEEPANCE_BUSINESS_PLAN.md` (in the repo root) — it's the operating contract that explains what Keepance is, who it's for, how it makes money, and what we're doing for the next 8 weeks.

## Layout

```
docs/
├── reference/      Architectural and product documentation that doesn't change often
├── operations/     Runbooks, how-tos, deploy guides — read these to do things
├── quality/        Testing, definition of done, manual test checklists
└── archive/        Historical documents superseded by current state — kept for reference
```

## Reference (the "what" and "why")

| File | What it covers |
|---|---|
| [FEATURES.md](reference/FEATURES.md) | Canonical feature reference — every capability, file type, shortcut, and setting. Read first for "what can Keepance do". |
| [VISION.md](reference/VISION.md) | Current product vision (founder-focused positioning) |
| [PROJECT_VISION_ORIGINAL.md](reference/PROJECT_VISION_ORIGINAL.md) | Original vision doc — preserved for context |
| [ARCHITECTURE.md](reference/ARCHITECTURE.md) | System architecture, layered design, modules |
| [PRD.md](reference/PRD.md) | Product requirements and user stories |
| [DECISIONS.md](reference/DECISIONS.md) | Architecture Decision Records (ADRs) |
| [IMPLEMENTATION.md](reference/IMPLEMENTATION.md) | Detailed implementation notes |
| [SECURITY.md](reference/SECURITY.md) | Security model, threat model, and constraints |

## Operations (the "how")

| File | What it covers |
|---|---|
| [DEVELOPMENT_WORKFLOW.md](operations/DEVELOPMENT_WORKFLOW.md) | Day-to-day dev workflow, branch strategy, releases |

## Quality (testing + DoD)

**➡️ Start here: [quality/README.md](quality/README.md) — the testing index.** It maps the whole test pyramid, every current testing doc, the live trackers, and how to run each layer. Read it first for anything testing-related.

| File | What it covers |
|---|---|
| [quality/README.md](quality/README.md) | **The testing index — current state, the pyramid, how to run, what's left** |
| [DEFINITION_OF_DONE.md](quality/DEFINITION_OF_DONE.md) | What "done" means before merging (note: pre-3.0 branding, due a refresh) |
| (archived) `archive/quality/PLAYWRIGHT_TESTING.md` | E2E patterns — superseded by `playwright.config.ts` + the full-user-test playbook |
| (archived) `archive/quality/MANUAL_TESTING_CHECKLIST.md` | v1.0-era manual checklist — superseded by the full-user-test playbook + Windows test plan |

## Archive (historical, kept for reference)

| File | Why it's archived |
|---|---|
| [OLD_BACKLOG_2026-02-18.md](archive/OLD_BACKLOG_2026-02-18.md) | Original v1 backlog (all 46 tickets done). Replaced by `~/keepance/BACKLOG.md`. |
| [V1_LAUNCH_PLAN.md](archive/V1_LAUNCH_PLAN.md) | Plan for the original v1.0 launch. Done. |
| [WINDOWS_MIGRATION_PLAN.md](archive/WINDOWS_MIGRATION_PLAN.md) | Plan for migrating from browser to Tauri Windows desktop. Done. |
| [WINDOWS_MIGRATION_COMPLETE.md](archive/WINDOWS_MIGRATION_COMPLETE.md) | Summary of the completed Windows migration. |
| [WINDOWS_DESKTOP_BACKLOG.md](archive/WINDOWS_DESKTOP_BACKLOG.md) | Original Windows-specific backlog. Done. |
| [v1.0.1-ISSUES.md](archive/v1.0.1-ISSUES.md) | Bug list from v1.0.1 testing. Mostly fixed. |
| [WIN-015-prompt-confirm-audit.md](archive/WIN-015-prompt-confirm-audit.md) | Audit of `window.prompt`/`window.confirm` usage during Tauri migration. |

## Repo root files

- `README.md` — public-facing project intro
- `CLAUDE.md` — instructions for Claude Code working in this repo
- `KEEPANCE_BUSINESS_PLAN.md` — the operating contract (read this first)
- `BACKLOG.md` — current week-by-week task list
- `CHANGELOG.md` — release-by-release history
