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

- **Vitest**: 808 pass / 0 fail (baseline + 14 new tutorial-content tests + 9 new feature-tour tests)
- **Playwright (chromium, full sweep)**: 231 pass / 15 fail / 4 skipped
  - The 15 failures are the **same pre-existing v1.5 baseline failures** (visual snapshots, ai-assistant-tab tests that pre-date this branch, theme persistence in test mode). v1.6 adds **two new passes** (the dedicated v1.6-feature-tour spec) and zero new failures.
- **Targeted v1.6 regression**: api-keys-panel + v1.6-feature-tour = 9/9 pass

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
