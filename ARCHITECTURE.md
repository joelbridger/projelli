# Keepance — Architecture

> The canonical map of the frontend codebase (`src/`). Written for both humans
> and AI agents. If a file's location ever disagrees with this doc, trust the
> code and fix the doc. The layer rules below are **machine-enforced** by
> `tests/unit/architecture-boundaries.test.ts`.

Keepance is **the private intelligence layer for a law practice**: a local-first
Tauri + React app where a lawyer's documents, email, and matters live, kept
provably private, answering questions across all of it with verifiable citations.
(Product details: `CLAUDE.md` and `KEEPANCE_BUSINESS_PLAN.md`. Data/tech stack:
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
│   ├── email/  matters/  firm/  settings/  audit/  onboarding/  onboarding-journey/  dictation/  account/
│
├── platform/                    # cross-cutting capabilities (by domain)
│   ├── providers/               #   model adapters (Claude/OpenAI/Gemini/Ollama), keychain
│   ├── fs/                      #   WorkspaceService + FS backends + workspace stores
│   ├── rag/                     #   LanceDB/fastembed RAG, facts/memory, ocr/
│   ├── firm/                    #   firm crypto + relay clients + coedit CRDT + vault
│   ├── matter/                  #   the unified matter store (4 slices, multi-key persist) + samples/
│   ├── audit/  privacy/  search/  history/  licensing/  providers/  analysis/  updater/
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
  Tauri bundle id `com.keepance.app`; keychain prefixes `com.keepance.*`;
  localStorage keys `keepance:settings`, `ai-chat-storage`, and the matter keys
  `keepance:matters` / `keepance:matter-ui-snapshots` / `keepance:matter-at-a-glance`.
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

## `src/features/onboarding-journey/` — the animated first-run journey

The animated 8-chapter first-run experience that replaced GuidedOnboarding/FirstRunWizard (2026-06).

```
onboarding-journey/
├── JourneyHost.tsx          # full-screen overlay that hosts the journey; mounted in App.tsx
│                            #   - accepts chapters[], journeyActions, onComplete, onExit
│                            #   - on replay (from Settings): closing just hides overlay;
│                            #     onboarding_complete flag stays true
├── engine/
│   ├── useJourney.ts        # chapter progression state machine (current/next/back/skip)
│   ├── progress.ts          # read/write keepance_journey_progress from localStorage
│   └── types.ts             # Chapter, JourneyData, JourneyActions interfaces
├── scenes/                  # SVG metaphor scenes (one per chapter)
│   ├── SceneFrame.tsx       # reduced-motion wrapper; applies @keyframes from sceneKeyframes.css
│   ├── Brain/Cloud/FilingCabinet/House/KeyShape/Lock/PaperPlane/Papers/ReceiptTag.tsx
│   └── sceneKeyframes.css   # keyframe definitions (honors prefers-reduced-motion)
├── chapters/                # one file per chapter (Ch1–Ch8) + shared layout
│   ├── ChapterLayout.tsx    # two-column layout: scene left, copy + actions right
│   ├── Ch1Welcome.tsx       # welcome / brand intro
│   ├── Ch2AboutYou.tsx      # profession + display name (reuses onboarding sub-components)
│   ├── Ch3FilesStayHome.tsx # local-first explainer + workspace folder picker
│   ├── Ch4MeetTheAI.tsx     # what AI does in Keepance
│   ├── Ch5ChooseYourBrain.tsx # cloud key | local (Ollama guided setup) | defer
│   ├── Ch5LocalSetup.tsx    # Ollama download + model pull walkthrough
│   ├── Ch6Email.tsx         # email connector (reuses settings/MailConnect, MailGmailConnect)
│   ├── Ch7SoloOrFirm.tsx    # solo vs. firm mode selector
│   └── Ch8SeeItWork.tsx     # done screen + addSamples opt-in
└── copy/
    └── strings.ts           # all user-visible strings for the journey (no i18n yet)
```

**Allowlisted cross-feature edges (the two permitted feature→feature imports):**
- `features/onboarding-journey` may import from `features/onboarding/` (ApiKeyWizard, AiSetupReminder, aiSetupState) — both are first-run surfaces owned by the same conceptual domain.
- `features/onboarding-journey/Ch6Email` may import from `features/settings/` (MailConnect, MailGmailConnect) — email connector UI is SSOT in settings; the journey reuses it directly rather than duplicating.

**Replay from Settings:** `src/features/settings/SetupChecklist.tsx` has a "Watch the setup intro again" button wired to `onRestartOnboarding` → `setShowFirstRun(true)` in `App.tsx`. Replay is safe: the `keepance_onboarding_complete` flag is never cleared, so `onComplete`/`onExit` from a replay both simply close the overlay.

## History

This structure landed in the 3.0 **feature-first reorganization** (2026-06): the
codebase was migrated from layer-based folders (`components/`, `modules/`,
`stores/`, `hooks/`, `utils/`, `types/`) to the surfaces-and-platform layout above,
behavior-preserving, with all gates green at every commit. See the git history on
`keepance-3.0` and `docs/operations/2026-06-16-NEXT-SESSION-reorg-handoff.md`.
