<!-- LANTERN-CRM PROGRAM BANNER (keep this block first; fork-only) -->
> **🚨 THIS IS `~/lantern-crm` — THE ISOLATED LANTERN-CRM PROGRAM FORK (Path 4: full CRM, replace Wealthbox). READ [`LANTERN-CRM.md`](./LANTERN-CRM.md) FIRST — it is the charter and it OVERRIDES everything below where they conflict.** In particular: (1) the one-shot workflow (design ALL → freeze → build ALL → test after) is Jameson's explicit choice — no design-build-test loops; (2) **model routing for THIS program: ALL work by Codex (`codex-task`, gpt-5.6-terra, high) — the "Token-Budget Operating Mode" below (Opus driver / Sonnet workers) does NOT apply here**; the only Anthropic model is the Fable 5 coordinator (planning/review/merging); (3) never touch `~/lantern-plus`, `~/keepance`, or `~/lantern`; push only `lantern-crm`/`crm/*` branches; no deploys; no real client data; (4) coordinate compile windows with the mainline session via `~/lantern-coordination/BOARD.md`. The LANTERN-PLUS.md in this folder is inherited history, not this program's mission. Everything below is inherited Keepance/Lantern context — code conventions, architecture, gate commands, and invariants still apply unless the charter says otherwise.

> ## 🔴 CODEX IS OFF (2026-07-13) — CLAUDE MODELS ARE THE DEFAULT WORKERS
> Jameson ran out of Codex tokens and moved to a new Anthropic account. **Every "delegate to Codex / codex-task / gpt-5.6-terra / gpt-5.6-sol" instruction in this file is SUPERSEDED.** Use: **Sonnet 5** = default worker · **Haiku 4.5** = mechanical volume · **Opus 4.8** = coordinator + hard/critical lanes + review · **review must use a different model than the builder**. **Fan out 3-5 concurrent workers, NOT 8-12** (that number was Codex economics — Claude workers cost real tokens and real RAM). The cross-model safety check is gone: compensate by DRIVING the real packaged product on the real OS and prompting reviewers adversarially. Full policy: `~/.claude/CLAUDE.md` OVERRIDE block + memory `feedback_claude_workers_default.md`.



# Keepance — Claude Code Project Context

> **Read this first if you're a future Claude session working in this repo.**
>
> **Operating contract:** Read `~/keepance/KEEPANCE_BUSINESS_PLAN.md` BEFORE doing anything substantive. It's the strategic plan, the 8-week launch roadmap, and the record of every CEO-level decision made on Jameson's behalf. Don't override its decisions without explicit board input.
>
> **Current state:** Read `~/keepance/BACKLOG.md` for the live week-by-week task list, what's done, what's in flight, and what's blocked.
>
> **🗺️ WHERE IS THE CURRENT CODE? Read [`docs/operations/REPO-MAP-CURRENT.md`](docs/operations/REPO-MAP-CURRENT.md) FIRST if you're unsure which folder/branch is current.** The live branch is **`keepance-3.0`**. Read/search current code in **`/home/jameson/lantern`** (pinned to the `keepance-3.0` tip). Start new work in a fresh worktree: `git -C /home/jameson/kp-coord worktree add -b <branch> /home/jameson/kp-<name> keepance-3.0`. **Do NOT trust a random `kp-*` side folder to be current** — check its branch first. (A 2026-06-29 cleanup fixed a stale-checkout problem that had caused wrong search results.)
>
> **🧪 QA / bug-fixing (parallel engine):** Read [`docs/qa/QA_BOARD.md`](docs/qa/QA_BOARD.md) — the control doc for accelerated, PARALLEL QA (isolated worktree agents + Codex on scoped tickets; one lead reviews/gates/merges serially). It has the test/gate commands, the bug DB pointer (`docs/quality/2026-06-20-test-bug-backlog.md`), the scoped-fix ticket protocol, the merge workflow, and the coverage gap-tickets. **Verification rule:** never claim a fix done without showing the exact command you ran + its pass/fail output (`npm run gate` / scoped `vitest` / `node scripts/eslint-gate.mjs`); evidence before assertions.
>
> **📊 Board dashboard (the big picture — READ IT):** `docs/board/board-data.json` holds the board-level state of the business across eleven areas — Strategy & Vision, Marketing, Sales, Growth & Traction, Competitive & Market, Engineering, UX, UI, Testing, Jameson's Questions, Finance & Metrics. Read it at the start of substantive work for where Keepance is and where it's going (Jameson = Board of Directors; you = CEO reporting in). It's served privately at board.jameworld.com. **Update it ONLY on special occasions — a major decision, a validated insight, a strategy shift, or a real milestone — NEVER on routine work;** then run `bash docs/board/deploy.sh`. Full rules: `docs/board/README.md`.
>
> **🛑 NO SHORTCUTS on the core app — build it RIGHT and robust (rule set by Jameson, 2026-06-20):** For Keepance core app development (the product itself — the desktop app, its Rust backend, its features), do **NOT** do quick fixes, partial fixes, or shortcuts. Get it correct and make it robust. When a fix can be done cheaply-but-incompletely vs. fully-but-with-more-work (more files, a backend/engine change, a longer rebuild/test cycle), **take the long route to the robust solution** — don't even propose the shortcut as the plan. Still verify rigorously (TDD, real tests, bench/live confirmation, independent/Codex review). This sharpens (does not contradict) the "lean, direct execution" default in `~/.claude/CLAUDE.md`: lean still applies to non-core work (scripts, one-off tooling, marketing, infra) and to *how* you execute once the robust approach is chosen — but for the core product the bias is **robustness over minimal effort**. See `~/.claude/projects/-home-jameson/memory/feedback_keepance_robust_no_shortcuts.md`.
>
> **⚠️ Reality check — the product is NOT "finished, just market it" (corrected 2026-06-20):** Recent hands-on testing on real Windows hardware found MANY unfinished and broken areas. The 2026-06-17 strategy cluster (now archived at `docs/archive/strategy-2026-06-17/` — master-plan, build-session-handoff, evaluation-path-to-traction, reorientation-execution-summary) concluded "the product is mature; stop building; the only binding constraint is distribution, not engineering" — **treat that conclusion as OUTDATED** (and also superseded by the 2026-06-23/29 advisor re-aim). A lot is built, but finishing and hardening the product (especially on real Windows and Mac) is real, necessary work — alongside, not after, distribution. For the honest current state, trust the board dashboard (`docs/board/`) and the latest `docs/operations/*CURRENT-STATE*` over the June-17 strategy cluster.
>
> **🪟 WINDOWS (and Mac) TESTING IS THE AI's JOB — NOT JAMESON's (rule set by Jameson 2026-06-23, and it is mandatory for every Claude Code instance):** Real-OS testing of Keepance is **YOUR responsibility**, not the user's. There is an always-on **Legion Windows laptop** set up exactly for this (Tailscale device `laptop` = `james@100.127.67.22`, admin). When any change needs real-Windows verification — a smoke test, driving the app like a user, a bench run, confirming a fix live — **you bring the Legion up to the current code, run it, and drive it yourself** via `scripts/desktop-drive.mjs` (CDP over the WebView2 remote-debug port) + `scripts/legion_agent.py` (pyautogui, for native dialogs). **NEVER ask Jameson to run, install, smoke-test, or Windows-test the app himself** — he is the product designer, not your QA. The only things to ask him for are rare physical/biometric taps (a passkey, a FileVault unlock, or powering the laptop on if it is offline). Mac spot-checks use the M1 bench the same way. Full how-to: `~/.claude/projects/-home-jameson/memory/reference_keepance_desktop_control.md` + `project_keepance_dev_velocity.md` + `feedback_windows_testing_is_ai_job.md`.
>
> **If you're working on marketing:** Read `~/keepance/docs/marketing/README.md` first. It's the canonical entry point for all marketing work — explains the marketing/ folder structure (playbook/, channels/, action-packs/, campaigns/) and where new campaigns land. The playbook subfolder ties together email sequences, master playbook, and reply bank; channels/ has per-platform launch packages (PH, HN, IH, Reddit, newsletter, etc.). **Don't write any new marketing content without checking what's already there** — the channel playbooks have pre-staged FAQ replies and reply templates that should be reused, not duplicated. New marketing pushes get a folder under `docs/marketing/campaigns/YYYY-MM-<slug>/`.
>
> **User profile:** Jameson is **NOT a developer**. He's a Senior Product Designer at Wheel Health. Explain technical concepts in plain language. Don't assume he can read code. Don't dump stack traces on him — translate them. The persistent project memory file at `~/.claude/projects/-home-jameson/memory/project_keepance.md` has the full user/project context.
>
> **Voice rules for any user-facing copy:** Every marketing artifact in `docs/features/` and `website/blog/` was written under the rules in `~/.claude/projects/-home-jameson/memory/feedback_marketing_copy_voice.md` and `~/.claude/projects/-home-jameson/memory/reference_ai_writing_tells.md`. The short version: first-person singular always, contractions, specific concrete nouns over abstractions, no "leverage / delve / seamless / transform / empower / elevate / unlock", no italicized fragments at sentence ends, no "It's not X, it's Y" parallelism, uneven sentence length, occasional informal fragments. If in doubt, read the homepage at keepance.com (audited 2026-04-08) for the canonical voice reference.

## Token-Budget Operating Mode (Keepance only)

> **Scope: this project only.** These rules live in the Keepance `CLAUDE.md`, so they apply *only* when a Claude Code session is working in this repo. They do **not** change how you pick models in any other project on the server, and they do **not** touch the global `~/.claude/CLAUDE.md`. Manual model control everywhere else is unchanged.
>
> **Why this exists:** finishing 3.0 to 100% of the vision while staying inside a $100 Max 5x weekly budget, without compromising thinking ability or code quality. The prior approach (Claude Fable 5 at Max effort) was the single most expensive configuration possible and exhausted a $200 plan in three days. The fix below keeps quality high (Opus 4.8 is the strongest bug-finder of the family) while cutting burn several-fold.

**Model + effort policy for work in this repo:**

- **Driver / orchestrator / reviewer: Opus 4.8 at `high` effort.** High is the quality-vs-tokens sweet spot. Do **not** run the main session at Max effort as a default.
- **Raise to `xhigh` only for the two correctness-critical, data-loss-sensitive builds:** the **encrypted workspace vault** (VG-6d-v2) and the **live multi-user co-editing CRDT** (VG-8). Everything else stays at `high`.
- **Claude Fable 5 = break-glass only.** Never the default. If Opus genuinely stalls on one intractable problem (e.g. a nasty CRDT convergence bug), spend a single scoped Fable session on just that, then drop straight back to Opus 4.8.
- **Delegate the volume so it never touches the premium bucket.** Most tokens in a build are mechanical, not the hard 20%. Use subagent-driven development and push work down a tier per the **Sub-agent model routing** section below:
  - well-specified implementation → **Sonnet 4.6** subagents (`model: "sonnet"`; effectively unlimited on Max 5x for normal workloads)
  - boilerplate / scaffolding / renames / fixtures / mechanical edits → **`model: "haiku"`** (cheapest tier)
  - Opus 4.8 reviews the diffs; it does not write the boilerplate.

> **Routing reality check (verified 2026-06-11):** Claude Code is **not** currently routed through the local LiteLLM gateway (no `ANTHROPIC_BASE_URL` set in env, shell profiles, or either `settings.json`). So `model: "haiku"` subagents bill as **Anthropic cloud Haiku ($1/$5 per MTok)** today, not the free local RTX 5070. Cloud Haiku is still the cheapest tier, so the strategy holds; the "free" local offload only becomes real once the gateway is wired into Claude Code. The bottom "Sub-agent model routing" section describes that intended setup (and names Qwen2.5-7B, which is not loaded — only llama3.1:8b / llama3.2:3b are), so treat it as aspirational until the gateway is hooked up.

**Per-wave model map (remaining work to 100%):**

| Wave | Driver / reviewer | Implementation subagents |
|---|---|---|
| Wave 2 finale (re-review + native re-run) | Opus 4.8 · high | Sonnet 4.6 + local-Haiku |
| Wave 3a: SSO (OIDC) | Opus 4.8 · high | Sonnet 4.6 |
| Wave 3b: encrypted vault | Opus 4.8 · **xhigh** | Sonnet 4.6 (Opus reviews every diff) |
| Wave 4: live co-editing CRDT | Opus 4.8 · **xhigh** | Sonnet 4.6 |
| Wave 5: connectors (Clio / add-ins / DMS) | Opus 4.8 · high | Sonnet 4.6 + local-Haiku for boilerplate |

**Token hygiene (the quiet 30-60% saver):**

- `/compact` roughly every 30 turns; long sessions re-read the whole transcript each turn (near-quadratic growth).
- Reference files by path ("the `validateToken` function in `src/auth.ts`") instead of pasting; trim logs/stack traces to the relevant 20-30 lines.
- Feed each wave its already-written plan up front in one well-specified prompt. Opus 4.8 wastes tokens inferring scope across many turns and rewards a clear goal stated once.
- Stay terse between tool calls on autonomous builds. Opus 4.8 narrates more by default; that is pure output tokens you do not need. Lead the final summary with the outcome, then detail.

---

## Where things live

| Item | Path | Notes |
|---|---|---|
| **Canonical source** | `/home/jameson/lantern/` | Server-resident, mirrors jameworld/behaviorux/portfolio pattern |
| **GitHub** | `github.com/keepance/keepance` | Org owned by joelbridger account; transferred from joelbridger/keepance on 2026-04-08 |
| **Live website** | `https://keepance.com` → `/var/www/keepance.com/index.html` | System Caddy on `:8080`, Cloudflare tunnel `d4e16129` |
| **Deploy script** | `~/keepance/infra/deploy.sh` | rsync website/ → /var/www/keepance.com + CF cache purge |
| **Business plan** | `~/keepance/KEEPANCE_BUSINESS_PLAN.md` | Operating contract — every CEO decision lives here |
| **Backlog** | `~/keepance/BACKLOG.md` | Week-by-week tickets, includes marketing asset inventory section |
| **Full user-test playbook** | `~/keepance/docs/quality/full-user-test-playbook.md` | Repeatable "drive it like a user" test (Playwright on the dev server + real keys + the 6 journeys + native-import harnesses). Run before any release candidate. Say "run the full user-test playbook". |
| **Board action items** | `~/keepance/docs/operations/BOARD_ACTION_ITEMS.md` | Engineering / financial / identity work that needs Jameson's hands (Azure signing, Apple Developer, LemonSqueezy, etc.) |
| **Marketing entry point** | `~/keepance/docs/marketing/README.md` | **Read first before any marketing work.** Explains the marketing/ folder structure (playbook, channels, action-packs, campaigns) and where new campaigns land. |
| **Marketing playbook** | `~/keepance/docs/marketing/playbook/MARKETING_PLAYBOOK.md` | Master index tying all marketing artifacts together + critical-path launch timeline. |
| **Marketing action pack** | `~/keepance/docs/marketing/action-packs/JAMESON_ACTION_PACK.md` | The 8 marketing tasks only Jameson can do (PH hunters, beta testers, screenshots, demo video, X posts, etc.) with pre-staged drafts. Complementary to BOARD_ACTION_ITEMS.md, not a duplicate. |
| **Competitive landscape** | `~/keepance/docs/reference/COMPETITIVE_LANDSCAPE.md` | Side-by-side vs Notion AI / Obsidian / ChatGPT / Reflect / Tana / etc. with reply paragraphs ready for PH/HN comments. |
| **Channel playbooks** | `~/keepance/docs/marketing/channels/{PRODUCT_HUNT_LAUNCH,SHOW_HN_LAUNCH,INDIE_HACKERS_LAUNCH,NEWSLETTER_OUTREACH,REDDIT_SIDEPROJECT_POST,DIRECTORY_SUBMISSIONS,PH_HUNTERS,BUILD_IN_PUBLIC_TWEETS}.md` | Per-channel launch playbooks with title variants, reply templates, anti-patterns. |
| **Email sequences** | `~/keepance/docs/marketing/playbook/EMAIL_SEQUENCES.md` | 10 plain-text emails covering signup → purchase → retention → refund → re-engagement. |
| **Press kit** | `~/keepance/website/press-kit/` | Live at keepance.com/press-kit/ — founder bio (3 lengths), fact sheet, brand colors, screenshot slots, demo video links. |
| **Blog** | `~/keepance/website/blog/` | Live at keepance.com/blog/ — multiple publishable posts (8-week launch story, why local-first, picking templates, Notion AI math, hidden tokenizer tax, chat persistence, v1.5 announce). |
| **Docs** | `~/keepance/docs/{reference,operations,features,marketing,quality,strategy,launch-v1.0,archive}/` | Reorganized 2026-04-22: `features/` = product release plans only; `marketing/` = ALL marketing work; `launch-v1.0/` = one-time v1.0 launch operational docs (renamed from `launch/`). |
| **Financial / legal** | `~/financial/` | Server-wide repository for tax, entity, banking, legal, insurance, retirement decisions. **Read first for any tax/legal/banking question.** Core timeline: `~/financial/08-recommendations/minimum-viable-launch.md` (milestone-gated launch framework reusable across projects). |
| **CI** | `~/keepance/.github/workflows/release.yml` | Tauri matrix build for Win/Mac/Linux on git tag |

## Quick Reference (development)

| Item | Value |
|------|-------|
| **Start Command** | `npm run dev` (browser) or `npm run tauri:dev` (desktop) |
| **Build Command** | `npm run build` or `npm run tauri:build` |
| **Test Command** | `npm run test` |
| **Port** | 5173 (Vite default) |
| **TypeScript** | Strict mode enabled |
| **Target Platforms** | Windows, macOS (arm + intel), Linux — all live and signed since v3.0.0, with auto-update |

---

## What Keepance is

**Keepance** (3.0, re-aimed 2026-06-23 to FINANCIAL ADVISORS) is **the private intelligence layer for a financial advisory practice**: the place an advisor's confidential client work lives (documents, email, client files), kept provably private, that answers questions across all of it with citations you can verify. Word (.docx) is the first-class format via an in-house OOXML engine with tracked changes and AI redline; Markdown never appears in user-facing copy. Recall is client-scoped with cryptographic isolation; an always-visible egress indicator, a printable Data Map, and a Local-only / BYOK-direct / Assured confidentiality spectrum make the trust story honest and inspectable. North star: the advisor re-aim docs `docs/strategy/2026-06-28-strategic-advisor-memo.md` + `KEEPANCE_STRATEGIC_ADVISOR_ACTION_PLAN.md` (these supersede the 2026-06-09 attorney positioning in `docs/strategy/2026-06-09-keepance-3.0-roadmap.md`).

> **🎯 Board direction (2026-06-29, Jameson — OFFICIAL STANCE):** Keepance competes to be the **leading financial-advisor AI** — head-on, **not** a retreat to a niche — and positions as a **simple, powerful AI app (connect your files → ask cited questions → living Client Map), NEVER a note-taker.** Win on **simplicity + AI-first clarity**, not integration breadth ("connect 60 things" is the incumbent Jump's failure mode — don't become it). Notetaking is at most a feature, never the identity. Full decision + rationale: `docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`. This **supersedes the "reposition away from advisors / retreat to a narrow wedge" counsel** in the 2026-06-28 competitive analysis + advisor memo (those remain useful competitor/market intel; their retreat recommendation does not govern). The "get real first users, don't only build" discipline still holds.

> **Facade note (do not break):** the engine keeps the internal name `matter` / the `Matter` type and `matter_id` on the wire — **never rename them.** Only USER-FACING copy becomes client/household. "Client-scoped" above is the user-facing name for the same matter-isolation engine.

**The pitch in one sentence:** *The private place your whole practice lives and answers you back: your clients' data never leaves your control, and every answer is cited.*

**The differentiator:** local-first + BYOK + Word-native + per-client isolation (matter isolation internally) + a firm tier whose collaboration is end-to-end encrypted (the relay only ever stores ciphertext; information barriers are enforced by key denial, not UI hiding). AI requests go directly from the user's machine to their provider (or through the firm's zero-retention proxy in Assured mode), never via a Keepance content server.

**ICP (re-aimed 2026-06-23):** solo and small/mid RIA and financial-advisory practices first, where the buyer is confidentiality-anxious about client data (Reg S-P, Reg BI; unit = client/household). The law, tax, and consulting packs still exist as adjacent verticals (law is kept as a secondary segment), but advisors now lead.

**Pricing (3.0, live):** per-seat ANNUAL subscriptions via LemonSqueezy: Solo $468/yr (wire code `personal`), Professional $948/yr (`professional`), Firm $1,548/seat/yr (`practice`, min 3 seats enforced server-side). Pre-3.0 one-time buyers are grandfathered forever (entitlement layer guarantees data access is never gated). Canonical config: `src/config/pricing.ts`.

**Key Principles:**
- **Local-first** — works offline (except for AI calls)
- **Chat creates artifacts** — every AI interaction produces persistent, editable documents
- **User in control** — AI proposes, user decides; destructive ops need confirmation
- **Reproducible** — every workflow run is replayable
- **Auditable** — append-only log of all AI actions
- **BYOK forever** — Keepance never holds AI keys, never sees user data, never charges for inference

---

## Architecture

### Layered System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│         React + TypeScript + Zustand + shadcn/ui + Tailwind CSS             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CORE MODULES                                      │
│  Workspace │ Editor │ History │ Workflow │ Models │ Research │ Analysis     │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TOOL LAYER                                        │
│     filesystem │ history │ search │ render │ research                        │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────────┐
│ FILES - your documents        │   │ LOCAL STATE + SPECIALIZED STORES      │
│   WebFS / Tauri FS backends   │   │  Zustand+localStorage · LanceDB(RAG)  │
└───────────────────────────────┘   └───────────────────────────────────────┘
```

### Technology Stack (MANDATORY - DO NOT DEVIATE)

| Layer | Technology | Notes |
|-------|------------|-------|
| **Frontend** | React 18 + TypeScript 5 + Vite 6 | Strict mode enabled |
| **State** | Zustand | No providers needed, works outside React |
| **UI Components** | shadcn/ui + Radix + Tailwind CSS 3 | Accessible, customizable |
| **Editor** | In-house OOXML (.docx) engine + TipTap | Word-native is primary: tracked changes + AI redline. CodeMirror is kept for plain-text/Markdown utility files (.md/.txt/.json). |
| **Desktop** | Tauri 2 | Small binary, native security model |
| **Persistence** | Flat files (WebFS / Tauri FS) for documents; Zustand + `localStorage` for app state | **NO sql.js.** RunRecords are `.workflow` files; SourceCards are `.source` files. |
| **Search** | minisearch (full-text) + fuse.js (fuzzy / quick-open) | **NO FlexSearch.** Semantic RAG = LanceDB + fastembed (e5-small), native Rust, stored under `~/.keepance`. |
| **Audit / mail store** | SQLCipher + rusqlite (Tauri only) | Append-only encrypted audit log; mail-import metadata. Not a general app DB. |
| **Vault** | AES-256-GCM flat files (`keepance-vault` crate) | Encrypted workspace; keys in OS keychain. |
| **Diagrams** | Mermaid | (Legacy; tied to the markdown preview being removed.) |
| **API Key Storage** | OS Keychain (Tauri, `KeychainService` Tauri backend) → `localStorage` fallback (base64-obfuscated, browser/dev only). The raw key is never written to plain `localStorage` (`useApiKeys` persists only through `KeychainService`); a one-time migration (`migrateLocalStorageApiKeysToKeychain`, v2) moves any legacy plaintext `apiKey_<provider>` entry from older builds into the keychain (or obfuscated localStorage in the browser) and deletes it. |
| **Testing** | Vitest + React Testing Library | Vite-native |

> **✅ Structure reconciliation (DONE, 2026-06-17).** The 3.0 feature-first reorg is complete: `src/` is now `{app, features, platform, ui, lib}` (one folder per product surface + a cross-cutting platform layer), governed by a 5-layer dependency DAG. **The authoritative map is [`ARCHITECTURE.md`](./ARCHITECTURE.md) — read it first for anything structural.** The "Key Files" / "Directory Structure" sections below now just point to it and to a layer map; the stale pre-3.0 per-file tables (`src/modules/…`, `src/components/…`, `src/stores/…`) that used to live there were removed (they'd send you to paths that no longer exist). The data-layer rows in the table above are accurate.

---

## Key Files

> **The authoritative code map is [`ARCHITECTURE.md`](./ARCHITECTURE.md).** Read
> it first for structure. The old per-file tables that used to live here named
> `src/modules/…`, `src/components/…`, `src/stores/…`, `src/types/…` paths — all
> of which were retired in the 3.0 feature-first reorg. They're gone, not
> caveated, to avoid sending anyone to a path that no longer exists. Use the
> layer map below to know *which folder* a thing lives in, then grep by symbol
> for the exact file (the symbols themselves were preserved through the reorg).

**Old layout → where it lives now** (the reorg moved files by layer, see `ARCHITECTURE.md`):

| Old (pre-3.0) | Now | Verified anchor examples |
|---|---|---|
| `src/modules/<x>/` (services, engines, providers) | `src/platform/<domain>/` or, if surface-specific, `src/features/<surface>/` | `WorkspaceService` → `src/platform/fs/WorkspaceService.ts`; `ClaudeProvider`/`OpenAIProvider`/`Provider` → `src/platform/providers/`; `AuditService` → `src/platform/audit/AuditService.ts`; `WorkflowEngine` → `src/features/workflows/engine/WorkflowEngine.ts` |
| `src/components/<x>/` | `src/features/<surface>/`, `src/ui/`, or `src/app/shell/` | `FileTree` → under `src/features/documents/…/workspace/`; design-system primitives → `src/ui/` |
| `src/stores/<x>` | `src/platform/state/` (shared cross-feature) or a feature/platform domain | `aiChatStore` → `src/platform/state/aiChatStore.ts`; the matter store → `src/platform/matter/matterStore.ts` |
| `src/types/<x>` | `src/platform/types/` | `workflow.ts` (`RunRecord`, `ToolCall`) → `src/platform/types/workflow.ts` |
| `src/hooks/<x>` | `src/platform/hooks/` or `src/app/.../hooks/` | — |

To find any file fast: `grep -rl "export ... <SymbolName>" src/` — symbols are stable; folder paths are not. The Rust backend lives under `src-tauri/src/commands/` (one folder per area) plus the `keepance-vault` / `keepance-docx` crates.

---

## Development Guidelines

### Code Style

- **TypeScript strict mode** - All code must pass strict type checking
- **React functional components** - No class components
- **shadcn/ui patterns** - Use existing components, don't reinvent
- **Zustand for state** - Keep stores focused, use selectors
- **Path aliases** - Use `@/` prefix for imports (e.g., `@/platform/fs/WorkspaceService`, `@/features/ask/Ask`). See `ARCHITECTURE.md` for the layer layout.

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | `PascalCase.tsx` for components, `camelCase.ts` for utilities | `FileTree.tsx`, `pathUtils.ts` |
| Components | `PascalCase` | `WorkflowPanel` |
| Functions | `camelCase` | `validatePath()` |
| Types/Interfaces | `PascalCase` | `RunRecord`, `SourceCard` |
| Zustand stores | `use*Store` | `useWorkspaceStore` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_UNDO_STACK_SIZE` |

### Important Patterns

**Command Pattern for File Operations:** Every file write goes through a `Command` object with `execute()` / `undo()` methods — see `src/app/fileOps/` for the interface.

**Provider Interface for Models:** All AI providers implement a shared `Provider` interface (`sendMessage`, streaming `onChunk`, `toolCall`, `structuredOutput`) — see `src/platform/providers/` for the definition and adapters.

**AI Chat Provider Selection:**
- Each `.aichat` file stores `provider` and `model` fields
- `AIChatViewer` reads these to instantiate the correct provider (Claude/OpenAI/Gemini)
- Users select their model in the AI Assistant "Models" tab before creating a new chat
- Streaming is used by default; tokens appear in real-time with a Stop button

**FSBackend Abstraction:** `read` / `write` / `delete` / `move` / `list` — two implementations: `WebFSBackend` (browser dev) and `TauriFSBackend` (desktop). See `src/platform/fs/`.

### Autosave Behavior

All file changes are auto-saved every 2 seconds (`src/app/lifecycle/useAutosave.ts`). Tabs show a dirty dot that clears after save; no Ctrl+S needed. All writes go through `WorkspaceService`, consistent across browser and desktop.

### Anti-Patterns to Avoid

- **NO direct file system access** - Always go through WorkspaceService
- **NO storing API keys in plaintext** - Use KeychainService
- **NO autonomous AI operations** - User must approve all changes
- **NO plaintext cloud sync** - Solo mode is local-only. Firm-tier shared matters sync ONLY as end-to-end-encrypted blobs through the relay (per-matter keys in OS keychains; the server can never read content). Never add a sync path the relay could read.
- **NO chat-only patterns without artifacts** - Every chat interaction must produce/modify persistent documents
- **NO path concatenation without validation** - Use PathValidator

### Security Requirements

1. **Path Validation** - Block `../` traversal, deny symlinks escaping workspace
2. **API Key Security** - OS keychain primary, never log keys
3. **Audit Logging** - All AI actions logged (append-only)
4. **Destructive Ops** - Require confirmation with diff preview
5. **Prompt Injection** - Sanitize external content before including in prompts

---

## Testing Requirements

### Unit Tests Required For:
- Workspace operations (CRUD for folders/files)
- Path validation (traversal blocking)
- History/undo operations
- Schema validation (DocSummary, SourceCard, RunRecord)
- Search indexing and querying

### Integration Tests Required For:
- Full workspace flow (create, edit, undo, delete, restore)
- "New Business Kickoff" workflow with mock models
- Research flow (create SourceCard, cite in doc)

### Security Tests Required For:
- Path traversal attempts (`../../../etc/passwd`)
- Symlink escape attempts
- Prompt injection scenarios

### Running Tests:
```bash
npm run test              # Run all tests (Vitest unit + integration)
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage
npx playwright test       # E2E
```

### Gate (full pre-merge / pre-release check):
```bash
npm run gate        # typecheck + i18n + vitest + ESLint + Rust cargo tests
npm run gate:full   # also runs browser E2E + desktop harness (slow)
```

A pre-push hook runs typecheck + unit tests automatically before every push; bypass for docs-only pushes with `git push --no-verify`.

---

## Project skills (this repo)

A few Claude Code skills live under `.claude/skills/` (auto-discovered in any session here). Adapted from Matt Pocock's "skills for real engineers", trimmed to fit this repo:

- **`diagnosing-bugs`** — for any bug or "this is broken / slow", prefer this over the generic global debug skill. Its rule: build the **smallest fast command, test, or test-bench action** that proves the bug is real and later proves it fixed, **before** theorizing. The ~60–90 min signed build is never that loop — use Vitest / `cargo test` / Playwright / the desktop harness / a real test-bench app.
- **`tdd`** — the red-green habit for new features and fixes (one behavior test → implement → repeat). Tuned so it does not nag for permission; covers both Rust (`cargo test`) and the frontend (Vitest).
- **`codebase-design`** *(installed globally)* — shared vocabulary for deep modules: small interface, real seam, test through the interface, avoid shallow pass-through modules. Reach for it when designing or refactoring on either the Rust or React side.

---

## Changelog Updates

**After EVERY implemented change, update CHANGELOG.md:**

1. Add changes under `## [Unreleased]`
2. Use categories: `### Added`, `### Changed`, `### Fixed`, `### Removed`
3. Include file names and specific details
4. Keep entries concise but informative

```markdown
### Added
- **Feature Name** - Brief description
  - Implementation detail
  - Files modified: `WorkspaceService.ts`, `FileTree.tsx`
```

---

## Product Journey log

**On a MAJOR product decision or directional change, append a dated, plain-language entry to [`docs/PRODUCT-JOURNEY.md`](docs/PRODUCT-JOURNEY.md)** (see that file's header for what counts as "major" and the exact format). "Major" = a strategic pivot or repositioning, a headline feature milestone shipping, a significant architecture/identity change, a go/no-go or direction call, a major release, or abandoning/replacing a major approach — NOT routine code changes. The `CHANGELOG.md` covers all notable changes; the journey log is the higher-altitude story a non-engineer can follow. The coordinator and product workers keep it current.

---

## Directory Structure

> **The authoritative `src/` map is [`ARCHITECTURE.md`](./ARCHITECTURE.md).** The
> old ASCII tree that used to live here described the pre-3.0 layer-based layout
> (`components/`, `modules/`, `stores/`, `hooks/`, `types/`, `utils/`) — none of
> which exists anymore. It has been removed rather than caveated. The current
> shape, in one line:

```
keepance/
├── src/                  # feature-first frontend, 5-layer DAG (lib ← ui ← platform ← features ← app)
│   ├── app/              #   the shell that composes features (App.tsx, shell/, lifecycle/, dialogs/, …)
│   ├── features/         #   product surfaces, one folder each (ask, documents, email, matters, firm, workflows, settings, …)
│   ├── platform/         #   cross-cutting capabilities (providers, fs, rag, firm, matter, audit, state, types, …)
│   ├── ui/               #   design system (shadcn primitives + ui/kp/ + brand/)
│   └── lib/              #   domain-free leaf utilities
├── src-tauri/            # Tauri Rust backend (commands/ one folder per area; crates: keepance-vault, keepance-docx)
├── backend/             # firm backend (E2EE relay + SSO), deployed to api.keepance.com
├── tests/               # Vitest (unit/integration/security) + Playwright (e2e)
├── website/             # marketing site (deploys to keepance.com)
├── docs/                # all project docs (see docs/README.md for the index)
└── infra/, public/, scripts/, .github/workflows/
```

See `ARCHITECTURE.md` for the full per-folder breakdown, the layer rules (machine-enforced by `tests/unit/architecture-boundaries.test.ts`), and the locked identifiers that must never be renamed.

---

## Current Phase

**v3.3.5 — shipped on all platforms; re-aimed to financial advisors; pre-launch traction phase.**

- **Version:** v3.3.5 is the current release (signed Win/Mac/Linux installers + auto-update, LemonSqueezy subscriptions, firm backend live at api.keepance.com). The full 3.0 vision shipped across the 3.0→3.3 line (Word engine + AI redline, client-scoped cited recall, email + OneDrive + Wealthbox connectors, SSO, encrypted vault, OCR, live multi-user .docx co-editing).
- **Positioning:** re-aimed to **financial advisors** (2026-06-23), and the 2026-06-29 board decision set the direction: compete head-on to be the leading advisor-AI, as a simple AI-first app (connect files → ask cited questions → living Client Map), **not** a note-taker. Law/tax/consulting are secondary verticals.
- **Focus now:** not new features — **prove real advisors use it weekly and that one or two will pay.** A 3-tab IA (Client Map · Ask · Workflows), an advisor-first sample workspace, a live web demo, and a clean 3×-in-a-row Windows smoke are the current health signals. Nothing has shipped to outside users yet.
- **Read first for current state:** the board dashboard ([board.jameworld.com](https://board.jameworld.com)) + [`docs/operations/2026-06-24-advisor-website-board-CURRENT-STATE.md`](docs/operations/2026-06-24-advisor-website-board-CURRENT-STATE.md), the advisor re-aim docs (`docs/strategy/2026-06-28-strategic-advisor-memo.md`, `docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`), and the project memory. The 2026-06-17 "product is mature, stop building" strategy cluster is **superseded** and archived under `docs/archive/strategy-2026-06-17/`.

**Connectors (status, code-grounded):** shipping today — Email (Outlook/M365, Gmail, IMAP), OneDrive/SharePoint, Wealthbox (CRM), Calendly. Code-complete but gated on vendor credentials — DocuSign, Salesforce, Redtail. Five additional connectors (Addepar, Box, Jotform, ShareFile, Zocks) are **merged into `keepance-3.0` and live in `src/features/`**, gated on vendor credentials. Roadmap, no code yet — Clio, iManage/NetDocuments, Office add-ins (vendor-access applications running in parallel). Authoritative detail: [`docs/reference/CONNECTORS.md`](docs/reference/CONNECTORS.md).

---

## Commands

```bash
# Development
npm run dev                 # Start Vite dev server (browser)
npm run tauri dev           # Start Tauri desktop app

# Build
npm run build               # Build for production (browser)
npm run tauri build         # Build desktop installer

# Code Quality
npm run lint                # Run ESLint
npm run format              # Run Prettier
npm run typecheck           # TypeScript type check

# Testing
npm run test                # Run Vitest
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage

# Syntax Check (before commit)
npx tsc --noEmit
```

---

## Structured Schemas

Key types live in `src/platform/types/` — `workflow.ts` (`RunRecord`, `ToolCall`), `research.ts` (`SourceCard`), `analysis.ts` (`DocSummary`). Read the source files for the current shape; don't rely on a copy here.

---

## Out of Scope (DO NOT IMPLEMENT)

- Plaintext/cloud-readable sync of user content (firm sync exists but is E2EE-only; the relay must never be able to read content)
- Mobile support
- Autonomous agents (multi-step without approval)
- Web scraping/crawling

---

*When in doubt, choose the path that keeps the founder in control and produces auditable, persistent artifacts.*

