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

---

## Re-review — 2026-07-18

**Build reviewed:** `de08e929eb9c31c4cee3cfc9084f371c30b34c2d`

### Fresh live check

- Fresh X display: `:87` (not `:1` or `:251`)
- Fresh Vite port: `5197` (not `5174`)
- Fresh disposable Chromium profile with `--password-store=basic`
- Runtime-only feature enablement: the disposable browser profile set `localStorage['lantern:feature-flags']` to exactly `{"data-export-backup":true}` before the app loaded. No source, registry, or test files were changed.
- Test workspace: `?testMode=true`; no real client files were used.
- Teardown proven: the owned browser, Vite server, and X display stopped; ports `5197` and `9347`, display `:87`, and the disposable profile were all gone before this verdict was written.

### Fresh screenshots

| Screen | Evidence |
| --- | --- |
| Full panel copy | `2026-07-18-data-export-backup-rereview/01-data-export-panel-copy.png` |
| Prominent exclusions statement | `2026-07-18-data-export-backup-rereview/02-data-export-exclusions.png` |
| Human needs-review outcome | `2026-07-18-data-export-backup-rereview/03-data-export-needs-review.png` |

### Re-verdict

**Pass.** The panel now starts in ordinary language: it creates a JSON copy of CRM records that still have their original import data. The central warning says this is not a complete firm backup, and the adjacent, bold “Does not include” list makes the three missing categories unmistakable: documents and attachments, email files, and CRM records missing the needed import information. The unencrypted-file warning stays with that boundary.

The browser-only failure path also now speaks like a person: “This export needs review” and “No verified archive is being claimed.” The old raw engineering error is absent. The compact technical detail is no longer in the primary decision path, so the screen is clear before an advisor needs to understand the proof mechanics.

DESIGN-VERDICT: PASS
