# Keepance

> **Local-first AI workspace for confidential client work.**
> Your files stay on your machine. Your API keys never leave your OS keychain. Nothing touches a cloud.

[**keepance.com**](https://keepance.com) • [Download](https://github.com/keepance/keepance/releases) • [Press kit](https://keepance.com/press-kit/) • [Blog](https://keepance.com/blog/) • [Business plan](./KEEPANCE_BUSINESS_PLAN.md)

---

## What is Keepance?

Keepance is a desktop app (Tauri 2 + React 18 + TypeScript) for professionals who can't pipe their work into ChatGPT — lawyers, CPAs, consultants, and anyone else bound by privilege, NDA, or professional confidentiality obligations.

It combines:

- A **Markdown editor** with wiki-links, backlinks, version history, and split panes
- An **integrated AI chat** that produces real, persistent files in your workspace — not throwaway conversations
- **Profession-specific workflow template packs** built around the actual tasks attorneys, tax preparers, and consultants do every day
- **Three AI providers** with streaming and per-chat model selection: Claude, OpenAI, Gemini
- **Local-first** — your data stays on your machine, your API keys live in your OS keychain, the app works fully offline (except for actual AI calls)
- **BYOK** (bring your own key) — Keepance never sees your data or your API requests

The pitch in one sentence: the AI workspace for people who legally or temperamentally cannot put their work in the cloud.

## Status

- **v1.5** is the latest stable release (Windows). v1.6 is in active release-candidate testing with macOS as the new addition.
- Code signing, payments via LemonSqueezy, license validation, auto-updater, and legal docs are all live.
- See [`KEEPANCE_BUSINESS_PLAN.md`](./KEEPANCE_BUSINESS_PLAN.md) for the full strategy and [`BACKLOG.md`](./BACKLOG.md) for week-by-week tasks.

## Install

**Windows:** Download `Keepance_x.y.z_x64-setup.exe` from [Releases](https://github.com/keepance/keepance/releases). Double-click — installer runs silently, then Keepance auto-launches. Signed via Azure Trusted Signing (no SmartScreen warning).

**macOS:** Download the DMG that matches your chip (`aarch64` for M-series, `x64` for Intel) from Releases, drag to Applications. First launch hits a Gatekeeper warning because Apple's notary service has been intermittent since spring 2026 — right-click → Open → "Open Anyway" to bypass (one time only). Signed with our Apple Developer ID.

**Linux:** AppImage / `.deb` / `.rpm` builds are produced but Linux is not officially supported in v1.6. Coming as v1.7 after the launch settles.

## Mobile access

Keepance is a desktop app, but your workspace is just a folder of plain Markdown files. Point that folder at iCloud Drive, Dropbox, Syncthing, or Google Drive on your computer and your notes show up on your iPhone or Android in the matching files app, with no new account and no extra cost. The full setup steps (one guide per provider, plus a "which one should I pick" decision matrix) live at [keepance.com/docs/mobile-access/](https://keepance.com/docs/mobile-access/). A dedicated Keepance mobile reader is in beta and will land in the v2.0 cycle.

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
keepance/
├── README.md                       — this file
├── KEEPANCE_BUSINESS_PLAN.md       — operating contract / 8-week launch plan
├── BACKLOG.md                      — week-by-week task list
├── CHANGELOG.md                    — release-by-release history
├── CLAUDE.md                       — instructions for Claude Code working in this repo
├── src/                            — frontend source (React + TypeScript)
├── src-tauri/                      — Rust backend
├── tests/                          — Vitest + Playwright test suites
├── website/                        — marketing site (deploys to keepance.com)
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

- **Personal:** $49 one-time — all features, all AI providers, unlimited workspaces
- **Professional:** $129 one-time — Personal + one profession template pack of your choice (Legal, Tax, or Consulting)
- **Practice:** $399 one-time — up to 5 seats + all profession packs + email support

Sold via [LemonSqueezy](https://lemonsqueezy.com) (merchant of record handles tax and refunds). Perpetual license, no subscription, no ongoing fees.

## Privacy

Keepance is local-first by design.

- All your files live in a folder on your hard drive that you choose
- API keys are stored in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux)
- AI calls go directly from your machine to your provider (Claude / OpenAI / Google)
- Keepance's servers never see your files, your prompts, or your responses
- The only call Keepance's server gets is a one-time license validation when you activate

Privacy policy: [https://keepance.com/legal/privacy](https://keepance.com/legal/privacy)

## Support

- **Email:** `support@keepance.com`
- **Issues:** [GitHub Issues](https://github.com/keepance/keepance/issues)

## License

Closed-source proprietary software. End-User License Agreement: [https://keepance.com/legal/eula](https://keepance.com/legal/eula).

A "Keepance Lite" open-source version may be released later as a marketing funnel — not on the v1 roadmap.

## Built by

[Jameson Daines](https://jamesondaines.com) — Senior Product Designer at Wheel Health, and the operator of [BehaviorUX](https://behaviorux.com), a health-tech UX consulting practice.
