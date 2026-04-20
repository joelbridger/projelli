# Projelli v1.6 Release Tracking

> **Current state:** `v1.6.0-rc.4` published as pre-release on 2026-04-20.
> Awaiting Jameson's Windows dogfood pass. If clean, tag `v1.6.0` final.
>
> **Integration branch:** `release/v1.6` (forked from `release/v1.5` after
> v1.5-rc.9 bug fix, 2026-04-17).
> **Commits since fork:** 147.

---

## Scope + Status

| Ticket | Description | Status |
|---|---|---|
| v1.5-rc.9 | Fix React #185 crash on AI chat | ✅ Done (shipped in v1.5) |
| W-SI | Windows silent install | ✅ Done in rc.4 (rc.1-3 had bug) |
| W-PX | Portable `.exe` artifact signed + uploaded | ✅ Done since rc.3 |
| T-AKT | API key tutorial in wizard + Settings + AI pane | ✅ Done |
| T-FT | Feature tour (expanded from 5 → 10 steps) | ✅ Done |
| R2+R3 | Tab/group UX overhaul (30+ commits) | ✅ Done |
| BUG-REPORT | "Something broken?" mailto link in status bar | ✅ Done in rc.4 |

## RC history

| Tag | Date | Outcome |
|---|---|---|
| `v1.6.0-rc.1` | 2026-04-17 | ❌ Failed: invalid `"updater"` in bundle.targets array |
| `v1.6.0-rc.2` | 2026-04-17 | ⚠️ Cancelled by Jameson mid-build to switch to dev-mode iteration |
| `v1.6.0-rc.3` | 2026-04-19 | ⚠️ Built green, but Windows silent install didn't work (`$PassiveMode=1` without `SetSilent`) |
| `v1.6.0-rc.4` | 2026-04-20 | ✅ Built green, published pre-release, **pending user dogfood** |

---

## What shipped in v1.6

### Installer (Windows)
- **Silent install default.** Double-clicking `Projelli_1.6.0_x64-setup.exe` shows only a brief progress window, no wizard. Pass `/INTERACTIVE` for the full wizard.
- **Portable `.exe`** (`Projelli_1.6.0_x64-portable.exe`) — Azure-signed single-file executable. See "Portable mode caveats" below.

### Onboarding
- **10-step feature tour** after first-run wizard. Every step anchors to a visible UI element (sidebar tabs, Ctrl+K button, settings gear) with a coral highlight outline. Arrow keys + Enter, Escape to skip, auto-advances if target missing. Restartable from Settings → Onboarding → "Start tour".
- **API key tutorial** reachable from three entry points (first-run wizard step 2, Settings → Onboarding, AI Assistant pane's "How to get API keys"). All three route to the same `ApiKeyWizard` component in `tutorialOnly` mode. Per-provider 5-step guides with prominent "Open API keys page" buttons that launch the provider's console in the default browser.

### Bug fixes
- **React #185 infinite loop** on AI chat — two root causes fixed:
  1. `AIChatViewer.loadAIRules` useEffect had `workspaceServiceRef` in its deps array (shipped in v1.5-rc.9).
  2. `ChatCostChip`'s Zustand selectors (`useChatCost`, `useTodayCost`) returned fresh objects per call, tripping React 18's `useSyncExternalStore` identity check. Fixed with `useShallow` + a module-level `EMPTY_BY_PROVIDER` stable empty object.
- **Bundle target validation** — dropped the invalid `"updater"` entry from `bundle.targets`. Updater artifacts are controlled by `createUpdaterArtifacts: true`.
- **New AI chat overwriting previous** (test-mode only) — mock workspace was missing `mkdir` + `list`, so chat-file reload failed after save and the sequential "Chat N" naming always resolved to "Chat 1".

### Tab + tab group UX (R2+R3, 2026-04-18 / 04-19)
Rewrote the drag/drop model around a unified zone-based pattern matching Chrome/VSCode/Arc:

- **Drop zones on every target** (tab OR chip):
  - Left 30% → reorder "before"
  - Middle 40% → combine (create group / join / merge / absorb)
  - Right 30% → reorder "after"
- **Interaction matrix:**
  - Tab → Tab (center) = create new group with both → opens "Name your group" dialog
  - Tab → Tab (edge) = reorder
  - Tab → Chip (center) = join that group
  - Tab → Chip (edge) = reorder relative to the chip's position
  - Chip → Tab (center) = group absorbs that tab
  - Chip → Tab (edge) = reorder the group's block to the tab's position
  - Chip → Chip (center) = merge groups
  - Chip → Chip (edge) = reorder groups
- **Tab Group Manager modal** — full drag support: within-group reorder, cross-group move, drop-on-Ungrouped-section to remove from group, drop-on-empty-group section to add.
- **Inline rename at every scale:** double-click tab, double-click chip, pencil in TabGroupManager row, pencil in editor title strip.
- **Removed** per-tab close X + 6-dot grip icon. Close now via right-click → Close / Close Others / Rename, middle-click, Ctrl+W, or TabGroupManager.
- **Editor title strip** shows the colored file-type icon + filename + pencil rename. Works whether the tab is visible in the bar or collapsed inside a group.
- **Brand Coral `#FF7C6E`** is the primary accent throughout (buttons, toggles, focus rings, tour highlight). Matches the press kit.

### Other
- `AuditLog` and `WorkflowPanel` sidebar headers tightened to fit the 256px sidebar slot (shorter titles, icon-only export buttons).
- **"Something broken? Let us know!"** link (bug icon, far-right of status bar) opens `mailto:jamesondaines@outlook.com` with pre-filled subject `Projelli <version> bug report` and body containing app version + OS + user agent.

---

## Critical architectural notes

These are non-obvious patterns that future Claude sessions or contributors need to know:

### Tab group chip is NOT a Radix DropdownMenu
The group chip in `TabBar.tsx` uses a **custom portal'd popover**, not `<DropdownMenu>`. Reason: Radix's `DropdownMenuTrigger` commits to opening on `pointerdown`, which interferes with the browser's HTML5 drag gesture detection — draggable elements need a clean pointerdown without popup interference. The custom popover opens on `click` (pointerup without movement) so drag can initiate instantly on any pointer movement.

Implementation: inline-rendered `<div role="menu">` portaled to `document.body` with `position: fixed` + coordinates captured from the chip's `getBoundingClientRect()` at click time. Click-outside + Escape handled via document-level listeners.

### Tab rendering is order-driven, not group-driven
`renderItems` in `TabBar.tsx` walks `openTabs` in order and emits a group chip at each group's **first appearance** (tracked via `seenGroups` Set). Ungrouped tabs render in their current openTabs position. This means groups and ungrouped tabs interleave freely — groups are NOT always rendered first. The `tabGroups` array order doesn't determine chip position; openTabs order does.

### Silent install requires BOTH settings
NSIS `.onInit` must call:
```nsis
StrCpy $PassiveMode 1
SetSilent silent
```
Setting `$PassiveMode` alone is NOT enough — the MUI pages ignore that variable. `SetSilent silent` is the runtime directive that actually skips the wizard. See `src-tauri/windows/installer-silent.nsi` lines 453-470.

### Dev mock workspace has full FS semantics
`src/App.tsx` has a mock `workspaceServiceRef` active when `?testMode=true`. It implements `exists`, `readFile`, `readFileBinary`, `writeFile`, `writeFileBinary`, `mkdir`, `list`, `stat`, `delete`, `rename`. Folder existence is synthesized from key prefixes. The `list(path)` returns `{name, path, type}` with type inferred from whether further `/`-prefixed keys exist. Keep this parity with `TauriFSBackend` or new features that touch folders will silently fail in dev mode.

### Drag-and-drop payload prefixes
All drag events use `dataTransfer.setData('text/plain', payload)`:
- Tabs: numeric string (the tab's index in openTabs)
- Groups: `"group:<groupId>"` prefix
- Tab Group Manager rows: `"tabgm:<path>"` prefix
Handlers branch on `payload.startsWith('group:')` vs `startsWith('tabgm:')` vs numeric.

### Brand Coral in one place
`src/styles/globals.css` defines `--color-primary: hsl(6 100% 72%)` for both light and dark themes. Any new surface that needs the accent should use `text-primary` / `bg-primary` Tailwind classes and inherit. Hard-coded hex `#FF7C6E` only appears in `FeatureTour.tsx` (highlight border) and `ProjelliLogo.tsx` (SVG fills).

---

## Test results (at rc.4)

- **Vitest**: 811 / 811 pass (baseline + 14 tutorial-content + 9 feature-tour tests)
- **Targeted Playwright E2E** (chromium): 18/18 pass
  - `tab-bar-scroll`, `ai-assistant-tab`, `drag-drop-repeated`, `drag-drop-upload`, `v1.6-feature-tour`, `api-keys-panel`
- **MCP browser dogfood**: multi-round manual verification of every drop path, rename flow, popover interaction.
- **Pre-existing baseline failures** (unchanged from v1.5): ~15 visual-snapshot + theme-persistence specs that predate this branch.

---

## Portable mode caveats

Document these for release notes + docs + launch-day reply bank:

- **Data still saves to `%APPDATA%\Projelli`.** The portable binary does NOT save config / workspaces next to itself. This is a Tauri limitation (`dirs::data_dir()` returns absolute paths). Users who move the portable `.exe` between drives should also copy `%APPDATA%\Projelli`. True self-contained portable data is a v1.7 item.
- **Auto-updater is disabled in portable mode.** The updater requires a writable install dir + permission to replace the running binary. Portable users re-download manually.
- **MCP `.mcpb` sidecar is NOT bundled.** The portable `.exe` is a single file; the MCP server binary is a separate artifact the `.mcpb` install flow fetches. Portable users can't use the MCP server unless they also download the installer version.
- **First-run behavior is identical.** Welcome dialog, workspace picker, API key wizard, sample files, and the feature tour all work.
- **WebView2 required.** Pre-installed on Windows 11 and on most Windows 10 via Windows Update. ~2% of users may need to install it manually (prompt will show if missing). A bundled WebView2 runtime is a v1.7 consideration.

---

## Ship procedure (remaining)

When Jameson confirms rc.4 works on Windows:

1. `git tag v1.6.0 && git push origin v1.6.0`
2. Watch CI (`gh run watch <id>`). All 4 platforms must go green.
3. Per v1.5 procedure: **manual Windows updater-sign** (see `docs/operations/SESSION_2026-04-16_v1.0.8_SHIP.md` Phase 8 Step 2) until the CI patch lands.
4. **Patch `latest.json`** to merge the Windows `windows-x86_64` entry (until updater-sign CI fix).
5. `gh release edit v1.6.0 --draft=false --latest --prerelease=false --repo projelli/projelli`
6. Fast-forward merge to master: `git checkout master && git pull && git merge --ff-only release/v1.6 && git push`
7. Deploy website: `cd ~/projelli && ./infra/deploy.sh`
8. Optional: announce via blog + email list (drafts at `website/blog/projelli-1-6-launch.html` if created).

---

## Commit log

Use `git log --oneline release/v1.6 ^master` (147 commits at rc.4). Highlights are captured in `CHANGELOG.md`.
