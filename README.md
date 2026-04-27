# Projelli

> **Local-first AI workspace where every chat becomes a real file.**
> Built for indie founders who want AI as a co-pilot, not a replacement.

[**projelli.com**](https://projelli.com) • [Download](https://github.com/projelli/projelli/releases) • [Press kit](https://projelli.com/press-kit/) • [Blog](https://projelli.com/blog/) • [Business plan](./PROJELLI_BUSINESS_PLAN.md)

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

- **v1.5** is the latest stable release (Windows). v1.6 is in active release-candidate testing with macOS as the new addition.
- Code signing, payments via LemonSqueezy, license validation, auto-updater, and legal docs are all live.
- See [`PROJELLI_BUSINESS_PLAN.md`](./PROJELLI_BUSINESS_PLAN.md) for the full strategy and [`BACKLOG.md`](./BACKLOG.md) for week-by-week tasks.

## Install

**Windows:** Download `Projelli_x.y.z_x64-setup.exe` from [Releases](https://github.com/projelli/projelli/releases). Double-click — installer runs silently, then Projelli auto-launches. Signed via Azure Trusted Signing (no SmartScreen warning).

**macOS:** Download the DMG that matches your chip (`aarch64` for M-series, `x64` for Intel) from Releases, drag to Applications. First launch hits a Gatekeeper warning because Apple's notary service has been intermittent since spring 2026 — right-click → Open → "Open Anyway" to bypass (one time only). Signed with our Apple Developer ID.

**Linux:** AppImage / `.deb` / `.rpm` builds are produced but Linux is not officially supported in v1.6. Coming as v1.7 after the launch settles.

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
│   ├── index.html                  — homepage
│   ├── docs/                       — public user docs (Getting Started, FAQ, API Keys)
│   ├── legal/                      — Privacy / Terms / EULA
│   ├── press-kit/                  — press resources for journalists
│   └── blog/                       — blog posts
├── infra/
│   └── deploy.sh                   — website deploy script
├── docs/
│   ├── README.md                   — docs index
│   ├── reference/                  — architecture, vision, ADRs, competitive landscape
│   ├── operations/                 — runbooks
│   ├── features/                   — marketing playbook + launch packages
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

Privacy policy: [https://projelli.com/legal/privacy](https://projelli.com/legal/privacy)

## Support

- **Email:** `support@projelli.com`
- **Issues:** [GitHub Issues](https://github.com/projelli/projelli/issues)

## License

Closed-source proprietary software. End-User License Agreement: [https://projelli.com/legal/eula](https://projelli.com/legal/eula).

A "Projelli Lite" open-source version may be released later as a marketing funnel — not on the v1 roadmap.

## Built by

[Jameson Daines](https://jamesondaines.com) — Senior Product Designer at Wheel Health, and the operator of [BehaviorUX](https://behaviorux.com), a health-tech UX consulting practice.
