# Advisor Prep Hero — Architecture

> The canonical map of the frontend codebase (`src/`). Written for both humans
> and AI agents. If a file's location ever disagrees with this doc, trust the
> code and fix the doc. The layer rules below are machine-checked by
> `tests/unit/architecture-boundaries.test.ts`. A newer shrink-only baseline
> checker also freezes today's deep cross-feature imports and blocks new ones as
> the existing debt is reduced.

Keepance is **the private intelligence layer for a financial advisory practice**:
a local-first Tauri + React app where an advisor's client documents, email, and
files live, kept provably private, answering questions across all of it with
verifiable citations. (The engine's isolation unit is internally still named
`matter`/`matter_id` — never renamed — while the user-facing word is *client*.
Product details: `CLAUDE.md` and `KEEPANCE_BUSINESS_PLAN.md`. Data/tech stack:
`CLAUDE.md` § Technology Stack.)

## The 5-layer dependency DAG

The codebase is organized **by product surface (feature), not by technical layer.**
Everything in `src/` belongs to one of five layers, and dependencies only ever
point **left** (down the stack):

```
   lib  <--  ui  <--  platform  <--  features  <--  app
  (leaf)  (design   (cross-cutting  (product       (the shell that
          system)    capabilities)   surfaces)      composes features)
```

| Layer | May import | What lives here |
|-------|-----------|-----------------|
| **`lib/`** | (nothing internal) | Domain-free leaf utilities (`utils.ts`/cn, `hash`, `locale-detect`, `pdf-extract`). |
| **`ui/`** | `lib` | The design system: Radix/shadcn primitives (`button`, `dialog`, …), the **`ui/kp/`** component library + tokens, and shared presentational pieces used by many surfaces (`SurfaceHeader`, `ConfirmDialog`, `EmptyState`, `brand/`). No business logic. |
| **`platform/`** | `ui`, `lib`, `platform` | Cross-cutting **capabilities** used by 2+ features — services, stores, hooks, types. Organized by domain (see below). Never imports a feature. |
| **`features/`** | `platform`, `ui`, `lib`, another feature's `index.ts` only | The product **surfaces** — one folder per surface. A feature may import platform/ui/lib freely. Another feature exposes only its root `index.ts` public surface; it must never be reached through internally. |
| **`app/`** | anything | The shell that wires the features together: `App.tsx`/`main.tsx` (at `src/` root) plus `src/app/` (lifecycle, dialogs, commands, fileOps, shell routing/layout, workflow runner, app-only hooks). |

**The one rule:** *a layer never imports a layer to its right, and a feature never
imports another feature's internals.* Cross-feature imports may use only
`@/features/<surface>` (or its `index.ts`); shared behavior belongs in platform.
This is what keeps the
app navigable — to understand a surface you read its one folder, and platform
capabilities can't secretly depend on product UI.

Unlayered leaves at `src/` root are outside the DAG and importable by anyone:
`config/` (pricing), `content/` (changelog), `styles/`, `locales/`, `i18n.ts`,
`dev/`, `web-demo/`.

## `src/` map

```
src/
├── App.tsx, main.tsx            # root entry (the shell mount)
├── app/                         # the shell — composes features
│   ├── shell/                   #   AppShell + surface router + layout/ (MainPanel, Spine, StatusBar) + common dialogs (CommandPalette, …)
│   ├── lifecycle/  dialogs/  commands/  fileOps/  workflow/  hooks/
│
├── features/                    # product surfaces (one folder each)
│   ├── ask/                     #   Ask + AIChatViewer + useChatSending + citations + attachments
│   ├── documents/               #   DocumentsHome + editors + ooxml/spreadsheet viewers (media/) + workspace/ file nav
│   ├── workflows/               #   AssociateHome + WorkflowEngine + templates (legal/tax/consulting/advisors) + marketplace
│   ├── email/                   #   EmailWorkspace — Outlook/M365, Gmail, IMAP import + search
│   ├── onedrive/                #   OneDrive/SharePoint connector UI + sync
│   ├── crm/                     #   Wealthbox CRM connector (households → matters)
│   ├── calendly/                #   Calendly connector (meetings → matters)
│   ├── docusign/                #   DocuSign connector (envelopes → matters) — gated on vendor credentials
│   ├── addepar/                 #   Addepar connector — merged, gated on vendor credentials
│   ├── box/                     #   Box connector — merged, gated on vendor credentials
│   ├── jotform/                 #   Jotform connector — merged, gated on vendor credentials
│   ├── sharefile/               #   ShareFile connector — merged, gated on vendor credentials
│   ├── zocks/                   #   Zocks connector — merged, gated on vendor credentials
│   ├── privacy/                 #   data-egress indicator, Data Map, consent flows
│   ├── matters/  firm/  settings/  audit/  onboarding/  dictation/  account/
│
├── platform/                    # cross-cutting capabilities (by domain)
│   ├── providers/               #   model adapters (Claude/OpenAI/Gemini/Ollama), keychain
│   ├── fs/                      #   WorkspaceService + FS backends + workspace stores
│   ├── rag/                     #   LanceDB/fastembed RAG, facts/memory, ocr/, sourceProvenance
│   ├── firm/                    #   firm crypto + relay clients + coedit CRDT + vault
│   ├── matter/                  #   the unified matter store (4 slices, multi-key persist) + samples/
│   ├── clientMap/               #   Client Map feature logic (summaries, at-a-glance, timeline)
│   ├── ai/                      #   shared AI primitives (prompt builders, structured output, eval)
│   ├── mcp/                     #   MCP tool registration + command dispatcher
│   ├── flags/                   #   feature-flag checks (LaunchDarkly-style, local config)
│   ├── audit/  privacy/  search/  history/  licensing/  analysis/  updater/
│   ├── state/                   #   shared cross-feature stores (aiChat, editor, fileContext)
│   ├── profile/  settings/  tools/  voice/
│   └── hooks/  utils/  types/    #   shared leaf hooks/utils/types
│
├── ui/                          # design system (primitives + kp/ + brand/ + shared presentational)
└── lib/                         # domain-free leaf utils
```

Layer sizes (≈): app 33 · features 279 · platform 179 · ui 34 · lib 4.

## Conventions that matter

- **Imports use the `@/` alias** → `src/`. There is a single catch-all alias
  (`@/*` in `tsconfig`, `@` in vite/vitest); import as `@/features/ask/Ask`,
  `@/platform/providers/ClaudeProvider`, etc. No deep per-layer aliases.
- **Locked identifiers — never rename** (grep after any structural change):
  the internal namespace is `lantern` (`APP_NS` — single source of truth:
  `src/config/identity.ts` on the TS side, `src-tauri/src/identity.rs` on the
  Rust side), which the 2026-06-29 Lantern rename applied everywhere: Tauri
  bundle id `com.lantern.app`; keychain prefixes both the reverse-DNS
  `com.lantern.*` (firm/vault/AI-key services) and the Rust-owned `lantern-*`
  services (e.g. `lantern-audit-enc`, `lantern-mail-enc`, `lantern-crm-`);
  localStorage keys `lantern:settings`, `ai-chat-storage`, and the matter keys
  `lantern:matters` / `lantern:matter-ui-snapshots` / `lantern:matter-at-a-glance`.
  (Pre-launch with zero outside users at the time, so the rename didn't need
  to preserve the old `com.keepance.*` / `keepance:*` names anywhere.)
- **The matter store** (`platform/matter/matterStore.ts`) is one store with four
  slices behind a custom **multi-key persist adapter** that preserves the three
  legacy localStorage keys byte-compatibly. Three thin alias-shim re-exports
  (`matterUiStore`/`matterSyncStore`/`matterAtAGlanceStore`) remain for back-compat.
- **Tests** live under `tests/` (unit/integration/e2e/security); `tsconfig`
  type-checks `src` only, so **`npx vitest run` is the real safety net** for
  test-file correctness. Gates: `npm run typecheck` (0) + `npx vitest run`.
- **Adding a new product surface?** Create `src/features/<surface>/`, depend on
  platform/ui/lib, and wire it into the shell in `src/app/`. If two features need
  the same thing, it belongs in `platform/`, not copied or cross-imported.
- **Permanent handle (`data-testid`) naming** — tests and the robot grip elements
  by `data-testid`, never by copy, class, or DOM shape. Rules:
  - **Every interactive element** (button, input, select, tab, clickable card,
    list row) gets a `data-testid`. Shared primitives in `src/ui/kp/` forward it
    (`Button`, `IconButton`, `Chip`, `Card`, `Badge`, `Dropdown`, `SearchField`),
    so most handles are added at the call site; `SegmentedToggle`, `ConfirmDialog`,
    `SlidePanel`, `EmptyState`, `FilterBar`, `SurfaceToolbar` take an explicit
    `data-testid`/`testId` prop.
  - **Kebab-case, semantic, role-based** — name the element's ROLE, not its label
    or position: `ask-composer-input`, `connect-onedrive-button`,
    `spine-nav-matters`, `record-meeting-button`, `confirm-dialog-confirm`. Never
    an English display word (`ok-button`) or a bare index unless the item has no
    stable id (then suffix a stable id: `spine-client-row-${matterId}`).
  - **Handles are permanent.** They're a machine contract. Removing or renaming
    one requires a migration entry in
    `scripts/ui-system/handles.migrations.json`; the handle guard
    (`scripts/ui-system/handle-guard.mjs`, wired into `npm run gate`) fails the
    build otherwise. Adding handles is always free.
  - **Copy assertions go through i18n keys**, never literal strings. See
    `scripts/ui-system/README.md` for the full UI Iteration System (handles,
    tokens, tier gates, robot rehearsal).

## Two local-AI paths — which is canonical

Two on-device inference engines coexist and are **not duplicates** — one is the
product's default, the other is an optional alternative for users who already
run their own local models:

- **Bundled "Local AI" (llama.cpp) — canonical for Local-only mode.** A
  sidecar process Keepance downloads and manages itself
  (`src-tauri/src/sidecars/llama_server.rs`, commands in
  `src-tauri/src/commands/local_llm/`), fronted by
  `src/platform/providers/AppLocalProvider.ts` (`providerId: 'keepance-local'`).
  This is what "Download Local AI" in Settings → AI
  (`src/features/settings/LocalAiSettingsControl.tsx`) sets up, and it's tried
  first whenever a surface needs on-device generation.
- **Ollama connector — optional BYO alternative.** A thin HTTP client
  (`src/platform/providers/OllamaProvider.ts`) against a daemon the *user*
  installs and runs (`http://127.0.0.1:11434`), no bundled binary. Configured
  separately in the Account window
  (`src/features/account/AccountWindow.tsx` → `OllamaSettingsSection.tsx`), not
  in Settings → AI.
- **The single resolution rule** lives in
  `src/platform/providers/resolveLocalProvider.ts`: prefer the embedded engine
  when its model is downloaded and ready, else fall back to the user's Ollama
  daemon. Both satisfy "nothing leaves the device" equally — this only changes
  *which* local engine runs, never whether Local-only mode's no-egress
  guarantee holds. Don't duplicate this fallback logic elsewhere; route new
  local-inference call sites through `resolveLocalGenerationProvider()` /
  `resolveAvailableLocalGenerationProvider()`.

## History

This structure landed in the 3.0 **feature-first reorganization** (2026-06): the
codebase was migrated from layer-based folders (`components/`, `modules/`,
`stores/`, `hooks/`, `utils/`, `types/`) to the surfaces-and-platform layout above,
behavior-preserving, with all gates green at every commit. See the git history on
`keepance-3.0` (the session handoff doc is in `docs/archive/session-handoffs/`).
