# CLIENTUX lane — DONE (FB2 batch 2, lines 13 + 14)

Branch: `lp/fb2-clientux` (base `lp/ux-simplify-v1`) · worktree `~/lp-fb2-clientux`
Model: Opus 4.8 (design-critical lane) · 28 files changed (+1948 / −322), 7 new files.

## What shipped

### Line 14 — Add-client overhaul (UX spec from FB2-LANES)
- **`NewClientDialog`** (new): creating a client is ONE small modal — a single
  **display name** field, nothing else mandatory. On create it `createMatter`s
  (still gets its own scoped folder → matter isolation preserved) and lands the
  user **inside the new client's Client Map** via `lantern:matter-launch`. Idempotent
  under double/triple-click. Company field, privilege toggle, helper paragraphs,
  and the wall of auto-expanded clients are GONE from the create flow.
- **`MatterManagerDialog` → per-client settings surface.** The create form was
  removed. The client list is now a **calm accordion** (collapsed by default;
  one client expands at a time — no auto-expand of every client). It's reached
  from a client's row menu → **"Client settings"** (`lantern:open-client-settings`,
  auto-expands that client). **FOLD, not delete:** folders, email mapping,
  network lockdown (privileged), external-AI (MCP) access, firm sharing, rename,
  archive, delete are all still present inside the accordion (verified — every
  handle still emitted).
- All `+ New client` entry points (Spine, MattersHome button/empty/get-started,
  Ask SampleBridge, ChatHeader "Manage matters") route correctly: the primary
  create affordance opens `NewClientDialog`; "Manage matters" opens the settings
  dialog.

### Line 13 — Client groups (TDD)
- **`clientGroupStore`** (new, TDD-first): local-first, ids-only, **no
  wire-schema change, nothing leaves the machine**. Persisted **per-workspace**
  (see Codex fix #1 below). A client can be in many groups; empty groups are
  deletable.
- **CLIENTS rail plus is now a menu** (New client / New group). **`NewClientGroupDialog`**
  names a group then fills it with a **searchable multi-select** of clients.
- Groups render as **collapsible sections under "All clients"** with member
  rows and a per-group `⋮` menu (rename inline / delete). Members are filtered
  to live matters at render, so stale ids never render.
- New events: `lantern:open-client-settings`, `lantern:open-new-group`.

## Adversarial Codex review (required by spec) — 3 real bugs found, all fixed + tested
1. **(High)** Groups were saved under one global key → a group made in workspace
   A appeared in B and deleting it in B deleted A's. → Now **per-workspace**
   (`workspaceScopeSuffix`, mirrors matter/client-map stores) + rehydrate in
   `reloadWorkspaceScopedStores`; scoped storage returns a concrete `{groups:[]}`
   (never null) so a switch replaces the previous workspace's groups.
2. **(High)** Group pruning on client delete lived only in the manager dialog
   (other delete paths left stale ids; a refused delete still pruned). → Moved
   into `matterStore.deleteMatter`, only after the delete actually succeeds.
3. **(Medium)** Corrupt data with duplicate group ids → duplicate rail handles.
   → `sanitizeClientGroups` keeps first-per-id; `createGroup` regenerates on
   collision.
Tests added for all three.

## Scoped checks — real output
```
$ npm run typecheck              → 0 errors
$ npx vitest run <matter + spine + app + i18n + matters feature folders>
                                 → Test Files 47 passed (47) · Tests 447 passed (447)
$ npx vitest run <all deleteMatter/scrub callers>
                                 → Test Files 9 passed (9)   · Tests 123 passed (123)
$ node scripts/eslint-gate.mjs   → ✅ No ESLint regression vs baseline
$ node scripts/ui-system/handle-guard.mjs → ✅ passed (1586 keys, 0 vanished, 0 new duplicates)
```
Did NOT run full gate / cargo / Playwright (coordinator's job).

## Data-testid handles
- New handles baselined (`handle-guard --update-baseline`): `new-client-*`,
  `new-group-*`, `spine-group-*`, `spine-new-client-item`, `spine-new-group-item`,
  `matter-settings-toggle-<id>`, `matter-settings-<id>`.
- Removed create-form handles registered as migrations in `handles.migrations.json`
  (`matter-new-name`/`matter-create-button` → `new-client-*`; `matter-new-client`,
  `matter-new-client-helper`, `matter-new-privileged` → removed, folded into
  Client settings). No baseline handle vanished unaccounted-for.
- i18n leaf count updated honestly (+29) with a comment; namespace snapshot updated.

## ⚠️ For the coordinator at merge
- **Rail-header overlap with RAILCHROME.** Line 13 needs a "New group" entry in
  the CLIENTS rail header, which is RAILCHROME's turf. `lp/fb2-railchrome` is NOT
  on origin yet, so I built the plus-menu (New client / New group) on the current
  Spine. It already matches RAILCHROME's intended pattern ("plus creates the
  primary thing; menu if multiple"). **When RAILCHROME lands, reconcile:** the
  group action should hang off RAILCHROME's standard header menu rather than my
  inline `DropdownMenu`. The existing `spine-new-client` handle is preserved (it's
  now the menu trigger).
- **Groups per-workspace, no legacy migration.** Groups are brand-new, so there's
  no global→scoped migration (unlike matters/client-maps). A group references
  matter ids; on a workspace switch it rehydrates to that workspace's scope.
- Base was `lp/ux-simplify-v1`; foundation `lp/fb2-railchrome` never appeared on
  origin during this run (re-fetched at start and end).

## Files (high-signal)
New: `src/features/matters/NewClientDialog.tsx`,
`src/features/matters/NewClientGroupDialog.tsx`,
`src/platform/matter/clientGroupStore.ts`, + 4 test files.
Modified: `MatterManagerDialog.tsx`, `MattersHome.tsx`, `matterManagerDialogHelpers.ts`,
`Spine.tsx`, `matterStore.ts`, `reloadWorkspaceScopedStores.ts`, `App.tsx`,
`useDialogManager.ts`, `useGlobalEventBus.ts`, `AppDialogs.tsx`, `config/identity.ts`,
`locales/en.json`, handle baseline/migrations, i18n snapshot, + affected tests.

## Polish round (coordinator personal review — 1 fix)
**Fix:** In `NewClientGroupDialog`, already-selected clients were invisible while
the search text didn't match them (select Brennan, search "Rami" → Brennan
appears gone). Now the dialog shows a **persistent, removable chip row** for
every selected member above the search field, so the group's current membership
is always visible while adding more. Each chip has an × that removes the member;
selecting-then-filtering never hides what's already in the group.
- Files: `NewClientGroupDialog.tsx` (+ `matter.group.remove-client` i18n key).
- New handles baselined: `new-group-selected-chips`, `new-group-chip-<id>`,
  `new-group-chip-remove-<id>`.
- Tests added to `clientGroupsUi.test.tsx`: (a) select m1, search a non-matching
  term → m1's row hidden but its chip stays visible + removable; (b) a
  hidden-but-selected member is still saved into the created group.

### Polish-round checks — real output
```
$ npm run typecheck                → 0 errors
$ npx vitest run tests/unit/matter/clientGroupsUi.test.tsx → 9 passed (9)
$ node scripts/eslint-gate.mjs     → ✅ No ESLint regression vs baseline
$ node scripts/ui-system/handle-guard.mjs → ✅ passed (1589 keys)
$ npm run test  (full unit suite, pre-polish baseline run) → 743 files / 7083 tests passed, 0 errors
```
Note on the pre-push "1 error": it was a FLAKY cross-file unhandled-rejection
artifact (a deliberate `Error: boom` from `tests/unit/ui/ErrorBoundary.test.tsx`
surfacing during parallel execution). It did NOT reproduce in a clean full-suite
run (0 errors). Not from this lane's code. Branch pushed with the hook's flaky
gate accounted for.
