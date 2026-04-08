# Projelli

> **Local-first AI workspace where every chat becomes a real file.**
> Built for indie founders who want AI as a co-pilot, not a replacement.

[**projelli.com**](https://projelli.com) • [Download](https://github.com/joelbridger/projelli/releases) • [Business plan](./PROJELLI_BUSINESS_PLAN.md)

---

## What is Projelli?

Projelli is a desktop app (Tauri 2 + React 18 + TypeScript) that combines:

- A **Markdown editor** with wiki-links, backlinks, version history, and split panes
- An **integrated AI chat** that produces real, persistent files in your workspace — not throwaway conversations
- **15 founder-focused workflow templates** (New Business Kickoff, Competitor Analysis, Pitch Deck, Investor Update, etc.)
- **Three AI providers** with streaming and per-chat model selection: Claude, OpenAI, Gemini
- **Local-first** — your data stays on your machine, your API keys live in your OS keychain, the app works fully offline (except for actual AI calls)
- **BYOK** (bring your own key) — Projelli never sees your data or your API requests

The pitch in one sentence: it's Obsidian for the AI era, built for founders, sold once.

## Status

- **v1.0.0** is live on GitHub Releases (Windows installer)
- Currently in **Phase 0 reorganization** ahead of an 8-week launch ramp — see [`PROJELLI_BUSINESS_PLAN.md`](./PROJELLI_BUSINESS_PLAN.md) and [`BACKLOG.md`](./BACKLOG.md)
- macOS, code signing, payments, license validation, and the official launch are all coming in Weeks 2-6

## Install (current state)

**Windows:** Download the latest `.exe` from [Releases](https://github.com/joelbridger/projelli/releases). The installer is currently **unsigned** (Windows SmartScreen will warn you "unrecognized app" — click "More info" → "Run anyway"). This will be fixed in Week 2 of the launch ramp once code signing is in place.

**macOS / Linux:** Not yet shipped. Coming in Week 3.

## Development

```bash
# Install dependencies
npm install

# Run in browser dev mode (for fast iteration)
npm run dev

# Run in Tauri desktop dev mode
npm run tauri:dev

# Production build (creates installer in src-tauri/target/release/bundle/)
npm run tauri:build

# Type check
npm run typecheck

# Run tests
npm test          # Vitest unit + integration
npx playwright test  # E2E
```

**Stack:**
- Tauri 2 + Rust backend
- React 18 + TypeScript 5 + Vite 5
- Zustand state management
- shadcn/ui + Tailwind CSS
- CodeMirror 6 for the editor
- @tauri-apps/plugin-fs, plugin-shell, plugin-dialog
- AI providers: Anthropic, OpenAI, Google AI

## Repository layout

```
projelli/
├── README.md                       — this file
├── PROJELLI_BUSINESS_PLAN.md       — operating contract / 8-week launch plan
├── BACKLOG.md                      — week-by-week task list
├── CHANGELOG.md                    — release-by-release history
├── CLAUDE.md                       — instructions for Claude Code working in this repo
├── src/                            — frontend source (React + TypeScript)
├── src-tauri/                      — Rust backend
├── tests/                          — Vitest + Playwright test suites
├── website/                        — marketing site (deploys to projelli.com)
├── infra/
│   └── deploy.sh                   — website deploy script
├── docs/
│   ├── README.md                   — docs index
│   ├── reference/                  — architecture, vision, ADRs
│   ├── operations/                 — runbooks
│   ├── quality/                    — testing docs
│   └── archive/                    — historical / superseded docs
└── .github/workflows/
    └── release.yml                 — Tauri matrix CI for Win/Mac/Linux builds
```

## Architecture (high level)

```
┌─────────────────────────────────────────────────────────┐
│                    React UI Layer                        │
│         shadcn/ui + Tailwind + Zustand                  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Core Modules                            │
│  Workspace │ Editor │ History │ Workflow │ Models │ ... │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌─────────────────┐         ┌──────────────────┐
│  Filesystem     │         │  AI Providers    │
│  (Tauri FS API) │         │  (BYOK, direct)  │
└─────────────────┘         └──────────────────┘
```

For details, see [`docs/reference/ARCHITECTURE.md`](docs/reference/ARCHITECTURE.md).

## Pricing (when launched)

- **Free:** Core editor, 1 AI provider, 3 templates, 1 workspace — forever
- **Pro:** $49 one-time — all 3 AI providers, all 15 templates, unlimited workspaces, 1 year of updates
- **Lifetime:** $99 one-time — same as Pro + updates forever + early access + commercial license
- **Founder's Launch:** $29 one-time lifetime — first 100 buyers only

Sold via [LemonSqueezy](https://lemonsqueezy.com) (merchant of record handles tax and refunds).

## Privacy

Projelli is local-first by design.

- All your files live in a folder on your hard drive that you choose
- API keys are stored in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux)
- AI calls go directly from your machine to your provider (Claude / OpenAI / Google)
- Projelli's servers never see your files, your prompts, or your responses
- The only call Projelli's server gets is a one-time license validation when you activate

Privacy policy: [https://projelli.com/legal/privacy](https://projelli.com/legal/privacy) (live in Week 1)

## Support

- **Email:** `support@projelli.com` (live in Week 1)
- **Issues:** [GitHub Issues](https://github.com/joelbridger/projelli/issues)

## License

Closed-source proprietary software. End-User License Agreement: [https://projelli.com/legal/eula](https://projelli.com/legal/eula) (live in Week 1).

A "Projelli Lite" open-source version may be released later as a marketing funnel — not on the v1 roadmap.

## Built by

[Jameson Daines](https://jamesondaines.com) — Senior Product Designer at Wheel Health, and the operator of [BehaviorUX](https://behaviorux.com), a health-tech UX consulting practice.
