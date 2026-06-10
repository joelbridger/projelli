# Keepance Project Map

**Status:** v3.0.0 in Phase 1 (firm tier wiring: desktop collaboration + org licensing + inference proxy)  
**Last updated:** 2026-06-10  
**Read the operating contract first:** [`~/keepance/KEEPANCE_BUSINESS_PLAN.md`](../../KEEPANCE_BUSINESS_PLAN.md)

---

## What Keepance Is (One Sentence)

A local-first, AI-powered workspace for professionals (lawyers, CPAs, consultants) who legally or temperamentally cannot pipe their work into the cloud. Every chat becomes a real file on your machine; your API keys never leave your OS keychain.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   TAURI DESKTOP (Windows/macOS/Linux)            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         REACT FRONTEND (TypeScript + Zustand)            │   │
│  │  Editor │ FileTree │ AIChat │ Workflow │ Research │ Sync │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│        ┌──────────────────┼──────────────────┐                  │
│        ▼                  ▼                  ▼                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Tauri Rust   │  │   Zustand    │  │  Web FS API  │          │
│  │  Commands    │  │ State Stores │  │   (browser)  │          │
│  │ (fs, tts,    │  │              │  │              │          │
│  │  voice, ...)  │  │              │  │  OR          │          │
│  │              │  │              │  │  TauriFSAPI  │          │
│  └──────────────┘  └──────────────┘  │   (desktop)  │          │
│                                       └──────────────┘          │
│                                              │                  │
│                                              ▼                  │
│                                      ┌──────────────┐            │
│                                      │ Workspace    │            │
│                                      │ (local files)│            │
│                                      └──────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│  AI Providers│  │ Firm Backend  │  │ Local Services       │
│ (BYOK proxy) │  │  (optional)   │  │ (Piper TTS, etc.)    │
│              │  │  Port 5290    │  │                      │
│ - Claude API │  │               │  │ OS Keychain          │
│ - OpenAI API │  │ - Auth/License│  │ SQLite (local DB)    │
│ - Gemini API │  │ - E2EE CRDT   │  │                      │
└──────────────┘  │ - Assured Inf.│  └──────────────────────┘
                  └──────────────┘
```

### Three-Tier Service Model

| Tier | Who | Entrypoint | DB | Authentication |
|------|-----|-----------|--|----|
| **Solo (Local-first)** | Individual users, no sync | Browser or Tauri | File system + optional SQLite | OS Keychain (API keys only) |
| **Firm (Optional)** | Teams with shared matters + licensing | `backend/` (Bun, port 5290) | SQLite (dev) → Postgres (prod) | Email + password, seat tokens, refresh tokens |
| **Inference Proxy** | Firm customers needing zero-retention | `assured.*` routes in `backend/` | Audit log only (no retention) | Signed provider keys |

**Default behavior:** Solo mode. Firm backend is completely optional and defaults off. CLAUDE.md §3 locks this design.

---

## Key Directories & Their Purpose

| Path | What | Notes |
|------|------|-------|
| **`src/`** | React frontend source (TypeScript) | Main editor, workspace, AI chat, plugins |
| **`src/components/`** | React UI components | `editor/`, `layout/`, `workspace/`, `research/`, `workflow/`, `firm/`, `matter/`, etc. |
| **`src/modules/`** | Business logic services | 24 modules including `editor/`, `workspace/`, `chat/`, `models/`, `audit/`, `firm/`, `matter/`, `licensing/` |
| **`src/stores/`** | Zustand state stores | `workspaceStore`, `editorStore`, `aiChatStore`, `settingsStore`, `firmStore`, etc. |
| **`src/types/`** | TypeScript interfaces & types | `workspace`, `workflow`, `research`, `analysis`, `firm`, `matter`, `contract` |
| **`src-tauri/`** | Tauri Rust backend | Desktop commands, TTS, voice, http proxy, keychain, tarball operations |
| **`src-tauri/src/commands/`** | Tauri command handlers | `fs.rs`, `keychain.rs`, `tts.rs`, `voice.rs`, `http.rs` |
| **`src-tauri/src/sidecars/`** | External binaries (Piper TTS, Parakeet STT) | Spawned on demand, managed by Rust layer |
| **`backend/`** | Firm platform backend (Bun) | Identity, licensing, E2EE sync relay, inference proxy (all 3 chunks of DECISION.md) |
| **`backend/src/`** | Bun server & routes | `server.ts` + flat router across `routes/` (auth, seats, matters, assured, admin, etc.) |
| **`backend/src/lib/`** | Backend libraries | `db.ts` (Store class, SQLite + WAL + IMMEDIATE transactions), `crypto.ts`, `assured.ts`, `config.ts`, etc. |
| **`tests/`** | Vitest (React) + Playwright (E2E) | Unit, integration, security, campaign, e2e, fixtures |
| **`website/`** | Marketing site (HTML + static assets) | Deploys to keepance.com via `infra/deploy.sh` (rsync + Cloudflare cache purge) |
| **`website/docs/`** | Public user-facing docs | Getting Started, FAQ, Mobile Access, API Keys guides |
| **`website/press-kit/`** | Press materials | Bios (3 lengths), fact sheet, brand colors, screenshots, demo video links |
| **`website/blog/`** | Blog posts | Publishable content: v1.5 announce, why local-first, Notion AI math, chat persistence, etc. |
| **`docs/`** | Internal documentation | Reference, operations, quality, strategy, launch docs, marketing playbooks |
| **`docs/reference/`** | Architecture & design (slow-changing) | `FEATURES.md`, `VISION.md`, `ARCHITECTURE.md`, `PRD.md`, `SECURITY.md`, `DECISIONS.md` |
| **`docs/operations/`** | Runbooks & how-tos | Deployment, development workflow, onboarding |
| **`docs/quality/`** | Testing & definition of done | `DEFINITION_OF_DONE.md`, `PLAYWRIGHT_TESTING.md`, manual test checklists |
| **`docs/marketing/`** | **All marketing work** | Playbook, channels/, action-packs/, campaigns/, email sequences, competitive landscape |
| **`docs/strategy/`** | Strategic documents | Pricing, positioning, competitive analysis, SOC 2 decision, launch readiness |
| **`docs/operations/BOARD_ACTION_ITEMS.md`** | **Engineering + financial handoffs to Jameson** | Azure signing, Apple Developer, LemonSqueezy, etc. — separate from JAMESON_ACTION_PACK |
| **`infra/`** | Infrastructure & deployment | `deploy.sh` (website), deploy scripts |
| **`.github/workflows/`** | GitHub Actions CI/CD | `ci.yml` (lint, type-check, test), `release.yml` (Tauri multi-platform builds + code signing) |
| **`packages/`** | Monorepo sub-packages | `plugin-api/`, `create-keepance-plugin/`, `eslint-plugin-keepance-i18n/` |

---

## Entrypoints & How to Run

### Development (Browser)
```bash
cd /home/jameson/keepance
npm run dev
# Opens at http://localhost:5173
```

### Development (Tauri Desktop)
```bash
npm run tauri:dev
# Launches the Tauri window; Vite dev server runs simultaneously
# Firm backend (if testing sync): FIRM_BACKEND_TARGET=http://127.0.0.1:5290 npm run tauri:dev
```

### Firm Backend (Optional, for team testing)
```bash
cd backend
bun install
cp .env.example .env
# Generate keypair: bun run keygen → copy SEAT_PRIVATE_KEY_PEM + SEAT_PUBLIC_KEY_PEM into .env
# Set AUTH_SECRET: openssl rand -hex 48
bun run start  # Listens on http://127.0.0.1:5290
# Or: bun run dev (watch mode)
```

### Production Build (Tauri)
```bash
npm run tauri:build
# Outputs installers to src-tauri/target/release/bundle/
# Automatically signs (macOS + Windows via GitHub Secrets)
# Tag: git tag v3.0.0 && git push --tags → GitHub Actions builds + releases
```

### Website Deploy
```bash
cd infra
./deploy.sh
# rsync website/ → /var/www/keepance.com
# Cloudflare cache purge
# Website lives at keepance.com (caddy on :8080 + CF tunnel)
```

---

## Configuration & Secrets

### Frontend (`src/`)
- **Locale detection:** `src/lib/locale-detect.ts` (OS detection + `?lang=` override)
- **Settings store:** `src/stores/settingsStore.ts` (persisted user prefs: theme, language, AI provider keys)
- **i18n:** `src/i18n.ts`, `src/locales/` (en, es, de)
- **AI provider config:** `src/modules/models/` (ClaudeProvider, OpenAIProvider, GeminiProvider; BYOK via OS keychain)

### Backend (`backend/`)
**Secrets (environment variables only, never committed):**
- `SEAT_PRIVATE_KEY_PEM` — Ed25519 seat token signing key (generated via `bun run keygen`)
- `SEAT_PUBLIC_KEY_PEM` — Public key for token verification
- `AUTH_SECRET` — 256-bit hex for JWT signing (`openssl rand -hex 48`)
- `BOOTSTRAP_ORG_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_PASSWORD` — (optional) create an org on first boot
- `DATABASE_URL` — SQLite path in dev; Postgres conn string in production
- `LemonSqueezy_API_KEY` — (opt) for license webhook validation
- Optional SMTP / SendGrid creds (for email notifications, not yet implemented)

**Port:** `5290` (firm backend dev default; override with `FIRM_BACKEND_TARGET` in Vite dev)

**Config source:** `backend/src/lib/config.ts` (reads all env vars, types them, validates at startup)

### Tauri (`src-tauri/`)
- **Windows code signing:** Azure Trusted Signing (service principal secrets in GitHub)
- **macOS code signing:** Apple Developer ID cert + notarization (secrets in GitHub)
- **Capabilities:** `src-tauri/capabilities/` (Tauri security ACL for commands)
- **Binary sidecars:** `src-tauri/binaries/` (Piper TTS, Parakeet STT; auto-downloaded on first use)

### Website (`website/`)
- **Static deployment:** rsync to `/var/www/keepance.com`
- **Cloudflare tunnel:** `d4e16129` (managed by system Caddy on `:8080`)
- **No secrets needed** (pure static HTML)

---

## Firm Backend API Routes (for reference)

All routes below require authentication (Bearer token for most; signed tokens for a few). Firm backend is optional; solo mode never uses it.

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/auth/register` | Create user account | None |
| `POST` | `/auth/login` | Email + password → access + refresh tokens | None |
| `POST` | `/auth/refresh` | Rotate refresh token, get new access token | Refresh token |
| `POST` | `/auth/logout` | Invalidate refresh token | Access token |
| `GET` | `/auth/me` | Fetch current user profile | Access token |
| `POST` | `/seats/activate` | Claim a seat (firm tier only) | License key |
| `GET` | `/seats/validate` | Check if seat is still valid | Seat token |
| `POST` | `/seats/heartbeat` | Keep-alive (proves device is still in use) | Seat token |
| `POST` | `/admin/org` | Create an organization (admin only) | Access token |
| `GET` | `/admin/seats` | List seats in org | Access token |
| `POST` | `/admin/seats/:id/revoke` | Revoke a seat | Access token |
| `GET` | `/matter` | List matters visible to user | Access token |
| `POST` | `/matter` | Create new shared matter | Access token |
| `WS` | `/matter/:id/sync` | E2EE CRDT sync (WebSocket) | Signed ticket |
| `POST` | `/assured/infer` | Zero-retention AI inference | Signed provider key |
| `POST` | `/assured/provider-keys` | Register a provider API key | Access token |
| `GET` | `/webhooks/lemmonsqueezy` | License webhook handler | Webhook secret |

See `backend/src/contract.ts` for full TypeScript types and error codes.

---

## Data Storage Paths

### Solo Mode (Local-first, file-system only)
- **Workspace root:** User selects via file picker (browser) or Tauri dialog (desktop)
- **Markdown files:** Plain `.md` files in workspace root + subfolders
- **Version history:** Stored as side-by-side numbered files (e.g., `doc.md.1`, `doc.md.2`) — see `src/modules/versioning/`
- **AI chat artifacts:** Stored as `.aichat` files (JSON schema) — see `src/modules/chat/`
- **Settings/keychain:**
  - Browser: `localStorage` (API keys **not stored** in browser)
  - Desktop: OS keychain (Tauri: `src-tauri/src/commands/keychain.rs`) + `~/.config/Keepance/` for local prefs

### Firm Mode (Optional, requires backend)
- **User identity:** Backend SQLite (dev) / Postgres (prod) — hashed passwords, refresh token hashes
- **Licenses + seats:** Backend DB (seat_limit enforced via IMMEDIATE transaction lock)
- **Matter metadata:** Backend DB (shared-matter list, ACL, ethical walls)
- **Matter CRDT updates:** Transient (no persistent storage) — E2EE sync relay stores updates only long enough to fan-out to all subscribers
- **Inference audit log:** Backend (append-only, zero-retention by design)
- **User workspace files:** Still local (firm user's own disk, E2EE'd sync is optional overlay)

---

## Test Paths & Running Tests

### Unit & Integration Tests (Vitest)
```bash
npm run test              # Run all
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
```

**Test structure:**
- `tests/unit/` — Workspace ops, path validation, history/undo, schema validation, search
- `tests/integration/` — Full workflows (create, edit, undo, delete, restore), "New Business Kickoff" template
- `tests/security/` — Path traversal, symlink escape, prompt injection
- `tests/setup.ts` — Global test configuration (fixtures, test DB init)

### E2E Tests (Playwright)
```bash
npx playwright test              # Run all E2E
npx playwright test --ui         # Interactive mode
npx playwright show-trace trace  # View a trace
```

**E2E structure:**
- `tests/e2e/` — Browser-driven tests (file creation, editing, AI chat, sync, etc.)
- Matrix runs across en/es/de locales (see `tests/e2e/playwright.config.ts`)

### Backend Tests (Bun)
```bash
cd backend
bun test              # 52 tests across crypto, auth, licensing, HTTP lifecycle
bun run typecheck     # tsc --noEmit (strict)
```

---

## Common Development Tasks

| Task | Command | Notes |
|------|---------|-------|
| **Check for errors** | `npm run typecheck` | Runs tsc --noEmit (strict mode) |
| **Lint code** | `npm run lint` | ESLint + Prettier check |
| **Format code** | `npm run format` | Prettier write |
| **Build for production** | `npm run build` | Vite build (browser only) |
| **Build Tauri installer** | `npm run tauri:build` | Creates Win/Mac/Linux installers |
| **Generate new locale** | `npm run i18n:extract` | Extracts new i18n keys |
| **Capture marketing screenshots** | `npm run capture:all` | Playwright automation (docs/quality/) |
| **Deploy website** | `cd infra && ./deploy.sh` | rsync + Cloudflare cache purge |
| **Update CHANGELOG** | (manual) | Edit CHANGELOG.md after every commit |
| **Sync with repo** | `git pull origin main` | Assume main is always deployable |

---

## If You Only Read 5 Files…

1. **[`~/keepance/KEEPANCE_BUSINESS_PLAN.md`](../../KEEPANCE_BUSINESS_PLAN.md)** — The operating contract (ICP, pricing, 8-week launch roadmap, every CEO decision)
2. **[`~/keepance/BACKLOG.md`](../../BACKLOG.md)** — Week-by-week task list (what's done, in flight, blocked)
3. **[`~/keepance/CLAUDE.md`](../../CLAUDE.md)** — Instructions for Claude Code in this repo (architecture, key files, anti-patterns)
4. **[`~/keepance/docs/reference/ARCHITECTURE.md`](../reference/ARCHITECTURE.md)** — System design, module breakdown, data flow
5. **[`~/keepance/docs/quality/DEFINITION_OF_DONE.md`](../quality/DEFINITION_OF_DONE.md)** — What "done" means before merging (tests, docs, changelog, etc.)

---

## Handoff Anchors

### For Marketing Work
**Start here:** `~/keepance/docs/marketing/README.md` (explains the marketing folder structure, playbook, channels, action-packs, campaigns)

**Complementary docs:**
- `docs/marketing/playbook/MARKETING_PLAYBOOK.md` — Master index + critical-path launch timeline
- `docs/marketing/playbook/EMAIL_SEQUENCES.md` — 10 pre-staged plain-text emails
- `docs/marketing/action-packs/JAMESON_ACTION_PACK.md` — 8 tasks only Jameson can do (PH hunters, beta testers, demo video, etc.)
- `docs/marketing/channels/` — Per-platform launch playbooks (PH, HN, IH, Reddit, newsletter, directories)
- `docs/reference/COMPETITIVE_LANDSCAPE.md` — Side-by-side comparison + ready-to-paste HN/PH reply templates

### For Operations / Deployments
**Deployment runbook:** `~/keepance/infra/deploy.sh` (website) + GitHub Actions (Tauri builds)

**Key paths:**
- Website: `~/keepance/website/` → rsync to `/var/www/keepance.com` + Cloudflare tunnel
- Tauri builds: `.github/workflows/release.yml` → matrix build (Windows/macOS/Linux) + auto-sign
- Firm backend: `~/keepance/backend/` (Bun server, optional, for team testing)

### For Engineering / Debugging
**Start with the issue:** Check `BACKLOG.md` for ticket status, then read the relevant module in `src/modules/`

**Debug flow:**
1. Reproduce locally: `npm run tauri:dev`
2. Check tests: `npm run test` (unit/integration tests may reveal the bug)
3. Check types: `npm run typecheck`
4. Trace code: Search `src/modules/` for the module + use browser DevTools (Tauri: right-click → inspect)
5. Log issue: Add debug output, re-run, capture terminal output
6. Fix + test: Update code, verify test passes, update CHANGELOG.md
7. Submit PR: Link to BACKLOG.md ticket, request code review

---

## Key Decision Records (ADRs)

**All major architectural decisions live in:**
- `~/keepance/KEEPANCE_BUSINESS_PLAN.md` (CEO-level: ICP, pricing, launch plan)
- `~/keepance/docs/reference/DECISIONS.md` (technical: stacks, patterns, security model)
- `~/keepance/spikes/firm-sync/DECISION.md` (firm tier design: 3 chunks, E2EE relay, assured inference)

**Recent major decisions (2026-06):**
- Keepance 3.0: Add optional firm tier (org licensing, shared matters, E2EE sync relay, inference proxy)
- Firm backend: Bun + TypeScript (matches other services) + SQLite (dev) → Postgres (prod)
- Pricing: $49/$129/$399 (Personal/Professional/Practice) + $89 charter offer
- ICP locked: Solo attorneys (general + patent) + tax preparers + consultants (fast-follow: general lawyers, then tax, then consulting)

---

## Voice Rules (Marketing Copy)

**Every artifact in `docs/features/` and `website/blog/` must follow these rules:**
- First-person singular ("I", not "we")
- Contractions always ("don't", not "do not")
- Specific concrete nouns ("Claude" > "AI"; "Markdown files" > "documents")
- **Banned words:** "leverage", "delve", "seamless", "transform", "empower", "elevate", "unlock"
- No italicized fragments at sentence ends
- No "It's not X, it's Y" parallelism
- Uneven sentence length (avoid metronome rhythm)
- Occasional informal fragments ("Nope. Not happening.") for personality

**Reference:** Canonical homepage voice at keepance.com (audited 2026-04-08)
See: `~/.claude/projects/-home-jameson/memory/feedback_marketing_copy_voice.md` + `reference_ai_writing_tells.md`

---

## GitHub / Versioning

- **Org:** `keepance` (transferred from `joelbridger` on 2026-04-08)
- **Main branch:** `main` (always deployable)
- **Releases:** Git tags (`git tag v3.0.0`) trigger GitHub Actions multi-platform Tauri builds
- **Windows signing:** Azure Trusted Signing (no local code-signing certificate needed)
- **macOS signing:** Apple Developer ID (notarization intermittent since spring 2026 — users right-click → Open → "Open Anyway")

---

## Known Gotchas & Workarounds

| Issue | Workaround |
|-------|------------|
| Tauri window doesn't open in dev | Ensure Vite dev server is running on correct port (5173 by default). Check `vite.config.ts` and `tauri.conf.json` `devUrl`. |
| "Module not found" errors | Verify path aliases in `tsconfig.json` and `vite.config.ts`. Check barrel exports (`index.ts`). |
| Firm backend API calls 404 | Ensure backend is running on correct port (5290 default). Override with `FIRM_BACKEND_TARGET` env var in `npm run tauri:dev`. |
| Tests fail after env changes | Ensure test setup in `tests/setup.ts` matches your .env. Run `npm run typecheck` first to catch type errors early. |
| SQLite errors in browser | sql.js WASM must be loaded before use. Check `src/lib/sqlite.ts` async initialization. |
| File operations fail silently | Check browser DevTools console for permission errors. Verify workspace root is set correctly in `workspaceStore`. |
| Playwright tests timeout | Increase timeout in `tests/e2e/playwright.config.ts` if running on slow hardware or slow network. |
| Locale doesn't switch | Check `src/lib/locale-detect.ts` — falls back to 'en' on error. Try explicit `?lang=es` query param. |
| DPI scaling issues (Windows Tauri) | Tauri 2 handles DPI scaling automatically. If font rendering is fuzzy, check Windows display scaling (Settings → Display → Scale). |

---

## Next Phases (from BACKLOG)

- **Phase 1 (in progress):** Firm desktop wiring (shared-matter UI, member/seat management, live collab, purchase-to-provision)
- **Phase 4 (pending):** Usability study (Diane Marchetti persona)
- **Phase 5 (pending):** Mechanical exhaustive sweep (bug triage, fix wave, regression testing)
- **Phase 6 (pending):** Native Tauri pass (Linux, fresh profile testing)
- **Phase 7 (pending):** v3.1.0 RC, launch-readiness report

---

*This map is durable memory, kept up-to-date after major changes. For live task status, always check BACKLOG.md.*
