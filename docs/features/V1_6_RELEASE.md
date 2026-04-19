# Projelli v1.6 Release Tracking

> Ticket-by-ticket status for v1.6. Mirrors V1_5_RELEASE.md shape.
>
> **Plan:** `docs/features/V1_6_PLAN.md`
> **Integration branch:** `release/v1.6` (forked from `release/v1.5` after v1.5-rc.9 bug fix)
> **Created:** 2026-04-17

---

## Scope

| Ticket | Description | Status |
|---|---|---|
| v1.5-rc.9 | Fix React #185 crash on AI chat / Pop-out | ✅ Done |
| W-SI | Windows silent install (NSIS passive mode default) | ✅ Done |
| W-PX | Portable .exe artifact signed and uploaded to releases | ✅ Done |
| T-AKT | API key tutorial content in wizard + Settings entry | ✅ Done (4/4) |
| T-FT | 5-step feature tour after first-run | ✅ Done (6/6) |

## Phase status

| Phase | Work | Status |
|---|---|---|
| Phase 1 | Bug fix (ships as v1.5-rc.9) | ✅ Done |
| Phase 2 | Branch + version bump | ✅ Done |
| Phase 3 | Silent install | ✅ Done |
| Phase 4 | Portable .exe | ✅ Done |
| Phase 5 | API key tutorials | ✅ Done |
| Phase 6 | Feature tour | ✅ Done |
| Phase 7 | RC + extensive Playwright + publish prep | 🟡 RC build in flight |

## Portable mode caveats

Document these for release notes + docs + launch-day reply bank:

- **Data still saves to `%APPDATA%\Projelli`.** The portable binary does NOT save config / workspaces next to itself. This is a Tauri limitation (`dirs::data_dir()` returns absolute paths). Users who move the portable .exe between drives should also copy `%APPDATA%\Projelli`. True self-contained portable data is a v1.7 item.
- **Auto-updater is disabled in portable mode.** The updater requires a writable install dir + permission to replace the running binary. Portable users re-download manually.
- **MCP `.mcpb` sidecar is NOT bundled.** The portable .exe is a single file; the MCP server binary is a separate artifact the `.mcpb` install flow fetches. Portable users can't use the MCP server unless they also download the installer version.
- **First-run behavior is identical.** Welcome dialog, workspace picker, API key wizard, sample files, and the new feature tour all work.
- **WebView2 required.** Pre-installed on Windows 11 and on most Windows 10 via Windows Update. ~2% of users may need to install it manually (prompt will show if missing). A bundled WebView2 runtime is a v1.7 consideration.

## Test results

- **Vitest**: 811 pass / 0 fail (baseline + 14 tutorial-content + 9 feature-tour tests)
- **Targeted E2E (chromium)**: 18/18 pass across tab-bar, drag-drop, AI assistant, API keys, and v1.6 feature tour specs.
- **MCP browser dogfood**: multi-round manual test of every new tab + group UX path — all verified.

## Round 2 + 3 UX work (2026-04-18 / 04-19)

Triggered by extensive dogfooding once rc.2 was paused. Twenty-nine commits landed across two rounds rewriting the tab/group interaction model around a unified zone-based drop system that matches Chrome/VSCode/Arc patterns.

Highlights:
- **Fixed a second root cause of the v1.5 Pop-out crash** — ChatCostChip Zustand selectors were returning fresh objects on every call, tripping React 18's `useSyncExternalStore` identity check. `useShallow` + a stable empty `byProvider` constant.
- **Swapped the Radix DropdownMenu on group chips for a custom portal'd popover** so HTML5 drag initiates on the first few pixels of pointer movement (Radix's pointerdown handling blocked native drag on the draggable element).
- **Unified drop zones** — every drop target (tab or chip) has the same three-zone behavior: left 30% = reorder 'before', middle 40% = combine (create group / join / merge / absorb), right 30% = reorder 'after'.
- **Inline rename at every scale** — tab dblclick, chip dblclick, modal pencil, editor-title pencil. New-group creation auto-opens a "Name your group" dialog with the placeholder pre-selected.
- **Full drag-and-drop inside the Tab Group Manager modal** with drop zones for within-group reorder, cross-group move, and ungroup.
- **Removed the per-tab close X and grip dot**; replaced with a right-click context menu (Rename / Close / Close Others).
- **Editor title strip** now shows the colored file-type icon + filename + pencil rename, matching the file tree and tab bar.
- **Brand Coral `#FF7C6E` accent** across the app (buttons, toggles, focus rings, tour highlight).

## Ship procedure (Phase 7+8)

When ready to publish:
1. `git push origin release/v1.6`
2. `git tag v1.6.0-rc.1 && git push origin v1.6.0-rc.1` — CI builds signed installer + portable
3. Dogfood rc.1 on Windows (silent install, portable .exe, tour, tutorial)
4. If clean: `git tag v1.6.0 && git push origin v1.6.0`
5. Per v1.5 procedure: manual Windows updater-sign + patch `latest.json`
6. `gh release edit v1.6.0 --draft=false --latest --repo projelli/projelli`
7. Fast-forward merge to master, then `cd ~/projelli && ./infra/deploy.sh`

## Commit log

All v1.6 commits on `release/v1.6` since fork point. See `git log --oneline release/v1.6 ^master`.
