# Repo Guide — Orient in 60 Seconds

**Advisor Prep Hero** (code-named Keepance internally; the brand config at `brand/brand.config.json` drives display names). The live branch is `keepance-3.0`; canonical checkout is `/home/jameson/keepance` on the Jameworld server.

## Where things are

```
/                           <- you are here
├── README.md               what Advisor Prep Hero is, install, dev setup, pricing
├── ARCHITECTURE.md         THE CODE MAP — read this before searching for anything
├── REPO_GUIDE.md           this file — 60-second orientation
├── CLAUDE.md               instructions for Claude Code sessions in this repo
├── KEEPANCE_BUSINESS_PLAN.md  operating contract: strategy, decisions, roadmap
├── BACKLOG.md              current week-by-week task list
├── CHANGELOG.md            release history (version index at the top)
│
├── src/                    feature-first frontend (5-layer DAG)
│   ├── app/                the shell (App.tsx, routing, global lifecycle)
│   ├── features/           one folder per product surface (ask/, documents/, email/, ...)
│   ├── platform/           cross-cutting services (providers, fs, rag, matter, ...)
│   ├── ui/                 design system (shadcn + kp/ components + brand/)
│   └── lib/                domain-free utilities
│
├── src-tauri/              Rust backend (commands/ + keepance-vault + keepance-docx crates)
├── backend/                firm backend (E2EE relay + SSO) at api.keepance.com
├── brand/                  single source of truth for name/colors/logo (run `npm run brand:sync`)
├── tests/                  Vitest unit/integration/security + Playwright e2e
├── website/                marketing site (keepance.com)
└── docs/                   all project docs — see docs/README.md for the index
```

## Read these first

| Goal | Document |
|---|---|
| Understand the code layout | `ARCHITECTURE.md` — the authoritative `src/` map |
| Know what this product is | `KEEPANCE_BUSINESS_PLAN.md` — strategy and decisions |
| See the big-picture business state | [board.jameworld.com](https://board.jameworld.com) (data: `docs/board/board-data.json`) |
| Understand current direction | [`docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`](docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md) |
| Know what's in progress | `BACKLOG.md` |
| Find the current code location | [`docs/operations/REPO-MAP-CURRENT.md`](docs/operations/REPO-MAP-CURRENT.md) |
| Run tests / verify a change | `npm run gate` (typecheck + i18n + vitest + ESLint + Rust); `npm run gate:full` also runs E2E |

## Active / generated-local / historical

**Active** — read and edit freely:
- `src/`, `src-tauri/`, `backend/`, `brand/`, `tests/`, `website/`
- `docs/strategy/`, `docs/operations/`, `docs/reference/`, `docs/quality/`, `docs/qa/`
- `docs/marketing/` (current campaigns and playbooks)
- Root files: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `BACKLOG.md`, `CHANGELOG.md`

**Generated-local** — do NOT commit these:
- `dist/`, `src-tauri/target/`, `coverage/`, `test-results/`, `playwright-report/`
- `public/ocr/*.wasm`, embedding model cache
- `marketing-demo/`, `advisor-packet/` (generated outputs)

**Historical / archived** — keep for reference, do NOT edit:
- `docs/archive/` — superseded state snapshots, session handoffs, old build plans, and earlier strategy
- `docs/superpowers/plans/` (pre-2026-06-25 build plans archived; later ones still live)
- `docs/archive/strategy-2026-06-17/` — the "product is mature, stop building" cluster (explicitly superseded)

## Locked identifiers — never rename

These load-bearing strings must survive any renaming or rebranding (the brand config handles display names):

- Tauri bundle id: `com.keepance.app`
- Keychain prefixes: `com.keepance.*`
- localStorage keys: `keepance:settings`, `ai-chat-storage`, `keepance:matters`, `keepance:matter-ui-snapshots`, `keepance:matter-at-a-glance`
- Data dir: `.keepance/`
- Internal engine type: `matter` / `matter_id` (user-facing word is "client")
- Wire codes: `personal`, `professional`, `practice` (pricing tier identifiers)

## Quick dev commands

```bash
npm run dev            # Vite browser dev server (fast iteration)
npm run tauri:dev      # Tauri desktop dev mode
npm run gate           # Full pre-merge check (typecheck + i18n + vitest + ESLint + Rust)
npm run brand:sync     # Regenerate brand tokens from brand/brand.config.json
npm run typecheck      # TypeScript only
npm test               # Vitest unit + integration
```
