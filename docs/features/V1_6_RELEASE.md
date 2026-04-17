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

## Commit log

(Appended as phases complete.)
