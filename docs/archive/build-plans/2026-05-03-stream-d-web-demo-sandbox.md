# Projelli v2.0 Stream D-web: Web Demo Sandbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `projelli.com/try`: a browser-based Projelli demo with pre-seeded sample workspace, a clearly-marked "demo mode" UX, AI chat using either a shared rate-limited Anthropic key (via a Bun proxy) or the user's own pasted key, demo limits (5 messages OR 10 minutes), conversion CTAs at strategic points, marketing instrumentation via Plausible. The demo lets prospects experience the product without download or BYOK setup.

**Branch:** `feature/stream-d-web-demo-sandbox`. Branches off `master`. Independent of all other v2.0 streams. Can land any time after master is current.

**Why D-web matters for v2.0 launch:** the website's primary CTA today is "Download for Mac/Win/Linux." Lower-friction trial increases top-of-funnel. The demo IS a managed cloud surface (the shared key proxy), which conflicts with Projelli's "no servers in your path" pitch — mitigation is clear framing: "demo uses our key, rate-limited; the desktop app uses YOUR key, end-to-end private."

**Architecture:**

```
┌─────── Browser (projelli.com/try) ───────────┐
│                                                │
│  Projelli React app (existing)                 │
│  + WebDemoSeeder    (one-time IDB hydration)   │
│  + DemoModeBanner   (sticky top)               │
│  + DemoLimitGate    (hooks aiChat sends)       │
│  + BYOKKeyInput     (paste-your-own-key)       │
│  + DemoExitModal    (full-screen CTA)          │
│                                                │
│  WebFSBackend       (existing, IndexedDB)      │
│  AI provider override:                         │
│    if BYOK key: direct provider call           │
│    else: POST /api/demo-chat (this server)     │
└────────────────────────────────────────────────┘
                ↕ HTTPS
┌─────── projelli-demo-proxy (Bun service) ─────┐
│                                                │
│  POST /api/demo-chat                           │
│  ├── Validates session token (rotated daily)   │
│  ├── Rate-limit: 5 msg/session, 100 sess/day   │
│  ├── Per-IP daily cap                          │
│  ├── Forwards to api.anthropic.com with        │
│  │   Projelli's key                            │
│  └── Returns response (streaming optional)     │
│                                                │
│  Cost cap: $50/month tracked in disk file      │
│  Service degrades gracefully when exhausted    │
└────────────────────────────────────────────────┘
```

**Tech Stack:** TypeScript 5, React 18, Vite 5 (separate build target `build:web-demo`), Bun (proxy service runtime), Anthropic SDK (proxy server-side), Plausible (analytics), Cloudflare Tunnel (existing), Caddy (existing serving).

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` section 7.3.

---

## File Structure

### Files to create in this projelli/projelli repo

| Path | Purpose |
|---|---|
| `vite.config.web-demo.ts` | Separate Vite build config: outputs `dist-web-demo/`, defines `__PROJELLI_DEMO__ = true` |
| `src/web-demo/main.tsx` | Demo entry point, mounts the app with demo wrapper |
| `src/web-demo/WebDemoSeeder.ts` | Runs once per browser, populates IndexedDB with sample workspace |
| `src/web-demo/sample-workspace.json` | Bundled JSON: 12 workflow templates + 3-4 sample notes + 1 sample chat history + 1 sample SourceCard |
| `src/web-demo/DemoModeBanner.tsx` | Sticky top banner: "You're using the Projelli demo. [Download for full version]" |
| `src/web-demo/DemoLimitGate.tsx` | HoC / hook around aiChat that tracks message count + session time, fires `DemoExitModal` at limits |
| `src/web-demo/BYOKKeyInput.tsx` | Small input + toggle: paste your own key for unlimited; falls back to shared rate-limited demo key |
| `src/web-demo/DemoExitModal.tsx` | Full-screen CTA when limit hit: "You've explored Projelli. Download for full version." with [Download for Mac/Win/Linux] buttons |
| `src/web-demo/demoModeFlag.ts` | Feature flag exposed as `__PROJELLI_DEMO__`. Existing app code branches on this where needed (no real save, rate-limited AI, CTA triggers) |
| `src/web-demo/demoAIProvider.ts` | Wraps the existing Anthropic provider: if BYOK key set, direct call; else POST to `/api/demo-chat` |
| `src/web-demo/demoSessionToken.ts` | Generates / refreshes the session token used by the proxy (rotates daily; stored in localStorage) |
| `package.json` (modify) | Add `"build:web-demo": "vite build --config vite.config.web-demo.ts"` script |
| `tests/unit/web-demo/WebDemoSeeder.test.ts` | Seeder: idempotent (skips if already seeded), populates expected sample files |
| `tests/unit/web-demo/DemoLimitGate.test.tsx` | Limit triggers correct modal at 5 messages and at 10 minutes |
| `tests/unit/web-demo/BYOKKeyInput.test.tsx` | Toggle, paste, validate format |
| `tests/unit/web-demo/demoAIProvider.test.ts` | Routes BYOK to direct, demo to proxy, handles proxy 429/quota-exhausted |
| `tests/e2e/web-demo.spec.ts` | Playwright: load demo, see sample workspace, send AI message via shared key, hit limit, see modal |

### Files to create OUTSIDE this repo

| Path | Purpose |
|---|---|
| `~/services/projelli-demo-proxy/package.json` | Bun service manifest |
| `~/services/projelli-demo-proxy/index.ts` | Bun HTTP server: `/api/demo-chat`, `/api/demo-status` (quota / health) |
| `~/services/projelli-demo-proxy/rateLimit.ts` | Per-session + per-IP rate-limit + daily caps |
| `~/services/projelli-demo-proxy/spendTracker.ts` | Disk-persisted monthly spend tracker (resets first of month) |
| `~/services/projelli-demo-proxy/anthropicClient.ts` | Thin Anthropic SDK wrapper |
| `~/services/projelli-demo-proxy/.env.example` | Documents required env vars: `ANTHROPIC_API_KEY`, `MONTHLY_BUDGET_USD`, `PORT` |
| `~/services/projelli-demo-proxy/README.md` | Operational docs: deploy, monitor, rotate key, raise budget |
| `infra/systemd/projelli-demo-proxy.service` | Systemd unit. Runs as Bun, restarts on failure |

### Files to modify

| Path | Change |
|---|---|
| `infra/Caddyfile` (or system Caddyfile at /etc/caddy/Caddyfile) | Add a route block for `projelli.com/try` serving `dist-web-demo/` + reverse-proxy `/api/demo-chat` to `localhost:<demo-proxy-port>` |
| `infra/deploy.sh` | Run `npm run build:web-demo` and rsync `dist-web-demo/` to `/var/www/projelli.com/try/` |
| `~/projelli/website/index.html` | Add a "Try in browser" CTA next to "Download" on the homepage. UTM-tagged for Plausible tracking |

---

## Task Decomposition

There are 7 task groups.

- Group I: Bun proxy service (out-of-repo, but lives in projelli/projelli plan)
- Group II: Vite build target + entry point + sample workspace JSON
- Group III: WebDemoSeeder + demo mode flag + AI provider override
- Group IV: DemoModeBanner + DemoLimitGate + DemoExitModal
- Group V: BYOKKeyInput
- Group VI: Caddy + systemd + deploy script wiring
- Group VII: Plausible instrumentation + E2E + final PR

---

## Group I: Bun proxy service

- [ ] **Task 1.1** — Scaffold `~/services/projelli-demo-proxy/`. `package.json` with `bun run start` script. TypeScript-first (Bun supports TS natively).
- [ ] **Task 1.2** — `index.ts`: minimal HTTP server using Bun's native `Bun.serve`. Routes `/api/demo-chat` (POST) and `/api/demo-status` (GET).
- [ ] **Task 1.3** — `rateLimit.ts`: per-session-token (5 msg/session) + per-IP (10 sessions/day) + global pool (100 sessions/day). Sessions tracked in-memory; reset daily via timer.
- [ ] **Task 1.4** — `spendTracker.ts`: disk file at `/var/lib/projelli-demo-proxy/spend.json`, format `{ month: '2026-05', spentUsd: 12.34 }`. Increment on each call (estimated cost from response token counts). Refuse new calls if `spentUsd >= MONTHLY_BUDGET_USD`.
- [ ] **Task 1.5** — `anthropicClient.ts`: thin wrapper using the official `@anthropic-ai/sdk` (claude-api skill recommends; pin to current Anthropic SDK version). Supports streaming and non-streaming responses.
- [ ] **Task 1.6** — `index.ts` integration: validates session token, applies rate limits, checks spend cap, forwards to Anthropic, returns response (streaming preferred), increments spend tracker.
- [ ] **Task 1.7** — `infra/systemd/projelli-demo-proxy.service`: unit file with `Restart=always`, `EnvironmentFile=/etc/projelli-demo-proxy.env`, `User=jameson`. Document install: `sudo systemctl enable --now projelli-demo-proxy`.
- [ ] **Task 1.8** — README at `~/services/projelli-demo-proxy/README.md`: install steps, env var docs, monitoring, key rotation, budget management.
- [ ] **Task 1.9** — Smoke test: start the service locally with `bun run start`, curl `/api/demo-status`, curl `/api/demo-chat` with a valid session token, observe rate limits kick in.

## Group II: Vite build target + entry + sample workspace

- [ ] **Task 2.1** — `vite.config.web-demo.ts`: extends base `vite.config.ts`, sets `define: { __PROJELLI_DEMO__: true, __PROJELLI_DESKTOP__: false }`, output `dist-web-demo/`, base path `/try/`.
- [ ] **Task 2.2** — `package.json` script: `"build:web-demo": "vite build --config vite.config.web-demo.ts"`.
- [ ] **Task 2.3** — `src/web-demo/main.tsx`: mounts the app with `WebDemoSeeder` running first, then `<App />` wrapped with `<DemoModeBanner />` always-visible.
- [ ] **Task 2.4** — `src/web-demo/sample-workspace.json`: JSON containing the 12 founder workflow templates (read-only, can copy text), 3-4 sample notes showing AI chat in action, 1 sample chat history file, 1 sample SourceCard. Hand-curate. Include realistic content so prospects see the product working.

## Group III: WebDemoSeeder + demo mode flag + AI provider override

- [ ] **Task 3.1** — `src/web-demo/WebDemoSeeder.ts`: reads `sample-workspace.json`, populates IndexedDB via existing `WebFSBackend`. Idempotent (skips if `__projelli_demo_seeded` localStorage flag is set).
- [ ] **Task 3.2** — `src/web-demo/demoModeFlag.ts`: exports `IS_DEMO = __PROJELLI_DEMO__ === true`. Tree-shaken to false in desktop build.
- [ ] **Task 3.3** — `src/web-demo/demoSessionToken.ts`: generates/refreshes session token. Format: `projelli-demo-<rotating-secret>-<date>`. Stored in localStorage; rotates daily.
- [ ] **Task 3.4** — `src/web-demo/demoAIProvider.ts`: wraps Anthropic provider. If localStorage has `byokKey`, direct call. Else POST to `/api/demo-chat` with session token. Handle 429 (rate limited) + 503 (quota exhausted) with friendly toast: "Demo limit reached. Paste your own API key or download the desktop app for unlimited use."
- [ ] **Task 3.5** — Patch the existing AI chat send path in the React app to use `demoAIProvider` if `IS_DEMO`. Tree-shake-safe behind the flag.

## Group IV: DemoModeBanner + DemoLimitGate + DemoExitModal

- [ ] **Task 4.1** — `src/web-demo/DemoModeBanner.tsx`: sticky top, text + [Download for full version] button (UTM-tagged).
- [ ] **Task 4.2** — `src/web-demo/DemoLimitGate.tsx`: hook around `aiChatStore.send`. Tracks `messageCount` (resets on session end, persists in localStorage with 24h TTL) and `sessionStartTime`. At 5 messages OR 10 minutes elapsed, dispatches event to open `DemoExitModal`.
- [ ] **Task 4.3** — `src/web-demo/DemoExitModal.tsx`: full-screen modal. Title "You've explored Projelli." Body text per spec. Buttons: [Download for Mac] [Download for Windows] [Download for Linux] (all UTM-tagged), [Continue browsing] (dismisses once; returns on next AI action).
- [ ] **Task 4.4** — Tests for each component.

## Group V: BYOKKeyInput

- [ ] **Task 5.1** — `src/web-demo/BYOKKeyInput.tsx`: small input + toggle. Default to "Demo AI · 5 messages" mode. Toggle to "Your AI · unlimited" reveals input. Validates Anthropic key format (`sk-ant-...`). On valid paste, stores in localStorage with confirm dialog: "Your key is stored only in your browser. The Projelli demo never sees it."
- [ ] **Task 5.2** — Wire BYOKKeyInput into the demo's main shell (header next to DemoModeBanner, OR Settings panel within the demo, OR inline in the chat input — UX choice; pick the lowest-friction).
- [ ] **Task 5.3** — Tests.

## Group VI: Caddy + systemd + deploy script wiring

- [ ] **Task 6.1** — Modify the system Caddyfile (`/etc/caddy/Caddyfile`) — add a route block under projelli.com:
  ```
  handle /try/* {
      uri strip_prefix /try
      root * /var/www/projelli.com/try
      try_files {path} {path}/index.html /index.html
      file_server
  }
  handle /api/demo-chat {
      reverse_proxy localhost:<port>
  }
  handle /api/demo-status {
      reverse_proxy localhost:<port>
  }
  ```
  Verify with `caddy validate` then `sudo systemctl reload caddy`.
- [ ] **Task 6.2** — Modify `infra/deploy.sh` to: (a) `npm run build:web-demo`, (b) rsync `dist-web-demo/` to `/var/www/projelli.com/try/`, (c) purge the relevant Cloudflare cache paths.
- [ ] **Task 6.3** — Install systemd unit, start the demo-proxy: `sudo cp infra/systemd/projelli-demo-proxy.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now projelli-demo-proxy`. Verify with `systemctl status` + `curl localhost:<port>/api/demo-status`.

## Group VII: Plausible instrumentation + E2E + final PR

- [ ] **Task 7.1** — Wire Plausible events from the demo: `demo_loaded`, `demo_ai_first_message`, `demo_limit_hit`, `demo_download_clicked`, `demo_byok_used`. Call `window.plausible('event_name', { props: { ... } })`.
- [ ] **Task 7.2** — UTM tag download links: `?utm_source=demo&utm_campaign=v2-launch`. Propagate through to whatever the download buttons point at (probably the homepage's `/download/` section or releases page).
- [ ] **Task 7.3** — `tests/e2e/web-demo.spec.ts` (Playwright). Steps: load `localhost:5173/try/` (or wherever the dev demo serves), see sample workspace, send AI message via shared key (mock the proxy in test), hit limit modal, click download (verify UTM in URL), use BYOK input.
- [ ] **Task 7.4** — Verify Caddy serves `projelli.com/try/` correctly (in the staging environment if available, or local).
- [ ] **Task 7.5** — Verify the demo-proxy is reachable, rate-limited, capped.
- [ ] **Task 7.6** — Update `~/projelli-worktrees/stream-d-web-demo-sandbox/CHANGELOG.md`.
- [ ] **Task 7.7** — `npm run typecheck`, `npm run test`, `npm run lint` clean.
- [ ] **Task 7.8** — Open the PR via `gh`:
  ```
  gh pr create --repo projelli/projelli \
    --base master \
    --head feature/stream-d-web-demo-sandbox \
    --title "feat(stream-d): web demo sandbox at projelli.com/try (v2.0)"
  ```
  PR body: spec reference §7.3, plan reference, smoke test instructions (visit `/try`, send a few messages, hit limit, paste BYOK key).

---

## Acceptance criteria

- A user opens `projelli.com/try` and lands inside a working Projelli demo within 3 seconds.
- The sample workspace appears pre-seeded; user can browse the 12 templates and the 3-4 sample notes.
- Sending an AI message uses the shared demo key transparently (no setup).
- After 5 messages OR 10 minutes, the DemoExitModal appears with a Download CTA.
- BYOK input works: pasting a valid Anthropic key removes rate limits.
- Plausible events fire on the documented triggers.
- Demo proxy enforces rate limits + spend cap + degrades gracefully when exhausted.
- No unsanctioned AI spend (proxy refuses calls past the monthly budget).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Demo proxy abused by bots | Per-IP daily cap + session token rotation + Cloudflare's existing bot protection. CAPTCHA gate added if abuse detected. |
| Monthly budget overrun | Spend tracker is a hard cap. Service refuses new calls past budget. Jameson alerted via separate UptimeRobot monitor on `/api/demo-status` returning quota-exhausted. |
| Demo perceived as the "real" Projelli | DemoModeBanner is sticky, framing is explicit ("You're using the Projelli demo"), exit modal is unambiguous. |
| Browser compat: Safari + Firefox lack File System Access API | Sample workspace runs in-memory only on those browsers; show degradation banner: "demo works best in Chrome or Edge." Mobile browsers redirect to `/docs/mobile-access/`. |
| User pastes their key into a fake field on a phishing clone | BYOK confirmation dialog explicitly says "stored only in your browser, demo never sees it." |
| Anthropic key leak via proxy logs | Proxy logs only metadata (session token, response token counts), never request/response bodies. |

---

## Out of scope

- Editor functionality beyond read-only viewing in demo (sample workspace is read-mostly)
- File save persistence in Safari/Firefox (in-memory only there)
- BYOK for OpenAI/Gemini/Ollama in demo (Anthropic only for v2.0; user can switch by downloading the desktop app)
- Translation of demo into other languages (Stream E may pick this up)

---

## Definition of done

- All 7 task groups completed.
- Live at `projelli.com/try` (verified end-to-end).
- Demo proxy running as systemd service, monitored, budget-capped.
- One PR opened.
- CHANGELOG entry under `[Unreleased]`.

---

## Dispatch hints

- Worktree: `cd ~/projelli && git worktree add ~/projelli-worktrees/stream-d-web-demo-sandbox -b feature/stream-d-web-demo-sandbox master`. Then `npm install`.
- Pass plan path: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-d-web-demo-sandbox.md`.
- Group I (proxy service) is out-of-repo work in `~/services/projelli-demo-proxy/`. Implementer agent has filesystem access; verify the service folder doesn't conflict with anything before scaffolding.
- Caddy + systemd modifications (Group VI) require sudo. Implementer agent may need to surface "I need sudo to install the systemd unit" to Jameson rather than attempting `sudo` itself.
- The demo-proxy and Caddy config touch shared server state; coordinate timing with any Plausible / behaviorux work in flight.
