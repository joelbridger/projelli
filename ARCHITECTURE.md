# Advisor Prep Hero — Architecture

> The canonical map of the frontend codebase (`src/`). Written for both humans
> and AI agents. If a file's location ever disagrees with this doc, trust the
> code and fix the doc. The layer rules below are **machine-enforced** by
> `tests/unit/architecture-boundaries.test.ts`.

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
| **`features/`** | `platform`, `ui`, `lib` | The product **surfaces** — one folder per surface. A feature may import platform/ui/lib freely. It should **not** import another feature; the few real exceptions are an explicit allowlist in the guard test. |
| **`app/`** | anything | The shell that wires the features together: `App.tsx`/`main.tsx` (at `src/` root) plus `src/app/` (lifecycle, dialogs, commands, fileOps, shell routing/layout, workflow runner, app-only hooks). |

**The one rule:** *a layer never imports a layer to its right, and features don't
import other features (except the documented allowlist).* This is what keeps the
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
  bundle id `com.lantern.app`; keychain prefixes `com.lantern.*`; localStorage
  keys `lantern:settings`, `ai-chat-storage`, and the matter keys
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

## History

This structure landed in the 3.0 **feature-first reorganization** (2026-06): the
codebase was migrated from layer-based folders (`components/`, `modules/`,
`stores/`, `hooks/`, `utils/`, `types/`) to the surfaces-and-platform layout above,
behavior-preserving, with all gates green at every commit. See the git history on
`keepance-3.0` (the session handoff doc is in `docs/archive/session-handoffs/`).
