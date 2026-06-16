# Keepance — UX / Reimagined-Shell Session Handoff (2026-06-16)

> Read this first if you're picking up the reimagined-shell UI work.
> For overall 3.0 product state (SSO, vault, co-editing, deploy) see
> `docs/operations/2026-06-13-CURRENT-STATE.md` — this doc is **only** the
> design-system / shell UX workstream.

## TL;DR

A long, iterative UX polish pass on the reimagined law-first shell. All work is
on branch **`keepance-3.0`**, **NOT deployed** (commercial boundary — explicit
go required before any production deploy). Working tree is clean and in sync
with origin at commit **`797633c`**.

Gates as of this handoff:
- `npm run typecheck` → **0 errors**
- full `npx vitest run` → **3519 passed, 6 skipped**
- citation e2e (`tests/e2e/citation-persistence.spec.ts`) → **3/3** (run earlier this session)
- Visually verified on the live dev server (account window, settings sub-tabs, Extensions, search).

## What shipped this session (newest first)

| Commit | What |
|---|---|
| `797633c` | **Horizontal tabs + header cleanup + Extensions UX.** Settings sub-sections and the account window are now horizontal tabs (was a vertical accordion). Removed redundant section titles (Advanced/Privacy/Mobile/Plugins/Marketplace). Full Extensions cleanup. |
| `cea3c02` | **Comprehensive Settings search + 3 fixes.** Search now indexes the bespoke controls (language picker, plugins, local models, setup links) via a keyword registry + relevance ranking. Data map dialog made collapsible (print-safe). Workflows "Running in: <matter>" badge moved into the content above the groups. MCP section spacing fixed. |
| `7ceefd8` | **Onboarding identity + account collapse.** New "Make it yours" onboarding step (name + photo) after Profession; firm name + logo capture in the Firm step (prefilled from `org.name`); rail/window firm name falls back to `org.name`. Account window made collapsible (later → tabs in 797633c). |
| `84ce695` | **Account/firm identity in the rail + Account window.** Replaced the rail "Collapse" affordance with an account identity chip (solo name+photo / firm name+logo, both uploadable). Clicking opens a dedicated Account window holding the profile editor + License / Firm / Usage / Connections. Removed the "Account" section from Settings (now 5 sections). Collapse moved to a small arrow beside the chip; collapsed rail shows the avatar at the bottom. |
| `7f316c7` / `ee54500` | Keepance shield favicon (replaced the old projelli jellybean) + per-matter UI memory (returning to a matter restores the surface/tab/search you had open). |

CHANGELOG.md `[Unreleased]` carries the plain-language "rounds" narrative (rounds 15–18 are this session).

## Key architecture notes (for the next session)

- **Tabs, not accordion.** `src/components/settings/SettingsContent.tsx` — `AccordionSection` (legacy name) now renders a horizontal **tab strip** built by inspecting its `SubSection` children's props (`id`/`label`/`testid`/`containsMatch`). Only the active panel mounts. Tab button keeps `data-testid="{testid}-heading"` and an inner `<span data-testid="{testid}">` so the old `subheader-*` selectors still resolve; the content wrapper is `data-testid="subsection-{name}"`. First tab active by default; search auto-selects the first matching tab and dims non-matching ones.
- **Settings search index.** `SETTINGS_GROUP_SEARCH` (subId → {section, keywords}) + `groupKeywordMatch()` + `sectionScores` (label/key match = strong, group keyword = strong, description-only = weak) drive comprehensive search + the best-section auto-switch. Add keywords here when a new bespoke control is added to a group.
- **Account window** — `src/components/account/AccountWindow.tsx`. Opened via the `keepance:open-account` CustomEvent (dispatched by `AccountIdentity` in `ReimaginedSpine.tsx`, handled in `App.tsx`). Horizontal tabs (`account-tab-{id}`), **collapsed by default** (no tab selected → "Choose a section above to manage it."). Renders the account content directly (LicenseSettings, FirmSignIn+FirmAdminConsole, CostMetrics, Mail*/Mcp/Ollama). Account deep-links (`license`/`firm`/`costs`/`integrations`/`account`) are redirected here from the open-settings handler in App.tsx.
- **profileStore** (`src/stores/profileStore.ts`) — persisted solo/firm name + image (data URLs). **imageUpload** (`src/utils/imageUpload.ts`) — resizes to ≤256px PNG data URL. Both feed the rail chip, the Account window, and the onboarding "Make it yours" + firm-branding steps.
- **Data map dialog** (`src/components/privacy/DataMapDialog.tsx`) — the printable "where your data goes" doc is a single-open collapsible (first row open). Bodies stay **mounted** (hidden when collapsed) and `handlePrint`'s stylesheet force-shows `[hidden]`, so Print/Save-PDF still captures every section. Don't switch this to a Radix accordion (it unmounts → broken print).
- **Onboarding** is `GuidedOnboarding.tsx` (9 steps now), NOT FirstRunWizard (stale comment elsewhere). The "Make it yours" step is index 2; the Firm step (index 7) admin branch has the `FirmBranding` capture.
- **Extensions** (Advanced → Extensions tab) = three labelled areas: **Browse and install** (MarketplaceTab, the one Templates/Plugins toggle), **Installed plugins** (PluginsSettings, stray title removed), **Per-workflow AI model** (`TemplateModelSettings` — now a compact "pin a model to a workflow" picker; only overridden workflows render as rows). Catalog cards show a placeholder when a screenshot is missing/fails.
- **Design system:** the `kp` token layer + `src/components/ui/kp` component library (Button/IconButton/SearchField/SegmentedToggle/SurfaceToolbar/Eyebrow/etc.). Every surface follows Header → SurfaceToolbar (buttons → toggles → filters → search) → Content. Use these, not ad-hoc inline styles.

## Open items (none blocking; for Jameson / next session)

- **Account window default tab** — it currently opens collapsed (empty "Choose a section above" state) per the explicit "collapsed by default" request. Jameson may prefer it to default to the Account tab — flagged to him at session end; one-line change (`useState('')` → `useState('account')` in AccountWindow.tsx) if he wants it.
- **Pre-existing repo lint debt** (~1873 errors, mostly test-file unused-vars + `no-confusing-void-expression` across many files) is untouched by policy — only newly-changed files are kept lint-clean. There is no passing lint gate.
- Real-hardware spot-checks for the broader 3.0 work remain (see CURRENT-STATE doc) — unrelated to this UX workstream.

## How to preview locally

The main dev server on `:5173` runs over **HTTPS** (`KEEPANCE_DEV_HTTPS=1`), which Playwright/clean-URL previews reject. For a clean HTTP preview over Tailscale:

```bash
cd ~/keepance
unset KEEPANCE_DEV_HTTPS
nohup npx vite --host 0.0.0.0 --port 5174 --strictPort false > /tmp/keepance-vite-5174.log 2>&1 &
```

Then:
- Shell / account window / settings: `http://100.68.20.52:5174/?testMode=true&shell=new`
- Onboarding flow: `http://100.68.20.52:5174/?forceOnboarding=true&shell=new`

(The temporary 5174 server started this session was shut down at wrap-up — relaunch with the command above.)

## Orchestration notes that worked well

- Delegated the mechanical/contained slices to Sonnet background agents (broken-image fix, template-list cut-down, header removals, settings test rewrites) while doing the architectural tabs refactor inline. Agents were told never to run git/tsc/tests; the orchestrator verified centrally.
- Settings test rewrites were needed because the accordion → tab change altered the DOM contract (role=tab/aria-selected, active-panel-only, search-selects-tab). That pattern will recur if the tab model changes again.
