# Keepance

> **The private intelligence layer for a law practice.**
> Your documents, email, and matters stay on your machine, kept provably private, and answer you back with citations you can verify.

[**keepance.com**](https://keepance.com) • [Download](https://github.com/keepance/keepance/releases) • [Press kit](https://keepance.com/press-kit/) • [Blog](https://keepance.com/blog/) • [Business plan](./KEEPANCE_BUSINESS_PLAN.md)

---

## What is Keepance?

Keepance is a desktop app (Tauri 2 + React 18 + TypeScript) where a lawyer's confidential work lives. It indexes a practice's documents, email, and matters locally, keeps them private by architecture, and answers questions across all of it with verifiable citations.

It combines:

- **Word-native editing.** An in-house OOXML (.docx) engine with tracked changes and AI redline. Word is the first-class format, not an export afterthought.
- **Matter-scoped cited recall.** Ask a question and get an answer grounded in your own files and email, every claim carrying a citation you can click. Recall is scoped per matter with cryptographic isolation.
- **Email intelligence.** Import Outlook, Gmail, or IMAP into one local index and actually find anything, with a citation, even when native search fails.
- **Local-first and BYOK.** Your data stays on your machine and your API keys live in your OS keychain. AI requests go straight from your machine to your provider under your own key, or through a firm zero-retention proxy in Assured mode. Keepance never holds your keys, sees your data, or routes content through a server of ours.
- **A firm tier with end-to-end-encrypted collaboration.** Shared matters, SSO, ethical walls enforced by key denial, and live multi-user .docx co-editing where the relay only ever stores ciphertext.
- **Profession workflow packs** for the real tasks attorneys do (plus tax, consulting, and advisor packs).

The pitch in one sentence: the private place your whole practice lives and answers you back, where your clients' data never leaves your control and every answer is cited.

## Status

- **v3.2.0** is live: signed installers for Windows, macOS (Apple Silicon + Intel), and Linux, all with auto-update.
- Per-seat annual subscriptions via LemonSqueezy, license validation, the firm backend at `api.keepance.com`, and the full legal docs are all live.
- See [`KEEPANCE_BUSINESS_PLAN.md`](./KEEPANCE_BUSINESS_PLAN.md) for strategy, [`docs/operations/2026-06-13-CURRENT-STATE.md`](./docs/operations/2026-06-13-CURRENT-STATE.md) for the authoritative current state, and [`BACKLOG.md`](./BACKLOG.md) for the task list.

## Install

**Windows:** Download `Keepance_x.y.z_x64-setup.exe` from [Releases](https://github.com/keepance/keepance/releases). Double-click; the installer runs silently, then Keepance auto-launches. Signed via Azure Trusted Signing (no SmartScreen warning).

**macOS:** Download the DMG that matches your chip (`aarch64` for Apple Silicon, `x64` for Intel) from Releases and drag it to Applications. Signed with our Apple Developer ID and notarized.

**Linux:** AppImage, `.deb`, and `.rpm` builds are published on Releases and officially supported.

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
npm test             # Vitest unit + integration
npx playwright test  # E2E
```

**Stack:**
- Tauri 2 + Rust backend
- React 18 + TypeScript 5 + Vite 6
- Zustand state management
- shadcn/ui + Tailwind CSS
- In-house OOXML (.docx) engine + TipTap as the primary editor; CodeMirror 6 for plain-text and Markdown utility files
- LanceDB + fastembed (e5-small) for local semantic recall; SQLCipher for the encrypted audit and mail-index store
- AI providers: Anthropic, OpenAI, Google AI, and local models via Ollama

## Repository layout

```
keepance/
├── README.md                       this file
├── ARCHITECTURE.md                 canonical map of src/ (the 5-layer DAG) — read first for structure
├── KEEPANCE_BUSINESS_PLAN.md       operating contract / strategy
├── BACKLOG.md                      task list
├── CHANGELOG.md                    release-by-release history
├── CLAUDE.md                       instructions for Claude Code working in this repo
├── src/                            frontend source, feature-first:
│   ├── app/                        the shell that composes features
│   ├── features/                   product surfaces (ask, documents, email, matters, firm, …)
│   ├── platform/                   cross-cutting capabilities (providers, fs, rag, firm, matter, …)
│   ├── ui/                         design system (primitives + kp/ + brand)
│   └── lib/                        domain-free leaf utilities
├── src-tauri/                      Rust backend (commands, crates: keepance-vault, keepance-docx)
├── backend/                        firm backend (E2EE relay, SSO) deployed to api.keepance.com
├── tests/                          Vitest (unit/integration/security) + Playwright (e2e)
├── website/                        marketing site (deploys to keepance.com)
├── infra/deploy.sh                 website deploy script
└── .github/workflows/release.yml   Tauri matrix CI for Win/Mac/Linux builds
```

For the authoritative structure, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Pricing

Per-seat annual subscriptions, sold via [LemonSqueezy](https://lemonsqueezy.com) (merchant of record, handles tax and refunds):

- **Solo:** $468/yr ($39/mo billed annually) — the full app, all AI providers, unlimited matters.
- **Professional:** $948/yr ($79/mo billed annually) — Solo plus the legal workflow library and all practice packs.
- **Firm:** $1,548/seat/yr ($129/mo billed annually), minimum 3 seats — shared matters, SSO, ethical walls, and the assured zero-retention option.

A founding cohort locks 30% off for the life of the subscription. Pre-3.0 one-time buyers are grandfathered forever; the entitlement layer guarantees their data access is never gated.

## Privacy

Keepance is local-first by design.

- Your files live in a folder on your machine that you choose, optionally inside an AES-256-GCM encrypted vault.
- API keys are stored in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux).
- AI calls go directly from your machine to your provider (Claude, OpenAI, Google, or a local model), or through the firm zero-retention proxy in Assured mode.
- Keepance's servers never see your files, your prompts, or your responses. Firm collaboration syncs only end-to-end-encrypted blobs; the relay can never read content.
- We do not hold a SOC 2 report or a signed DPA today. The privacy story is verifiable by architecture, and our honest current posture is documented at [keepance.com/security](https://keepance.com/security).

Privacy policy: [https://keepance.com/legal/privacy](https://keepance.com/legal/privacy)

## Support

- **Email:** `support@keepance.com`
- **Issues:** [GitHub Issues](https://github.com/keepance/keepance/issues)

## License

Closed-source proprietary software. End-User License Agreement: [https://keepance.com/legal/eula](https://keepance.com/legal/eula).

## Built by

[Jameson Daines](https://jamesondaines.com), Senior Product Designer at Wheel Health and operator of [BehaviorUX](https://behaviorux.com), a health-tech UX consulting practice.
