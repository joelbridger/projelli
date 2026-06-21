# Keepance — Claude Code Project Context

> **Read this first if you're a future Claude session working in this repo.**
>
> **Operating contract:** Read `~/keepance/KEEPANCE_BUSINESS_PLAN.md` BEFORE doing anything substantive. It's the strategic plan, the 8-week launch roadmap, and the record of every CEO-level decision made on Jameson's behalf. Don't override its decisions without explicit board input.
>
> **Current state:** Read `~/keepance/BACKLOG.md` for the live week-by-week task list, what's done, what's in flight, and what's blocked.
>
> **📊 Board dashboard (the big picture — READ IT):** `docs/board/board-data.json` holds the board-level state of the business across eleven areas — Strategy & Vision, Marketing, Sales, Growth & Traction, Competitive & Market, Engineering, UX, UI, Testing, Jameson's Questions, Finance & Metrics. Read it at the start of substantive work for where Keepance is and where it's going (Jameson = Board of Directors; you = CEO reporting in). It's served privately at board.jameworld.com. **Update it ONLY on special occasions — a major decision, a validated insight, a strategy shift, or a real milestone — NEVER on routine work;** then run `bash docs/board/deploy.sh`. Full rules: `docs/board/README.md`.
>
> **🛑 NO SHORTCUTS on the core app — build it RIGHT and robust (rule set by Jameson, 2026-06-20):** For Keepance core app development (the product itself — the desktop app, its Rust backend, its features), do **NOT** do quick fixes, partial fixes, or shortcuts. Get it correct and make it robust. When a fix can be done cheaply-but-incompletely vs. fully-but-with-more-work (more files, a backend/engine change, a longer rebuild/test cycle), **take the long route to the robust solution** — don't even propose the shortcut as the plan. Still verify rigorously (TDD, real tests, bench/live confirmation, independent/Codex review). This sharpens (does not contradict) the "lean, direct execution" default in `~/.claude/CLAUDE.md`: lean still applies to non-core work (scripts, one-off tooling, marketing, infra) and to *how* you execute once the robust approach is chosen — but for the core product the bias is **robustness over minimal effort**. See `~/.claude/projects/-home-jameson/memory/feedback_keepance_robust_no_shortcuts.md`.
>
> **⚠️ Reality check — the product is NOT "finished, just market it" (corrected 2026-06-20):** Recent hands-on testing on real Windows hardware found MANY unfinished and broken areas. The 2026-06-17 strategy docs (`docs/strategy/2026-06-17-keepance-master-plan.md`, `...-path-to-traction.md`, `...-build-session-handoff-...md`) concluded "the product is mature; stop building; the only binding constraint is distribution, not engineering" — **treat that conclusion as OUTDATED.** A lot is built, but finishing and hardening the product (especially on real Windows and Mac) is real, necessary work — alongside, not after, distribution. For the honest current state, trust the board dashboard (`docs/board/`) and the latest `docs/operations/*CURRENT-STATE*` over the June-17 strategy cluster.
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
| **Canonical source** | `/home/jameson/keepance/` | Server-resident, mirrors jameworld/behaviorux/portfolio pattern |
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

**Keepance** (3.0, repositioned 2026-06-09) is **the private intelligence layer for a law practice**: the place a lawyer's confidential work lives (documents, email, matters), kept provably private, that answers questions across all of it with citations you can verify. Word (.docx) is the first-class format via an in-house OOXML engine with tracked changes and AI redline; Markdown never appears in user-facing copy. Recall is matter-scoped with cryptographic isolation; an always-visible egress indicator, a printable Data Map, and a Local-only / BYOK-direct / Assured confidentiality spectrum make the trust story honest and inspectable. North star: `docs/strategy/2026-06-09-keepance-3.0-roadmap.md` + `docs/research/2026-06-08-ux-attorney-v2.5.1/vision-most-viable-keepance.md`.

**The pitch in one sentence:** *The private place your whole practice lives and answers you back: your clients' data never leaves your control, and every answer is cited.*

**The differentiator:** local-first + BYOK + Word-native + matter isolation + a firm tier whose collaboration is end-to-end encrypted (the relay only ever stores ciphertext; ethical walls are enforced by key denial, not UI hiding). AI requests go directly from the user's machine to their provider (or through the firm's zero-retention proxy in Assured mode), never via a Keepance content server.

**ICP (locked 2026-05-27, sharpened 2026-06-09):** litigation-heavy solos and small/mid law firms first (ABA Op 512, U.S. v. Heppner); tax and consulting packs exist but law leads.

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
| **API Key Storage** | OS Keychain (Tauri) → Encrypted file fallback |
| **Testing** | Vitest + React Testing Library | Vite-native |

> **✅ Structure reconciliation (DONE, 2026-06-17).** The 3.0 feature-first reorg is complete: `src/` is now `{app, features, platform, ui, lib}` (one folder per product surface + a cross-cutting platform layer), governed by a 5-layer dependency DAG. **The authoritative map is [`ARCHITECTURE.md`](./ARCHITECTURE.md) — read it first for anything structural.** The "Key Files" / "Directory Structure" sections below are kept only as a coarse historical reference; where they disagree with `ARCHITECTURE.md` or the code, the code wins. The data-layer rows in the table above are accurate.

---

## Key Files

> **Historical paths (pre-3.0-reorg).** Modules moved to `platform/`, components
> to `features/`/`ui/`/`app/`, stores to `platform/`. For current locations use
> **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** or grep by symbol — the tables below
> name the right files but their `src/...` paths are stale.

### Core Modules

| File | Purpose |
|------|---------|
| `src/modules/workspace/WorkspaceService.ts` | File CRUD, path validation, security |
| `src/modules/workspace/WebFSBackend.ts` | Browser File System Access API |
| `src/modules/workspace/TauriFSBackend.ts` | Tauri filesystem backend |
| `src/modules/workspace/PathValidator.ts` | Path traversal blocking |
| `src/modules/editor/EditorService.ts` | CodeMirror integration |
| `src/modules/editor/WikiLinkParser.ts` | `[[link]]` syntax parsing |
| `src/modules/history/HistoryService.ts` | Undo/redo command stack |
| `src/modules/history/TrashService.ts` | Soft delete management |
| `src/modules/workflow/WorkflowEngine.ts` | Workflow execution |
| `src/modules/workflow/RunRecordService.ts` | Run persistence |
| `src/modules/models/Provider.ts` | Model adapter interface |
| `src/modules/models/ClaudeProvider.ts` | Anthropic API adapter |
| `src/modules/models/OpenAIProvider.ts` | OpenAI API adapter |
| `src/modules/models/ModelListService.ts` | Auto-fetch available models from provider APIs with 24h cache |
| `src/modules/models/fetchUtils.ts` | Shared provider base URL resolution (dev proxy / production) |
| `src/hooks/useModelList.ts` | React hook for dynamic model list fetching and caching |
| `src/modules/audit/AuditService.ts` | Append-only action log |
| `src/modules/research/SourceCardService.ts` | Citation management |
| `src/modules/analysis/DocSummaryService.ts` | Document summarization |

### UI Components

| File | Purpose |
|------|---------|
| `src/components/workspace/FileTree.tsx` | Folder/file navigation |
| `src/components/editor/MarkdownEditor.tsx` | CodeMirror wrapper |
| `src/components/editor/TabBar.tsx` | Multiple file tabs |
| `src/components/editor/SplitPane.tsx` | Side-by-side editing |
| `src/components/editor/DiffViewer.tsx` | Change preview |
| `src/components/workflow/WorkflowPanel.tsx` | Workflow launcher |
| `src/components/workflow/InterviewForm.tsx` | Q&A collection |

### Zustand Stores

| File | Purpose |
|------|---------|
| `src/stores/workspaceStore.ts` | File tree, workspace root |
| `src/stores/editorStore.ts` | Open tabs, pane layout |
| `src/stores/workflowStore.ts` | Running workflows, history |
| `src/stores/settingsStore.ts` | User preferences |
| `src/stores/aiChatStore.ts` | AI chat sessions, streaming message updates, draft input persistence |

### Type Definitions

| File | Purpose |
|------|---------|
| `src/types/workspace.ts` | FileNode, Workspace types |
| `src/types/workflow.ts` | WorkflowTemplate, RunRecord, ToolCall |
| `src/types/research.ts` | SourceCard |
| `src/types/analysis.ts` | DocSummary |

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

**Command Pattern for File Operations:**
```typescript
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
}
// All file writes go through commands for undo support
```

**Provider Interface for Models:**
```typescript
interface Provider {
  sendMessage(prompt: string, options?: SendOptions): Promise<ProviderResponse>;
  sendMessageStreaming?(prompt: string, options: StreamOptions): Promise<ProviderResponse>;
  toolCall?(tool: string, params: Record<string, unknown>, options?: SendOptions): Promise<unknown>;
  structuredOutput<T>(prompt: string, options: StructuredOutputOptions): Promise<T>;
  getMetadata(): ProviderMetadata;
}

// StreamOptions extends SendOptions with:
// - onChunk: (chunk: string) => void  — called for each text token
// - signal?: AbortSignal              — allows cancelling mid-stream
```

**AI Chat Provider Selection:**
- Each `.aichat` file stores `provider` and `model` fields
- `AIChatViewer` reads these to instantiate the correct provider (Claude/OpenAI/Gemini)
- Users select their model in the AI Assistant "Models" tab before creating a new chat
- Streaming is used by default; tokens appear in real-time with a Stop button

**FSBackend Abstraction:**
```typescript
interface FSBackend {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(path: string): Promise<FileNode[]>;
}
// Implemented by WebFSBackend and TauriFSBackend
```

### Autosave Behavior

**All file changes are automatically saved** - no manual save required.

**How it works:**
- **Interval**: Every 2 seconds (`src/app/lifecycle/useAutosave.ts`)
- **Trigger**: Changes to file content mark tabs as `isDirty: true`
- **Persistence**: Autosave interval writes dirty tabs to disk via WorkspaceService
- **Visual Indicator**: "Auto-save" / dirty indicator in the status bar (`src/app/shell/layout/StatusBar.tsx`)
- **Version History**: Versionable files (.md, .txt, .json, .source) automatically save versions on content change

**User Experience:**
- Type in any editor → content auto-saves within 2 seconds
- No Ctrl+S required (though keyboard shortcut still works for manual save)
- Tab shows dot indicator when dirty, clears after autosave completes
- All changes persist across app reloads

**Technical Implementation:**
```typescript
// App.tsx - Autosave interval
useEffect(() => {
  const autosaveInterval = setInterval(async () => {
    for (const tab of openTabs) {
      if (tab.isDirty) {
        await workspaceServiceRef.current.writeFile(tab.path, tab.content);
        markSaved(tab.path);
      }
    }
  }, 2000);
  return () => clearInterval(autosaveInterval);
}, [openTabs]);
```

**Note:** This is a deliberate design choice for a local-first application. Users never lose work due to crashes or accidental closes. All file operations go through the same WorkspaceService abstraction, ensuring consistency across browser and Tauri environments.

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

## Directory Structure

> **Historical (pre-3.0-reorg) layout — kept for reference only.** The current
> tree is `src/{app, features, platform, ui, lib}` (feature-first, 5-layer DAG).
> See **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** for the authoritative map.

```
keepance/
├── src/
│   ├── main.tsx                    # Entry point
│   ├── App.tsx                     # Root component
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives
│   │   ├── layout/                 # Sidebar, MainPanel, StatusBar
│   │   ├── workspace/              # FileTree, WorkspaceSelector
│   │   ├── editor/                 # MarkdownEditor, TabBar, SplitPane, DiffViewer
│   │   ├── workflow/               # WorkflowPanel, InterviewForm
│   │   ├── research/               # SourceCardPanel, CompetitorMatrix
│   │   ├── analysis/               # ComparisonView, SynthesisPanel
│   │   ├── settings/               # ApiKeySettings
│   │   └── common/                 # CommandPalette, AuditLog, TrashPanel
│   ├── modules/
│   │   ├── workspace/              # WorkspaceService, FSBackends, PathValidator
│   │   ├── editor/                 # EditorService, WikiLinkParser, BacklinkIndex
│   │   ├── history/                # HistoryService, CommandStack, TrashService
│   │   ├── workflow/               # WorkflowEngine, RunRecordService, templates/
│   │   ├── models/                 # Provider, ClaudeProvider, OpenAIProvider, ModelListService, fetchUtils
│   │   ├── research/               # SourceCardService, CitationParser
│   │   ├── analysis/               # DocSummaryService, ContradictionDetector
│   │   ├── search/                 # SearchService, IndexBuilder
│   │   └── audit/                  # AuditService
│   ├── tools/                      # Unified tool layer for models
│   ├── stores/                     # Zustand stores
│   ├── hooks/                      # React hooks
│   ├── types/                      # TypeScript interfaces
│   ├── utils/                      # Shared utilities
│   ├── lib/                        # Third-party wrappers (sqlite.ts, mermaid.ts)
│   └── styles/                     # globals.css
├── src-tauri/                      # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/               # fs.rs, keychain.rs
│   │   └── lib.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── docs/
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

---

## Current Phase

**v3.0.x — launched (2026-06-09/10), full-vision quality campaign in flight.**

- v3.0.0 published: signed Win/Mac/Linux installers + auto-update; keepance.com on 3.0 positioning/pricing; firm backend LIVE at api.keepance.com; LemonSqueezy subscriptions live.
- Firm desktop wiring complete (2026-06-10): shared matters with cross-member key distribution (ECDH P-256 wrap + admin escrow), live collaborative matter notes (Yjs over the E2EE relay), invite-by-email, ethical walls with key purge + epoch rotation, /org/claim self-serve activation, LS webhook provisioning, Assured routing.
- In flight: the exhaustive usability campaign (persona study + mechanical sweep + native pass) feeding a fix wave and the v3.1.0 release. Campaign home: `docs/quality/2026-06-10-v3-usability-campaign/`; umbrella plan: `docs/superpowers/plans/2026-06-10-v3-full-vision-quality-campaign.md`.
- Read `docs/strategy/2026-06-09-keepance-3.0-STATUS.md` and the project memory before substantive work; parts of the historical sections below (architecture tables, file lists) predate 3.0 and are being reconciled.

**Post-launch build program:** 100% vision-document completion, zero exceptions (board Q7 revised, 2026-06-10). Plan of record: `docs/strategy/2026-06-10-vision-gap-closure-plan.md` (Option B model download → wedge proof → OCR → SSO + encrypted vault → live multi-user .docx co-editing [ship gate overridden, addendum in `spikes/firm-sync/DECISION.md`] → Clio/Office add-ins/DMS connectors, with vendor-access applications running in parallel).

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

## Structured Schemas (Reference)

```typescript
// src/types/workflow.ts
interface RunRecord {
  run_id: string;
  workflow: string;
  model: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  tool_calls: ToolCall[];
  start_time: string;  // ISO datetime
  end_time: string;    // ISO datetime
  status: 'pending' | 'running' | 'completed' | 'failed';
}

// src/types/research.ts
interface SourceCard {
  id: string;
  url: string;
  title: string;
  date_accessed: string;  // ISO date
  quote_or_snippet: string;
  claim_supported: string;
  reliability_notes: string;
}

// src/types/analysis.ts
interface DocSummary {
  doc_id: string;
  thesis: string;
  bullets: string[];
  assumptions: string[];
  risks: string[];
  open_questions: string[];
  actions: string[];
  confidence: number;  // 0-1
  citations: string[];  // SourceCard IDs
}
```

---

## Troubleshooting

### "Module not found" errors
- Check path aliases in `tsconfig.json` and `vite.config.ts`
- Ensure module has `index.ts` barrel export

### Tauri window doesn't open
- Ensure Vite dev server is running on correct port
- Check `tauri.conf.json` devUrl matches Vite port

### TypeScript errors after changes
- Run `npx tsc --noEmit` to see all errors
- Check that strict mode rules are followed

### File operations fail silently
- Check browser DevTools console for permission errors
- Verify workspace root is set correctly

---

## Out of Scope (DO NOT IMPLEMENT)

- Plaintext/cloud-readable sync of user content (firm sync exists but is E2EE-only; the relay must never be able to read content)
- Mobile support
- Autonomous agents (multi-step without approval)
- Web scraping/crawling

---

*When in doubt, choose the path that keeps the founder in control and produces auditable, persistent artifacts.*

---

## Sub-agent model routing

Claude Code routes through a LiteLLM gateway. Two tiers:

- **`haiku`** → local RTX 5070 (Qwen2.5-7B, free, ~1-3s). Use for implementation sub-agents: writing boilerplate, scaffolding components, mechanical code changes, repetitive file edits.
- **`sonnet`** → Anthropic cloud (billed). Use for reasoning-heavy work: architecture decisions, complex debugging, novel problem-solving, anything requiring broad knowledge.
- **`opus`** → Anthropic cloud (billed, expensive). Orchestration only. Don't spawn sub-agents on opus.

**Rule of thumb:** If the sub-agent is executing a well-specified task, use `model: "haiku"`. If it needs to figure something out, use `model: "sonnet"`.
