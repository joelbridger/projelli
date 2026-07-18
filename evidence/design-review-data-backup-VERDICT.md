# Design review — Data export / backup

**Build reviewed:** `5c1895683c27b783e59d278907d01365e3416fc6`

**Review date:** 2026-07-18
**Scope:** the new Settings panel only. Navigation and information architecture were not judged, as requested.

## Review setup

This was a fresh browser drive from this worktree. The first browser process exited before it could be driven; the second fresh display/browser attempt completed normally.

- Fresh X display: `:84` (not `:1` or `:251`)
- Fresh Vite port: `5184` (not `5174`)
- Disposable Chromium profile with `--password-store=basic`
- Runtime-only feature enablement: in that disposable browser profile, DevTools set `localStorage['lantern:feature-flags']` to exactly `{"data-export-backup":true}`, then reloaded the page. This is the development override read by the app’s flag router. No registry, source, or test file was changed.
- Test workspace: `?testMode=true`, so no real client files were used.

Teardown completed before this verdict: the owned browser, Vite server, and X display stopped; ports `5184` and `9239` were free; display `:84` was free; and the disposable profile was removed.

## Screens reviewed

| Screen | Evidence |
| --- | --- |
| Settings with the visible Data export panel | `2026-07-18-data-export-backup/01-settings-data-export-visible.png` |
| Pre-export panel and its stated claims | `2026-07-18-data-export-backup/02-data-export-pre-export-claims.png` |
| Keyboard focus on the export button | `2026-07-18-data-export-backup/03-data-export-keyboard-focus.png` |
| Browser-run failure state | `2026-07-18-data-export-backup/04-data-export-needs-review.png` |

## What works

- The panel looks like a real member of the existing light Settings family: same white working area, dark type, thin blue-gray dividers, compact form rhythm, warning color, and red action treatment. It does not introduce a competing visual system.
- The warning is impossible to miss. “This is not a complete firm backup” is a strong, appropriately honest headline.
- The button has a plain visible name, uses a real button, and receives a clear red two-pixel keyboard focus ring. In the driven order, Tab moved from the export button to the persistent bug-report control and Shift+Tab returned to the export button. The panel’s heading structure is also sensible (`Data export`, then the includes heading).
- The static warning gives a user a useful first truth: this tool is not a full firm backup.

## Required changes

1. **Rewrite the user-facing scope in ordinary advisor language.** The opening sentence and most of the “includes” list use implementation words such as “source type,” “source ID,” “source payload,” “fidelity rows,” “manifest,” “reconciled,” and “contract.” An advisor cannot reliably tell what will be saved from that language. Start with the plain result (for example, “This creates a JSON copy of eligible CRM import records”) and move technical proof details behind a secondary “details for your tech team” disclosure if they must remain visible.

2. **Make the exclusions easy to scan and just as prominent as the promise.** The screen does say that workspace documents and email files are excluded, but it is a small, pale paragraph buried after dense technical copy. From the screen alone, a user could still mistake this for a usable backup of their client files. Put a short, high-contrast “Does not include” list directly below the warning: documents and attachments, email files, and any CRM record missing the required import data. Keep the decrypted-file warning with that list.

3. **Never show an engineering error after an export click.** In this browser drive the native writer was unavailable, and the panel rendered `Cannot read properties of undefined (reading 'invoke')`. That is neither understandable nor the promised safe review state. The UI must instead say plainly that the archive could not be checked, it needs review, and no verified archive is being claimed. This is especially important because the pre-export badge says “needs review”; the action outcome must carry that same honest language.

## Truth-in-UI result

**Not yet clear enough to pass.** The main limitation is honestly signposted, but the exact boundary of what is and is not included is not unmistakable to a non-engineering advisor. The generic failure message makes that trust problem worse when the export cannot run.

DESIGN-VERDICT: CHANGES-3
