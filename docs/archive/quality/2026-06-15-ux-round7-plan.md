# Keepance UX — ROUND 7 plan (2026-06-15, Jameson asleep — max autonomous)

Branch `feature/ux-round7-2026-06-15`, backup tag `pre-ux-round7-2026-06-15`. NOT deployed.

## R7-1 — Settings collapse behavior
- **All sub-sections collapsed by default** (was: first open). 
- **You can collapse them all** (none open is allowed): clicking an open sub-section header now COLLAPSES it (was a no-op to keep one open). Keep "one open at a time" within a section (opening one closes the others), but zero-open is valid.
- Search still expands the sub-sections that contain a match.
- File: `src/components/settings/SettingsContent.tsx`. Also apply the new `SurfaceHeader` to the Settings page (Settings icon + "Settings" + a short description) — part of R7-2 but lives in this file.

## R7-2 — Standardize every surface header (match "Matters")
Jameson: the top header area is inconsistent across tabs; standardize so each reads like Matters —
`[navy icon] Title` with a short muted description below. New shared primitive `src/components/layout/SurfaceHeader.tsx`
(already created, matches the Matters header exactly: icon 18px navy, title 22px/700 navy, description 13px muted,
optional right-side actions slot). Apply it at the TOP of every surface, using the SAME icon as the nav item:
- **Matters** (`ReimaginedMattersHome`) — Briefcase + entityLabel.Other + the existing "N matters. Click a row to focus AI on that client." (refactor its existing header to use SurfaceHeader; this IS the reference).
- **Search** (`ReimaginedAsk`) — Sparkles + "Search" + "Find anything across your work. Every answer cites its source."
- **Documents** (`ReimaginedDocumentsHome`) — FolderTree + "Documents" + "Your files and folders, on your computer." (a compact header above the Files-tab strip).
- **Email** (`ReimaginedEmailWorkspace`) — Mail + "Email" + "Search, read, and file your email."
- **Workflows** (`ReimaginedAssociateHome`) — ListChecks + "Workflows" + the existing "your tireless associate, N ready" line.
- **Activity Log** (`ReimaginedAuditHome`) — ShieldCheck + "Activity Log" + the existing "every AI request + file change, exportable" line.
- **Settings** (`SettingsContent`) — Settings(gear) + "Settings" + a short description.
Keep each surface's existing primary actions (New matter, New email, scope toggles, etc.) — pass them into the
header's `actions` slot or keep them where they are, but the icon+title+description block must be the standard one.
Match the navy/Satoshi/light theme; entity-label-aware where relevant; no em-dashes.

## Waves
R7-2 surfaces (Agent B: the 6 non-settings surfaces) and R7-1 + Settings header (Agent A: SettingsContent) run in
PARALLEL (disjoint files; both import the already-created SurfaceHeader). Verify + commit; then verify + merge.

## Verification gate
typecheck 0 · full vitest · eslint clean on touched · live sweep (every tab's header reads [icon] Title +
description, consistent; Settings sub-sections all collapsed by default + collapse-all works; citations survive
nav; --kp-navy ok; zero errors). Master ledger: `2026-06-14-ux-program-LEDGER.md`.
